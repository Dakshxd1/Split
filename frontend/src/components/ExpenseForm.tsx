import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, MenuItem,
  Select, InputLabel, FormControl, Checkbox, Stack, Typography, Alert, Box, useTheme, alpha,
} from "@mui/material";
import { api } from "../api/client";
import type { GroupMembership, SplitType } from "../api/types";
import PersonChip from "./PersonChip";

interface Props {
  open: boolean;
  onClose: () => void;
  groupId: number;
  members: GroupMembership[];
}

export default function ExpenseForm({ open, onClose, groupId, members }: Props) {
  const theme = useTheme();
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
  const selectedCount = Object.values(selected).filter(Boolean).length;

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

  function toggleMember(userId: number) {
    setSelected({ ...selected, [userId]: !selected[userId] });
  }

  const valueLabel = { equal: "", exact: "Amount", unequal: "Amount", percentage: "%", share: "Shares" }[splitType];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ pb: 0.5 }}>
        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.2, display: "block" }}>
          New entry
        </Typography>
        <Typography variant="h6" sx={{ fontWeight: 700, mt: -0.5 }}>Add expense</Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} mt={0.5}>
          <TextField label="Title" placeholder="e.g. Groceries, Dinner, Wifi bill" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth />

          <Stack direction="row" spacing={2}>
            <TextField
              label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} fullWidth
              InputProps={{ startAdornment: currency === "INR" ? <Box component="span" sx={{ color: "text.secondary", mr: 0.5 }}>₹</Box> : undefined }}
            />
            <FormControl sx={{ minWidth: 110 }}>
              <InputLabel>Currency</InputLabel>
              <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value as "INR" | "USD")}>
                <MenuItem value="INR">INR</MenuItem>
                <MenuItem value="USD">USD</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          {currency === "USD" && (
            <TextField
              label="Exchange rate (1 USD = ? INR)" value={rate} onChange={(e) => setRate(e.target.value)}
              size="small" sx={{ maxWidth: 260 }}
            />
          )}

          <Stack direction="row" spacing={2}>
            <TextField
              label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)}
              InputLabelProps={{ shrink: true }} fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>Paid by</InputLabel>
              <Select label="Paid by" value={paidBy} onChange={(e) => setPaidBy(Number(e.target.value))}>
                {activeMembers.map((m) => (
                  <MenuItem key={m.user.id} value={m.user.id}>
                    <PersonChip id={m.user.id} name={m.user.display_name} size={20} fontSize="0.875rem" />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

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

          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="baseline" mb={1}>
              <Typography
                variant="subtitle2" color="text.secondary"
                sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6, fontSize: "0.72rem" }}
              >
                Split between
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {selectedCount} selected
              </Typography>
            </Stack>

            <Stack spacing={1}>
              {activeMembers.map((m) => {
                const isSelected = !!selected[m.user.id];
                return (
                  <Box
                    key={m.user.id}
                    onClick={() => toggleMember(m.user.id)}
                    sx={{
                      display: "flex", alignItems: "center", gap: 1,
                      px: 1, py: 0.5, borderRadius: 2,
                      border: "1px solid",
                      borderColor: isSelected ? alpha(theme.palette.secondary.main, 0.5) : "divider",
                      bgcolor: isSelected ? alpha(theme.palette.secondary.main, 0.06) : "transparent",
                      cursor: "pointer",
                      transition: "border-color 0.15s ease, background-color 0.15s ease",
                      "&:hover": { borderColor: alpha(theme.palette.secondary.main, 0.5) },
                    }}
                  >
                    <Checkbox
                      checked={isSelected}
                      onChange={() => toggleMember(m.user.id)}
                      onClick={(e) => e.stopPropagation()}
                      size="small"
                    />
                    <Box sx={{ flexGrow: 1, minWidth: 140 }}>
                      <PersonChip id={m.user.id} name={m.user.display_name} size={22} fontSize="0.875rem" />
                    </Box>
                    {splitType !== "equal" && isSelected && (
                      <TextField
                        size="small" label={valueLabel} sx={{ width: 110 }}
                        value={rawValues[m.user.id] || ""}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRawValues({ ...rawValues, [m.user.id]: e.target.value })}
                      />
                    )}
                  </Box>
                );
              })}
            </Stack>
          </Box>

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} color="inherit">Cancel</Button>
        <Button
          variant="contained"
          color="secondary"
          disableElevation
          sx={{ borderRadius: 2, px: 2.5, fontWeight: 600 }}
          disabled={!title || !amount || !paidBy || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "Adding…" : "Add expense"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}