import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box, Typography, Table, TableBody, TableCell, TableHead, TableRow, Chip, Button,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
} from "@mui/material";
import { api } from "../api/client";
import type { Group, GroupMembership } from "../api/types";

export default function MembersPanel({ group }: { group: Group }) {
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

  return (
    <Box>
      <Typography variant="h6" mb={2}>Members</Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Joined</TableCell>
            <TableCell>Left</TableCell>
            <TableCell>Role</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((m) => (
            <TableRow key={m.id}>
              <TableCell>{m.user.display_name}</TableCell>
              <TableCell>{m.joined_at}</TableCell>
              <TableCell>{m.left_at || <Chip size="small" label="active" color="success" />}</TableCell>
              <TableCell>{m.role}</TableCell>
              <TableCell align="right">
                {!m.left_at && (
                  <Button size="small" color="warning" onClick={() => setLeaveTarget(m)}>Mark left</Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!leaveTarget} onClose={() => setLeaveTarget(null)}>
        <DialogTitle>{leaveTarget?.user.display_name} is leaving the group</DialogTitle>
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
        <DialogActions>
          <Button onClick={() => setLeaveTarget(null)}>Cancel</Button>
          <Button variant="contained" color="warning" onClick={() => removeMember.mutate()}>Confirm</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
