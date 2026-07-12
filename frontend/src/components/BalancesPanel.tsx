import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box, Typography, Paper, Stack, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  Table, TableBody, TableCell, TableHead, TableRow, Button, TextField, MenuItem, Select,
  InputLabel, FormControl, Alert, Divider, useTheme, alpha,
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
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ pb: 0.5 }}>
        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.2, display: "block" }}>
          Balance trail
        </Typography>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>{name}</Typography>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Every row below is summed to produce the net balance — nothing is a magic number.
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Amount</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {trail?.map((line, i) => (
              <TableRow key={i} sx={{ "&:last-child td": { borderBottom: 0 } }}>
                <TableCell sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>{line.date}</TableCell>
                <TableCell>{line.description}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={line.kind.replace("_", " ")}
                    sx={{ textTransform: "capitalize", fontSize: "0.7rem", height: 22 }}
                  />
                </TableCell>
                <TableCell align="right" sx={{ color: Number(line.amount) < 0 ? "error.main" : "success.main", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {Number(line.amount) < 0 ? "−" : "+"}{money(line.amount)}
                </TableCell>
              </TableRow>
            ))}
            {trail?.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  No activity yet.
                </TableCell>
              </TableRow>
            )}
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
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ fontWeight: 700 }}>Record a payment</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={0.5}>
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
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} color="inherit">Cancel</Button>
        <Button
          variant="contained"
          color="secondary"
          disableElevation
          sx={{ borderRadius: 2, px: 2.5 }}
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
  const theme = useTheme();
  const [trailUser, setTrailUser] = useState<{ id: number; name: string } | null>(null);
  const [paymentDialog, setPaymentDialog] = useState<null | { fromUserId: number; toUserId: number; amount: string }>(null);
  const [showBlankPaymentForm, setShowBlankPaymentForm] = useState(false);

  const { data } = useQuery({
    queryKey: ["balances", groupId],
    queryFn: async () => (await api.get<BalancesResponse>(`/groups/${groupId}/balances/`)).data,
  });

  return (
    <Box>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="flex-end" mb={3}>
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.2 }}>
            Where things stand
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 700, mt: -0.5 }}>Balances</Typography>
        </Box>
        <Button
          variant="contained"
          color="secondary"
          disableElevation
          sx={{ borderRadius: 2, px: 2.5, fontWeight: 600 }}
          onClick={() => setShowBlankPaymentForm(true)}
        >
          <Box component="span" sx={{ mr: 0.75, fontSize: 18, lineHeight: 1 }}>+</Box>
          Record a payment
        </Button>
      </Box>

      {/* Per-person balance cards */}
      <Typography variant="subtitle2" color="text.secondary" mb={1.5} sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6, fontSize: "0.72rem" }}>
        Net balance per person
      </Typography>
      <Stack direction="row" spacing={1.75} flexWrap="wrap" mb={5} useFlexGap>
        {data?.summary.map((line) => {
          const amt = Number(line.net_balance);
          const tone = amt > 0 ? "success" : amt < 0 ? "error" : undefined;
          const toneColor = tone ? theme.palette[tone].main : theme.palette.text.secondary;
          return (
            <Paper
              key={line.user_id}
              elevation={0}
              sx={{
                p: 2,
                pl: 2.5,
                minWidth: 200,
                cursor: "pointer",
                borderRadius: 2.5,
                position: "relative",
                overflow: "hidden",
                border: "1px solid",
                borderColor: "divider",
                bgcolor: tone ? alpha(toneColor, 0.06) : "background.paper",
                transition: "transform 0.15s ease, box-shadow 0.15s ease",
                "&:hover": {
                  transform: "translateY(-2px)",
                  boxShadow: `0 6px 20px ${alpha(toneColor, 0.18)}`,
                },
                "&::before": {
                  content: '""',
                  position: "absolute",
                  left: 0, top: 0, bottom: 0,
                  width: 4,
                  bgcolor: toneColor,
                },
              }}
              onClick={() => setTrailUser({ id: line.user_id, name: line.display_name })}
            >
              <Box mb={1}><PersonChip id={line.user_id} name={line.display_name} size={26} fontWeight={600} /></Box>
              <Typography
                variant="h6"
                sx={{ color: toneColor, fontVariantNumeric: "tabular-nums", fontWeight: 700, lineHeight: 1.2 }}
              >
                {amt === 0 ? "Settled up" : amt > 0 ? `+${money(line.net_balance)}` : `−${money(line.net_balance)}`}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {amt > 0 ? "is owed" : amt < 0 ? "owes the group" : "all square"}
              </Typography>
            </Paper>
          );
        })}
      </Stack>

      {/* Settlements needed */}
      <Typography variant="subtitle2" color="text.secondary" mb={1.5} sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6, fontSize: "0.72rem" }}>
        Who pays whom
      </Typography>

      {data?.settlements_needed.length === 0 && (
        <Paper
          elevation={0}
          sx={{
            p: 3, borderRadius: 2.5, textAlign: "center",
            border: "1px dashed", borderColor: alpha(theme.palette.success.main, 0.4),
            bgcolor: alpha(theme.palette.success.main, 0.05),
          }}
        >
          <Box sx={{ color: "success.main", fontSize: 30, mb: 0.5, lineHeight: 1 }}>✓</Box>
          <Typography sx={{ fontWeight: 600 }}>Everyone is settled up</Typography>
          <Typography variant="body2" color="text.secondary">No payments needed right now.</Typography>
        </Paper>
      )}

      <Stack spacing={1.25}>
        {data?.settlements_needed.map((s, i) => (
          <Paper
            key={i}
            elevation={0}
            sx={{
              p: 2, borderRadius: 2.5,
              border: "1px solid", borderColor: "divider",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              flexWrap: "wrap", gap: 1.5,
              transition: "border-color 0.15s ease",
              "&:hover": { borderColor: alpha(theme.palette.secondary.main, 0.5) },
            }}
          >
            <Stack direction="row" spacing={1.25} alignItems="center">
              <PersonChip id={s.from_user_id} name={s.from_name} size={24} fontWeight={600} />
              <Box sx={{ color: "text.disabled", fontSize: 18 }}>→</Box>
              <PersonChip id={s.to_user_id} name={s.to_name} size={24} fontWeight={600} />
            </Stack>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Chip
                label={money(s.amount)}
                sx={{
                  fontVariantNumeric: "tabular-nums", fontWeight: 700,
                  bgcolor: alpha(theme.palette.secondary.main, 0.1),
                  color: "secondary.dark",
                }}
              />
              <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
              <Button
                size="small" variant="outlined" color="secondary"
                sx={{ borderRadius: 1.5, fontWeight: 600 }}
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