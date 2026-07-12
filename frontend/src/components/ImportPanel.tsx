import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box, Button, Chip, Typography, Paper, Stack, Alert, LinearProgress,
  Accordion, AccordionSummary, AccordionDetails, MenuItem, Select, TextField,
} from "@mui/material";
import { api } from "../api/client";
import type { ImportBatch, ImportAnomaly, GroupMembership } from "../api/types";
import PersonChip from "./PersonChip";

// Generic actions every anomaly type can fall back to.
const DEFAULT_OPTIONS = [
  { value: "skip", label: "Skip this row" },
  { value: "import_as_is", label: "Import anyway (warnings only)" },
];

// Per-type action lists. Types not listed here fall back to DEFAULT_OPTIONS.
// Types handled by a dedicated fix-it form below (unresolved_name,
// missing_payer, split_percentage_invalid, missing_currency, invalid_date)
// still list their "fix" action here so the label + Apply button work the
// same way as every other row - the form just supplies the extra fields
// the action needs.
const ACTION_OPTIONS: Record<string, { value: string; label: string }[]> = {
  duplicate: [
    { value: "skip", label: "Skip this row (it's a duplicate)" },
    { value: "keep_both", label: "Keep both (they're actually different expenses)" },
  ],
  conflicting_duplicate: [
    { value: "skip", label: "Skip this row" },
    { value: "keep_both", label: "Keep both rows" },
  ],
  settlement_as_expense: [
    { value: "convert_to_settlement", label: "Convert to a settlement" },
    { value: "skip", label: "Skip (don't import at all)" },
  ],
  unresolved_name: [
    { value: "reassign_names", label: "Pick the correct member(s)" },
    { value: "skip", label: "Skip this row" },
  ],
  missing_payer: [
    { value: "import_with_correction", label: "Choose who paid" },
    { value: "skip", label: "Skip this row" },
  ],
  split_percentage_invalid: [
    { value: "normalize_split", label: "Auto-normalize to 100%" },
    { value: "skip", label: "Skip this row" },
  ],
  missing_currency: [
    { value: "import_with_correction", label: "Set currency and import" },
    { value: "skip", label: "Skip this row" },
  ],
  invalid_date: [
    { value: "import_with_correction", label: "Correct the date and import" },
    { value: "skip", label: "Skip this row" },
  ],
  default: DEFAULT_OPTIONS,
};

// Any name in paid_by / split_with that doesn't match a current group
// member's display name is treated as "unresolved" client-side, so the
// fix-it form knows which name(s) need a dropdown - this mirrors what the
// backend's resolve_user() does, without needing a new endpoint.
function unresolvedNames(anomaly: ImportAnomaly, members: GroupMembership[]): string[] {
  const known = new Set(members.map((m) => m.user.display_name.trim().toLowerCase()));
  const raw = anomaly.raw_data || {};
  const names: string[] = [];

  const payer = (raw.paid_by || "").toString().trim();
  if (payer && !known.has(payer.toLowerCase())) names.push(payer);

  const splitWith = (raw.split_with || "")
    .toString()
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const n of splitWith) {
    if (!known.has(n.toLowerCase())) names.push(n);
  }

  return Array.from(new Set(names));
}

// Client-side preview of what normalize_split will do, so the person sees
// the corrected percentages before committing - the actual math is done
// server-side (services/splitting.py owns the real rounding rule).
function normalizedSplitPreview(anomaly: ImportAnomaly): { name: string; from: string; to: string }[] {
  const raw = (anomaly.raw_data?.split_details || "").toString();
  const parsed = raw
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((part) => {
      const lastSpace = part.lastIndexOf(" ");
      const name = part.slice(0, lastSpace).trim();
      const value = parseFloat(part.slice(lastSpace + 1).replace("%", ""));
      return { name, value };
    });
  const total = parsed.reduce((sum, p) => sum + p.value, 0);
  if (!total) return [];
  return parsed.map((p) => ({
    name: p.name,
    from: `${p.value}%`,
    to: `${((p.value / total) * 100).toFixed(2)}%`,
  }));
}

function AnomalyRow({ anomaly, batchGroup, members }: { anomaly: ImportAnomaly; batchGroup: number; members: GroupMembership[] }) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState("");
  const [fromUser, setFromUser] = useState("");
  const [toUser, setToUser] = useState("");
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  const [payerChoice, setPayerChoice] = useState("");
  const [currencyChoice, setCurrencyChoice] = useState("");
  const [dateChoice, setDateChoice] = useState("");

  const namesNeeded = useMemo(
    () => (anomaly.issue_type === "unresolved_name" ? unresolvedNames(anomaly, members) : []),
    [anomaly, members],
  );
  const splitPreview = useMemo(
    () => (anomaly.issue_type === "split_percentage_invalid" ? normalizedSplitPreview(anomaly) : []),
    [anomaly],
  );

  const resolve = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { action };
      if (action === "convert_to_settlement") {
        payload.from_user_id = fromUser;
        payload.to_user_id = toUser;
      }
      if (action === "reassign_names") {
        payload.name_map = Object.fromEntries(
          Object.entries(nameMap).map(([name, userId]) => [name, Number(userId)]),
        );
      }
      if (action === "import_with_correction") {
        if (anomaly.issue_type === "missing_payer") payload.corrections = { paid_by: payerChoice };
        if (anomaly.issue_type === "missing_currency") payload.corrections = { currency: currencyChoice };
        if (anomaly.issue_type === "invalid_date") payload.corrections = { date: dateChoice };
      }
      return api.post(`/anomalies/${anomaly.id}/resolve/`, payload);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["import-batch", batchGroup] }),
  });

  const options = ACTION_OPTIONS[anomaly.issue_type] || ACTION_OPTIONS.default;
  const isResolved = anomaly.status !== "pending";

  const canApply = () => {
    if (!action) return false;
    if (action === "convert_to_settlement") return !!fromUser && !!toUser;
    if (action === "reassign_names") return namesNeeded.every((n) => !!nameMap[n]);
    if (action === "import_with_correction") {
      if (anomaly.issue_type === "missing_payer") return !!payerChoice;
      if (anomaly.issue_type === "missing_currency") return !!currencyChoice;
      if (anomaly.issue_type === "invalid_date") return !!dateChoice;
    }
    return true;
  };

  return (
    <Accordion>
      <AccordionSummary expandIcon={<span style={{ fontSize: 18 }}>&#9660;</span>}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ width: "100%" }}>
          <Chip size="small" label={anomaly.severity} color={anomaly.severity === "blocking" ? "error" : "warning"} />
          <Typography sx={{ flexGrow: 1 }}>
            Row {anomaly.row_number} — {anomaly.issue_type.replace(/_/g, " ")}
          </Typography>
          {isResolved && <Chip size="small" label={anomaly.status} color="success" />}
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Typography variant="body2" mb={1}>{anomaly.description}</Typography>
        <Paper variant="outlined" sx={{ p: 1, mb: 2, fontSize: 12, fontFamily: "monospace", overflowX: "auto" }}>
          {JSON.stringify(anomaly.raw_data)}
        </Paper>

        {isResolved ? (
          <Typography variant="body2" color="text.secondary">
            Resolved: {anomaly.chosen_action}
            {anomaly.resolved_by_name ? ` (by ${anomaly.resolved_by_name})` : ""}
          </Typography>
        ) : (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Select size="small" displayEmpty value={action} onChange={(e) => setAction(e.target.value)} sx={{ minWidth: 260 }}>
                <MenuItem value="" disabled>Choose an action…</MenuItem>
                {options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </Select>

              {action === "convert_to_settlement" && (
                <>
                  <Select size="small" displayEmpty value={fromUser} onChange={(e) => setFromUser(e.target.value)}>
                    <MenuItem value="" disabled>Paid by…</MenuItem>
                    {members.map((m) => (
                      <MenuItem key={m.user.id} value={m.user.id}>
                        <PersonChip id={m.user.id} name={m.user.display_name} size={20} fontSize="0.875rem" />
                      </MenuItem>
                    ))}
                  </Select>
                  <Select size="small" displayEmpty value={toUser} onChange={(e) => setToUser(e.target.value)}>
                    <MenuItem value="" disabled>Received by…</MenuItem>
                    {members.map((m) => (
                      <MenuItem key={m.user.id} value={m.user.id}>
                        <PersonChip id={m.user.id} name={m.user.display_name} size={20} fontSize="0.875rem" />
                      </MenuItem>
                    ))}
                  </Select>
                </>
              )}

              {action === "import_with_correction" && anomaly.issue_type === "missing_payer" && (
                <Select size="small" displayEmpty value={payerChoice} onChange={(e) => setPayerChoice(e.target.value)} sx={{ minWidth: 200 }}>
                  <MenuItem value="" disabled>Paid by…</MenuItem>
                  {members.map((m) => (
                    <MenuItem key={m.user.id} value={m.user.display_name}>
                      <PersonChip id={m.user.id} name={m.user.display_name} size={20} fontSize="0.875rem" />
                    </MenuItem>
                  ))}
                </Select>
              )}

              {action === "import_with_correction" && anomaly.issue_type === "missing_currency" && (
                <Select size="small" displayEmpty value={currencyChoice} onChange={(e) => setCurrencyChoice(e.target.value)} sx={{ minWidth: 140 }}>
                  <MenuItem value="" disabled>Currency…</MenuItem>
                  <MenuItem value="INR">INR</MenuItem>
                  <MenuItem value="USD">USD</MenuItem>
                </Select>
              )}

              {action === "import_with_correction" && anomaly.issue_type === "invalid_date" && (
                <TextField
                  size="small" type="date" label="Correct date"
                  InputLabelProps={{ shrink: true }}
                  value={dateChoice} onChange={(e) => setDateChoice(e.target.value)}
                />
              )}

              <Button
                variant="contained" size="small"
                disabled={!canApply() || resolve.isPending}
                onClick={() => resolve.mutate()}
              >
                Apply
              </Button>
            </Stack>

            {action === "reassign_names" && namesNeeded.length > 0 && (
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                  These name(s) from the file don't match any current group member - pick who each one really is:
                </Typography>
                <Stack spacing={1}>
                  {namesNeeded.map((name) => (
                    <Stack key={name} direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" sx={{ minWidth: 160, fontStyle: "italic" }}>"{name}"</Typography>
                      <Typography variant="body2">→</Typography>
                      <Select
                        size="small" displayEmpty sx={{ minWidth: 200 }}
                        value={nameMap[name] || ""}
                        onChange={(e) => setNameMap((prev) => ({ ...prev, [name]: e.target.value }))}
                      >
                        <MenuItem value="" disabled>Choose member…</MenuItem>
                        {members.map((m) => (
                          <MenuItem key={m.user.id} value={m.user.id}>
                            <PersonChip id={m.user.id} name={m.user.display_name} size={20} fontSize="0.875rem" />
                          </MenuItem>
                        ))}
                      </Select>
                    </Stack>
                  ))}
                </Stack>
              </Paper>
            )}

            {action === "normalize_split" && splitPreview.length > 0 && (
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                  Percentages will be scaled down proportionally so they sum to 100%:
                </Typography>
                <Stack spacing={0.5}>
                  {splitPreview.map((p) => (
                    <Typography key={p.name} variant="body2">
                      {p.name}: {p.from} → <b>{p.to}</b>
                    </Typography>
                  ))}
                </Stack>
              </Paper>
            )}
          </Stack>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

export default function ImportPanel({ groupId, members }: { groupId: number; members: GroupMembership[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // On mount (and whenever we return to this tab), look up every past
  // import for this group instead of assuming there is none - a fresh page
  // load had no way to find an upload that already happened.
  const { data: pastBatches } = useQuery({
    queryKey: ["import-batch-list", groupId],
    queryFn: async () => (await api.get<ImportBatch[]>(`/groups/${groupId}/import/`)).data,
  });

  useEffect(() => {
    if (batchId === null && pastBatches && pastBatches.length > 0) {
      setBatchId(pastBatches[0].id);
    }
  }, [pastBatches, batchId]);

  const upload = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("file", file as File);
      const { data } = await api.post<ImportBatch>(`/groups/${groupId}/import/`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return data;
    },
    onSuccess: (data) => {
      setBatchId(data.id);
      setFile(null);
    },
  });

  const { data: batch } = useQuery({
    queryKey: ["import-batch", groupId, batchId],
    queryFn: async () => (await api.get<ImportBatch>(`/import-batches/${batchId}/report/`)).data as any,
    enabled: !!batchId,
  });

  async function downloadReport() {
    const res = await api.get(`/import-batches/${batchId}/report/?download=text`, { responseType: "blob" });
    const url = window.URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `import_report_${batchId}.txt`;
    a.click();
  }

  const pending = batch?.anomalies?.filter((a: ImportAnomaly) => a.status === "pending") ?? [];
  const resolved = batch?.anomalies?.filter((a: ImportAnomaly) => a.status !== "pending") ?? [];

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={2}>
        <Typography variant="h6">Import CSV / Excel</Typography>
        {pastBatches && pastBatches.length > 1 && (
          <Button size="small" onClick={() => setPickerOpen((v) => !v)}>
            {pickerOpen ? "Hide" : "Show"} past uploads ({pastBatches.length})
          </Button>
        )}
      </Box>

      <Alert severity="info" sx={{ mb: 2 }}>
        The importer never edits the source file and never guesses. Rows with problems are held here for you
        to review and approve — nothing is deleted or changed without an explicit action from you.
      </Alert>

      {pastBatches && pastBatches.length > 1 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This group has {pastBatches.length} separate imports on record. If the same file was uploaded more
          than once, you likely have duplicate expenses — check the Expenses tab, and remove the extra batch's
          rows if so (Django admin, or the delete button on each expense).
        </Alert>
      )}

      {pickerOpen && pastBatches && (
        <Paper variant="outlined" sx={{ p: 1, mb: 2 }}>
          {pastBatches.map((b) => (
            <Box
              key={b.id}
              onClick={() => { setBatchId(b.id); setPickerOpen(false); }}
              sx={{
                p: 1, borderRadius: 1, cursor: "pointer",
                bgcolor: b.id === batchId ? "action.selected" : "transparent",
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <Typography variant="body2">
                <b>{b.filename}</b> — {new Date(b.uploaded_at).toLocaleString("en-IN")} — {b.total_rows} rows
              </Typography>
            </Box>
          ))}
        </Paper>
      )}

      <Stack direction="row" spacing={2} alignItems="center" mb={3} flexWrap="wrap">
        <Button variant="outlined" component="label">
          Choose CSV or Excel file
          <input
            type="file"
            hidden
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Button>
        {file && <Typography variant="body2">{file.name}</Typography>}
        <Button variant="contained" color="secondary" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
          {upload.isPending ? "Uploading…" : "Upload & scan"}
        </Button>
      </Stack>
      {upload.isPending && <LinearProgress sx={{ mb: 2 }} />}

      {batch && (
        <>
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Stack direction="row" spacing={3} flexWrap="wrap">
              <Typography>Total rows: <b>{batch.total_rows}</b></Typography>
              <Typography>Imported clean: <b>{batch.imported_clean}</b></Typography>
              <Typography>Anomalies: <b>{batch.anomalies_total}</b> ({pending.length} pending)</Typography>
            </Stack>
            <Button size="small" sx={{ mt: 1 }} onClick={downloadReport}>Download full report (.txt)</Button>
          </Paper>

          {pending.length > 0 && (
            <>
              <Typography variant="subtitle1" mb={1}>Needs your review ({pending.length})</Typography>
              {pending.map((a: ImportAnomaly) => (
                <AnomalyRow key={a.id} anomaly={a} batchGroup={groupId} members={members} />
              ))}
            </>
          )}

          {pending.length === 0 && (
            <Alert severity="success" sx={{ mb: 2 }}>All anomalies in this import are resolved.</Alert>
          )}

          {resolved.length > 0 && (
            <>
              <Typography variant="subtitle1" mt={3} mb={1}>Resolved ({resolved.length})</Typography>
              {resolved.map((a: ImportAnomaly) => (
                <AnomalyRow key={a.id} anomaly={a} batchGroup={groupId} members={members} />
              ))}
            </>
          )}
        </>
      )}
    </Box>
  );
}