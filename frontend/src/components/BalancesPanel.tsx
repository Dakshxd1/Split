import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box, Typography, Paper, Stack, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  Table, TableBody, TableCell, TableHead, TableRow, Button, TextField, MenuItem, Select,
  InputLabel, FormControl, Alert,
} from "@mui/material";
import { api } from "../api/client";
import type { BalancesResponse, BalanceTrailLine, GroupMembership } from "../api/types";
import PersonChip from "./PersonChip";

function money(v: string) {
  const n = Number(v);
  return `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

function TrailDialog({ groupId, userId, name, onClose }: { groupId: number; userId: number; name: string; onClose: () => void }) {
  const { data: trail } = useQuery({
    queryKey: ["balance-trail", groupId, userId],
    queryFn: async () => (await api.get<BalanceTrailLine[]>(`/groups/${groupId}/balances/${userId}/trail/`)).data,
  });

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{name}'s balance trail</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Every row below is summed to produce the net balance — nothing is a magic number.
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Type</TableCell>
              <TableCell align="right">Amount</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {trail?.map((line, i) => (
              <TableRow key={i}>
                <TableCell sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>{line.date}</TableCell>
                <TableCell>{line.description}</TableCell>
                <TableCell sx={{ textTransform: "capitalize" }}>{line.kind.replace("_", " ")}</TableCell>
                <TableCell align="right" sx={{ color: Number(line.amount) < 0 ? "error.main" : "success.main", fontWeight: 600 }}>
                  {Number(line.amount) < 0 ? "-" : "+"}{money(line.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}

function RecordPaymentDialog({
  groupId, members, onClose, prefill,
}: {
  groupId: number;
  members: GroupMembership[];
  onClose: () => void;
  prefill?: { fromUserId: number; toUserId: number; amount: string };
}) {
  const queryClient = useQueryClient();
  const [fromUser, setFromUser] = useState<number | "">(prefill?.fromUserId ?? "");
  const [toUser, setToUser] = useState<number | "">(prefill?.toUserId ?? "");
  const [amount, setAmount] = useState(prefill?.amount ?? "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const activeMembers = members.filter((m) => !m.left_at);

  const record = useMutation({
    mutationFn: () =>
      api.post("/settlements/", {
        group: groupId, from_user: fromUser, to_user: toUser, amount, date, note,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["balances", groupId] });
      onClose();
    },
    onError: (err: any) => setError(err?.response?.data?.detail || "Could not record this payment."),
  });

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Record a payment</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <Typography variant="body2" color="text.secondary">
            This logs money that's already changed hands — it settles a balance, it's not a new shared expense.
          </Typography>

          <FormControl fullWidth>
            <InputLabel>Paid by</InputLabel>
            <Select label="Paid by" value={fromUser} onChange={(e) => setFromUser(Number(e.target.value))}>
              {activeMembers.map((m) => (
                <MenuItem key={m.user.id} value={m.user.id}>
                  <PersonChip id={m.user.id} name={m.user.display_name} size={20} fontSize="0.875rem" />
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth>
            <InputLabel>Received by</InputLabel>
            <Select label="Received by" value={toUser} onChange={(e) => setToUser(Number(e.target.value))}>
              {activeMembers.map((m) => (
                <MenuItem key={m.user.id} value={m.user.id}>
                  <PersonChip id={m.user.id} name={m.user.display_name} size={20} fontSize="0.875rem" />
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField label="Amount (₹)" value={amount} onChange={(e) => setAmount(e.target.value)} fullWidth />
          <TextField
            label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)}
            InputLabelProps={{ shrink: true }} fullWidth
          />
          <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} fullWidth />

          {fromUser && toUser && fromUser === toUser && (
            <Alert severity="warning">Paid by and received by can't be the same person.</Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="secondary"
          disabled={!fromUser || !toUser || fromUser === toUser || !amount || record.isPending}
          onClick={() => record.mutate()}
        >
          Record payment
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function BalancesPanel({ groupId, members }: { groupId: number; members: GroupMembership[] }) {
  const [trailUser, setTrailUser] = useState<{ id: number; name: string } | null>(null);
  const [paymentDialog, setPaymentDialog] = useState<null | { fromUserId: number; toUserId: number; amount: string }>(null);
  const [showBlankPaymentForm, setShowBlankPaymentForm] = useState(false);

  const { data } = useQuery({
    queryKey: ["balances", groupId],
    queryFn: async () => (await api.get<BalancesResponse>(`/groups/${groupId}/balances/`)).data,
  });

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">Balances</Typography>
        <Button variant="contained" color="secondary" onClick={() => setShowBlankPaymentForm(true)}>
          + Record a payment
        </Button>
      </Box>

      <Typography variant="subtitle1" mb={1.5}>Net balance per person</Typography>
      <Stack direction="row" spacing={2} flexWrap="wrap" mb={4} useFlexGap>
        {data?.summary.map((line) => {
          const amt = Number(line.net_balance);
          const tone = amt > 0 ? "success" : amt < 0 ? "error" : "default";
          return (
            <Paper
              key={line.user_id}
              variant="outlined"
              sx={{
                p: 2, minWidth: 190, cursor: "pointer",
                borderColor: tone === "default" ? "divider" : `${tone}.main`,
                borderWidth: tone === "default" ? 1 : 1.5,
                "&:hover": { bgcolor: "action.hover" },
              }}
              onClick={() => setTrailUser({ id: line.user_id, name: line.display_name })}
            >
              <Box mb={1}><PersonChip id={line.user_id} name={line.display_name} size={26} fontWeight={600} /></Box>
              <Typography variant="h6" color={amt > 0 ? "success.main" : amt < 0 ? "error.main" : "text.primary"} sx={{ fontVariantNumeric: "tabular-nums" }}>
                {amt === 0 ? "Settled up" : amt > 0 ? `+${money(line.net_balance)}` : `-${money(line.net_balance)}`}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {amt > 0 ? "is owed" : amt < 0 ? "owes the group" : "all square"}
              </Typography>
            </Paper>
          );
        })}
      </Stack>

      <Typography variant="subtitle1" mb={1.5}>Who pays whom (minimized)</Typography>
      <Stack spacing={1}>
        {data?.settlements_needed.length === 0 && (
          <Chip label="Everyone is settled up" color="success" variant="outlined" sx={{ width: "fit-content" }} />
        )}
        {data?.settlements_needed.map((s, i) => (
          <Paper key={i} variant="outlined" sx={{ p: 1.5, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <PersonChip id={s.from_user_id} name={s.from_name} size={22} />
              <Typography color="text.secondary">→</Typography>
              <PersonChip id={s.to_user_id} name={s.to_name} size={22} />
            </Stack>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Chip label={money(s.amount)} sx={{ fontVariantNumeric: "tabular-nums" }} />
              <Button
                size="small" variant="outlined"
                onClick={() => setPaymentDialog({ fromUserId: s.from_user_id, toUserId: s.to_user_id, amount: s.amount })}
              >
                Mark as paid
              </Button>
            </Stack>
          </Paper>
        ))}
      </Stack>

      {trailUser && (
        <TrailDialog groupId={groupId} userId={trailUser.id} name={trailUser.name} onClose={() => setTrailUser(null)} />
      )}

      {paymentDialog && (
        <RecordPaymentDialog groupId={groupId} members={members} prefill={paymentDialog} onClose={() => setPaymentDialog(null)} />
      )}
      {showBlankPaymentForm && (
        <RecordPaymentDialog groupId={groupId} members={members} onClose={() => setShowBlankPaymentForm(false)} />
      )}
    </Box>
  );
}