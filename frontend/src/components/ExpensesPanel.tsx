import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, Typography, Button, Table, TableBody, TableCell, TableHead, TableRow, Chip } from "@mui/material";
import { api } from "../api/client";
import type { Expense, Group } from "../api/types";
import ExpenseForm from "./ExpenseForm";
import PersonChip from "./PersonChip";

export default function ExpensesPanel({ group }: { group: Group }) {
  const [formOpen, setFormOpen] = useState(false);

  const { data: expenses } = useQuery({
    queryKey: ["expenses", group.id],
    queryFn: async () => (await api.get<Expense[]>(`/expenses/?group=${group.id}`)).data,
  });

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">Expenses</Typography>
        <Button variant="contained" color="secondary" onClick={() => setFormOpen(true)}>+ Add expense</Button>
      </Box>

      {expenses?.length === 0 ? (
        <Box sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 2, p: 4, textAlign: "center" }}>
          <Typography color="text.secondary" mb={2}>No expenses logged yet.</Typography>
          <Button variant="outlined" onClick={() => setFormOpen(true)}>Add your first expense</Button>
        </Box>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Title</TableCell>
              <TableCell>Paid by</TableCell>
              <TableCell>Split</TableCell>
              <TableCell align="right">Amount</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {expenses?.map((e) => (
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ExpenseForm open={formOpen} onClose={() => setFormOpen(false)} groupId={group.id} members={group.memberships} />
    </Box>
  );
}