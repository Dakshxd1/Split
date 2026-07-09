"""
Run this from the backend/ directory with:

    python manage.py shell < seed_import_test.py

Creates the 6 real users referenced in expenses_export_assigbment_annex.xlsx,
one group, and backdated memberships that match the dates in that file.

Deliberately does NOT create users for "Priya S" or "Kabir" - those are
anomaly test cases (unresolved_name) in the source data. Creating users for
them would silently remove the anomalies the assignment wants you to test.
"""
from datetime import date
from accounts.models import User
from expenses.models import Group, GroupMembership

# --- 1. Create users ---
users_data = [
    ("aisha", "Aisha"),
    ("rohan", "Rohan"),
    ("priya", "Priya"),
    ("meera", "Meera"),
    ("dev",   "Dev"),
    ("sam",   "Sam"),
]

users = {}
for username, display_name in users_data:
    u, created = User.objects.get_or_create(
        username=username,
        defaults={"display_name": display_name},
    )
    if created:
        u.set_password("testpass123")
        u.save()
    users[display_name] = u
    print(f"{'created' if created else 'exists '} -> {display_name}")

# --- 2. Create the group ---
group, _ = Group.objects.get_or_create(
    name="Flatshare Feb-Apr 2026",
    defaults={"created_by": users["Aisha"]},
)
print(f"group -> {group.name} (id={group.id})")

# --- 3. Memberships, backdated to match the xlsx timeline ---
# Aisha, Rohan, Priya: in from the start, never leave
for name in ["Aisha", "Rohan", "Priya"]:
    GroupMembership.objects.get_or_create(
        group=group, user=users[name],
        defaults={"joined_at": date(2026, 1, 25), "role": "admin" if name == "Aisha" else "member"},
    )

# Meera: in from the start, moves out end of March (farewell dinner is Mar 28)
GroupMembership.objects.get_or_create(
    group=group, user=users["Meera"],
    defaults={"joined_at": date(2026, 1, 25), "left_at": date(2026, 3, 29)},
)

# Dev: visits from mid-Feb (first appears Feb 8), no explicit leave date in the data
GroupMembership.objects.get_or_create(
    group=group, user=users["Dev"],
    defaults={"joined_at": date(2026, 2, 7)},
)

# Sam: joins early April (deposit row is Apr 8)
GroupMembership.objects.get_or_create(
    group=group, user=users["Sam"],
    defaults={"joined_at": date(2026, 4, 8)},
)

print("done. group id:", group.id)