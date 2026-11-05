import { AppError } from '../AppError';

export type ImageQualityResult = {
  ok: boolean;
  width: number | null;
  height: number | null;
  byteLength: number;
  reason?: string;
};

function readPngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

function readJpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const size = buf.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc2) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      return { width, height };
    }
    i += 2 + size;
  }
  return null;
}

/**
 * Basic structural checks only — not authenticity proof.
 * Allows portrait phone photos of a CNIC (common in the wild).
 */
export function assessImageQuality(buffer: Buffer): ImageQualityResult {
  const byteLength = buffer.length;
  if (!buffer?.length) {
    return { ok: false, width: null, height: null, byteLength: 0, reason: 'missing' };
  }
  if (byteLength < 8_000) {
    return { ok: false, width: null, height: null, byteLength, reason: 'too_small' };
  }
  if (byteLength > 12 * 1024 * 1024) {
    return { ok: false, width: null, height: null, byteLength, reason: 'too_large' };
  }

  const size = readJpegSize(buffer) ?? readPngSize(buffer);
  if (!size) {
    return {
      ok: false,
      width: null,
      height: null,
      byteLength,
      reason: 'unsupported_format',
    };
  }

  const minSide = Math.min(size.width, size.height);
  const maxSide = Math.max(size.width, size.height);
  if (minSide < 280 || maxSide < 400) {
    return {
      ok: false,
      width: size.width,
      height: size.height,
      byteLength,
      reason: 'low_resolution',
    };
  }

  // Allow portrait (phone) and landscape card frames
  const ratio = size.width / Math.max(1, size.height);
  if (ratio < 0.35 || ratio > 3.2) {
    return {
      ok: false,
      width: size.width,
      height: size.height,
      byteLength,
      reason: 'unlikely_cnic_frame',
    };
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 64_000));
  const unique = new Set(sample);
  if (unique.size < 18) {
    return {
      ok: false,
      width: size.width,
      height: size.height,
      byteLength,
      reason: 'low_detail',
    };
  }

  return { ok: true, width: size.width, height: size.height, byteLength };
}

export function assertProcessableCnicImage(buffer: Buffer) {
  const quality = assessImageQuality(buffer);
  if (!quality.ok) {
    throw new AppError('Please upload a clearer image of your CNIC.', 400);
  }
  return quality;
}
