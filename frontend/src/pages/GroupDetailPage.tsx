import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AppBar, Toolbar, Typography, Button, Container, Tabs, Tab, Box, CircularProgress } from "@mui/material";
import { api } from "../api/client";
import type { Group } from "../api/types";
import MembersPanel from "../components/MembersPanel";
import ExpensesPanel from "../components/ExpensesPanel";
import BalancesPanel from "../components/BalancesPanel";
import ImportPanel from "../components/ImportPanel";

export default function GroupDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState(0);

  const { data: group, isLoading } = useQuery({
    queryKey: ["group", id],
    queryFn: async () => (await api.get<Group>(`/groups/${id}/`)).data,
  });

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
      <Container sx={{ mt: 4 }}>
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