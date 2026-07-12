export interface User {
  id: number;
  username: string;
  email: string;
  display_name: string;
}

export interface GroupMembership {
  id: number;
  user: User;
  joined_at: string;
  left_at: string | null;
  role: "admin" | "member";
}

export interface Group {
  id: number;
  name: string;
  created_by: number;
  created_at: string;
  memberships: GroupMembership[];
  active_member_count: number;
}

export type SplitType = "equal" | "exact" | "unequal" | "percentage" | "share";

export interface ExpenseParticipant {
  id: number;
  user: User | null;
  guest_name: string;
  share_amount: string;
  share_input: string | null;
}

export interface Expense {
  id: number;
  group: number;
  paid_by: number;
  paid_by_detail: User;
  title: string;
  description: string;
  category: string;
  date: string;
  currency: "INR" | "USD";
  original_amount: string;
  exchange_rate_used: string;
  converted_inr_amount: string;
  split_type: SplitType;
  participants: ExpenseParticipant[];
  source_row: number | null;
  created_at: string;
}

export interface Settlement {
  id: number;
  group: number;
  from_user: number;
  from_user_detail: User;
  to_user: number;
  to_user_detail: User;
  amount: string;
  date: string;
  note: string;
}

export interface ImportAnomaly {
  id: number;
  import_batch: number;
  row_number: number;
  raw_data: Record<string, string>;
  issue_type: string;
  severity: "blocking" | "warning";
  description: string;
  suggested_action: string;
  chosen_action: string;
  status: "pending" | "resolved" | "rejected";
  resolved_by: number | null;
  // Added alongside the report.py fix - the report endpoint now sends the
  // display name too, since the plain-text report needs a name, not an id.
  resolved_by_name?: string | null;
  resolved_at: string | null;
}

export interface ImportBatch {
  id: number;
  filename: string;
  group: number;
  uploaded_at: string;
  status: string;
  total_rows: number;
  imported_rows: number;
  anomalies: ImportAnomaly[];
}

export interface BalanceSummaryLine {
  user_id: number;
  display_name: string;
  net_balance: string;
}

export interface SettlementSuggestion {
  from_user_id: number;
  from_name: string;
  to_user_id: number;
  to_name: string;
  amount: string;
}

export interface BalancesResponse {
  summary: BalanceSummaryLine[];
  settlements_needed: SettlementSuggestion[];
}

export interface BalanceTrailLine {
  kind: "paid" | "owed" | "settlement_out" | "settlement_in";
  date: string;
  description: string;
  amount: string;
  expense_id: number | null;
  settlement_id: number | null;
}