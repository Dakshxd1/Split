import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AppBar, Toolbar, Typography, IconButton, Container, Tabs, Tab, Box, CircularProgress } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/esm/ArrowBack";
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
    return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>;
  }

  return (
    <>
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar>
          <IconButton edge="start" onClick={() => navigate("/groups")}><ArrowBackIcon /></IconButton>
          <Typography variant="h6" sx={{ ml: 1 }}>{group.name}</Typography>
        </Toolbar>
      </AppBar>
      <Container sx={{ mt: 3 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
          <Tab label="Expenses" />
          <Tab label="Balances" />
          <Tab label="Members" />
          <Tab label="Import CSV" />
        </Tabs>

        {tab === 0 && <ExpensesPanel group={group} />}
        {tab === 1 && <BalancesPanel groupId={group.id} />}
        {tab === 2 && <MembersPanel group={group} />}
        {tab === 3 && <ImportPanel groupId={group.id} members={group.memberships} />}
      </Container>
    </>
  );
}
