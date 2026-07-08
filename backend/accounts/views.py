from rest_framework import generics, permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import RegisterSerializer, UserSerializer


class RegisterView(generics.CreateAPIView):
    """
    POST /api/auth/register/  {username, email, display_name, password}
    Open to anyone (no auth required to sign up). Login itself is handled by
    SimpleJWT's TokenObtainPairView - we don't reinvent password checking,
    only registration, which Django doesn't provide a REST endpoint for out
    of the box.
    """
    permission_classes = [permissions.AllowAny]
    serializer_class = RegisterSerializer


class MeView(APIView):
    """GET /api/auth/me/ - the logged-in user's own profile, from their JWT."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)
