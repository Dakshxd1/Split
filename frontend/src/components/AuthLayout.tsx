import { Box, Typography, Stack } from "@mui/material";
import { avatarPalette } from "../theme";

/**
 * Shared shell for Login/Register. A full-height split layout: a branded
 * ink panel on the left (with the same avatar-color dots used throughout
 * the app for people, previewing the visual language before you've even
 * logged in), and the actual form on a plain paper background on the
 * right - so auth doesn't feel like a different, unstyled app bolted onto
 * the real one.
 */
export default function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <Box display="flex" minHeight="100vh">
      <Box
        sx={{
          display: { xs: "none", md: "flex" },
          flexDirection: "column",
          justifyContent: "space-between",
          width: 380,
          flexShrink: 0,
          bgcolor: "primary.main",
          color: "#fff",
          p: 5,
        }}
      >
        <Typography variant="h4" sx={{ color: "#fff" }}>Split</Typography>

        <Box>
          <Typography variant="h5" sx={{ color: "#fff", mb: 2, lineHeight: 1.3 }}>
            Every rupee traced back to a real expense — nothing owed on faith.
          </Typography>
          <Stack direction="row" spacing={1} mb={2}>
            {avatarPalette.map((c) => (
              <Box key={c} sx={{ width: 28, height: 28, borderRadius: "50%", bgcolor: c, border: "2px solid rgba(255,255,255,0.25)" }} />
            ))}
          </Stack>
          <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.65)" }}>
            Shared households, trips, and everything you split with the people who matter.
          </Typography>
        </Box>

        <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.4)" }}>
          A ledger, not a guess.
        </Typography>
      </Box>

      <Box flex={1} display="flex" alignItems="center" justifyContent="center" bgcolor="background.default" p={3}>
        <Box width="100%" maxWidth={380}>
          <Typography variant="h4" mb={0.5}>{title}</Typography>
          <Typography color="text.secondary" mb={4}>{subtitle}</Typography>
          {children}
        </Box>
      </Box>
    </Box>
  );
}