from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

User = get_user_model()


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, validators=[validate_password])

    class Meta:
        model = User
        fields = ["id", "username", "email", "display_name", "password"]

    def create(self, validated_data):
        # create_user (not create) so the password goes through Django's
        # hashing rather than being stored as plain text on the model.
        return User.objects.create_user(
            username=validated_data["username"],
            email=validated_data.get("email", ""),
            display_name=validated_data.get("display_name", validated_data["username"]),
            password=validated_data["password"],
        )


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "email", "display_name"]
        read_only_fields = ["id"]
