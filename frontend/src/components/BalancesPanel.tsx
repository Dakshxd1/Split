import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Box, Typography, Paper, Stack, Chip, Dialog, DialogTitle, DialogContent, Table,
  TableBody, TableCell, TableHead, TableRow,
} from "@mui/material";
import { api } from "../api/client";
import type { BalancesResponse, BalanceTrailLine } from "../api/types";

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
                <TableCell>{line.date}</TableCell>
                <TableCell>{line.description}</TableCell>
                <TableCell>{line.kind.replace("_", " ")}</TableCell>
                <TableCell align="right" sx={{ color: Number(line.amount) < 0 ? "error.main" : "success.main" }}>
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

export default function BalancesPanel({ groupId }: { groupId: number }) {
  const [trailUser, setTrailUser] = useState<{ id: number; name: string } | null>(null);

  const { data } = useQuery({
    queryKey: ["balances", groupId],
    queryFn: async () => (await api.get<BalancesResponse>(`/groups/${groupId}/balances/`)).data,
  });

  return (
    <Box>
      <Typography variant="h6" mb={2}>Balances</Typography>

      <Typography variant="subtitle1" mb={1}>Net balance per person</Typography>
      <Stack direction="row" spacing={2} flexWrap="wrap" mb={3}>
        {data?.summary.map((line) => {
          const amt = Number(line.net_balance);
          return (
            <Paper
              key={line.user_id} sx={{ p: 2, minWidth: 180, cursor: "pointer" }}
              onClick={() => setTrailUser({ id: line.user_id, name: line.display_name })}
            >
              <Typography variant="body2" color="text.secondary">{line.display_name}</Typography>
              <Typography variant="h6" color={amt > 0 ? "success.main" : amt < 0 ? "error.main" : "text.primary"}>
                {amt === 0 ? "settled up" : amt > 0 ? `+${money(line.net_balance)}` : `-${money(line.net_balance)}`}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {amt > 0 ? "is owed" : amt < 0 ? "owes the group" : ""}
              </Typography>
            </Paper>
          );
        })}
      </Stack>

      <Typography variant="subtitle1" mb={1}>Who pays whom (minimized)</Typography>
      <Stack spacing={1}>
        {data?.settlements_needed.length === 0 && <Chip label="Everyone is settled up" color="success" sx={{ width: "fit-content" }} />}
        {data?.settlements_needed.map((s, i) => (
          <Paper key={i} sx={{ p: 1.5, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography>{s.from_name} → {s.to_name}</Typography>
            <Chip label={money(s.amount)} />
          </Paper>
        ))}
      </Stack>

      {trailUser && (
        <TrailDialog groupId={groupId} userId={trailUser.id} name={trailUser.name} onClose={() => setTrailUser(null)} />
      )}
    </Box>
  );
}
