import { Types } from 'mongoose';
import { ProviderPaymentAccount } from '../models/ProviderPaymentAccount';
import { ProviderProfile } from '../models/ProviderProfile';
import { AppError, assertFound } from '../utils/AppError';
import {
  assertValidPayoutAccount,
  normalizePayoutIdentifier,
} from '../utils/payoutAccountValidation';
import {
  maskIdentifier,
  type PayoutChannel,
} from '../types/payment.types';

function requireProvider(providerId: string) {
  if (!providerId || !Types.ObjectId.isValid(providerId)) {
    throw new AppError('Provider profile required', 403);
  }
  return providerId;
}

function validateAccountInput(input: {
  channel: PayoutChannel;
  label: string;
  accountTitle: string;
  identifier: string;
  bankName?: string;
}) {
  try {
    assertValidPayoutAccount(input);
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : 'Invalid account details', 400);
  }
}

export function toPublicAccount(
  doc: InstanceType<typeof ProviderPaymentAccount>,
  opts?: { reveal?: boolean }
) {
  return {
    id: doc._id.toString(),
    channel: doc.channel,
    label: doc.label,
    accountTitle: doc.accountTitle,
    displayIdentifier: maskIdentifier(doc.channel, doc.identifier),
    identifier: opts?.reveal ? doc.identifier : undefined,
    bankName: doc.bankName,
    branch: doc.branch,
    instructions: doc.instructions,
    active: doc.active,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function listAccounts(providerId: string, opts?: { activeOnly?: boolean }) {
  requireProvider(providerId);
  const filter: Record<string, unknown> = { providerId };
  if (opts?.activeOnly) filter.active = true;
  const rows = await ProviderPaymentAccount.find(filter).sort({ createdAt: -1 });
  return rows.map((row) => toPublicAccount(row));
}

/** Active accounts for a provider — used on the customer payment screen (masked). */
export async function listActiveAccountsForCustomer(providerId: string) {
  const rows = await ProviderPaymentAccount.find({ providerId, active: true }).sort({
    createdAt: -1,
  });
  return rows.map((row) => toPublicAccount(row));
}

export async function createAccount(
  providerId: string,
  input: {
    channel: PayoutChannel;
    label: string;
    accountTitle: string;
    identifier: string;
    bankName?: string;
    branch?: string;
    instructions?: string;
    active?: boolean;
  }
) {
  requireProvider(providerId);
  assertFound(await ProviderProfile.findById(providerId), 'Provider not found');
  validateAccountInput(input);

  const identifier = normalizePayoutIdentifier(input.channel, input.identifier);

  const doc = await ProviderPaymentAccount.create({
    providerId,
    channel: input.channel,
    label: input.label.trim(),
    accountTitle: input.accountTitle.trim(),
    identifier,
    bankName: input.bankName?.trim(),
    branch: input.branch?.trim(),
    instructions: input.instructions?.trim(),
    active: input.active !== false,
  });
  return toPublicAccount(doc);
}

export async function updateAccount(
  providerId: string,
  accountId: string,
  patch: Partial<{
    label: string;
    accountTitle: string;
    identifier: string;
    bankName: string;
    branch: string;
    instructions: string;
    active: boolean;
  }>
) {
  requireProvider(providerId);
  const doc = assertFound(
    await ProviderPaymentAccount.findOne({ _id: accountId, providerId }),
    'Payment account not found'
  );

  if (patch.label != null) doc.label = patch.label.trim();
  if (patch.accountTitle != null) doc.accountTitle = patch.accountTitle.trim();
  if (patch.identifier != null) {
    doc.identifier = normalizePayoutIdentifier(doc.channel, patch.identifier);
  }
  if (patch.bankName != null) doc.bankName = patch.bankName.trim();
  if (patch.branch != null) doc.branch = patch.branch.trim();
  if (patch.instructions != null) doc.instructions = patch.instructions.trim();
  if (patch.active != null) doc.active = Boolean(patch.active);

  validateAccountInput({
    channel: doc.channel,
    label: doc.label,
    accountTitle: doc.accountTitle,
    identifier: doc.identifier,
    bankName: doc.bankName,
  });

  await doc.save();
  return toPublicAccount(doc);
}

export async function deleteAccount(providerId: string, accountId: string) {
  requireProvider(providerId);
  const doc = assertFound(
    await ProviderPaymentAccount.findOneAndDelete({ _id: accountId, providerId }),
    'Payment account not found'
  );
  return { id: doc._id.toString(), deleted: true };
}

export async function getAccountForPayment(
  providerId: string,
  accountId: string,
  channel?: PayoutChannel
) {
  const doc = assertFound(
    await ProviderPaymentAccount.findOne({
      _id: accountId,
      providerId,
      active: true,
      ...(channel ? { channel } : {}),
    }),
    'Selected payment account is not available'
  );
  return doc;
}
