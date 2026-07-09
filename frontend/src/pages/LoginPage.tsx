import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Box, Button, TextField, Typography, Alert, Paper } from "@mui/material";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(username, password);
      navigate("/groups");
    } catch {
      setError("Invalid username or password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box display="flex" justifyContent="center" mt={8}>
      <Paper sx={{ p: 4, width: 360 }}>
        <Typography variant="h5" mb={2}>Log in</Typography>
        <form onSubmit={handleSubmit}>
          <TextField fullWidth label="Username" margin="normal" value={username} onChange={(e) => setUsername(e.target.value)} />
          <TextField fullWidth label="Password" type="password" margin="normal" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
          <Button fullWidth variant="contained" type="submit" sx={{ mt: 2 }} disabled={busy}>
            {busy ? "Logging in…" : "Log in"}
          </Button>
        </form>
        <Typography variant="body2" mt={2}>
          No account? <Link to="/register">Register</Link>
        </Typography>
      </Paper>
    </Box>
  );
}
