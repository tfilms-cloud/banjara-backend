export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Detects an image format from the file's magic bytes.
 *
 * The multipart `Content-Type` is supplied by the client and is not evidence of
 * anything; the bytes are. Returns null for anything not a supported image.
 */
export function sniffImageType(buffer: Buffer): ImageMime | null {
  if (!buffer || buffer.length < 4) return null;

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'GIF8') {
    return 'image/gif';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
