/** P2P-style (non-escrow) payment types for BANJARA. */

export type PayoutChannel = 'bank' | 'easypaisa' | 'jazzcash' | 'raast' | 'other';

/** Extended payment methods — legacy card/cash kept for compatibility. */
export type PaymentMethod =
  | 'card'
  | 'mobileWallet'
  | 'cash'
  | 'payAtHotel'
  | 'bankTransfer'
  | 'easypaisa'
  | 'jazzcash'
  | 'raast';

/**
 * Payment lifecycle. Legacy `pending`/`paid` remain for older records.
 * New P2P flows use the richer statuses.
 */
export type PaymentStatus =
  | 'pending'
  | 'unpaid'
  | 'payment_initiated'
  | 'proof_submitted'
  | 'under_review'
  | 'paid'
  | 'confirmed'
  | 'rejected'
  | 'disputed'
  | 'failed'
  | 'refunded'
  | 'refund_pending'
  | 'expired';

export type PaymentTimelineEventType =
  | 'booking_created'
  | 'payment_method_selected'
  | 'instructions_viewed'
  | 'marked_paid'
  | 'proof_submitted'
  | 'provider_notified'
  | 'provider_reviewing'
  | 'payment_confirmed'
  | 'booking_confirmed'
  | 'payment_issue_reported'
  | 'support_case_opened'
  | 'admin_investigation'
  | 'resolved'
  | 'expired'
  | 'refunded'
  | 'refund_requested'
  | 'message';

export type PaymentIssueReason =
  | 'not_received'
  | 'incorrect_amount'
  | 'incorrect_account'
  | 'invalid_receipt'
  | 'transaction_not_found'
  | 'duplicate_payment'
  | 'other';

export interface PaymentAccountSnapshot {
  accountId: string;
  channel: PayoutChannel;
  label: string;
  accountTitle: string;
  /** Masked display value (e.g. ****1234 or 03XX-XXX1234) */
  displayIdentifier: string;
  /** Full value only returned to the paying customer during an active payment */
  identifier?: string;
  bankName?: string;
  instructions?: string;
}

export interface PaymentProof {
  receiptUrls: string[];
  referenceNumber: string;
  paidAmount: number;
  paidAt: Date;
  note?: string;
  submittedAt: Date;
}

export interface PaymentTimelineEvent {
  type: PaymentTimelineEventType;
  message: string;
  actorRole?: 'customer' | 'provider' | 'admin' | 'system';
  actorId?: string;
  meta?: Record<string, unknown>;
  at: Date;
}

export const P2P_METHODS: PaymentMethod[] = [
  'bankTransfer',
  'easypaisa',
  'jazzcash',
  'raast',
];

export function isP2PMethod(method: string): boolean {
  return P2P_METHODS.includes(method as PaymentMethod);
}

export function channelForMethod(method: PaymentMethod): PayoutChannel | null {
  if (method === 'bankTransfer') return 'bank';
  if (method === 'easypaisa') return 'easypaisa';
  if (method === 'jazzcash') return 'jazzcash';
  if (method === 'raast') return 'raast';
  return null;
}

export function maskIdentifier(channel: PayoutChannel, value: string): string {
  const raw = String(value ?? '').replace(/\s+/g, '');
  if (!raw) return '****';
  if (channel === 'bank' || channel === 'raast') {
    if (raw.length <= 4) return `****${raw}`;
    return `${'*'.repeat(Math.max(4, raw.length - 4))}${raw.slice(-4)}`;
  }
  // mobile wallets
  if (raw.length <= 4) return `****${raw}`;
  return `${raw.slice(0, 4)}XXXX${raw.slice(-3)}`;
}

export function generateTxnCode() {
  const n = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TXN-${n}${r}`;
}
