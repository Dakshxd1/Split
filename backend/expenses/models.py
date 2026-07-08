from django.conf import settings
from django.db import models

User = settings.AUTH_USER_MODEL


class Group(models.Model):
    name = models.CharField(max_length=100)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name="groups_created")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class GroupMembership(models.Model):
    """
    This table is the whole answer to Sam's question ('why would March
    electricity affect my balance') and to the Meera-still-in-the-list
    anomaly. joined_at/left_at are the only facts the balance engine trusts
    about who was 'in' the flat on a given date - not whatever a CSV row
    happens to list in split_with.

    left_at is nullable: null means still an active member. A person can
    have multiple rows if they leave and rejoin later (explicitly required
    by the assignment: 'users can rejoin').
    """
    ROLE_CHOICES = [("admin", "Admin"), ("member", "Member")]

    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="memberships")
    joined_at = models.DateField()
    left_at = models.DateField(null=True, blank=True)
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default="member")

    class Meta:
        indexes = [models.Index(fields=["group", "user", "joined_at"])]

    def is_active_on(self, date) -> bool:
        if self.joined_at > date:
            return False
        if self.left_at is not None and self.left_at < date:
            return False
        return True

    def __str__(self):
        return f"{self.user} in {self.group} ({self.joined_at} - {self.left_at or 'active'})"


class Expense(models.Model):
    """
    An Expense is money one person spent that others owe a share of.
    It is never a settlement - see the Settlement model below. The importer
    enforces that split at import time (see importer.py); this model doesn't
    re-derive it, it just refuses to be ambiguous about which one it is.
    """
    SPLIT_EQUAL = "equal"
    SPLIT_EXACT = "exact"
    SPLIT_PERCENTAGE = "percentage"
    SPLIT_SHARE = "share"
    SPLIT_UNEQUAL = "unequal"
    SPLIT_CHOICES = [
        (SPLIT_EQUAL, "Equal"),
        (SPLIT_EXACT, "Exact amount"),
        (SPLIT_PERCENTAGE, "Percentage"),
        (SPLIT_SHARE, "Share (weighted units)"),
        (SPLIT_UNEQUAL, "Unequal (explicit per-person amount)"),
    ]

    CURRENCY_CHOICES = [("INR", "INR"), ("USD", "USD")]

    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name="expenses")
    paid_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="expenses_paid")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=50, blank=True)
    date = models.DateField()

    currency = models.CharField(max_length=3, choices=CURRENCY_CHOICES, default="INR")
    original_amount = models.DecimalField(max_digits=12, decimal_places=2)
    exchange_rate_used = models.DecimalField(max_digits=8, decimal_places=4, default=1)
    converted_inr_amount = models.DecimalField(max_digits=12, decimal_places=2)

    split_type = models.CharField(max_length=20, choices=SPLIT_CHOICES)

    # Traceability back to the CSV row this came from, if it came from an
    # import. Null for expenses created directly in the app.
    source_row = models.IntegerField(null=True, blank=True)
    import_batch = models.ForeignKey(
        "ImportBatch", on_delete=models.SET_NULL, null=True, blank=True, related_name="expenses"
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["group", "date"])]

    def __str__(self):
        return f"{self.title} ({self.date}) - {self.original_amount} {self.currency}"


class ExpenseParticipant(models.Model):
    """
    This table is Rohan's requirement, directly: 'if the app says I owe
    2300, I want to see exactly which expenses make that up'. Every balance
    number the app ever shows is a sum over rows in this table, never a
    number computed and thrown away. share_amount is always in INR, always
    positive, and always sums (across an expense's participants) to that
    expense's converted_inr_amount - that invariant is enforced in
    services/splitting.py, not trusted from input.

    A participant can be a guest (Kabir on the parasailing trip) instead of
    a real User - guest_name is set and user is null in that case. Guests
    never get a GroupMembership row; they only ever exist inside a single
    Expense's participant list.
    """
    expense = models.ForeignKey(Expense, on_delete=models.CASCADE, related_name="participants")
    user = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True, related_name="expense_shares")
    guest_name = models.CharField(max_length=100, blank=True)

    share_amount = models.DecimalField(max_digits=12, decimal_places=2)
    # Raw input that produced share_amount, kept for auditability -
    # e.g. "30" for a 30% split, or "2" for a 2-share weighting.
    share_input = models.DecimalField(max_digits=8, decimal_places=4, null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(user__isnull=False) | ~models.Q(guest_name=""),
                name="participant_has_user_or_guest_name",
            )
        ]

    def __str__(self):
        who = self.user or self.guest_name
        return f"{who}: {self.share_amount} on {self.expense}"


class Settlement(models.Model):
    """
    A settlement is money that already changed hands to clear a balance.
    It is deliberately its own table, not an Expense with a special flag -
    that keeps 'sum of expenses I'm owed' and 'money actually transferred'
    from ever being computed by the same code path and silently blending.
    """
    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name="settlements")
    from_user = models.ForeignKey(User, on_delete=models.PROTECT, related_name="settlements_paid")
    to_user = models.ForeignKey(User, on_delete=models.PROTECT, related_name="settlements_received")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    date = models.DateField()
    note = models.CharField(max_length=200, blank=True)

    source_row = models.IntegerField(null=True, blank=True)
    import_batch = models.ForeignKey(
        "ImportBatch", on_delete=models.SET_NULL, null=True, blank=True, related_name="settlements"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.from_user} -> {self.to_user}: {self.amount} on {self.date}"


class ImportBatch(models.Model):
    """One CSV upload. Anomalies and the eventual report are scoped to this."""
    STATUS_CHOICES = [
        ("pending_review", "Pending review"),
        ("completed", "Completed"),
    ]
    filename = models.CharField(max_length=200)
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name="import_batches")
    uploaded_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending_review")
    total_rows = models.IntegerField(default=0)
    imported_rows = models.IntegerField(default=0)

    def __str__(self):
        return f"{self.filename} ({self.status})"


class ImportAnomaly(models.Model):
    """
    One detected problem in one CSV row. This table IS the import report -
    the report the app generates is a rendering of these rows, not a
    separate thing that has to be kept in sync.
    """
    SEVERITY_CHOICES = [("blocking", "Blocking"), ("warning", "Warning")]
    STATUS_CHOICES = [
        ("pending", "Pending review"),
        ("resolved", "Resolved"),
        ("rejected", "Row rejected, not imported"),
    ]
    ISSUE_CHOICES = [
        ("duplicate", "Duplicate expense"),
        ("conflicting_duplicate", "Duplicate with differing amount"),
        ("settlement_as_expense", "Settlement logged as expense"),
        ("negative_amount", "Negative amount"),
        ("malformed_amount", "Malformed amount"),
        ("zero_amount", "Zero amount"),
        ("missing_payer", "Missing payer"),
        ("unresolved_name", "Payer/participant name could not be matched"),
        ("missing_currency", "Missing currency"),
        ("invalid_date", "Corrupted or implausible date"),
        ("ambiguous_date", "Ambiguous date format"),
        ("non_member_participant", "Participant is not a group member"),
        ("membership_mismatch", "Participant not active member on expense date"),
        ("split_percentage_invalid", "Percentages do not sum to 100"),
        ("split_type_mismatch", "Split type label contradicts supplied share data"),
        ("other", "Other"),
    ]

    import_batch = models.ForeignKey(ImportBatch, on_delete=models.CASCADE, related_name="anomalies")
    row_number = models.IntegerField()
    raw_data = models.JSONField()
    issue_type = models.CharField(max_length=40, choices=ISSUE_CHOICES)
    severity = models.CharField(max_length=10, choices=SEVERITY_CHOICES)
    description = models.TextField()
    suggested_action = models.TextField(blank=True)
    chosen_action = models.TextField(blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending")

    resolved_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["import_batch", "status"])]
        verbose_name_plural = "import anomalies"

    def __str__(self):
        return f"Row {self.row_number}: {self.issue_type} ({self.status})"
