import { env } from '../config/env';
import { DeviceToken } from '../models/DeviceToken';
import { Notification } from '../models/Notification';
import { User } from '../models/User';
import { assertFound, AppError } from '../utils/AppError';
import {
  allowsPush,
  mergePreferences,
  type NotificationPreferences,
} from '../utils/notificationCatalog';
import { logger } from '../utils/logger';
import { getPagination, paginatedResult } from '../utils/pagination';
import { getIO } from '../sockets/socket';

type NotifyInput = {
  userId: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  /** Skip Expo push (still saves inbox + socket) */
  skipPush?: boolean;
};

/**
 * Create in-app notification, emit socket event, and send Expo push when allowed.
 * Existing call sites can keep using createNotification — it aliases here.
 */
export async function notifyUser(input: NotifyInput) {
  const doc = await Notification.create({
    userId: input.userId,
    type: input.type,
    title: input.title,
    message: input.message,
    data: input.data,
  });

  const payload = {
    id: doc._id.toString(),
    type: doc.type,
    title: doc.title,
    message: doc.message,
    data: doc.data ?? {},
    isRead: false,
    createdAt: doc.createdAt,
  };

  try {
    const io = getIO();
    if (io) {
      io.to(`user:${input.userId}`).emit('notification:new', payload);
    }
  } catch (error) {
    logger.warn({ err: error, userId: input.userId }, '[notify] socket emit failed');
  }

  if (!input.skipPush) {
    void sendExpoPush(input.userId, {
      title: input.title,
      body: input.message,
      data: {
        ...(input.data ?? {}),
        type: input.type,
        notificationId: payload.id,
      },
      type: input.type,
    }).catch((error) => {
      logger.warn({ err: error, userId: input.userId }, '[notify] expo push failed');
    });
  }

  return doc;
}

/** @deprecated Prefer notifyUser — kept as alias for existing imports. */
export async function createNotification(input: NotifyInput) {
  return notifyUser(input);
}

export async function listNotifications(userId: string, query: Record<string, unknown> = {}) {
  const { page, limit, skip } = getPagination(query);
  const filter = { userId };
  const [items, total] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments(filter),
  ]);
  return paginatedResult(items, total, page, limit);
}

export async function markRead(userId: string, id: string) {
  const notification = assertFound(await Notification.findById(id), 'Notification not found');
  if (notification.userId.toString() !== userId) throw new AppError('Forbidden', 403);
  notification.isRead = true;
  await notification.save();
  return notification;
}

export async function markAllRead(userId: string) {
  await Notification.updateMany({ userId, isRead: false }, { isRead: true });
  return { updated: true };
}

export async function registerDeviceToken(input: {
  userId: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
  appRole?: 'customer' | 'provider';
}) {
  const token = String(input.token || '').trim();
  if (!token.startsWith('ExponentPushToken[') && !token.startsWith('ExpoPushToken[')) {
    throw new AppError('Invalid Expo push token', 400);
  }

  const doc = await DeviceToken.findOneAndUpdate(
    { token },
    {
      $set: {
        userId: input.userId,
        platform: input.platform,
        appRole: input.appRole ?? 'customer',
        lastSeenAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return {
    id: doc!._id.toString(),
    token: doc!.token,
    platform: doc!.platform,
    appRole: doc!.appRole,
  };
}

export async function unregisterDeviceToken(userId: string, token?: string) {
  if (token) {
    await DeviceToken.deleteMany({ userId, token });
  } else {
    await DeviceToken.deleteMany({ userId });
  }
  return { removed: true };
}

export async function getPreferences(userId: string): Promise<NotificationPreferences> {
  const user = assertFound(
    await User.findById(userId).select('preferences').lean(),
    'User not found'
  );
  const nested =
    user.preferences && typeof user.preferences === 'object'
      ? (user.preferences as Record<string, unknown>).notifications
      : undefined;
  return mergePreferences(nested);
}

export async function updatePreferences(
  userId: string,
  patch: Partial<NotificationPreferences>
): Promise<NotificationPreferences> {
  const user = assertFound(await User.findById(userId), 'User not found');
  const current = mergePreferences(
    user.preferences && typeof user.preferences === 'object'
      ? (user.preferences as Record<string, unknown>).notifications
      : undefined
  );
  const next = mergePreferences({ ...current, ...patch });
  const prefs =
    user.preferences && typeof user.preferences === 'object'
      ? { ...(user.preferences as Record<string, unknown>) }
      : {};
  prefs.notifications = next;
  user.preferences = prefs;
  await user.save();
  return next;
}

async function sendExpoPush(
  userId: string,
  message: {
    title: string;
    body: string;
    data: Record<string, unknown>;
    type: string;
  }
) {
  const prefs = await getPreferences(userId);
  if (!allowsPush(prefs, message.type)) return { sent: 0, skipped: 'prefs' as const };

  const devices = await DeviceToken.find({ userId }).lean();
  if (!devices.length) return { sent: 0, skipped: 'no_tokens' as const };

  const messages = devices.map((d) => ({
    to: d.token,
    sound: 'default' as const,
    title: message.title,
    body: message.body,
    data: message.data,
    priority: 'high' as const,
    channelId: 'banjara-default',
  }));

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (env.EXPO_NOTIFICATION_KEY) {
    headers.Authorization = `Bearer ${env.EXPO_NOTIFICATION_KEY}`;
  }

  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers,
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Expo push HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const json = (await response.json()) as {
    data?: Array<{ status?: string; details?: { error?: string }; message?: string }>;
  };

  const tickets = Array.isArray(json.data) ? json.data : [];
  const invalidTokens: string[] = [];
  tickets.forEach((ticket, index) => {
    if (ticket.status === 'error') {
      const err = ticket.details?.error || ticket.message || '';
      if (/DeviceNotRegistered|InvalidCredentials|ExpoPushToken/i.test(err)) {
        invalidTokens.push(devices[index]?.token);
      }
    }
  });

  if (invalidTokens.length) {
    await DeviceToken.deleteMany({ token: { $in: invalidTokens.filter(Boolean) } });
  }

  logger.info(
    { userId, sent: messages.length, invalid: invalidTokens.length },
    '[notify] expo push complete'
  );

  return { sent: messages.length, invalid: invalidTokens.length };
}
