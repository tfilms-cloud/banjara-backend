import { ProviderProfile } from '../models/ProviderProfile';
import { AppError, assertFound } from '../utils/AppError';
import { extractCnicFieldsFromText } from '../utils/cnic/extract';
import { matchCnicFields, type CnicVerificationResult } from '../utils/cnic/match';
import { maskCNIC, normalizeCNIC, normalizeDate, normalizeName } from '../utils/cnic/normalize';
import { logger } from '../utils/logger';
import * as notificationService from './notification.service';
import { extractCNICData } from './ocr/ocr.service';

const recentAttempts = new Map<string, number>();
const ATTEMPT_COOLDOWN_MS = 8_000;

function guardDuplicate(providerId: string) {
  const last = recentAttempts.get(providerId) ?? 0;
  if (Date.now() - last < ATTEMPT_COOLDOWN_MS) {
    throw new AppError('Verification already in progress. Please wait a moment.', 429);
  }
  recentAttempts.set(providerId, Date.now());
}

export type IdentityVerificationSnapshot = {
  verificationStatus: 'pending' | 'verified' | 'failed' | 'manual_review';
  cnicVerified: boolean;
  cnicNumberMasked: string;
  fatherNameVerified: boolean;
  expiryDateVerified: boolean;
  documentVerificationDate?: Date;
  verificationFailureReason: string | null;
  /** OCR matched info only — not document authenticity */
  informationMatched: boolean;
};

async function persistResult(providerId: string, result: CnicVerificationResult) {
  const profile = assertFound(await ProviderProfile.findById(providerId), 'Provider not found');
  const snapshot: IdentityVerificationSnapshot = {
    verificationStatus: result.status,
    cnicVerified: result.fields.cnicNumber.matched && result.status === 'verified',
    cnicNumberMasked: maskCNIC(result.fields.cnicNumber.entered),
    fatherNameVerified: result.fields.fatherName.matched,
    expiryDateVerified: result.fields.expiryDate.matched && !result.fields.expiryDate.expired,
    documentVerificationDate: new Date(),
    verificationFailureReason: result.status === 'verified' ? null : result.message,
    informationMatched: result.verified,
  };

  profile.set('identityVerification', snapshot);
  // Soft-sync guide CNIC number when present (masked storage elsewhere)
  if (result.status === 'verified' && profile.guideDetails && typeof profile.guideDetails === 'object') {
    const guide = { ...(profile.guideDetails as Record<string, unknown>) };
    guide.cnicNumber = result.fields.cnicNumber.entered;
    profile.guideDetails = guide as typeof profile.guideDetails;
  }
  // The provider's identity and their driver's CNIC may belong to different people.
  // Verifying the account holder must not overwrite the saved driver's details.

  await profile.save();
  logger.info(
    {
      providerId,
      status: result.status,
      cnicMasked: snapshot.cnicNumberMasked,
    },
    '[cnic] verification stored'
  );
  return snapshot;
}

export async function extractFromCnicImage(input: {
  providerId: string;
  frontImage: Buffer;
  mimeType?: string;
}) {
  // Autofill can be retried immediately after crop — don't block on cooldown
  const extracted = await extractCNICData(input.frontImage, input.mimeType);
  const found = Boolean(extracted.cnicNumber || extracted.fatherName || extracted.expiryDate);
  return {
    cnicNumber: extracted.cnicNumber,
    fatherName: extracted.fatherName,
    expiryDate: extracted.expiryDate,
    confidence: extracted.confidence,
    filled: found,
    /** Prefill helper — client must not treat this as final verification */
    note: found
      ? 'Details were read from your CNIC. Confirm them, then verify.'
      : 'Could not read fields automatically. Enter the details manually, then verify.',
  };
}

export async function verifyProviderCnic(input: {
  providerId: string;
  cnicNumber: string;
  fatherName: string;
  expiryDate: string;
  frontImage: Buffer;
  backImage?: Buffer;
  mimeType?: string;
}): Promise<CnicVerificationResult & { identityVerification: IdentityVerificationSnapshot }> {
  guardDuplicate(`verify:${input.providerId}`);

  const enteredCnic = normalizeCNIC(input.cnicNumber);
  if (enteredCnic.length !== 13) {
    throw new AppError('Enter a valid 13-digit CNIC number', 400);
  }
  const enteredFather = normalizeName(input.fatherName);
  if (enteredFather.length < 3) {
    throw new AppError("Enter father's name as printed on the CNIC", 400);
  }
  const enteredExpiry = normalizeDate(input.expiryDate);
  if (!enteredExpiry) {
    throw new AppError('Enter a valid CNIC expiry date', 400);
  }

  const front = await extractCNICData(input.frontImage, input.mimeType);
  let merged = front;

  // Back image can help when front OCR misses a field — merge missing only
  if (input.backImage?.length) {
    try {
      const back = await extractCNICData(input.backImage, input.mimeType);
      merged = {
        cnicNumber: front.cnicNumber ?? back.cnicNumber,
        fatherName: front.fatherName ?? back.fatherName,
        expiryDate: front.expiryDate ?? back.expiryDate,
        confidence: {
          cnicNumber: front.confidence.cnicNumber ?? back.confidence.cnicNumber,
          fatherName: front.confidence.fatherName ?? back.confidence.fatherName,
          expiryDate: front.confidence.expiryDate ?? back.confidence.expiryDate,
        },
        provider: front.provider,
      };
    } catch {
      // Front is enough if back fails quality/OCR
    }
  }

  const result = matchCnicFields({
    enteredCnic,
    enteredFatherName: enteredFather,
    enteredExpiryDate: enteredExpiry,
    extracted: merged,
  });

  const identityVerification = await persistResult(input.providerId, result);

  const profile = await ProviderProfile.findById(input.providerId).select('userId').lean();
  if (profile?.userId) {
    const ok = result.status === 'verified';
    void notificationService
      .notifyUser({
        userId: profile.userId.toString(),
        type: ok ? 'cnicVerified' : 'cnicFailed',
        title: ok ? 'CNIC verified' : 'CNIC verification needs attention',
        message: ok
          ? 'Your CNIC details matched. You can continue registration.'
          : result.message || 'Please check your CNIC details and try again.',
        data: { screen: 'verification', status: result.status },
      })
      .catch((err) => {
        logger.warn({ err, providerId: input.providerId }, '[cnic] notify failed');
      });
  }

  return { ...result, identityVerification };
}

/** Unit-test helper: match without OCR. */
export function verifyFromOcrTextForTests(input: {
  cnicNumber: string;
  fatherName: string;
  expiryDate: string;
  ocrText: string;
}) {
  const extracted = extractCnicFieldsFromText(input.ocrText);
  return matchCnicFields({
    enteredCnic: input.cnicNumber,
    enteredFatherName: input.fatherName,
    enteredExpiryDate: input.expiryDate,
    extracted,
  });
}
