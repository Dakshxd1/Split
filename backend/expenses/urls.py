from django.urls import path
from rest_framework.routers import DefaultRouter

from expenses.views import (
    ExpenseViewSet, GroupViewSet, ImportAnomalyResolveView, ImportReportView,
    ImportUploadView, SettlementViewSet,
)

router = DefaultRouter()
router.register("groups", GroupViewSet, basename="group")
router.register("expenses", ExpenseViewSet, basename="expense")
router.register("settlements", SettlementViewSet, basename="settlement")

urlpatterns = router.urls + [
    path("groups/<int:group_id>/import/", ImportUploadView.as_view(), name="import-upload"),
    path("anomalies/<int:anomaly_id>/resolve/", ImportAnomalyResolveView.as_view(), name="anomaly-resolve"),
    path("import-batches/<int:batch_id>/report/", ImportReportView.as_view(), name="import-report"),
]
