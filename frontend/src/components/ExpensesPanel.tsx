import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box, Typography, Button, Table, TableBody, TableCell, TableHead, TableRow, Chip,
  TextField, MenuItem, Select, InputLabel, FormControl, Stack, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, InputAdornment,
} from "@mui/material";
import { api } from "../api/client";
import type { Expense, Group } from "../api/types";
import ExpenseForm from "./ExpenseForm";
import PersonChip from "./PersonChip";

type SortKey = "date_desc" | "date_asc" | "amount_desc" | "amount_asc";

export default function ExpensesPanel({ group }: { group: Group }) {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [payerFilter, setPayerFilter] = useState<number | "all">("all");
  const [sort, setSort] = useState<SortKey>("date_desc");
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);

  const { data: expenses } = useQuery({
    queryKey: ["expenses", group.id],
    queryFn: async () => (await api.get<Expense[]>(`/expenses/?group=${group.id}`)).data,
  });

  const removeExpense = useMutation({
    mutationFn: (id: number) => api.delete(`/expenses/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses", group.id] });
      queryClient.invalidateQueries({ queryKey: ["balances", group.id] });
      setDeleteTarget(null);
    },
  });

  const visible = useMemo(() => {
    let rows = expenses ?? [];

    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((e) => e.title.toLowerCase().includes(q));

    if (payerFilter !== "all") rows = rows.filter((e) => e.paid_by_detail.id === payerFilter);

    const sorted = [...rows].sort((a, b) => {
      switch (sort) {
        case "date_asc": return a.date.localeCompare(b.date);
        case "amount_desc": return Number(b.converted_inr_amount) - Number(a.converted_inr_amount);
        case "amount_asc": return Number(a.converted_inr_amount) - Number(b.converted_inr_amount);
        case "date_desc":
        default: return b.date.localeCompare(a.date);
      }
    });
    return sorted;
  }, [expenses, search, payerFilter, sort]);

  const total = visible.reduce((sum, e) => sum + Number(e.converted_inr_amount), 0);
  const payers = group.memberships;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={2}>
        <Typography variant="h6">Expenses</Typography>
        <Button variant="contained" color="secondary" onClick={() => setFormOpen(true)}>+ Add expense</Button>
      </Box>

      {expenses?.length === 0 ? (
        <Box sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 2, p: 4, textAlign: "center" }}>
          <Typography color="text.secondary" mb={2}>No expenses logged yet.</Typography>
          <Button variant="outlined" onClick={() => setFormOpen(true)}>Add your first expense</Button>
        </Box>
      ) : (
        <>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} mb={2} alignItems={{ sm: "center" }}>
            <TextField
              placeholder="Search by title…"
              size="small"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ minWidth: 220 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Box component="span" sx={{ fontSize: 16, color: "text.secondary" }}>&#8981;</Box>
                  </InputAdornment>
                ),
              }}
            />
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Paid by</InputLabel>
              <Select label="Paid by" value={payerFilter} onChange={(e) => setPayerFilter(e.target.value === "all" ? "all" : Number(e.target.value))}>
                <MenuItem value="all">Everyone</MenuItem>
                {payers.map((m) => (
                  <MenuItem key={m.user.id} value={m.user.id}>{m.user.display_name}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel>Sort by</InputLabel>
              <Select label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <MenuItem value="date_desc">Newest first</MenuItem>
                <MenuItem value="date_asc">Oldest first</MenuItem>
                <MenuItem value="amount_desc">Amount: high to low</MenuItem>
                <MenuItem value="amount_asc">Amount: low to high</MenuItem>
              </Select>
            </FormControl>
            <Box flexGrow={1} />
            <Typography variant="body2" color="text.secondary">
              {visible.length} expense{visible.length !== 1 ? "s" : ""} · total{" "}
              <Typography component="span" fontWeight={700} color="text.primary" sx={{ fontVariantNumeric: "tabular-nums" }}>
                ₹{total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </Typography>
            </Typography>
          </Stack>

          {visible.length === 0 ? (
            <Typography color="text.secondary">No expenses match your filters.</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Title</TableCell>
                  <TableCell>Paid by</TableCell>
                  <TableCell>Split</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map((e) => (
                  <TableRow key={e.id} hover>
                    <TableCell sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>{e.date}</TableCell>
                    <TableCell>{e.title}</TableCell>
                    <TableCell>
                      <PersonChip id={e.paid_by_detail.id} name={e.paid_by_detail.display_name} size={22} />
                    </TableCell>
                    <TableCell><Chip size="small" label={e.split_type} variant="outlined" /></TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      <Typography component="span" sx={{ fontWeight: 600 }}>
                        ₹{Number(e.converted_inr_amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </Typography>
                      {e.currency === "USD" && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          (${e.original_amount} @ {e.exchange_rate_used})
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => setDeleteTarget(e)} title="Delete expense">
                        <Box component="span" sx={{ fontSize: 16, color: "error.main" }}>&#10005;</Box>
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}

      <ExpenseForm open={formOpen} onClose={() => setFormOpen(false)} groupId={group.id} members={group.memberships} />

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this expense?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            "{deleteTarget?.title}" — ₹{deleteTarget && Number(deleteTarget.converted_inr_amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            {" "}will be removed and everyone's balances will recalculate. This can't be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button
            variant="contained" color="error"
            disabled={removeExpense.isPending}
            onClick={() => deleteTarget && removeExpense.mutate(deleteTarget.id)}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}