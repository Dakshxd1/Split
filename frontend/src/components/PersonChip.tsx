import { Avatar, Stack, Typography } from "@mui/material";
import { colorForPerson, initialsFor } from "../theme";

/**
 * Renders a small colored initial-avatar plus name. The color is a
 * deterministic hash of the person's id, so the same person always shows
 * the same color everywhere in the app (Members, Expenses, Balances,
 * Import) - a quick visual signature instead of a wall of plain text.
 */
export default function PersonChip({
  id,
  name,
  size = 24,
  fontSize = "0.875rem",
  fontWeight = 500,
  dimmed = false,
}: {
  id: number | string;
  name: string;
  size?: number;
  fontSize?: string;
  fontWeight?: number;
  dimmed?: boolean;
}) {
  const color = colorForPerson(id);
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ opacity: dimmed ? 0.55 : 1, minWidth: 0 }}>
      <Avatar
        sx={{
          width: size, height: size, bgcolor: color,
          fontSize: size * 0.4, fontWeight: 700,
        }}
      >
        {initialsFor(name || "?")}
      </Avatar>
      <Typography sx={{ fontSize, fontWeight }} noWrap>
        {name || "(unknown)"}
      </Typography>
    </Stack>
  );
}