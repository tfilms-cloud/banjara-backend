import {
  isPlausibleCnicExpiry,
  normalizeCNIC,
  normalizeDate,
  normalizeName,
} from './normalize';

export type ExtractedCnicFields = {
  cnicNumber: string | null;
  fatherName: string | null;
  expiryDate: string | null;
  confidence: {
    cnicNumber: number | null;
    fatherName: number | null;
    expiryDate: number | null;
  };
};

/**
 * Convert an OCR token to digits.
 * Only substitutes lookalike letters when the token is already mostly numeric.
 */
function ocrDigits(token: string): string {
  const cleaned = token.replace(/[^0-9OIlSZBDo]/gi, '');
  if (!cleaned) return '';
  const realDigits = (cleaned.match(/\d/g) ?? []).length;
  if (realDigits < Math.ceil(cleaned.length * 0.5)) {
    return cleaned.replace(/\D/g, '');
  }
  return cleaned
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[Zz]/g, '2')
    .replace(/\D/g, '');
}

function repairOcrText(ocrText: string): string {
  return ocrText
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D~～]/g, '-')
    .replace(/ldentity/gi, 'Identity')
    .replace(/ldentit[yv]/gi, 'Identity')
    .replace(/Fath[ae]r\s*Nam\w*/gi, 'Father Name')
    .replace(/Father'?s?\s*Nam\w*/gi, 'Father Name')
    .replace(/Date\s*of\s*Expir\w*/gi, 'Date of Expiry');
}

function isPlausibleCnic(digits: string): boolean {
  if (!/^\d{13}$/.test(digits)) return false;
  const province = Number(digits[0]);
  if (province < 1 || province > 8) return false;
  if (/^(19|20)\d{2}/.test(digits)) return false;
  if (/^(\d)\1{12}$/.test(digits)) return false;
  return true;
}

function scoreCnicCandidate(
  text: string,
  index: number,
  digits: string,
  opts: { dashed?: boolean; labeled?: boolean } = {}
): number {
  if (!isPlausibleCnic(digits)) return 0;

  const window = text.slice(Math.max(0, index - 80), Math.min(text.length, index + 60));
  const lower = window.toLowerCase();
  let score = opts.dashed ? 0.72 : 0.42;
  if (opts.labeled) score += 0.22;
  if (/identity\s*number|identity\s*no|id(?:entity)?\s*no|cnic/.test(lower)) score += 0.18;
  if (/serial|qr|barcode|chip/.test(lower)) score -= 0.25;
  if (/date\s*of\s*birth|date\s*of\s*issue|mobile|phone/.test(lower)) score -= 0.12;
  if (digits[0] === '8' && !opts.labeled && !/identity|cnic|number/.test(lower)) score -= 0.25;
  return Math.max(0, Math.min(1, score));
}

function looksLikeFieldLabel(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  return /^(name|father(?:'?s)?\s*name|gender|country(?:\s*of\s*stay)?|identity(?:\s*number)?|date(?:\s*of\s*(?:birth|issue|expiry))?|holder|pakistan|islamic|number)$/i.test(
    v
  );
}

function valueAfterLabel(text: string, label: RegExp): string | null {
  const lines = text.replace(/\u00a0/g, ' ').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!label.test(line)) continue;

    const same = line.replace(label, '').replace(/^[:\-\s]+/, '').trim();
    if (same && /[A-Za-z0-9]{2,}/.test(same)) {
      const leftCol = same.split(/\s{2,}|\t/)[0]?.trim() ?? same;
      if (leftCol && !looksLikeFieldLabel(leftCol)) {
        return leftCol;
      }
    }

    for (let j = i + 1; j < Math.min(i + 6, lines.length); j += 1) {
      const next = lines[j].trim();
      if (!next) continue;
      if (!/[A-Za-z0-9]/.test(next)) continue;
      const left = next.split(/\s{2,}|\t/)[0]?.trim() || next;
      if (looksLikeFieldLabel(left)) continue;
      if (
        /^(name|father|gender|country|identity|date|holder|pakistan|islamic)/i.test(left) &&
        left.length < 28
      ) {
        continue;
      }
      return left;
    }
  }
  return null;
}

function candidatesFromDigitStream(
  text: string,
  push: (digits: string, score: number) => void,
  baseScore: number
) {
  const spaced = text.replace(/[^\d]+/g, ' ').trim();
  for (const match of spaced.matchAll(/\b(\d{5})\s+(\d{7})\s+(\d)\b/g)) {
    const digits = `${match[1]}${match[2]}${match[3]}`;
    push(digits, baseScore + 0.08);
  }

  for (const line of text.split(/\r?\n/)) {
    if (!/identity|cnic\b|number/i.test(line)) continue;
    const stream = line.replace(/\D/g, '');
    if (stream.length === 13 && isPlausibleCnic(stream)) {
      push(stream, baseScore + 0.2);
    }
  }
}

export function extractCnicNumber(ocrText: string): { value: string | null; confidence: number | null } {
  const text = repairOcrText(ocrText);
  const candidates: Array<{ digits: string; score: number }> = [];

  const push = (digits: string, score: number) => {
    if (!isPlausibleCnic(digits) || score <= 0) return;
    const existing = candidates.find((c) => c.digits === digits);
    if (existing) {
      existing.score = Math.max(existing.score, score);
      return;
    }
    candidates.push({ digits, score });
  };

  let hasStructured = false;

  for (const match of text.matchAll(/\b(\d{5})-(\d{7})-(\d)\b/g)) {
    const digits = `${match[1]}${match[2]}${match[3]}`;
    const idx = match.index ?? 0;
    hasStructured = true;
    push(digits, scoreCnicCandidate(text, idx, digits, { dashed: true }) + 0.18);
  }

  const labeled = valueAfterLabel(
    text,
    /identit\w*\s*numb\w*|id(?:entity)?\s*no\.?|cnic\s*(?:no|number)?\.?/i
  );
  if (labeled) {
    const dashed =
      labeled.match(/(\d{5})\D{0,4}(\d{7})\D{0,4}(\d)/) ||
      labeled.match(/([0-9OIl]{5})\D{0,4}([0-9OIl]{7})\D{0,4}([0-9OIl])/i);
    const plain = labeled.match(/(\d{13})/);
    const digits = dashed
      ? ocrDigits(`${dashed[1]}${dashed[2]}${dashed[3]}`)
      : plain
        ? plain[1]
        : ocrDigits(labeled);
    if (digits.length === 13) {
      hasStructured = true;
      push(
        digits,
        scoreCnicCandidate(text, 0, digits, {
          labeled: true,
          dashed: /\d{5}\D+\d{7}\D+\d/.test(labeled),
        }) + 0.25
      );
    }
  }

  for (const match of text.matchAll(/\b(\d{5})\D{1,5}(\d{7})\D{1,5}(\d)\b/g)) {
    const digits = `${match[1]}${match[2]}${match[3]}`;
    const idx = match.index ?? 0;
    hasStructured = true;
    push(digits, scoreCnicCandidate(text, idx, digits, { dashed: true }) + 0.08);
  }

  for (const match of text.matchAll(
    /\b([0-9OIl]{5})\D{1,5}([0-9OIl]{7})\D{1,5}([0-9OIl])\b/gi
  )) {
    const digits = ocrDigits(`${match[1]}${match[2]}${match[3]}`);
    const idx = match.index ?? 0;
    if (digits.length === 13) hasStructured = true;
    push(digits, scoreCnicCandidate(text, idx, digits, { dashed: true }));
  }

  for (const match of text.matchAll(/\b(\d{13})\b/g)) {
    const digits = match[1];
    const idx = match.index ?? 0;
    // Plain 13-digit without dashes is weaker — often digit-whitelist noise
    push(digits, scoreCnicCandidate(text, idx, digits, { dashed: false }) - 0.08);
  }

  candidatesFromDigitStream(text, push, 0.48);

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return { value: null, confidence: null };

  // Reject weak plain-digit guesses when we never saw a structured CNIC shape
  const minScore = hasStructured ? 0.38 : 0.62;
  if (best.score < minScore) return { value: null, confidence: null };

  return { value: normalizeCNIC(best.digits), confidence: best.score };
}

const FATHER_NAME_BLOCKLIST = new Set([
  'FATHER',
  'NAME',
  'NUMBER',
  'IDENTITY',
  'GENDER',
  'COUNTRY',
  'PAKISTAN',
  'DATE',
  'BIRTH',
  'ISSUE',
  'EXPIRY',
  'STAY',
  'HOLDER',
  'SIGNATURE',
  'S O',
  'D O',
  'M',
  'F',
  'MALE',
  'FEMALE',
  'FORS',
  'AE',
  'FORS AE',
  'ISLAMIC',
  'REPUBLIC',
  'BSA',
  'SSORY',
  'PERC',
  'RAE',
]);

const NAME_PARTICLES = new Set(['AL', 'UL', 'BIN', 'BINT', 'VON', 'DE', 'LA', 'EL']);

/** Heuristic quality 0–1 for a Latin father name. */
export function scoreFatherNameQuality(name: string): number {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  // Real father names on CNIC are usually 1–3 words — long OCR soup is noise
  if (words.length > 3) return 0.05;
  let score = 0.35;
  if (words.length === 2) score += 0.3;
  if (words.length === 3) score += 0.15;
  if (words.length === 1 && words[0].length >= 4) score += 0.1;
  const avgLen = words.reduce((s, w) => s + w.length, 0) / words.length;
  if (avgLen >= 3.5) score += 0.15;
  if (avgLen < 3) score -= 0.2;
  for (const w of words) {
    if (w.length <= 2 && !NAME_PARTICLES.has(w)) score -= 0.35;
    if (!/[AEIOU]/.test(w)) score -= 0.25;
    if (FATHER_NAME_BLOCKLIST.has(w)) score -= 0.55;
    // Weird consonant clusters (SSORY, PERC-like OCR junk)
    if (/[BCDFGHJKLMNPQRSTVWXYZ]{4,}/i.test(w) && !/[AEIOU]{1}/.test(w)) score -= 0.3;
  }
  const letters = name.replace(/\s/g, '');
  const vowels = (letters.match(/[AEIOU]/g) ?? []).length;
  if (letters.length >= 4 && vowels / letters.length < 0.28) score -= 0.3;
  if (words.length === 2 && words.every((w) => w.length >= 3 && /[AEIOU]/.test(w))) {
    score += 0.2;
  }
  return Math.max(0, Math.min(1, score));
}

function finalizeFatherName(raw: string, confidence: number) {
  let name = raw
    .replace(/[^\x00-\x7F]/g, ' ')
    .replace(
      /\b(Date|Gender|Country|Identity|Number|CNIC|Husband|Name|Father|Pakistan|Male|Female|Birth|Issue|Expiry)\b/gi,
      ' '
    )
    .replace(/[^A-Za-z\s'.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  name = normalizeName(name);
  if (!name || name.length < 3) return { value: null, confidence: null };
  if (FATHER_NAME_BLOCKLIST.has(name)) return { value: null, confidence: null };
  const words = name.split(' ');
  if (words.every((w) => FATHER_NAME_BLOCKLIST.has(w))) {
    return { value: null, confidence: null };
  }
  // Never keep OCR soup — CNIC father names are short
  if (words.length > 3) {
    name = words.slice(0, 3).join(' ');
  }

  const quality = scoreFatherNameQuality(name);
  if (quality < 0.5) return { value: null, confidence: null };

  return { value: name, confidence: Math.min(confidence, 0.4 + quality * 0.55) };
}

/** OCR variants of "Father Name": Fathe Nane, Fatner Narne, FatherName, Father's Name… */
const FATHER_LABEL =
  /\b(?:f\s?a\s?t\s?h\s?e\s?r|fath\w*|fat\w{1,3}r|f[ao]\w?her|fa\w?th\w?r)'?s?\s*(?:n\s?a\s?m\s?e|nam\w*|nane|narne|nme|nam)\b/i;

const NAME_LABEL_ONLY = /^\s*nam[e]?\s*$/i;

/** Line looks like a 1–3 word Latin person name (not a card heading). */
function isPersonNameLine(line: string): boolean {
  const left = line.split(/\s{2,}|\t/)[0]?.trim() || line.trim();
  if (!/^[A-Za-z][A-Za-z\s'.]{2,40}$/.test(left)) return false;
  if (looksLikeFieldLabel(left)) return false;
  if (/pakistan|islamic|republic|national|identity|card|country|stay|gender|holder|signature/i.test(left)) {
    return false;
  }
  const normalized = normalizeName(left);
  const words = normalized.split(' ').filter(Boolean);
  if (words.length < 1 || words.length > 3) return false;
  return scoreFatherNameQuality(normalized) >= 0.6;
}

/**
 * NADRA front layout: holder name → father name, both Latin, in order.
 * Used when OCR never reads the "Father Name" label itself.
 */
function fatherNameFromLayout(text: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Only trust layout when anchored on the "Name" label — otherwise OCR noise gets picked
  const nameIdx = lines.findIndex((l) => NAME_LABEL_ONLY.test(l));
  if (nameIdx < 0) return null;
  const start = nameIdx + 1;
  const names: string[] = [];
  for (let i = start; i < Math.min(lines.length, start + 6); i += 1) {
    if (/gender|country\s*of|identity|date\s*of/i.test(lines[i])) break;
    if (isPersonNameLine(lines[i])) {
      const left = lines[i].split(/\s{2,}|\t/)[0]?.trim() || lines[i];
      const normalized = normalizeName(left);
      if (!names.includes(normalized)) names.push(normalized);
    }
    if (names.length >= 2) break;
  }
  return names.length >= 2 ? names[1] : null;
}

export function extractFatherName(ocrText: string): { value: string | null; confidence: number | null } {
  const text = repairOcrText(ocrText);
  const options: Array<{ raw: string; conf: number; labeled: boolean }> = [];

  const hasFatherLabel = FATHER_LABEL.test(text);

  const labeled =
    valueAfterLabel(text, FATHER_LABEL) ||
    valueAfterLabel(text, /\bS\/?O\b/i) ||
    valueAfterLabel(text, /\bD\/?O\b/i);

  if (labeled && !(/\d{5}/.test(labeled) && ocrDigits(labeled).length >= 10)) {
    options.push({ raw: labeled, conf: 0.92, labeled: true });
  }

  const flat = text.replace(/\s+/g, ' ');
  for (const m of flat.matchAll(
    /Father'?s?\s*Name\s*[:\-]?\s*([A-Za-z][A-Za-z'.]{1,20}(?:\s+[A-Za-z][A-Za-z'.]{1,20}){0,2})(?=\s+(?:Gender|Country|Identity|Date|Husband|M\b|F\b|$))/gi
  )) {
    if (m[1]) options.push({ raw: m[1], conf: 0.8, labeled: true });
  }

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!FATHER_LABEL.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j += 1) {
      const left = lines[j].split(/\s{2,}|\t/)[0]?.trim() || lines[j].trim();
      if (!/^[A-Za-z][A-Za-z\s'.]{2,40}$/.test(left)) continue;
      if (looksLikeFieldLabel(left)) continue;
      if (left.split(/\s+/).length > 3) continue;
      options.push({ raw: left, conf: 0.88, labeled: true });
      break;
    }
  }

  // Label missed by OCR: fall back to card layout (2nd clean person-name line)
  if (!hasFatherLabel || !options.length) {
    const fromLayout = fatherNameFromLayout(text);
    if (fromLayout) options.push({ raw: fromLayout, conf: 0.6, labeled: false });
  }

  let best: { value: string; confidence: number } | null = null;
  for (const opt of options) {
    const finalized = finalizeFatherName(opt.raw, opt.conf);
    if (!finalized.value || finalized.confidence == null) continue;
    if (!best || finalized.confidence > best.confidence) {
      best = { value: finalized.value, confidence: finalized.confidence };
    }
  }

  return best ?? { value: null, confidence: null };
}

function parseOcrDate(raw: string): string | null {
  const fixed = raw
    .replace(/[Oo]/g, '0')
    .replace(/[Il]/g, '1')
    .replace(/\s+/g, ' ')
    .trim();
  return normalizeDate(fixed) ?? normalizeDate(fixed.replace(/\s/g, '.'));
}

// No leading \b: box borders often OCR as a stray digit ("127.03.2033" → 27.03.2033)
const DATE_LOOSE =
  /([0-9OIl]{1,2})\s*[.,:;\-\/ ]\s*([0-9OIl]{1,2})\s*[.,:;\-\/ ]\s*([0-9OIl]{4})\b/gi;

function collectDates(text: string): string[] {
  const found: string[] = [];
  const softened = text.replace(
    /([0-9OIl]{1,2})[.,:;\-\/ ]+([0-9OIl]{1,2})[.,:;\-\/ ]+([0-9OIl]{4})\b/gi,
    (m) => m.replace(/[Oo]/g, '0').replace(/[Il]/g, '1')
  );
  for (const match of softened.matchAll(DATE_LOOSE)) {
    const rebuilt = `${match[1]}.${match[2]}.${match[3]}`;
    const normalized = parseOcrDate(rebuilt);
    if (normalized) found.push(normalized);
  }
  for (const match of softened.matchAll(/\b(\d{2})[.\-/]?(\d{2})[.\-/]?(20\d{2}|19\d{2})\b/g)) {
    const normalized = parseOcrDate(`${match[1]}.${match[2]}.${match[3]}`);
    if (normalized) found.push(normalized);
  }
  return [...new Set(found)];
}

export function extractExpiryDate(ocrText: string): { value: string | null; confidence: number | null } {
  const text = repairOcrText(ocrText);
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/exp\w{0,4}r|expiny|date\s*of\s*exp|valid\s*(?:thru|to|until)/i.test(line)) continue;

    // Two-column OCR: "Date of Issue   Date of Expiry" then "27.03.2023   27.03.2033" — take last date
    const sameLineDates = collectDates(line).filter((d) => isPlausibleCnicExpiry(d)).sort();
    if (sameLineDates.length) {
      return { value: sameLineDates[sameLineDates.length - 1], confidence: 0.9 };
    }

    for (let j = i + 1; j < Math.min(i + 5, lines.length); j += 1) {
      const dates = collectDates(lines[j]).filter((d) => isPlausibleCnicExpiry(d)).sort();
      if (dates.length) return { value: dates[dates.length - 1], confidence: 0.88 };
    }
  }

  const flat = text.replace(/\s+/g, ' ');
  const windowMatch = flat.match(
    /Date\s*of\s*Expir(?:y|ation)?\s*[:\-]?\s*(\d{1,2}[.\-\/\s]+\d{1,2}[.\-\/\s]+\d{4})/i
  );
  if (windowMatch?.[1]) {
    const normalized = parseOcrDate(windowMatch[1]);
    if (normalized && isPlausibleCnicExpiry(normalized)) {
      return { value: normalized, confidence: 0.8 };
    }
  }

  // Fallback: latest plausible date among DOB / issue / expiry (never sci-fi years)
  const unique = collectDates(text)
    .filter((d) => isPlausibleCnicExpiry(d) || Number(d.slice(0, 4)) >= 2000)
    .filter((d) => {
      const y = Number(d.slice(0, 4));
      return y >= 2000 && y <= new Date().getFullYear() + 15;
    })
    .sort();
  if (unique.length >= 2) {
    const latest = unique[unique.length - 1];
    if (isPlausibleCnicExpiry(latest) || Number(latest.slice(0, 4)) >= new Date().getFullYear()) {
      return { value: latest, confidence: 0.5 };
    }
  } else if (unique.length === 1 && isPlausibleCnicExpiry(unique[0])) {
    return { value: unique[0], confidence: 0.4 };
  }

  return { value: null, confidence: null };
}

/** OCR text from a tight crop of the Father Name box → father name. */
export function fatherNameFromRegionText(regionText: string): string | null {
  const text = repairOcrText(regionText);
  const labeled = extractFatherName(text);
  if (labeled.value) return labeled.value;

  // Region holds only label + value, so the first clean name line is the father name
  for (const line of text.split(/\r?\n/)) {
    if (FATHER_LABEL.test(line) || /father|name/i.test(line)) continue;
    const left = line.split(/\s{2,}|\t/)[0]?.trim() || line.trim();
    if (!/^[A-Za-z][A-Za-z\s'.]{2,40}$/.test(left)) continue;
    const finalized = finalizeFatherName(left, 0.9);
    if (finalized.value) return finalized.value;
  }
  return null;
}

/** All valid dates in a tight crop (issue / expiry boxes). */
export function datesFromRegionText(regionText: string): string[] {
  return collectDates(repairOcrText(regionText));
}

/**
 * NADRA expiry shares day/month with the issue date (e.g. 27.03.2023 → 27.03.2033).
 * When OCR drops a digit ("7.03.2033"), recover the day from the issue date.
 */
export function reconcileExpiryWithIssue(
  expiryCandidates: string[],
  issueCandidates: string[]
): string | null {
  const expiries = expiryCandidates.filter((d) => isPlausibleCnicExpiry(d));
  if (!expiries.length) return null;

  const counts = new Map<string, number>();
  for (const d of expiries) counts.set(d, (counts.get(d) ?? 0) + 1);

  for (const issue of issueCandidates) {
    const [iy, im, id] = issue.split('-');
    // Exact agreement with issue day/month wins
    const agreeing = expiries.find((d) => {
      const [, m, day] = d.split('-');
      return m === im && day === id;
    });
    if (agreeing) return agreeing;

    // Same month, plausible validity span, different day → OCR misread the day
    for (const d of expiries) {
      const [y, m] = d.split('-');
      const span = Number(y) - Number(iy);
      if (m === im && [5, 7, 10, 15].includes(span)) {
        return `${y}-${m}-${id}`;
      }
    }
  }

  // Otherwise most-voted reading across variants
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function scoreExtractedFields(fields: ExtractedCnicFields): number {
  let score = 0;
  if (fields.cnicNumber) score += 3 + (fields.confidence.cnicNumber ?? 0);
  if (fields.fatherName) score += 2 + (fields.confidence.fatherName ?? 0);
  if (fields.expiryDate) score += 2 + (fields.confidence.expiryDate ?? 0);
  return score;
}

export function mergeExtractedFields(parts: ExtractedCnicFields[]): ExtractedCnicFields {
  const out: ExtractedCnicFields = {
    cnicNumber: null,
    fatherName: null,
    expiryDate: null,
    confidence: { cnicNumber: null, fatherName: null, expiryDate: null },
  };

  for (const part of parts) {
    for (const key of ['cnicNumber', 'fatherName', 'expiryDate'] as const) {
      const value = part[key];
      const conf = part.confidence[key];
      if (!value) continue;
      // Drop garbage even if a variant proposed it
      if (key === 'fatherName' && scoreFatherNameQuality(value) < 0.5) continue;
      if (key === 'expiryDate' && !isPlausibleCnicExpiry(value) && Number(value.slice(0, 4)) > new Date().getFullYear() + 15) {
        continue;
      }
      const prevConf = out.confidence[key] ?? -1;
      let nextConf = conf ?? 0;
      if (key === 'fatherName') {
        nextConf = (conf ?? 0) * 0.45 + scoreFatherNameQuality(value) * 0.55;
      }
      if (!out[key] || nextConf > prevConf) {
        out[key] = value;
        out.confidence[key] = nextConf;
      }
    }
  }
  return out;
}

/** Final gate: never return clearly-wrong autofill values. */
export function sanitizeExtractedFields(fields: ExtractedCnicFields): ExtractedCnicFields {
  const fatherOk =
    fields.fatherName && scoreFatherNameQuality(fields.fatherName) >= 0.5
      ? fields.fatherName
      : null;
  const expiryOk =
    fields.expiryDate &&
    (isPlausibleCnicExpiry(fields.expiryDate) ||
      (Number(fields.expiryDate.slice(0, 4)) >= 2020 &&
        Number(fields.expiryDate.slice(0, 4)) <= new Date().getFullYear() + 15))
      ? fields.expiryDate
      : null;

  return {
    cnicNumber: fields.cnicNumber,
    fatherName: fatherOk,
    expiryDate: expiryOk,
    confidence: {
      cnicNumber: fields.cnicNumber ? fields.confidence.cnicNumber : null,
      fatherName: fatherOk ? fields.confidence.fatherName : null,
      expiryDate: expiryOk ? fields.confidence.expiryDate : null,
    },
  };
}

export function extractCnicFieldsFromText(ocrText: string): ExtractedCnicFields {
  const cnic = extractCnicNumber(ocrText);
  const father = extractFatherName(ocrText);
  const expiry = extractExpiryDate(ocrText);
  return sanitizeExtractedFields({
    cnicNumber: cnic.value,
    fatherName: father.value,
    expiryDate: expiry.value,
    confidence: {
      cnicNumber: cnic.confidence,
      fatherName: father.confidence,
      expiryDate: expiry.confidence,
    },
  });
}
