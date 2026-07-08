from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .views import MeView, RegisterView

urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    # SimpleJWT's TokenObtainPairView IS the login endpoint: it takes
    # {username, password} and returns {access, refresh}. Nothing custom
    # needed here - reinventing this would just be a worse copy of it.
    path("login/", TokenObtainPairView.as_view(), name="login"),
    path("refresh/", TokenRefreshView.as_view(), name="refresh"),
    path("me/", MeView.as_view(), name="me"),
]
