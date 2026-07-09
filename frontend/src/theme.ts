import { createTheme } from "@mui/material";

// Design direction: a household ledger, not a fintech dashboard. Ink navy
// for structure and text, a muted moss green for money that's owed to you,
// a brick-rust for money you owe, and a small gold accent for emphasis -
// evoking a receipts drawer rather than a banking app. Hairline borders
// and near-zero shadow instead of floating cards; the paper background is
// a cool off-white, not the cream/terracotta combination that's become an
// AI-design tell.
export const colors = {
  ink: "#1E2A38",
  inkSoft: "#4B5563",
  paper: "#F1F2EE",
  paperRaised: "#FFFFFF",
  hairline: "#DCDFD8",
  moss: "#3F6152",
  mossSoft: "#E7EEE9",
  rust: "#A94A34",
  rustSoft: "#F5E7E2",
  gold: "#B98A2E",
};

// A small, deliberately limited set of avatar colors so the same person
// always renders in the same color everywhere in the app (Members,
// Expenses, Balances, Import) - a recognizable "signature" per person
// rather than a generic gray initial circle.
export const avatarPalette = [
  "#3F6152", // moss
  "#A94A34", // rust
  "#4A5A8A", // slate blue
  "#B98A2E", // gold
  "#6B4C6B", // plum
  "#3E7C8C", // teal
  "#8A5A3F", // clay
];

export function colorForPerson(seed: number | string): string {
  const s = String(seed);
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return avatarPalette[hash % avatarPalette.length];
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: colors.ink },
    secondary: { main: colors.gold },
    success: { main: colors.moss, light: colors.mossSoft },
    error: { main: colors.rust, light: colors.rustSoft },
    background: { default: colors.paper, paper: colors.paperRaised },
    text: { primary: colors.ink, secondary: colors.inkSoft },
    divider: colors.hairline,
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: '"Inter", system-ui, sans-serif',
    h4: { fontFamily: '"Fraunces", serif', fontWeight: 600, letterSpacing: "-0.01em" },
    h5: { fontFamily: '"Fraunces", serif', fontWeight: 600, letterSpacing: "-0.01em" },
    h6: { fontFamily: '"Fraunces", serif', fontWeight: 600 },
    subtitle1: { fontWeight: 600, color: colors.inkSoft, fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.06em" },
    body2: { fontSize: "0.9rem" },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: { backgroundColor: colors.paperRaised, borderBottom: `1px solid ${colors.hairline}` },
        colorDefault: { backgroundColor: colors.paperRaised },
      },
      defaultProps: { elevation: 0 },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: "none" },
        outlined: { borderColor: colors.hairline },
      },
      defaultProps: { elevation: 0 },
    },
    MuiCard: {
      styleOverrides: {
        root: { border: `1px solid ${colors.hairline}`, boxShadow: "none", transition: "border-color 120ms ease, transform 120ms ease" },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: `1px solid ${colors.hairline}` },
        head: { fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: colors.inkSoft },
      },
    },
    MuiButton: {
      styleOverrides: {
        contained: { boxShadow: "none", "&:hover": { boxShadow: "none" } },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600 },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: { height: 2, backgroundColor: colors.ink },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { textTransform: "none", fontWeight: 600, fontSize: "0.85rem" },
      },
    },
  },
});