import { describe, expect, it } from 'vitest';
import { sniffImageType } from '../src/utils/imageSignature';
import { uploadImageBuffer } from '../src/config/supabase';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);
const GIF = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(8)]);
const WEBP = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii')]);

describe('Phase 4.3 — upload content validation', () => {
  it('detects real image signatures', () => {
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(GIF)).toBe('image/gif');
    expect(sniffImageType(WEBP)).toBe('image/webp');
  });

  it('returns null for non-image bytes', () => {
    expect(sniffImageType(Buffer.from('hello world, definitely not an image'))).toBeNull();
    expect(sniffImageType(Buffer.from('<script>alert(1)</script>'))).toBeNull();
  });

  it('rejects a file whose bytes are not an image even when mimetype claims image/png', async () => {
    await expect(
      uploadImageBuffer({
        buffer: Buffer.from('hello world'),
        mime: 'image/png',
        folder: 'avatars',
        userId: 'user-1',
        originalName: '../../etc/passwd',
      })
    ).rejects.toThrow(/image/i);
  });
});
