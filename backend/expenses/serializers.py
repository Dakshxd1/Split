from rest_framework import serializers

from accounts.serializers import UserSerializer
from expenses.models import (
    Expense, ExpenseParticipant, Group, GroupMembership, ImportAnomaly, ImportBatch, Settlement,
)


class GroupMembershipSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    user_id = serializers.IntegerField(write_only=True)

    class Meta:
        model = GroupMembership
        fields = ["id", "group", "user", "user_id", "joined_at", "left_at", "role"]
        read_only_fields = ["group"]


class GroupSerializer(serializers.ModelSerializer):
    memberships = GroupMembershipSerializer(many=True, read_only=True)
    active_member_count = serializers.SerializerMethodField()

    class Meta:
        model = Group
        fields = ["id", "name", "created_by", "created_at", "memberships", "active_member_count"]
        read_only_fields = ["created_by", "created_at"]

    def get_active_member_count(self, obj):
        return obj.memberships.filter(left_at__isnull=True).count()


class ExpenseParticipantSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = ExpenseParticipant
        fields = ["id", "user", "guest_name", "share_amount", "share_input"]


class ExpenseParticipantInputSerializer(serializers.Serializer):
    """What the client sends when creating an expense - not the same shape
    as the read serializer above, since on write we take raw share inputs
    (percentages, share counts, exact amounts) and compute share_amount
    server-side via services/splitting.py. The client never sends
    share_amount directly - that would let the frontend bypass the split
    invariant the balance engine depends on."""
    user_id = serializers.IntegerField(required=False, allow_null=True)
    guest_name = serializers.CharField(required=False, allow_blank=True, default="")
    raw_value = serializers.DecimalField(max_digits=10, decimal_places=4, required=False, allow_null=True)


class ExpenseSerializer(serializers.ModelSerializer):
    participants = ExpenseParticipantSerializer(many=True, read_only=True)
    participant_inputs = ExpenseParticipantInputSerializer(many=True, write_only=True)
    paid_by_detail = UserSerializer(source="paid_by", read_only=True)

    class Meta:
        model = Expense
        fields = [
            "id", "group", "paid_by", "paid_by_detail", "title", "description", "category", "date",
            "currency", "original_amount", "exchange_rate_used", "converted_inr_amount",
            "split_type", "participants", "participant_inputs", "source_row", "created_at",
        ]
        read_only_fields = ["converted_inr_amount", "exchange_rate_used", "created_at"]


class SettlementSerializer(serializers.ModelSerializer):
    from_user_detail = UserSerializer(source="from_user", read_only=True)
    to_user_detail = UserSerializer(source="to_user", read_only=True)

    class Meta:
        model = Settlement
        fields = [
            "id", "group", "from_user", "from_user_detail", "to_user", "to_user_detail",
            "amount", "date", "note", "created_at",
        ]
        read_only_fields = ["created_at"]


class ImportAnomalySerializer(serializers.ModelSerializer):
    class Meta:
        model = ImportAnomaly
        fields = [
            "id", "import_batch", "row_number", "raw_data", "issue_type", "severity",
            "description", "suggested_action", "chosen_action", "status",
            "resolved_by", "resolved_at", "created_at",
        ]
        read_only_fields = fields


class ImportBatchSerializer(serializers.ModelSerializer):
    anomalies = ImportAnomalySerializer(many=True, read_only=True)

    class Meta:
        model = ImportBatch
        fields = ["id", "filename", "group", "uploaded_by", "uploaded_at", "status", "total_rows", "imported_rows", "anomalies"]
        read_only_fields = fields


class BalanceLineSerializer(serializers.Serializer):
    kind = serializers.CharField()
    date = serializers.DateField()
    description = serializers.CharField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    expense_id = serializers.IntegerField(allow_null=True)
    settlement_id = serializers.IntegerField(allow_null=True)
