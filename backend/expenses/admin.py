from django.contrib import admin

from expenses.models import (
    Expense, ExpenseParticipant, Group, GroupMembership, ImportAnomaly, ImportBatch, Settlement,
)

admin.site.register(Group)
admin.site.register(GroupMembership)
admin.site.register(Expense)
admin.site.register(ExpenseParticipant)
admin.site.register(Settlement)
admin.site.register(ImportBatch)
admin.site.register(ImportAnomaly)
