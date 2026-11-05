import { ServiceCatalog, DEFAULT_SERVICE_CATALOG } from '../models/ServiceCatalog';
import { AppError, assertFound } from '../utils/AppError';
import { env } from '../config/env';

function slugifyKey(input: string) {
  const raw = String(input ?? '').trim();
  // Preserve known camelCase service keys
  const known: Record<string, string> = {
    transport: 'transport',
    hotel: 'hotel',
    tour: 'tour',
    travelguide: 'travelGuide',
    travelGuide: 'travelGuide',
    carrental: 'carRental',
    carRental: 'carRental',
    restaurant: 'restaurant',
  };
  if (known[raw] || known[raw.toLowerCase()]) {
    return known[raw] || known[raw.toLowerCase()];
  }
  // New custom services: snake_case
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function normalizeFeePercent(value: unknown, fallback = 0.2) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return fallback;
  return n;
}

export async function ensureDefaultServices() {
  const count = await ServiceCatalog.countDocuments();
  if (count === 0) {
    await ServiceCatalog.insertMany(
      DEFAULT_SERVICE_CATALOG.map((item) => ({ ...item, active: true }))
    );
    return;
  }
  // Repair lowercased camelCase keys (travelguide → travelGuide)
  const keyFixes: Array<[string, string]> = [
    ['travelguide', 'travelGuide'],
    ['carrental', 'carRental'],
    ['guesthouse', 'guestHouse'],
  ];
  for (const [from, to] of keyFixes) {
    const broken = await ServiceCatalog.findOne({ key: from });
    if (!broken) continue;
    const conflict = await ServiceCatalog.findOne({ key: to });
    if (conflict) {
      await ServiceCatalog.deleteOne({ _id: broken._id });
    } else {
      broken.key = to;
      await broken.save();
    }
  }
  // Backfill fee on older catalog rows that predate this field
  await ServiceCatalog.updateMany(
    { $or: [{ platformFeePercent: { $exists: false } }, { platformFeePercent: null }] },
    { $set: { platformFeePercent: 0.2 } }
  );
}

/** Resolve BANJARA commission % for a service key (transport, hotel, …). */
export async function getFeePercentForServiceKey(serviceKey?: string | null) {
  await ensureDefaultServices();
  const raw = String(serviceKey ?? '').trim();
  const candidates = Array.from(
    new Set(
      [
        raw,
        raw.toLowerCase() === 'travelguide' ? 'travelGuide' : '',
        raw.toLowerCase() === 'carrental' ? 'carRental' : '',
      ].filter(Boolean)
    )
  );
  for (const key of candidates) {
    const row = await ServiceCatalog.findOne({ key }).select('platformFeePercent').lean();
    if (row?.platformFeePercent != null && Number.isFinite(Number(row.platformFeePercent))) {
      return Number(row.platformFeePercent);
    }
  }
  return env.PLATFORM_FEE_RATE * 100;
}

export async function listServices(options?: { includeInactive?: boolean }) {
  await ensureDefaultServices();
  const filter = options?.includeInactive ? {} : { active: true };
  return ServiceCatalog.find(filter).sort({ sortOrder: 1, label: 1 }).lean();
}

export async function createService(input: {
  key?: string;
  label: string;
  emoji?: string;
  description?: string;
  active?: boolean;
  sortOrder?: number;
  platformFeePercent?: number;
}) {
  const label = String(input.label ?? '').trim();
  if (!label) throw new AppError('Label is required', 400);

  const key = slugifyKey(input.key || label);
  if (!key) throw new AppError('A valid service key is required', 400);

  const existing = await ServiceCatalog.findOne({ key });
  if (existing) throw new AppError(`Service "${key}" already exists`, 409);

  const maxOrder = await ServiceCatalog.findOne().sort({ sortOrder: -1 }).select('sortOrder').lean();
  const sortOrder =
    input.sortOrder != null && Number.isFinite(Number(input.sortOrder))
      ? Number(input.sortOrder)
      : (maxOrder?.sortOrder ?? 0) + 1;

  return ServiceCatalog.create({
    key,
    label,
    emoji: String(input.emoji ?? '✨').trim() || '✨',
    description: String(input.description ?? '').trim(),
    active: input.active !== false,
    sortOrder,
    platformFeePercent: normalizeFeePercent(input.platformFeePercent, 0.2),
  });
}

export async function updateService(
  id: string,
  patch: {
    label?: string;
    emoji?: string;
    description?: string;
    active?: boolean;
    sortOrder?: number;
    platformFeePercent?: number;
  }
) {
  const item = assertFound(await ServiceCatalog.findById(id), 'Service not found');
  if (patch.label != null) {
    const label = String(patch.label).trim();
    if (!label) throw new AppError('Label is required', 400);
    item.label = label;
  }
  if (patch.emoji != null) item.emoji = String(patch.emoji).trim() || item.emoji;
  if (patch.description != null) item.description = String(patch.description).trim();
  if (patch.active != null) item.active = Boolean(patch.active);
  if (patch.sortOrder != null && Number.isFinite(Number(patch.sortOrder))) {
    item.sortOrder = Number(patch.sortOrder);
  }
  if (patch.platformFeePercent != null) {
    const percent = Number(patch.platformFeePercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new AppError('platformFeePercent must be between 0 and 100', 400);
    }
    item.platformFeePercent = percent;
  }
  await item.save();
  return item;
}

export async function deleteService(id: string) {
  const item = assertFound(await ServiceCatalog.findById(id), 'Service not found');
  // Soft-delete so existing providers keep their key
  item.active = false;
  await item.save();
  return item;
}
