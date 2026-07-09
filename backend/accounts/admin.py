from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from accounts.models import User


class CustomUserAdmin(UserAdmin):
    # Default UserAdmin has no field for our custom display_name column,
    # so it silently stayed blank for every account created via /admin
    # instead of through the app's own /register form. Add it to both the
    # edit form and the "add user" form so it's actually settable here.
    fieldsets = UserAdmin.fieldsets + (
        ("Display name", {"fields": ("display_name",)}),
    )
    add_fieldsets = UserAdmin.add_fieldsets + (
        ("Display name", {"fields": ("display_name",)}),
    )
    list_display = ("username", "display_name", "email", "is_staff")


admin.site.register(User, CustomUserAdmin)