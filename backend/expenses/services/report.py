"""Produces the import report required by the assignment: every anomaly
detected, its severity, and what happened to it. Rendered as JSON for the
API and as plain text for a downloadable file."""
from expenses.models import ImportAnomaly


def build_report(batch) -> dict:
    anomalies = ImportAnomaly.objects.filter(import_batch=batch).order_by("row_number")
    return {
        "batch_id": batch.id,
        "filename": batch.filename,
        "uploaded_at": batch.uploaded_at.isoformat(),
        "total_rows": batch.total_rows,
        "imported_clean": batch.imported_rows,
        "anomalies_total": anomalies.count(),
        "anomalies_pending": anomalies.filter(status="pending").count(),
        "anomalies": [
            {
                "row_number": a.row_number,
                "issue_type": a.issue_type,
                "severity": a.severity,
                "description": a.description,
                "suggested_action": a.suggested_action,
                "chosen_action": a.chosen_action,
                "status": a.status,
                "resolved_by": a.resolved_by.display_name if a.resolved_by else None,
                "resolved_at": a.resolved_at.isoformat() if a.resolved_at else None,
            }
            for a in anomalies
        ],
    }


def render_report_text(batch) -> str:
    r = build_report(batch)
    lines = [
        f"IMPORT REPORT - {r['filename']}",
        f"Uploaded: {r['uploaded_at']}",
        f"Total rows: {r['total_rows']} | Imported clean: {r['imported_clean']} | Anomalies: {r['anomalies_total']} ({r['anomalies_pending']} pending)",
        "=" * 70,
    ]
    for a in r["anomalies"]:
        lines.append(
            f"Row {a['row_number']:>3} | {a['severity'].upper():8} | {a['issue_type']}\n"
            f"    {a['description']}\n"
            f"    status: {a['status']}"
            + (f" -> {a['chosen_action']}" if a["chosen_action"] else "")
            + (f" (by {a['resolved_by']} at {a['resolved_at']})" if a["resolved_by"] else "")
        )
    return "\n".join(lines)
