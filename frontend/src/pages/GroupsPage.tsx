import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Box, Button, Card, CardActionArea, CardContent, Container, Dialog, DialogActions,
  DialogContent, DialogTitle, TextField, Typography, AppBar, Toolbar, IconButton,
} from "@mui/material";
import LogoutIcon from "@mui/icons-material/Logout";
import { api } from "../api/client";
import type { Group } from "../api/types";
import { useAuth } from "../context/AuthContext";

export default function GroupsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [joinedAt, setJoinedAt] = useState(new Date().toISOString().slice(0, 10));

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

  return (
    <>
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>Shared Expenses</Typography>
          <Typography variant="body2" sx={{ mr: 2 }}>{user?.display_name}</Typography>
          <IconButton onClick={logout}><LogoutIcon /></IconButton>
        </Toolbar>
      </AppBar>
      <Container sx={{ mt: 4 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Typography variant="h5">Your groups</Typography>
          <Button variant="contained" onClick={() => setOpen(true)}>New group</Button>
        </Box>

        {isLoading && <Typography>Loading…</Typography>}
        <Box display="grid" gridTemplateColumns="repeat(auto-fill, minmax(240px, 1fr))" gap={2}>
          {groups?.map((g) => (
            <Card key={g.id}>
              <CardActionArea onClick={() => navigate(`/groups/${g.id}`)}>
                <CardContent>
                  <Typography variant="h6">{g.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {g.active_member_count} active member{g.active_member_count !== 1 ? "s" : ""}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Box>

        <Dialog open={open} onClose={() => setOpen(false)}>
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
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={() => createGroup.mutate()} disabled={!name || createGroup.isPending}>
              Create
            </Button>
          </DialogActions>
        </Dialog>
      </Container>
    </>
  );
}
