import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';
import {
  datesFromRegionText,
  extractCnicFieldsFromText,
  extractCnicNumber,
  fatherNameFromRegionText,
  mergeExtractedFields,
  reconcileExpiryWithIssue,
  sanitizeExtractedFields,
  scoreExtractedFields,
  type ExtractedCnicFields,
} from '../../utils/cnic/extract';
import { assertProcessableCnicImage } from '../../utils/cnic/imageQuality';
import { buildCnicFieldRegions, buildCnicOcrVariants } from '../../utils/cnic/preprocess';
import { logger } from '../../utils/logger';
import type { OcrProvider } from './ocr.types';
import { HttpOcrProvider } from './providers/httpOcr.provider';
import { TesseractOcrProvider } from './providers/tesseract.provider';

let cachedProvider: OcrProvider | null = null;

export function getOcrProvider(): OcrProvider {
  if (cachedProvider) return cachedProvider;

  const mode = (env.OCR_PROVIDER || 'auto').toLowerCase();
  if (mode === 'http' || (mode === 'auto' && env.OCR_API_KEY)) {
    cachedProvider = new HttpOcrProvider(
      env.OCR_API_URL || 'https://api.ocr.space/parse/image',
      env.OCR_API_KEY
    );
    return cachedProvider;
  }

  if (mode === 'mock') {
    throw new AppError(
      'OCR mock provider must be injected in tests via setOcrProviderForTests',
      503
    );
  }

  cachedProvider = new TesseractOcrProvider();
  return cachedProvider;
}

/** Override for unit tests. */
export function setOcrProviderForTests(provider: OcrProvider | null) {
  cachedProvider = provider;
}

/**
 * Run OCR + CNIC field extraction across image orientations / regions.
 * Does not log raw OCR text or identity fields.
 */
export async function extractCNICData(
  image: Buffer,
  mimeType = 'image/jpeg'
): Promise<ExtractedCnicFields & { provider: string }> {
  assertProcessableCnicImage(image);

  const provider = getOcrProvider();
  let variants: Buffer[];
  try {
    variants = await buildCnicOcrVariants(image);
  } catch {
    variants = [image];
  }

  const parts: ExtractedCnicFields[] = [];
  let bestTextLen = 0;
  let combinedText = '';

  // 1) Field-box pass: read each NADRA field from its fixed position on the cropped card
  const region = await readFieldRegions(provider, image, mimeType);
  if (region.debugText) combinedText = region.debugText;
  const regionComplete = Boolean(region.cnicNumber && region.fatherName && region.expiryDate);

  // 2) Whole-card passes fill whatever the field boxes missed
  for (let i = 0; i < (regionComplete ? 0 : variants.length); i += 1) {
    try {
      const result = await provider.extractText(variants[i], mimeType);
      const text = result.text ?? '';
      if (!text.trim()) continue;
      bestTextLen = Math.max(bestTextLen, text.length);
      combinedText = `${combinedText}\n${text}`;
      parts.push(extractCnicFieldsFromText(text));

      const mergedSoFar = mergeExtractedFields(parts);
      // Only stop early when all three autofill fields are present
      if (mergedSoFar.cnicNumber && mergedSoFar.fatherName && mergedSoFar.expiryDate) {
        break;
      }
    } catch {
      // try next variant
    }
  }

  // Also extract once from the concatenated whole-card text (fields split across variants)
  const wholeCardText = parts.length ? combinedText.replace(region.debugText, '') : '';
  if (wholeCardText.trim()) {
    parts.push(extractCnicFieldsFromText(wholeCardText));
  }

  const merged = parts.length ? mergeExtractedFields(parts) : null;
  const best = sanitizeExtractedFields({
    cnicNumber: region.cnicNumber ?? merged?.cnicNumber ?? null,
    fatherName: region.fatherName ?? merged?.fatherName ?? null,
    expiryDate: region.expiryDate ?? merged?.expiryDate ?? null,
    confidence: {
      cnicNumber: region.cnicNumber ? 0.95 : (merged?.confidence.cnicNumber ?? null),
      fatherName: region.fatherName ? 0.95 : (merged?.confidence.fatherName ?? null),
      expiryDate: region.expiryDate ? 0.95 : (merged?.confidence.expiryDate ?? null),
    },
  });
  const bestScore = scoreExtractedFields(best);

  // Dev-only: count CNIC-like shapes in OCR text (no identity values logged)
  const sample = combinedText;
  const dashedHits = (sample.match(/\b\d{5}-\d{7}-\d\b/g) ?? []).length;
  const looseHits = (sample.match(/\b\d{5}\D{1,5}\d{7}\D{1,5}\d\b/g) ?? []).length;
  const fatherLabelHits = (sample.match(/fath\w*\s*nam\w*/gi) ?? []).length;

  logger.info(
    {
      provider: provider.name,
      bestScore,
      textLength: bestTextLen,
      variantsTried: variants.length,
      hasCnic: Boolean(best.cnicNumber),
      hasFather: Boolean(best.fatherName),
      hasExpiry: Boolean(best.expiryDate),
      regionCnic: Boolean(region.cnicNumber),
      regionFather: Boolean(region.fatherName),
      regionExpiry: Boolean(region.expiryDate),
      dashedHits,
      looseHits,
      fatherLabelHits,
    },
    '[ocr] extraction complete'
  );

  return { ...best, provider: provider.name };
}

type RegionFields = {
  cnicNumber: string | null;
  fatherName: string | null;
  expiryDate: string | null;
  debugText: string;
};

async function readFieldRegions(
  provider: OcrProvider,
  image: Buffer,
  mimeType: string
): Promise<RegionFields> {
  const empty: RegionFields = { cnicNumber: null, fatherName: null, expiryDate: null, debugText: '' };
  let regions: Awaited<ReturnType<typeof buildCnicFieldRegions>>;
  try {
    regions = await buildCnicFieldRegions(image);
  } catch {
    return empty;
  }
  if (!regions) return empty;

  const read = async (buffers: Buffer[]) => {
    const texts: string[] = [];
    for (const buf of buffers) {
      try {
        const r = await provider.extractText(buf, mimeType);
        if (r.text?.trim()) texts.push(r.text);
      } catch {
        // next variant
      }
    }
    return texts;
  };

  const fatherTexts = await read(regions.father);
  const cnicTexts = await read(regions.cnic);
  const issueTexts = await read(regions.issue);
  const expiryTexts = await read(regions.expiry);

  let fatherName: string | null = null;
  for (const t of fatherTexts) {
    fatherName = fatherNameFromRegionText(t);
    if (fatherName) break;
  }

  let cnicNumber: string | null = null;
  for (const t of cnicTexts) {
    cnicNumber = extractCnicNumber(t).value;
    if (cnicNumber) break;
  }

  const expiryCandidates = expiryTexts.flatMap((t) => datesFromRegionText(t));
  const issueCandidates = issueTexts.flatMap((t) => datesFromRegionText(t));
  const expiryDate = reconcileExpiryWithIssue(expiryCandidates, issueCandidates);

  const debugText = [
    '=== father region ===',
    ...fatherTexts,
    '=== cnic region ===',
    ...cnicTexts,
    '=== issue region ===',
    ...issueTexts,
    '=== expiry region ===',
    ...expiryTexts,
  ].join('\n');

  return { cnicNumber, fatherName, expiryDate, debugText };
}
