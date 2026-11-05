/** Strip formatting from a Pakistani CNIC → 13 digits. */
export function normalizeCNIC(value: string | null | undefined): string {
  if (!value) return '';
  return String(value).replace(/\D/g, '');
}

/** Format 13-digit CNIC as xxxxx-xxxxxxx-x for display (never log full). */
export function formatCNICDisplay(value: string | null | undefined): string {
  const digits = normalizeCNIC(value);
  if (digits.length !== 13) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

export function maskCNIC(value: string | null | undefined): string {
  const digits = normalizeCNIC(value);
  if (digits.length < 8) return '***********';
  return `${digits.slice(0, 5)}******${digits.slice(-3)}`;
}

/** Uppercase, collapse whitespace, strip most punctuation. */
export function normalizeName(value: string | null | undefined): string {
  if (!value) return '';
  return String(value)
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Normalize common CNIC date formats to YYYY-MM-DD.
 * Supports DD.MM.YYYY, DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD.
 */
export function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return isValidYmd(iso[1], iso[2], iso[3]) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  }

  const dmy = raw.match(/^(\d{1,2})[./\-](\d{1,2})[./\-](\d{4})$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    const yyyy = dmy[3];
    return isValidYmd(yyyy, mm, dd) ? `${yyyy}-${mm}-${dd}` : null;
  }

  return null;
}

function isValidYmd(yyyy: string, mm: string, dd: string) {
  const y = Number(yyyy);
  const m = Number(mm);
  const d = Number(dd);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return false;
  // CNIC dates are never in the far future (OCR often invents years like 2318)
  const maxYear = new Date().getFullYear() + 20;
  if (y < 1947 || y > maxYear) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/** Expiry on a modern CNIC is typically within ~15 years of today. */
export function isPlausibleCnicExpiry(ymd: string | null | undefined, now = new Date()): boolean {
  const normalized = normalizeDate(ymd);
  if (!normalized) return false;
  const year = Number(normalized.slice(0, 4));
  const maxYear = now.getFullYear() + 15;
  // Allow slightly past expiries (still parseable) but reject ancient / sci-fi years
  return year >= now.getFullYear() - 5 && year <= maxYear;
}

export function isDateExpired(ymd: string | null | undefined, now = new Date()): boolean {
  const normalized = normalizeDate(ymd);
  if (!normalized) return false;
  const [y, m, d] = normalized.split('-').map(Number);
  const expiry = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
  return expiry.getTime() < now.getTime();
}

/** Dice coefficient on character bigrams — good for OCR name noise. */
export function nameSimilarity(a: string, b: string): number {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const bigrams = (s: string) => {
    const pairs = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i += 1) {
      const bg = s.slice(i, i + 2);
      pairs.set(bg, (pairs.get(bg) ?? 0) + 1);
    }
    return pairs;
  };

  const A = bigrams(left);
  const B = bigrams(right);
  let overlap = 0;
  for (const [bg, count] of A) {
    const other = B.get(bg) ?? 0;
    overlap += Math.min(count, other);
  }
  const total = Math.max(1, left.length - 1) + Math.max(1, right.length - 1);
  return (2 * overlap) / total;
}
