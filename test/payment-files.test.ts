import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const bucket = { upload: vi.fn(), createSignedUrl: vi.fn(), list: vi.fn() };
  return { bucket, storage: { getBucket: vi.fn(), createBucket: vi.fn(), updateBucket: vi.fn(), from: vi.fn(() => bucket) } };
});
vi.mock('../src/config/supabase', () => ({ getSupabase: () => ({ storage: fake.storage }) }));
const owner = '111111111111111111111111';
const filename = '00000000-0000-4000-8000-000000000001.jpg';
const ref = `payment-file:payments/${owner}/${filename}`;

describe('Private payment files', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.resetModules();
    fake.storage.getBucket.mockResolvedValue({ data: { public: false }, error: null });
    fake.storage.createBucket.mockResolvedValue({ error: null });
    fake.storage.updateBucket.mockResolvedValue({ error: null });
    fake.bucket.upload.mockResolvedValue({ error: null });
    fake.bucket.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://private.example/signed?token=temporary' }, error: null });
    fake.bucket.list.mockResolvedValue({ data: [{ name: filename }], error: null });
  });

  it('creates a private bucket and returns a stable reference with a temporary preview URL', async () => {
    fake.storage.getBucket.mockResolvedValue({ data: null, error: { statusCode: '404' } });
    const files = await import('../src/services/paymentFiles.service');
    const image = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);
    const result = await files.uploadPaymentImage(image, owner);
    expect(fake.storage.createBucket).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ public: false }));
    expect(result.storageRef).toMatch(/^payment-file:payments\//);
    expect(result.url).toContain('signed?token=');
    expect(fake.bucket.createSignedUrl).toHaveBeenCalledWith(result.path, 900);
  });

  it('secures an accidentally public payment bucket before signing', async () => {
    fake.storage.getBucket.mockResolvedValue({ data: { public: true }, error: null });
    const files = await import('../src/services/paymentFiles.service');
    await files.signPaymentFile(ref);
    expect(fake.storage.updateBucket).toHaveBeenCalledWith(expect.any(String), { public: false });
  });

  it('rejects another user attachment and missing objects', async () => {
    const files = await import('../src/services/paymentFiles.service');
    await expect(files.assertOwnedPaymentFiles([ref], '222222222222222222222222')).rejects.toMatchObject({ statusCode: 403 });
    fake.bucket.list.mockResolvedValue({ data: [], error: null });
    await expect(files.assertOwnedPaymentFiles([ref], owner)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('rejects arbitrary URLs and path traversal rather than trusting client attachments', async () => {
    const files = await import('../src/services/paymentFiles.service');
    for (const value of ['https://evil.example/receipt.jpg', 'payment-file:payments/../receipt.jpg']) {
      await expect(files.assertOwnedPaymentFiles([value], owner)).rejects.toMatchObject({ statusCode: 422 });
    }
    expect(fake.bucket.createSignedUrl).not.toHaveBeenCalled();
  });

  it('rejects non-image bytes before uploading anything', async () => {
    const files = await import('../src/services/paymentFiles.service');
    await expect(files.uploadPaymentImage(Buffer.from('not an image'), owner)).rejects.toMatchObject({ statusCode: 400 });
    expect(fake.bucket.upload).not.toHaveBeenCalled();
  });
});
