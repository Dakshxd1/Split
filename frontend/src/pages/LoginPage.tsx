import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Box, Button, TextField, Alert } from "@mui/material";
import { useAuth } from "../context/AuthContext";
import AuthLayout from "../components/AuthLayout";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function doLogin(user: string, pass: string) {
    setError("");
    setBusy(true);
    try {
      await login(user, pass);
      navigate("/groups");
    } catch {
      setError("Invalid username or password.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await doLogin(username, password);
  }

  // Dev/test helper: fills the form and logs in with test credentials
  function handleTestLogin() {
    setUsername("rahul");
    setPassword("Anshu@123");
    doLogin("rahul", "Anshu@123");
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Log in to see where things stand.">
      <form onSubmit={handleSubmit}>
        <TextField
          fullWidth
          label="Username"
          margin="normal"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />
        <TextField
          fullWidth
          label="Password"
          type="password"
          margin="normal"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
        <Button
          fullWidth
          variant="contained"
          color="secondary"
          type="submit"
          size="large"
          sx={{ mt: 3 }}
          disabled={busy}
        >
          {busy ? "Logging in…" : "Log in"}
        </Button>

        {/* Test-only quick login button (dev builds only) */}
        {import.meta.env.DEV && (
          <Button
            fullWidth
            variant="text"
            size="small"
            sx={{ mt: 1 }}
            disabled={busy}
            onClick={handleTestLogin}
          >
            Quick test login (rahul)
          </Button>
        )}
      </form>
      <Box mt={3} textAlign="center" color="text.secondary" fontSize="0.9rem">
        No account? <Link to="/register">Register</Link>
      </Box>
    </AuthLayout>
  );
}