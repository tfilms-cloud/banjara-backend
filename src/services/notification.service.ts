import { Notification } from '../models/Notification';
import { assertFound } from '../utils/AppError';
import { getPagination, paginatedResult } from '../utils/pagination';

export async function createNotification(input: {
  userId: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}) {
  // Architecture ready for Expo Push / FCM later via EXPO_NOTIFICATION_KEY.
  return Notification.create(input);
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
  if (notification.userId.toString() !== userId) throw new Error('Forbidden');
  notification.isRead = true;
  await notification.save();
  return notification;
}

export async function markAllRead(userId: string) {
  await Notification.updateMany({ userId, isRead: false }, { isRead: true });
  return { updated: true };
}
