import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box, Typography, Table, TableBody, TableCell, TableHead, TableRow, Chip, Button,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Paper, useTheme, alpha,
  Stack, Alert,
} from "@mui/material";
import { api } from "../api/client";
import type { Group, GroupMembership } from "../api/types";
import PersonChip from "./PersonChip";

const ROLE_COLOR: Record<string, "secondary" | "default"> = { admin: "secondary", member: "default" };

function AddMemberDialog({ group, onClose }: { group: Group; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [joinedAt, setJoinedAt] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");

  const addMember = useMutation({
    mutationFn: async () => {
      // Two calls: create the real user account first (via the same
      // public register endpoint the sign-up page uses), then attach
      // them to this group. If step 2 fails, the user account still
      // exists - that's fine, it just means they aren't in this group
      // yet and can be added again without re-registering.
      const { data: user } = await api.post("/auth/register/", {
        username, email, display_name: displayName, password,
      });
      await api.post(`/groups/${group.id}/add_member/`, { user_id: user.id, joined_at: joinedAt });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      queryClient.invalidateQueries({ queryKey: ["group", group.id] });
      onClose();
    },
    onError: (err: any) => {
      const detail = err?.response?.data;
      setError(detail ? JSON.stringify(detail) : "Could not add this member.");
    },
  });

  const canSubmit = displayName && username && password && joinedAt && !addMember.isPending;

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ pb: 0.5 }}>
        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.2, display: "block" }}>
          New household member
        </Typography>
        <Typography variant="h6" sx={{ fontWeight: 700, mt: -0.5 }}>Add member</Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={0.5}>
          <Typography variant="body2" color="text.secondary">
            This creates a real login for them and adds them to this group in one step — no Django admin needed.
          </Typography>
          <TextField
            label="Display name" placeholder="e.g. Priya"
            helperText="Must match how their name appears in any CSV/Excel imports"
            value={displayName} onChange={(e) => setDisplayName(e.target.value)} fullWidth
          />
          <TextField label="Username" value={username} onChange={(e) => setUsername(e.target.value)} fullWidth />
          <TextField label="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} fullWidth />
          <TextField
            label="Temporary password" type="password"
            helperText="They can change this after logging in"
            value={password} onChange={(e) => setPassword(e.target.value)} fullWidth
          />
          <TextField
            label="Joined on" type="date" value={joinedAt}
            onChange={(e) => setJoinedAt(e.target.value)} InputLabelProps={{ shrink: true }} fullWidth
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} color="inherit">Cancel</Button>
        <Button
          variant="contained" color="secondary" disableElevation
          sx={{ borderRadius: 2, px: 2.5, fontWeight: 600 }}
          disabled={!canSubmit}
          onClick={() => addMember.mutate()}
        >
          {addMember.isPending ? "Adding…" : "Add member"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DeleteMemberDialog({ group, target, onClose }: { group: Group; target: GroupMembership; onClose: () => void }) {
  const queryClient = useQueryClient();

  const deleteMember = useMutation({
    mutationFn: () => api.delete(`/groups/${group.id}/members/${target.id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      queryClient.invalidateQueries({ queryKey: ["group", group.id] });
      onClose();
    },
  });

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ pb: 0.5 }}>
        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.2, display: "block" }}>
          Remove membership
        </Typography>
        <Typography variant="h6" sx={{ fontWeight: 700, mt: -0.5 }}>{target.user.display_name}</Typography>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" mb={1}>
          This permanently deletes their membership row — use this only to fix a mistaken add
          (wrong person, typo), not for someone who actually lived here and left.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Any expenses already logged under their name are untouched — this can never alter expense history,
          it only removes them from this group's member list going forward.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} color="inherit">Cancel</Button>
        <Button
          variant="contained" color="error" disableElevation
          sx={{ borderRadius: 2, px: 2.5, fontWeight: 600 }}
          disabled={deleteMember.isPending}
          onClick={() => deleteMember.mutate()}
        >
          {deleteMember.isPending ? "Removing…" : "Delete permanently"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function MembersPanel({ group }: { group: Group }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [leaveTarget, setLeaveTarget] = useState<GroupMembership | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GroupMembership | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [leftAt, setLeftAt] = useState(new Date().toISOString().slice(0, 10));

  const removeMember = useMutation({
    mutationFn: () => api.post(`/groups/${group.id}/members/${leaveTarget!.id}/leave/`, { left_at: leftAt }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      queryClient.invalidateQueries({ queryKey: ["group", group.id] });
      setLeaveTarget(null);
    },
  });

  // Sorted so active members show first, then by join date - makes the
  // history readable at a glance rather than in raw insertion order.
  const sorted = [...group.memberships].sort((a, b) => {
    if (!!a.left_at !== !!b.left_at) return a.left_at ? 1 : -1;
    return a.joined_at.localeCompare(b.joined_at);
  });

  const activeCount = sorted.filter((m) => !m.left_at).length;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="flex-end" mb={2.5} flexWrap="wrap" gap={2}>
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.2 }}>
            Household
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 700, mt: -0.5 }}>Members</Typography>
        </Box>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Chip
            label={`${activeCount} active`}
            size="small"
            sx={{ bgcolor: alpha(theme.palette.success.main, 0.1), color: "success.dark", fontWeight: 600 }}
          />
          <Button
            variant="contained" color="secondary" disableElevation
            sx={{ borderRadius: 2, px: 2.5, fontWeight: 600 }}
            onClick={() => setAddOpen(true)}
          >
            + Add member
          </Button>
        </Stack>
      </Box>

      {sorted.length === 0 ? (
        <Paper
          elevation={0}
          sx={{
            border: "1px dashed", borderColor: "divider", borderRadius: 2.5, p: 5, textAlign: "center",
          }}
        >
          <Box sx={{ fontSize: 30, color: "text.disabled", mb: 1 }}>◍</Box>
          <Typography color="text.secondary" mb={2}>No one's been added yet.</Typography>
          <Button variant="outlined" onClick={() => setAddOpen(true)}>Add your first member</Button>
        </Paper>
      ) : (
        <Paper elevation={0} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2.5, overflow: "hidden" }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ "& th": { bgcolor: alpha(theme.palette.text.primary, 0.02), fontWeight: 700, border: 0 } }}>
                <TableCell>Name</TableCell>
                <TableCell>Joined</TableCell>
                <TableCell>Left</TableCell>
                <TableCell>Role</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {sorted.map((m) => (
                <TableRow
                  key={m.id}
                  sx={{
                    opacity: m.left_at ? 0.55 : 1,
                    transition: "background-color 0.15s ease",
                    "&:last-child td": { borderBottom: 0 },
                    "&:hover": { bgcolor: alpha(theme.palette.text.primary, 0.02) },
                  }}
                >
                  <TableCell>
                    <PersonChip id={m.user.id} name={m.user.display_name} dimmed={!!m.left_at} />
                  </TableCell>
                  <TableCell sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>{m.joined_at}</TableCell>
                  <TableCell sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
                    {m.left_at || (
                      <Chip
                        size="small" label="active" variant="outlined" color="success"
                        sx={{ fontWeight: 600 }}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small" label={m.role} color={ROLE_COLOR[m.role] ?? "default"}
                      variant={m.role === "admin" ? "filled" : "outlined"}
                      sx={{ textTransform: "capitalize", fontWeight: 600 }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      {!m.left_at && (
                        <Button
                          size="small" color="error" variant="text"
                          sx={{ fontWeight: 600 }}
                          onClick={() => setLeaveTarget(m)}
                        >
                          Mark left
                        </Button>
                      )}
                      <Button
                        size="small" color="inherit" variant="text"
                        sx={{ fontWeight: 600, color: "text.disabled", "&:hover": { color: "error.main" } }}
                        onClick={() => setDeleteTarget(m)}
                      >
                        Delete
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      <Dialog open={!!leaveTarget} onClose={() => setLeaveTarget(null)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ pb: 0.5 }}>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.2, display: "block" }}>
            Leaving the household
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, mt: -0.5 }}>{leaveTarget?.user.display_name}</Typography>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            This preserves their history — expenses before this date still count toward their balance;
            expenses after it won't include them.
          </Typography>
          <TextField
            fullWidth type="date" label="Left on" value={leftAt}
            onChange={(e) => setLeftAt(e.target.value)} InputLabelProps={{ shrink: true }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setLeaveTarget(null)} color="inherit">Cancel</Button>
          <Button
            variant="contained" color="error" disableElevation
            sx={{ borderRadius: 2, px: 2.5, fontWeight: 600 }}
            onClick={() => removeMember.mutate()}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

      {addOpen && <AddMemberDialog group={group} onClose={() => setAddOpen(false)} />}
      {deleteTarget && <DeleteMemberDialog group={group} target={deleteTarget} onClose={() => setDeleteTarget(null)} />}
    </Box>
  );
}