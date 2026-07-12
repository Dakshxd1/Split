import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Box, Button, TextField, Alert } from "@mui/material";
import { useAuth } from "../context/AuthContext";
import AuthLayout from "../components/AuthLayout";

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", displayName: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await register(form.username, form.password, form.displayName, form.email);
      navigate("/groups");
    } catch (err: any) {
      const detail = err?.response?.data;
      setError(detail ? JSON.stringify(detail) : "Registration failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Create your account" subtitle="One account, every group you split with.">
      <form onSubmit={handleSubmit}>
        <TextField fullWidth label="Display name" margin="normal" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} autoFocus />
        <TextField fullWidth label="Username" margin="normal" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        <TextField fullWidth label="Email" margin="normal" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <TextField fullWidth label="Password" type="password" margin="normal" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
        <Button fullWidth variant="contained" color="secondary" type="submit" size="large" sx={{ mt: 3 }} disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>
      <Box mt={3} textAlign="center" color="text.secondary" fontSize="0.9rem">
        Already have an account? <Link to="/login">Log in</Link>
      </Box>
    </AuthLayout>
  );
}