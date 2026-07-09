from decimal import Decimal

from django.contrib.auth import get_user_model
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from expenses.models import Expense, ExpenseParticipant, Group, GroupMembership, ImportAnomaly, ImportBatch, Settlement
from expenses.serializers import (
    ExpenseSerializer, GroupMembershipSerializer, GroupSerializer,
    ImportAnomalySerializer, ImportBatchSerializer, SettlementSerializer,
)
from expenses.services.balances import balance_trail_for_user, net_balance_for_group, simplify_debts
from expenses.services.importer import ImportEngine, rows_from_xlsx
from expenses.services.report import build_report, render_report_text
from expenses.services.resolution import ResolutionError, resolve_anomaly
from expenses.services.splitting import ShareInput, SplitError, compute_split

User = get_user_model()


class GroupViewSet(viewsets.ModelViewSet):
    serializer_class = GroupSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        return Group.objects.filter(memberships__user=self.request.user).distinct()

    def perform_create(self, serializer):
        group = serializer.save(created_by=self.request.user)
        # Creator is automatically an admin member. joined_at defaults to
        # today, but can be backdated via creator_joined_at - necessary
        # when a group is being set up specifically to import historical
        # data (like this assignment's Feb-onward CSV), where the creator
        # was a member long before the app existed.
        joined_at = self.request.data.get("creator_joined_at") or group.created_at.date()
        GroupMembership.objects.create(group=group, user=self.request.user, joined_at=joined_at, role="admin")

    @action(detail=True, methods=["post"])
    def add_member(self, request, pk=None):
        group = self.get_object()
        user_id = request.data.get("user_id")
        joined_at = request.data.get("joined_at")
        if not user_id or not joined_at:
            return Response({"detail": "user_id and joined_at required"}, status=400)
        membership = GroupMembership.objects.create(group=group, user_id=user_id, joined_at=joined_at)
        return Response(GroupMembershipSerializer(membership).data, status=201)

    @action(detail=True, methods=["post"], url_path="members/(?P<membership_id>[^/.]+)/leave")
    def remove_member(self, request, pk=None, membership_id=None):
        """Sets left_at rather than deleting the row - membership history
        must be preserved (Sam shouldn't retroactively vanish from March)."""
        group = self.get_object()
        membership = get_object_or_404(GroupMembership, id=membership_id, group=group, left_at__isnull=True)
        left_at = request.data.get("left_at")
        if not left_at:
            return Response({"detail": "left_at required"}, status=400)
        membership.left_at = left_at
        membership.save(update_fields=["left_at"])
        return Response(GroupMembershipSerializer(membership).data)

    @action(detail=True, methods=["get"])
    def balances(self, request, pk=None):
        group = self.get_object()
        raw_balances = net_balance_for_group(group)
        users_by_id = {u.id: u for u in User.objects.filter(id__in=raw_balances.keys())}
        summary = [
            {"user_id": uid, "display_name": users_by_id[uid].display_name, "net_balance": str(amt)}
            for uid, amt in raw_balances.items()
        ]
        settlements_needed = [
            {
                "from_user_id": frm, "from_name": users_by_id[frm].display_name,
                "to_user_id": to, "to_name": users_by_id[to].display_name,
                "amount": str(amt),
            }
            for frm, to, amt in simplify_debts(raw_balances)
        ]
        return Response({"summary": summary, "settlements_needed": settlements_needed})

    @action(detail=True, methods=["get"], url_path="balances/(?P<user_id>[^/.]+)/trail")
    def balance_trail(self, request, pk=None, user_id=None):
        group = self.get_object()
        user = get_object_or_404(User, id=user_id)
        trail = balance_trail_for_user(group, user)
        return Response([
            {
                "kind": l.kind, "date": l.date, "description": l.description,
                "amount": str(l.amount), "expense_id": l.expense_id, "settlement_id": l.settlement_id,
            }
            for l in trail
        ])


class ExpenseViewSet(viewsets.ModelViewSet):
    serializer_class = ExpenseSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        qs = Expense.objects.filter(group__memberships__user=self.request.user).distinct()
        group_id = self.request.query_params.get("group")
        if group_id:
            qs = qs.filter(group_id=group_id)
        category = self.request.query_params.get("category")
        if category:
            qs = qs.filter(category=category)
        date_from = self.request.query_params.get("date_from")
        if date_from:
            qs = qs.filter(date__gte=date_from)
        date_to = self.request.query_params.get("date_to")
        if date_to:
            qs = qs.filter(date__lte=date_to)
        return qs.order_by("-date")

    def create(self, request, *args, **kwargs):
        """
        Manual create (not the default ModelViewSet flow) because expense
        creation has to run through the same split engine the importer
        uses - the client sends raw split inputs (percentages, shares,
        exact amounts), and this computes + validates share_amount
        server-side rather than trusting whatever the frontend sends.
        """
        data = request.data
        group = get_object_or_404(Group, id=data["group"])
        if not GroupMembership.objects.filter(group=group, user=request.user).exists():
            return Response({"detail": "not a member of this group"}, status=403)

        currency = data.get("currency", "INR")
        amount = Decimal(str(data["original_amount"]))
        rate = Decimal(str(data.get("exchange_rate_used", "1")))
        converted = (amount * rate).quantize(Decimal("0.01"))

        inputs_raw = data.get("participant_inputs", [])
        share_inputs = [
            ShareInput(str(i.get("user_id") or i.get("guest_name")), Decimal(str(i["raw_value"])) if i.get("raw_value") is not None else None)
            for i in inputs_raw
        ]
        try:
            computed = compute_split(data["split_type"], converted, share_inputs)
        except SplitError as e:
            return Response({"detail": str(e)}, status=400)

        expense = Expense.objects.create(
            group=group, paid_by_id=data["paid_by"], title=data["title"],
            description=data.get("description", ""), category=data.get("category", ""),
            date=data["date"], currency=currency, original_amount=amount,
            exchange_rate_used=rate, converted_inr_amount=converted, split_type=data["split_type"],
        )
        for share, raw in zip(computed, inputs_raw):
            ExpenseParticipant.objects.create(
                expense=expense, user_id=raw.get("user_id"), guest_name=raw.get("guest_name", ""),
                share_amount=share.share_amount, share_input=share.share_input,
            )
        return Response(ExpenseSerializer(expense).data, status=201)


class SettlementViewSet(viewsets.ModelViewSet):
    pagination_class = None
    serializer_class = SettlementSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = Settlement.objects.filter(group__memberships__user=self.request.user).distinct()
        group_id = self.request.query_params.get("group")
        if group_id:
            qs = qs.filter(group_id=group_id)
        return qs.order_by("-date")


class ImportUploadView(APIView):
    """POST /api/groups/{group_id}/import/ with a multipart file field named
    'file' - either .csv or .xlsx. Runs detection immediately; returns the
    batch with all anomalies attached. Nothing is final until anomalies are
    resolved."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, group_id):
        group = get_object_or_404(Group, id=group_id)
        if not GroupMembership.objects.filter(group=group, user=request.user).exists():
            return Response({"detail": "not a member of this group"}, status=403)

        upload = request.FILES.get("file")
        if not upload:
            return Response({"detail": "file field required"}, status=400)

        name_lower = upload.name.lower()
        engine = ImportEngine(group, request.user, filename=upload.name)

        try:
            if name_lower.endswith(".xlsx"):
                rows = rows_from_xlsx(upload)
                batch = engine.run_rows(rows)
            elif name_lower.endswith(".csv"):
                csv_text = upload.read().decode("utf-8-sig")
                batch = engine.run(csv_text)
            else:
                return Response({"detail": "unsupported file type - upload a .csv or .xlsx file"}, status=400)
        except Exception as e:
            # A parsing failure here means the file itself couldn't be read
            # (corrupt, wrong format despite the extension, old .xls saved
            # with an .xlsx name, etc.) - not a row-level data problem, which
            # is instead surfaced as an ImportAnomaly. Return the real
            # exception message so it's visible without digging through
            # server logs.
            return Response(
                {"detail": f"could not read {upload.name}: {type(e).__name__}: {e}"},
                status=400,
            )

        return Response(ImportBatchSerializer(batch).data, status=201)


class ImportAnomalyResolveView(APIView):
    """POST /api/anomalies/{id}/resolve/  {"action": "...", ...extra fields}"""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, anomaly_id):
        anomaly = get_object_or_404(ImportAnomaly, id=anomaly_id)
        if not GroupMembership.objects.filter(group=anomaly.import_batch.group, user=request.user).exists():
            return Response({"detail": "not a member of this group"}, status=403)

        action_name = request.data.get("action")
        kwargs = {k: v for k, v in request.data.items() if k != "action"}
        try:
            resolve_anomaly(anomaly, action_name, resolved_by=request.user, **kwargs)
        except ResolutionError as e:
            return Response({"detail": str(e)}, status=400)
        return Response(ImportAnomalySerializer(anomaly).data)


class ImportReportView(APIView):
    """GET /api/import-batches/{id}/report/  -> JSON
       GET /api/import-batches/{id}/report/?download=text -> downloadable .txt

    Note: this deliberately does NOT use DRF's built-in ?format= query
    param (e.g. ?format=json) - that's reserved by DRF's content
    negotiation system and gets intercepted before it reaches the view,
    which caused a confusing 404 during testing rather than reaching this
    code at all. `download` avoids the collision.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, batch_id):
        batch = get_object_or_404(ImportBatch, id=batch_id)
        if not GroupMembership.objects.filter(group=batch.group, user=request.user).exists():
            return Response({"detail": "not a member of this group"}, status=403)

        if request.query_params.get("download") == "text":
            text = render_report_text(batch)
            response = HttpResponse(text, content_type="text/plain")
            response["Content-Disposition"] = f'attachment; filename="import_report_{batch.id}.txt"'
            return response

        return Response(build_report(batch))