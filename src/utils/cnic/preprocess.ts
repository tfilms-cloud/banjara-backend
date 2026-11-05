import sharp from 'sharp';

export type CnicFieldRegions = {
  father: Buffer[];
  cnic: Buffer[];
  issue: Buffer[];
  expiry: Buffer[];
};

/** Field boxes on the NADRA smart-card front, as fractions of the card (x0, y0, x1, y1). */
const FIELD_BOXES = {
  father: [0.24, 0.36, 0.56, 0.5],
  cnic: [0.24, 0.7, 0.53, 0.83],
  issue: [0.24, 0.81, 0.5, 0.96],
  expiry: [0.5, 0.81, 0.71, 0.96],
} as const;

/**
 * Crop individual field boxes from a card-shaped image (the app's crop step
 * outputs the ID-1 ratio). Returns null when the image isn't card-shaped.
 */
export async function buildCnicFieldRegions(image: Buffer): Promise<CnicFieldRegions | null> {
  const oriented = await sharp(image, { failOn: 'none' }).rotate().toBuffer();
  const meta = await sharp(oriented, { failOn: 'none' }).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return null;
  const ratio = w / h;
  if (ratio < 1.35 || ratio > 1.85) return null;

  const crop = async (box: readonly [number, number, number, number]) => {
    const left = Math.max(0, Math.floor(w * box[0]));
    const top = Math.max(0, Math.floor(h * box[1]));
    const width = Math.min(w - left, Math.floor(w * (box[2] - box[0])));
    const height = Math.min(h - top, Math.floor(h * (box[3] - box[1])));
    const region = await sharp(oriented, { failOn: 'none' })
      .extract({ left, top, width, height })
      .resize({ width: 1200, withoutEnlargement: false })
      .grayscale()
      .normalize()
      .toBuffer();
    const gray = await sharp(region).sharpen({ sigma: 1.2 }).jpeg({ quality: 95 }).toBuffer();
    // Printed text is much darker than the security pattern — a low threshold keeps only text
    const darkOnly = await sharp(region).threshold(95).jpeg({ quality: 95 }).toBuffer();
    return [gray, darkOnly];
  };

  return {
    father: await crop(FIELD_BOXES.father),
    cnic: await crop(FIELD_BOXES.cnic),
    issue: await crop(FIELD_BOXES.issue),
    expiry: await crop(FIELD_BOXES.expiry),
  };
}

/**
 * Prepare CNIC photo variants for OCR.
 * Phone photos are often portrait while the card text reads landscape —
 * we emit a small set of contrast/region/rotation passes and let the
 * extractor merge fields across them.
 */
export async function buildCnicOcrVariants(image: Buffer): Promise<Buffer[]> {
  const meta = await sharp(image, { failOn: 'none' }).rotate().metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const resized = await sharp(image, { failOn: 'none' })
    .rotate() // honour EXIF
    .resize({
      width: width >= height ? 2000 : undefined,
      height: height > width ? 2000 : undefined,
      fit: 'inside',
      withoutEnlargement: false,
    })
    .toBuffer();

  const toGrayJpeg = (input: Buffer) =>
    sharp(input, { failOn: 'none' })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.2 })
      .jpeg({ quality: 92 })
      .toBuffer();

  const toThresholdJpeg = (input: Buffer) =>
    sharp(input, { failOn: 'none' })
      .grayscale()
      .normalize()
      .linear(1.3, -24)
      .threshold(148)
      .jpeg({ quality: 92 })
      .toBuffer();

  const upright = await toGrayJpeg(resized);
  const variants: Buffer[] = [upright];

  try {
    variants.push(await toThresholdJpeg(resized));
  } catch {
    // keep upright
  }

  const uprightMeta = await sharp(upright, { failOn: 'none' }).metadata();
  const uw = uprightMeta.width ?? 0;
  const uh = uprightMeta.height ?? 0;

  // Right half = Identity Number + dates; left = names; bottom-right = expiry line
  if (uw > uh && uw > 400 && uh > 200) {
    try {
      const right = await sharp(upright, { failOn: 'none' })
        .extract({
          left: Math.floor(uw * 0.4),
          top: 0,
          width: uw - Math.floor(uw * 0.4),
          height: uh,
        })
        .toBuffer();
      variants.push(await toThresholdJpeg(right));

      const left = await sharp(upright, { failOn: 'none' })
        .extract({ left: 0, top: 0, width: Math.floor(uw * 0.65), height: uh })
        .toBuffer();
      variants.push(await toGrayJpeg(left));

      // Bottom band often holds Date of Issue / Date of Expiry
      const bottom = await sharp(upright, { failOn: 'none' })
        .extract({
          left: Math.floor(uw * 0.35),
          top: Math.floor(uh * 0.55),
          width: uw - Math.floor(uw * 0.35),
          height: uh - Math.floor(uh * 0.55),
        })
        .toBuffer();
      variants.push(await toThresholdJpeg(bottom));
    } catch {
      // ignore
    }
  }

  // Common phone orientations
  for (const angle of [90, 270] as const) {
    try {
      variants.push(
        await toGrayJpeg(await sharp(upright, { failOn: 'none' }).rotate(angle).toBuffer())
      );
    } catch {
      // skip
    }
  }

  return variants;
}
