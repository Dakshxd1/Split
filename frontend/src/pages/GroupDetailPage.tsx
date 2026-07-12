import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AppBar, Toolbar, Typography, Button, Container, Tabs, Tab, Box, CircularProgress, Chip, Stack,
} from "@mui/material";
import { api } from "../api/client";
import type { Group, BalancesResponse } from "../api/types";
import { useAuth } from "../context/AuthContext";
import MembersPanel from "../components/MembersPanel";
import ExpensesPanel from "../components/ExpensesPanel";
import BalancesPanel from "../components/BalancesPanel";
import ImportPanel from "../components/ImportPanel";
import MemberAvatarStack from "../components/MemberAvatarStack";

function money(v: string) {
  const n = Number(v);
  return `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

export default function GroupDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState(0);

  const { data: group, isLoading } = useQuery({
    queryKey: ["group", id],
    queryFn: async () => (await api.get<Group>(`/groups/${id}/`)).data,
  });

  // Shares the ["balances", groupId] cache key with BalancesPanel, so
  // switching tabs doesn't trigger a second network round-trip - this
  // just reads whatever's already been (or is being) fetched.
  const { data: balances } = useQuery({
    queryKey: ["balances", Number(id)],
    queryFn: async () => (await api.get<BalancesResponse>(`/groups/${id}/balances/`)).data,
    enabled: !!id,
  });

  const myLine = balances?.summary.find((l) => l.user_id === user?.id);
  const myAmt = myLine ? Number(myLine.net_balance) : 0;

  if (isLoading || !group) {
    return (
      <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" mt={12} gap={2}>
        <CircularProgress size={28} sx={{ color: "text.secondary" }} />
        <Typography color="text.secondary">Loading group…</Typography>
      </Box>
    );
  }

  return (
    <>
      <AppBar position="static" color="default">
        <Toolbar>
          <Button onClick={() => navigate("/groups")} sx={{ mr: 1, minWidth: 0, px: 1 }}>&larr;</Button>
          <Typography variant="h6">{group.name}</Typography>
        </Toolbar>
      </AppBar>
      <Box sx={{ height: 3, background: "linear-gradient(90deg, #3F6152, #B98A2E, #A94A34)" }} />

      <Container sx={{ mt: 4 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", sm: "center" }}
          spacing={2}
          mb={3}
        >
          <Box>
            <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
              Created {new Date(group.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            </Typography>
            <MemberAvatarStack memberships={group.memberships} />
          </Box>

          {myLine && (
            <Chip
              label={
                myAmt === 0
                  ? "You're all settled up"
                  : myAmt > 0
                  ? `You're owed ${money(myLine.net_balance)}`
                  : `You owe ${money(myLine.net_balance)}`
              }
              color={myAmt > 0 ? "success" : myAmt < 0 ? "error" : "default"}
              variant="outlined"
              sx={{ fontWeight: 600, py: 2.2, px: 0.5 }}
              onClick={() => setTab(1)}
            />
          )}
        </Stack>

        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3, borderBottom: "1px solid", borderColor: "divider" }}>
          <Tab label="Expenses" />
          <Tab label="Balances" />
          <Tab label="Members" />
          <Tab label="Import CSV" />
        </Tabs>

        {tab === 0 && <ExpensesPanel group={group} />}
        {tab === 1 && <BalancesPanel groupId={group.id} members={group.memberships} />}
        {tab === 2 && <MembersPanel group={group} />}
        {tab === 3 && <ImportPanel groupId={group.id} members={group.memberships} />}
      </Container>
    </>
  );
}