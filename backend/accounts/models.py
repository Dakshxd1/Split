from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """
    Custom user, not Django's default, for one reason: the CSV import has to
    resolve messy name strings ('priya', 'Priya S', 'rohan ') to a single
    canonical user. That resolution needs a place to record what it matched
    against, which the default User model has no room for.
    display_name is the canonical name the importer matches against
    (case-insensitive, whitespace-stripped) when it sees a name in the CSV.
    """
    display_name = models.CharField(max_length=100)

    def __str__(self):
        return self.display_name or self.username
