import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Box, Typography, Paper, Stack, Chip, Dialog, DialogTitle, DialogContent, Table,
  TableBody, TableCell, TableHead, TableRow,
} from "@mui/material";
import { api } from "../api/client";
import type { BalancesResponse, BalanceTrailLine } from "../api/types";
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

export default function BalancesPanel({ groupId }: { groupId: number }) {
  const [trailUser, setTrailUser] = useState<{ id: number; name: string } | null>(null);

  const { data } = useQuery({
    queryKey: ["balances", groupId],
    queryFn: async () => (await api.get<BalancesResponse>(`/groups/${groupId}/balances/`)).data,
  });

  return (
    <Box>
      <Typography variant="h6" mb={2}>Balances</Typography>

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
            <Chip label={money(s.amount)} sx={{ fontVariantNumeric: "tabular-nums" }} />
          </Paper>
        ))}
      </Stack>

      {trailUser && (
        <TrailDialog groupId={groupId} userId={trailUser.id} name={trailUser.name} onClose={() => setTrailUser(null)} />
      )}
    </Box>
  );
}