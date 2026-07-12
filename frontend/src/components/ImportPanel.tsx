import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box, Button, Chip, Typography, Paper, Stack, Alert, LinearProgress,
  Accordion, AccordionSummary, AccordionDetails, MenuItem, Select,
} from "@mui/material";
import { api } from "../api/client";
import type { ImportBatch, ImportAnomaly, GroupMembership } from "../api/types";
import PersonChip from "./PersonChip";

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
  default: [
    { value: "skip", label: "Skip this row" },
    { value: "import_as_is", label: "Import anyway (warnings only)" },
  ],
};

function AnomalyRow({ anomaly, batchGroup, members }: { anomaly: ImportAnomaly; batchGroup: number; members: GroupMembership[] }) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState("");
  const [fromUser, setFromUser] = useState("");
  const [toUser, setToUser] = useState("");

  const resolve = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { action };
      if (action === "convert_to_settlement") {
        payload.from_user_id = fromUser;
        payload.to_user_id = toUser;
      }
      return api.post(`/anomalies/${anomaly.id}/resolve/`, payload);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["import-batch", batchGroup] }),
  });

  const options = ACTION_OPTIONS[anomaly.issue_type] || ACTION_OPTIONS.default;
  const isResolved = anomaly.status !== "pending";

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
          </Typography>
        ) : (
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

            <Button
              variant="contained" size="small"
              disabled={!action || resolve.isPending}
              onClick={() => resolve.mutate()}
            >
              Apply
            </Button>
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
  // import for this group instead of assuming there is none - this is
  // what was missing before: a fresh page load had no way to find an
  // upload that already happened.
  const { data: pastBatches } = useQuery({
    queryKey: ["import-batch-list", groupId],
    queryFn: async () => (await api.get<ImportBatch[]>(`/groups/${groupId}/import/`)).data,
  });

  // Auto-select the most recent past batch once, the first time the list
  // loads, so review picks up right where it left off.
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