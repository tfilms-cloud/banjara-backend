import { env } from '../config/env';
import { log } from '../utils/logger';
import * as bookingService from '../services/booking.service';
import * as paymentService from '../services/payment.service';
import { cleanupRemovedMedia } from '../services/mediaDeletion.service';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const [expired, reminders, media] = await Promise.all([
      paymentService.expireStalePayments(),
      bookingService.sendPendingBookingReminders(),
      cleanupRemovedMedia(),
    ]);

    if (expired.expired > 0 || reminders.reminded > 0 || media.deleted > 0) {
      log().info(
        {
          expiredPayments: expired.expired,
          expiryNotified: expired.notified ?? 0,
          pendingReminders: reminders.reminded,
          pendingScanned: reminders.scanned,
          deletedPhotos: media.deleted,
        },
        '[jobs] tick complete'
      );
    }
  } catch (err) {
    log().error({ err }, '[jobs] tick failed');
  } finally {
    running = false;
  }
}

/** Start payment expiry, pending booking reminders and removed-photo cleanup. */
export function startJobs() {
  if (!env.JOBS_ENABLED || env.NODE_ENV === 'test') {
    log().info('[jobs] disabled');
    return;
  }
  if (timer) return;

  const interval = Math.max(15_000, env.JOBS_INTERVAL_MS);
  log().info({ intervalMs: interval }, '[jobs] starting');

  // First pass shortly after boot so local testing doesn't wait a full minute.
  setTimeout(() => void tick(), 5_000).unref?.();
  timer = setInterval(() => void tick(), interval);
  timer.unref?.();
}

export function stopJobs() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
