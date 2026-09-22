import { Counter } from '../models/Counter';

export async function generateBookingNumber(prefix = 'BNG'): Promise<string> {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dayKey = `${y}${m}${d}`;

  const counter = await Counter.findOneAndUpdate(
    { key: `booking-${dayKey}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );

  const seq = String(counter.seq).padStart(6, '0');
  return `${prefix}-${dayKey}-${seq}`;
}
