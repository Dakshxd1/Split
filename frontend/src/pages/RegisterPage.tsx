import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Box, Button, TextField, Typography, Alert, Paper } from "@mui/material";
import { useAuth } from "../context/AuthContext";

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
    <Box display="flex" justifyContent="center" mt={8}>
      <Paper sx={{ p: 4, width: 360 }}>
        <Typography variant="h5" mb={2}>Create account</Typography>
        <form onSubmit={handleSubmit}>
          <TextField fullWidth label="Display name" margin="normal" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          <TextField fullWidth label="Username" margin="normal" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <TextField fullWidth label="Email" margin="normal" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <TextField fullWidth label="Password" type="password" margin="normal" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
          <Button fullWidth variant="contained" type="submit" sx={{ mt: 2 }} disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </Button>
        </form>
        <Typography variant="body2" mt={2}>
          Already have an account? <Link to="/login">Log in</Link>
        </Typography>
      </Paper>
    </Box>
  );
}
