"""Produces the import report required by the assignment: every anomaly
detected, its severity, and what happened to it. Rendered as JSON for the
API and as plain text for a downloadable file."""
from expenses.models import ImportAnomaly


def build_report(batch) -> dict:
    # Single query instead of one query per anomaly: select_related pulls
    # resolved_by in via SQL JOIN, and evaluating into a list once (instead
    # of calling .count() twice more on the queryset) avoids re-running the
    # base query three separate times. With the DB in a different region
    # than the backend, each of those used to cost real, visible latency -
    # this was the actual reason the report screen felt slow and got
    # slower the more anomalies were resolved.
    anomalies = list(
        ImportAnomaly.objects.filter(import_batch=batch)
        .select_related("resolved_by")
        .order_by("row_number")
    )
    pending_count = sum(1 for a in anomalies if a.status == "pending")
    return {
        "batch_id": batch.id,
        "filename": batch.filename,
        "uploaded_at": batch.uploaded_at.isoformat(),
        "total_rows": batch.total_rows,
        "imported_clean": batch.imported_rows,
        "anomalies_total": len(anomalies),
        "anomalies_pending": pending_count,
        "anomalies": [
            {
                # BUG FIX: the frontend does `/anomalies/${anomaly.id}/resolve/`
                # for every action - without this field every resolve click
                # posted to `.../anomalies/undefined/resolve/` and 404'd.
                "id": a.id,
                "import_batch": a.import_batch_id,
                "row_number": a.row_number,
                # BUG FIX: also missing - the frontend renders this in the
                # "raw data" box (JSON.stringify(anomaly.raw_data)) and the
                # new fix-it forms below read paid_by/split_with/split_details
                # straight out of it to build their dropdowns.
                "raw_data": a.raw_data,
                "issue_type": a.issue_type,
                "severity": a.severity,
                "description": a.description,
                "suggested_action": a.suggested_action,
                "chosen_action": a.chosen_action,
                "status": a.status,
                # Matches ImportAnomalySerializer / api/types.ts, which both
                # declare resolved_by as a user id (number | null), not a
                # display name. The previous version silently swapped that
                # for a name here, which is a real type mismatch even though
                # nothing crashed on it - anything consuming this endpoint
                # and expecting an id (e.g. a "resolved by you" check) would
                # have silently misbehaved on a string instead.
                "resolved_by": a.resolved_by_id,
                "resolved_by_name": a.resolved_by.display_name if a.resolved_by else None,
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
            + (f" (by {a['resolved_by_name']} at {a['resolved_at']})" if a["resolved_by_name"] else "")
        )
    return "\n".join(lines)