import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, Typography, Button, Table, TableBody, TableCell, TableHead, TableRow, Chip } from "@mui/material";
import { api } from "../api/client";
import type { Expense, Group } from "../api/types";
import ExpenseForm from "./ExpenseForm";

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
        <Button variant="contained" onClick={() => setFormOpen(true)}>Add expense</Button>
      </Box>

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
            <TableRow key={e.id}>
              <TableCell>{e.date}</TableCell>
              <TableCell>{e.title}</TableCell>
              <TableCell>{e.paid_by_detail.display_name}</TableCell>
              <TableCell><Chip size="small" label={e.split_type} /></TableCell>
              <TableCell align="right">
                ₹{Number(e.converted_inr_amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
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

      <ExpenseForm open={formOpen} onClose={() => setFormOpen(false)} groupId={group.id} members={group.memberships} />
    </Box>
  );
}
