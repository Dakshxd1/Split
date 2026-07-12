import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box, Typography, Table, TableBody, TableCell, TableHead, TableRow, Chip, Button,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Paper, useTheme, alpha,
} from "@mui/material";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import { api } from "../api/client";
import type { Group, GroupMembership } from "../api/types";
import PersonChip from "./PersonChip";

const ROLE_COLOR: Record<string, "secondary" | "default"> = { admin: "secondary", member: "default" };

export default function MembersPanel({ group }: { group: Group }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [leaveTarget, setLeaveTarget] = useState<GroupMembership | null>(null);
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
      <Box display="flex" justifyContent="space-between" alignItems="flex-end" mb={2.5}>
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.2 }}>
            Household
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 700, mt: -0.5 }}>Members</Typography>
        </Box>
        <Chip
          label={`${activeCount} active`}
          size="small"
          sx={{ bgcolor: alpha(theme.palette.success.main, 0.1), color: "success.dark", fontWeight: 600 }}
        />
      </Box>

      {sorted.length === 0 ? (
        <Paper
          elevation={0}
          sx={{
            border: "1px dashed", borderColor: "divider", borderRadius: 2.5, p: 5, textAlign: "center",
          }}
        >
          <GroupsRoundedIcon sx={{ fontSize: 34, color: "text.disabled", mb: 1 }} />
          <Typography color="text.secondary">
            No one's been added yet. New members are added from Django admin for now.
          </Typography>
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
                <TableCell />
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
                    {!m.left_at && (
                      <Button
                        size="small" color="error" variant="text"
                        sx={{ fontWeight: 600 }}
                        onClick={() => setLeaveTarget(m)}
                      >
                        Mark left
                      </Button>
                    )}
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
    </Box>
  );
}