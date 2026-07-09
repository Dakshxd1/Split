import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, MenuItem,
  Select, InputLabel, FormControl, Checkbox, FormControlLabel, Stack, Typography, Alert,
} from "@mui/material";
import { api } from "../api/client";
import type { GroupMembership, SplitType } from "../api/types";

interface Props {
  open: boolean;
  onClose: () => void;
  groupId: number;
  members: GroupMembership[];
}

export default function ExpenseForm({ open, onClose, groupId, members }: Props) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"INR" | "USD">("INR");
  const [rate, setRate] = useState("1");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [paidBy, setPaidBy] = useState<number | "">("");
  const [splitType, setSplitType] = useState<SplitType>("equal");
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [rawValues, setRawValues] = useState<Record<number, string>>({});
  const [error, setError] = useState("");

  const activeMembers = members.filter((m) => !m.left_at);

  const create = useMutation({
    mutationFn: () => {
      const participant_inputs = activeMembers
        .filter((m) => selected[m.user.id])
        .map((m) => ({
          user_id: m.user.id,
          raw_value: splitType === "equal" ? null : Number(rawValues[m.user.id] || 0),
        }));
      return api.post("/expenses/", {
        group: groupId, title, date, currency,
        original_amount: amount, exchange_rate_used: currency === "USD" ? rate : "1",
        paid_by: paidBy, split_type: splitType, participant_inputs,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses", groupId] });
      queryClient.invalidateQueries({ queryKey: ["balances", groupId] });
      reset();
      onClose();
    },
    onError: (err: any) => setError(err?.response?.data?.detail || "Could not create expense."),
  });

  function reset() {
    setTitle(""); setAmount(""); setSelected({}); setRawValues({}); setError("");
  }

  const valueLabel = { equal: "", exact: "Amount", unequal: "Amount", percentage: "%", share: "Shares" }[splitType];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New expense</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth />
          <Stack direction="row" spacing={2}>
            <TextField label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} fullWidth />
            <FormControl sx={{ minWidth: 100 }}>
              <InputLabel>Currency</InputLabel>
              <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value as "INR" | "USD")}>
                <MenuItem value="INR">INR</MenuItem>
                <MenuItem value="USD">USD</MenuItem>
              </Select>
            </FormControl>
          </Stack>
          {currency === "USD" && (
            <TextField label="Exchange rate (1 USD = ? INR)" value={rate} onChange={(e) => setRate(e.target.value)} />
          )}
          <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} InputLabelProps={{ shrink: true }} />

          <FormControl fullWidth>
            <InputLabel>Paid by</InputLabel>
            <Select label="Paid by" value={paidBy} onChange={(e) => setPaidBy(Number(e.target.value))}>
              {activeMembers.map((m) => <MenuItem key={m.user.id} value={m.user.id}>{m.user.display_name}</MenuItem>)}
            </Select>
          </FormControl>

          <FormControl fullWidth>
            <InputLabel>Split type</InputLabel>
            <Select label="Split type" value={splitType} onChange={(e) => setSplitType(e.target.value as SplitType)}>
              <MenuItem value="equal">Equal</MenuItem>
              <MenuItem value="exact">Exact amount</MenuItem>
              <MenuItem value="unequal">Unequal (named amounts)</MenuItem>
              <MenuItem value="percentage">Percentage</MenuItem>
              <MenuItem value="share">Share (weighted units)</MenuItem>
            </Select>
          </FormControl>

          <Typography variant="subtitle2">Split between</Typography>
          {activeMembers.map((m) => (
            <Stack direction="row" spacing={2} alignItems="center" key={m.user.id}>
              <FormControlLabel
                control={<Checkbox checked={!!selected[m.user.id]} onChange={(e) => setSelected({ ...selected, [m.user.id]: e.target.checked })} />}
                label={m.user.display_name}
                sx={{ minWidth: 160 }}
              />
              {splitType !== "equal" && selected[m.user.id] && (
                <TextField
                  size="small" label={valueLabel}
                  value={rawValues[m.user.id] || ""}
                  onChange={(e) => setRawValues({ ...rawValues, [m.user.id]: e.target.value })}
                />
              )}
            </Stack>
          ))}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!title || !amount || !paidBy || create.isPending}
          onClick={() => create.mutate()}
        >
          Add expense
        </Button>
      </DialogActions>
    </Dialog>
  );
}
