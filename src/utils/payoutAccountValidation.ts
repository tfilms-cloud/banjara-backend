import type { PayoutChannel } from '../types/payment.types';

export function digitsOnly(value: string) {
  return String(value ?? '').replace(/\D/g, '');
}

export function normalizePkMobile(raw: string): string {
  let d = digitsOnly(raw);
  if (d.startsWith('92') && d.length === 12) d = `0${d.slice(2)}`;
  if (d.startsWith('3') && d.length === 10) d = `0${d}`;
  return d;
}

export function isValidPkMobile(raw: string): boolean {
  return /^03\d{9}$/.test(normalizePkMobile(raw));
}

export function normalizeIban(raw: string): string {
  return String(raw ?? '').replace(/\s+/g, '').toUpperCase();
}

export function isValidPkIban(raw: string): boolean {
  return /^PK\d{2}[A-Z0-9]{20}$/.test(normalizeIban(raw));
}

export function isValidBankAccountNumber(raw: string): boolean {
  return /^\d{8,20}$/.test(digitsOnly(raw));
}

export function isValidAccountTitle(raw: string): boolean {
  const v = String(raw ?? '').trim();
  if (v.length < 3 || v.length > 80) return false;
  return /^[A-Za-z\u0600-\u06FF\u0750-\u077F\s.'’-]+$/.test(v);
}

export function normalizePayoutIdentifier(channel: PayoutChannel, raw: string): string {
  if (channel === 'easypaisa' || channel === 'jazzcash') {
    return normalizePkMobile(raw);
  }
  if (channel === 'bank' || channel === 'raast') {
    const iban = normalizeIban(raw);
    if (isValidPkIban(iban)) return iban;
    if (isValidPkMobile(raw)) return normalizePkMobile(raw);
    if (isValidBankAccountNumber(raw)) return digitsOnly(raw);
  }
  return String(raw ?? '').trim();
}

export function assertValidPayoutAccount(input: {
  channel: PayoutChannel;
  label: string;
  accountTitle: string;
  identifier: string;
  bankName?: string;
}) {
  const label = input.label?.trim() ?? '';
  const title = input.accountTitle?.trim() ?? '';
  const identifier = input.identifier?.trim() ?? '';
  const bankName = input.bankName?.trim() ?? '';

  if (label.length < 2 || label.length > 40) {
    throw new Error('Enter a short label (2–40 characters)');
  }
  if (!isValidAccountTitle(title)) {
    throw new Error('Enter the real account holder name (letters only, min 3 characters)');
  }

  switch (input.channel) {
    case 'easypaisa':
    case 'jazzcash':
      if (!isValidPkMobile(identifier)) {
        throw new Error('Enter a valid Pakistani mobile number (03XXXXXXXXX)');
      }
      break;
    case 'bank':
      if (!bankName || bankName.length < 2) {
        throw new Error('Bank name is required');
      }
      if (!isValidPkIban(identifier) && !isValidBankAccountNumber(identifier)) {
        throw new Error('Enter a valid IBAN (PK… 24 characters) or account number (8–20 digits)');
      }
      break;
    case 'raast':
      if (!isValidPkIban(identifier) && !isValidPkMobile(identifier)) {
        throw new Error('Enter a Raast IBAN (PK…) or registered mobile number (03XXXXXXXXX)');
      }
      break;
    case 'other':
      if (identifier.length < 5 || identifier.length > 64) {
        throw new Error('Enter a valid account identifier (5–64 characters)');
      }
      break;
    default:
      throw new Error('Unsupported payment method');
  }
}
