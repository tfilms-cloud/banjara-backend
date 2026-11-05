import { z } from 'zod';

export const payoutChannelSchema = z.enum(['bank', 'easypaisa', 'jazzcash', 'raast']);

const paymentAccountFieldsSchema = z.object({
  channel: payoutChannelSchema,
  label: z.string().min(2).max(40),
  accountTitle: z.string().min(3).max(80),
  identifier: z.string().min(5).max(64),
  bankName: z.string().max(80).optional(),
  branch: z.string().max(60).optional(),
  instructions: z.string().max(300).optional(),
  active: z.boolean().optional(),
});

function refinePaymentAccount(
  data: {
    channel?: z.infer<typeof payoutChannelSchema>;
    label?: string;
    accountTitle?: string;
    identifier?: string;
    bankName?: string;
  },
  ctx: z.RefinementCtx
) {
  if (data.accountTitle != null) {
    if (!/^[A-Za-z\u0600-\u06FF\u0750-\u077F\s.'’-]+$/.test(data.accountTitle.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['accountTitle'],
        message: 'Account title must be a real name (letters only)',
      });
    }
  }

  if (data.identifier == null || data.channel == null) return;

  const id = data.identifier.replace(/\s+/g, '');
  if (data.channel === 'easypaisa' || data.channel === 'jazzcash') {
    const digits = id.replace(/\D/g, '');
    const normalized =
      digits.startsWith('92') && digits.length === 12
        ? `0${digits.slice(2)}`
        : digits.startsWith('3') && digits.length === 10
          ? `0${digits}`
          : digits;
    if (!/^03\d{9}$/.test(normalized)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['identifier'],
        message: 'Enter a valid Pakistani mobile number (03XXXXXXXXX)',
      });
    }
  }
  if (data.channel === 'bank') {
    if (!data.bankName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bankName'],
        message: 'Bank name is required',
      });
    }
    const iban = id.toUpperCase();
    const digits = id.replace(/\D/g, '');
    const ibanOk = /^PK\d{2}[A-Z0-9]{20}$/.test(iban);
    const acctOk = /^\d{8,20}$/.test(digits);
    if (!ibanOk && !acctOk) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['identifier'],
        message: 'Enter a valid IBAN (PK… 24 characters) or account number (8–20 digits)',
      });
    }
  }
  if (data.channel === 'raast') {
    const iban = id.toUpperCase();
    const digits = id.replace(/\D/g, '');
    const mobile =
      digits.startsWith('92') && digits.length === 12
        ? `0${digits.slice(2)}`
        : digits.startsWith('3') && digits.length === 10
          ? `0${digits}`
          : digits;
    const ibanOk = /^PK\d{2}[A-Z0-9]{20}$/.test(iban);
    const mobileOk = /^03\d{9}$/.test(mobile);
    if (!ibanOk && !mobileOk) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['identifier'],
        message: 'Enter a Raast IBAN (PK…) or registered mobile number (03XXXXXXXXX)',
      });
    }
  }
}

export const createPaymentAccountSchema = paymentAccountFieldsSchema.superRefine(refinePaymentAccount);

/** Zod v4: cannot .omit() a schema that already has refinements — build from base fields. */
export const updatePaymentAccountSchema = paymentAccountFieldsSchema
  .omit({ channel: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })
  .superRefine((data, ctx) => {
    // Channel is immutable on update; identifier format checks need channel from DB.
    // Only validate account title shape here when provided.
    if (data.accountTitle != null) {
      refinePaymentAccount({ accountTitle: data.accountTitle }, ctx);
    }
  });

export const initiatePaymentSchema = z.object({
  method: z.enum(['bankTransfer', 'easypaisa', 'jazzcash', 'raast']),
  accountId: z.string().min(1),
});

export const submitProofSchema = z.object({
  receiptUrls: z.array(z.string().startsWith('payment-file:').max(200)).min(1).max(6),
  referenceNumber: z.string().trim().min(3).max(80),
  paidAmount: z.coerce.number().positive(),
  paidAt: z.coerce.date().refine((v) => v.getTime() <= Date.now() + 60_000, 'Payment date cannot be in the future').optional(),
  note: z.string().max(500).optional(),
});

export const completeRefundSchema = z.object({
  referenceNumber: z.string().trim().min(3).max(80),
  receiptUrls: z.array(z.string().startsWith('payment-file:').max(200)).min(1).max(6),
});

export const reportIssueSchema = z.object({
  reason: z.enum([
    'not_received',
    'incorrect_amount',
    'incorrect_account',
    'invalid_receipt',
    'transaction_not_found',
    'duplicate_payment',
    'other',
  ]),
  note: z.string().max(500).optional(),
}).refine((value) => value.reason !== 'other' || Boolean(value.note?.trim()), {
  message: 'Describe the payment issue', path: ['note'],
});

export const sendPaymentMessageSchema = z
  .object({
    text: z.string().max(2000).optional(),
    imageUrl: z.string().startsWith('payment-file:').max(200).optional(),
    referenceNumber: z.string().max(80).optional(),
  })
  .refine((v) => Boolean(v.text?.trim() || v.imageUrl || v.referenceNumber), {
    message: 'Enter a message or attach an image',
  });
