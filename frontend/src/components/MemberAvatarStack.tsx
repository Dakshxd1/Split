import { Avatar, Stack, Typography } from "@mui/material";
import type { GroupMembership } from "../api/types";
import { colorForPerson, initialsFor } from "../theme";

export default function MemberAvatarStack({
  memberships, max = 4, size = 26,
}: {
  memberships: GroupMembership[];
  max?: number;
  size?: number;
}) {
  const active = memberships.filter((m) => !m.left_at);
  const shown = active.slice(0, max);
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
              width: size, height: size, fontSize: size * 0.42, fontWeight: 700,
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