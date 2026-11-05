import {
  isDateExpired,
  nameSimilarity,
  normalizeCNIC,
  normalizeDate,
  normalizeName,
} from './normalize';
import type { ExtractedCnicFields } from './extract';

export type FieldMatch<T = string> = {
  entered: string;
  extracted: T | null;
  matched: boolean;
};

export type CnicVerificationResult = {
  verified: boolean;
  status: 'verified' | 'failed' | 'manual_review';
  /** Safe for clients — no OCR raw text */
  message: string;
  fields: {
    cnicNumber: FieldMatch;
    fatherName: FieldMatch & { similarity: number };
    expiryDate: FieldMatch & { expired: boolean };
  };
};

const NAME_MATCH_THRESHOLD = 0.82;
const NAME_REVIEW_THRESHOLD = 0.68;
const LOW_CONFIDENCE = 0.55;

export function matchCnicFields(input: {
  enteredCnic: string;
  enteredFatherName: string;
  enteredExpiryDate: string;
  extracted: ExtractedCnicFields;
}): CnicVerificationResult {
  const enteredCnic = normalizeCNIC(input.enteredCnic);
  const enteredFather = normalizeName(input.enteredFatherName);
  const enteredExpiry = normalizeDate(input.enteredExpiryDate);

  const extractedCnic = input.extracted.cnicNumber
    ? normalizeCNIC(input.extracted.cnicNumber)
    : null;
  const extractedFather = input.extracted.fatherName
    ? normalizeName(input.extracted.fatherName)
    : null;
  const extractedExpiry = input.extracted.expiryDate
    ? normalizeDate(input.extracted.expiryDate)
    : null;

  const cnicMatched = Boolean(enteredCnic && extractedCnic && enteredCnic === extractedCnic);
  const similarity = nameSimilarity(enteredFather, extractedFather ?? '');
  const fatherMatched =
    Boolean(enteredFather && extractedFather) && similarity >= NAME_MATCH_THRESHOLD;
  const expiryMatched = Boolean(
    enteredExpiry && extractedExpiry && enteredExpiry === extractedExpiry
  );
  const expired =
    isDateExpired(enteredExpiry) ||
    isDateExpired(extractedExpiry) ||
    (Boolean(enteredExpiry) && isDateExpired(enteredExpiry));

  const incomplete =
    !extractedCnic || !extractedFather || !extractedExpiry || !enteredExpiry;

  const lowConfidence =
    (input.extracted.confidence.cnicNumber != null &&
      input.extracted.confidence.cnicNumber < LOW_CONFIDENCE) ||
    (input.extracted.confidence.fatherName != null &&
      input.extracted.confidence.fatherName < LOW_CONFIDENCE) ||
    (input.extracted.confidence.expiryDate != null &&
      input.extracted.confidence.expiryDate < LOW_CONFIDENCE);

  const clearMismatch =
    (extractedCnic && enteredCnic && !cnicMatched) ||
    (extractedExpiry && enteredExpiry && !expiryMatched) ||
    (extractedFather &&
      enteredFather &&
      similarity < NAME_REVIEW_THRESHOLD &&
      !fatherMatched) ||
    expired;

  const ambiguousName =
    Boolean(extractedFather && enteredFather) &&
    !fatherMatched &&
    similarity >= NAME_REVIEW_THRESHOLD &&
    similarity < NAME_MATCH_THRESHOLD;

  let status: CnicVerificationResult['status'];
  let message: string;

  if (cnicMatched && fatherMatched && expiryMatched && !expired) {
    status = 'verified';
    message = 'CNIC information extracted and matched. This does not prove document authenticity.';
  } else if (clearMismatch && !incomplete) {
    status = 'failed';
    message = expired
      ? 'This CNIC appears to be expired.'
      : 'The information on your CNIC does not match the information you entered.';
  } else if (incomplete || lowConfidence || ambiguousName) {
    status = 'manual_review';
    message = 'Your CNIC requires manual verification.';
  } else {
    status = 'failed';
    message = 'The information on your CNIC does not match the information you entered.';
  }

  return {
    verified: status === 'verified',
    status,
    message,
    fields: {
      cnicNumber: {
        entered: enteredCnic,
        extracted: extractedCnic,
        matched: cnicMatched,
      },
      fatherName: {
        entered: enteredFather,
        extracted: extractedFather,
        matched: fatherMatched,
        similarity: Math.round(similarity * 1000) / 1000,
      },
      expiryDate: {
        entered: enteredExpiry ?? input.enteredExpiryDate,
        extracted: extractedExpiry,
        matched: expiryMatched,
        expired,
      },
    },
  };
}
