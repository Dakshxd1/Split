import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box, Button, Card, CardActionArea, CardContent, Container, Dialog, DialogActions,
  DialogContent, DialogTitle, TextField, Typography, AppBar, Toolbar, Stack, Avatar,
  InputAdornment,
} from "@mui/material";
import { api } from "../api/client";
import type { Group } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { colorForPerson, initialsFor } from "../theme";

function MemberStack({ group }: { group: Group }) {
  const active = group.memberships.filter((m) => !m.left_at);
  const shown = active.slice(0, 4);
  const overflow = active.length - shown.length;

  if (active.length === 0) {
    return <Typography variant="caption" color="text.secondary">No active members yet</Typography>;
  }

  return (
    <Stack direction="row" alignItems="center">
      <Stack direction="row" sx={{ "& > *": { ml: -0.75 }, "& > *:first-of-type": { ml: 0 } }}>
        {shown.map((m) => (
          <Avatar
            key={m.id}
            title={m.user.display_name}
            sx={{
              width: 26, height: 26, fontSize: 11, fontWeight: 700,
              bgcolor: colorForPerson(m.user.id), border: "2px solid", borderColor: "background.paper",
            }}
          >
            {initialsFor(m.user.display_name)}
          </Avatar>
        ))}
      </Stack>
      {overflow > 0 && (
        <Typography variant="caption" color="text.secondary" ml={1}>+{overflow} more</Typography>
      )}
    </Stack>
  );
}

export default function GroupsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [joinedAt, setJoinedAt] = useState(new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState("");

  const { data: groups, isLoading } = useQuery({
    queryKey: ["groups"],
    queryFn: async () => (await api.get<Group[]>("/groups/")).data,
  });

  const createGroup = useMutation({
    mutationFn: () => api.post("/groups/", { name, creator_joined_at: joinedAt }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groups"] });
      setOpen(false);
      setName("");
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups ?? [];
    return (groups ?? []).filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, search]);

  return (
    <>
      <AppBar position="static" color="default">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>Split</Typography>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Avatar sx={{ width: 30, height: 30, bgcolor: colorForPerson(user?.id ?? 0), fontSize: 13, fontWeight: 700 }}>
              {initialsFor(user?.display_name || "?")}
            </Avatar>
            <Typography variant="body2" color="text.secondary">{user?.display_name}</Typography>
            <Button color="inherit" onClick={logout} size="small">Log out</Button>
          </Stack>
        </Toolbar>
      </AppBar>
      <Container sx={{ mt: 5, mb: 6 }}>
        <Box display="flex" justifyContent="space-between" alignItems="baseline" mb={3} flexWrap="wrap" gap={2}>
          <Typography variant="h4">Your groups</Typography>
          <Button variant="contained" color="secondary" onClick={() => setOpen(true)}>+ New group</Button>
        </Box>

        {!isLoading && (groups?.length ?? 0) > 0 && (
          <TextField
            fullWidth
            placeholder="Search your groups…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ mb: 3, maxWidth: 420 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Box component="span" sx={{ fontSize: 18, color: "text.secondary" }}>&#8981;</Box>
                </InputAdornment>
              ),
            }}
          />
        )}

        {isLoading && (
          <Typography color="text.secondary">Loading your groups…</Typography>
        )}

        {!isLoading && groups?.length === 0 && (
          <Box
            sx={{
              border: "1px dashed", borderColor: "divider", borderRadius: 2,
              p: 6, textAlign: "center", bgcolor: "background.paper",
            }}
          >
            <Typography variant="h6" gutterBottom>No groups yet</Typography>
            <Typography color="text.secondary" mb={3}>
              Create one for your household, trip, or anything else you split costs for.
            </Typography>
            <Button variant="contained" color="secondary" onClick={() => setOpen(true)}>Create your first group</Button>
          </Box>
        )}

        {!isLoading && (groups?.length ?? 0) > 0 && filtered.length === 0 && (
          <Typography color="text.secondary">No groups match "{search}".</Typography>
        )}

        <Box display="grid" gridTemplateColumns="repeat(auto-fill, minmax(260px, 1fr))" gap={2}>
          {filtered.map((g) => (
            <Card key={g.id} sx={{ "&:hover": { borderColor: "text.primary" } }}>
              <CardActionArea onClick={() => navigate(`/groups/${g.id}`)} sx={{ p: 0.5 }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom noWrap>{g.name}</Typography>
                  <Box mb={1.5}><MemberStack group={g} /></Box>
                  <Typography variant="body2" color="text.secondary">
                    {g.active_member_count} active member{g.active_member_count !== 1 ? "s" : ""}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Box>

        <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>New group</DialogTitle>
          <DialogContent>
            <TextField autoFocus fullWidth label="Group name" margin="dense" value={name} onChange={(e) => setName(e.target.value)} />
            <TextField
              fullWidth type="date" margin="dense" label="Your join date"
              value={joinedAt} onChange={(e) => setJoinedAt(e.target.value)}
              helperText="Backdate this if you're importing expenses from before today (e.g. an old spreadsheet)."
              InputLabelProps={{ shrink: true }}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="contained" color="secondary" onClick={() => createGroup.mutate()} disabled={!name || createGroup.isPending}>
              Create
            </Button>
          </DialogActions>
        </Dialog>
      </Container>
    </>
  );
}