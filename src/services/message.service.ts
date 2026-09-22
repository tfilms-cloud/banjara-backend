import { Message } from '../models/Message';
import { Booking } from '../models/Booking';
import { ProviderProfile } from '../models/ProviderProfile';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import { getPagination, paginatedResult } from '../utils/pagination';

const MAX_MESSAGE_LENGTH = 4000;
const MAX_ATTACHMENTS = 10;
const MESSAGE_RATE_WINDOW_MS = 60 * 1000;
const MESSAGE_RATE_MAX = 60;

/**
 * Process-local per-sender throttle. Like the HTTP rate limiter this does not survive a
 * restart or span instances — see the single-instance note in the README. Structured so
 * a shared store can replace the Map without touching call sites.
 */
const messageTimestamps = new Map<string, number[]>();

function assertMessageRate(senderId: string) {
  const now = Date.now();
  const recent = (messageTimestamps.get(senderId) ?? []).filter(
    (timestamp) => now - timestamp < MESSAGE_RATE_WINDOW_MS
  );
  if (recent.length >= MESSAGE_RATE_MAX) {
    throw new AppError('Too many messages, please slow down', 429);
  }
  recent.push(now);
  messageTimestamps.set(senderId, recent);
}

export function buildConversationId(a: string, b: string) {
  return [a, b].sort().join(':');
}

export function assertConversationMember(userId: string, conversationId: string) {
  const parts = conversationId.split(':');
  if (parts.length !== 2 || !parts.includes(userId)) {
    throw new AppError('You are not a member of this conversation', 403);
  }
}

export function serializeMessage(msg: InstanceType<typeof Message>) {
  return {
    id: msg._id.toString(),
    _id: msg._id.toString(),
    conversationId: msg.conversationId,
    senderId: msg.senderId.toString(),
    receiverId: msg.receiverId.toString(),
    bookingId: msg.bookingId?.toString(),
    type: msg.type ?? 'text',
    message: msg.message,
    text: msg.message,
    attachments: msg.attachments ?? [],
    status: msg.status ?? (msg.readAt ? 'read' : msg.deliveredAt ? 'delivered' : 'sent'),
    deliveredAt: msg.deliveredAt ?? null,
    readAt: msg.readAt ?? null,
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt,
  };
}

export async function sendMessage(input: {
  senderId: string;
  receiverId: string;
  message: string;
  bookingId?: string;
  attachments?: string[];
  type?: 'text' | 'image' | 'file' | 'location' | 'trip';
}) {
  if (!input.receiverId) throw new AppError('receiverId is required', 422);
  if (!String(input.message ?? '').trim()) throw new AppError('Message is required', 422);
  if (input.senderId === input.receiverId) {
    throw new AppError('Cannot message yourself', 400);
  }
  if (String(input.message).length > MAX_MESSAGE_LENGTH) {
    throw new AppError(`Message exceeds ${MAX_MESSAGE_LENGTH} characters`, 422);
  }
  if ((input.attachments?.length ?? 0) > MAX_ATTACHMENTS) {
    throw new AppError(`A message can carry at most ${MAX_ATTACHMENTS} attachments`, 422);
  }

  assertMessageRate(input.senderId);

  const receiver = await User.findById(input.receiverId).select('status');
  if (!receiver) throw new AppError('Recipient not found', 404);
  if (receiver.status !== 'active') throw new AppError('Recipient is not available', 400);

  if (input.bookingId) {
    const booking = await Booking.findById(input.bookingId).select('customerId providerId');
    if (!booking) throw new AppError('Booking not found', 404);
    const provider = await ProviderProfile.findById(booking.providerId).select('userId');
    const participants = [booking.customerId.toString(), provider?.userId?.toString()].filter(
      (id): id is string => Boolean(id)
    );
    if (!participants.includes(input.senderId) || !participants.includes(input.receiverId)) {
      throw new AppError('Booking does not connect these users', 403);
    }
  }

  const conversationId = buildConversationId(input.senderId, input.receiverId);
  const created = await Message.create({
    conversationId,
    senderId: input.senderId,
    receiverId: input.receiverId,
    bookingId: input.bookingId,
    type: input.type ?? 'text',
    message: String(input.message).trim(),
    attachments: input.attachments ?? [],
    status: 'sent',
  });
  return serializeMessage(created);
}

export async function getConversation(
  userId: string,
  otherUserId: string,
  query: Record<string, unknown> = {}
) {
  const conversationId = buildConversationId(userId, otherUserId);
  assertConversationMember(userId, conversationId);
  const { page, limit, skip } = getPagination(query, 40);
  const filter = { conversationId };
  const [items, total] = await Promise.all([
    Message.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Message.countDocuments(filter),
  ]);
  return paginatedResult(items.reverse().map(serializeMessage), total, page, limit);
}

export async function listConversations(userId: string) {
  // Bounded: only the most recent messages are scanned, and at most 100 threads are
  // returned. Without a limit this loaded a user's entire message history.
  const messages = await Message.find({
    $or: [{ senderId: userId }, { receiverId: userId }],
  })
    .sort({ createdAt: -1 })
    .limit(1000);

  const latestByConversation = new Map<string, (typeof messages)[0]>();
  for (const msg of messages) {
    if (!latestByConversation.has(msg.conversationId)) {
      latestByConversation.set(msg.conversationId, msg);
    }
  }

  const threads = await Promise.all(
    Array.from(latestByConversation.values()).map(async (msg) => {
      const otherUserId =
        msg.senderId.toString() === userId ? msg.receiverId.toString() : msg.senderId.toString();
      const otherUser = await User.findById(otherUserId).select('name role avatar');
      const unreadCount = await Message.countDocuments({
        conversationId: msg.conversationId,
        receiverId: userId,
        $or: [{ readAt: { $exists: false } }, { readAt: null }],
      });

      return {
        id: otherUserId,
        conversationId: msg.conversationId,
        otherUserId,
        otherUserName: otherUser?.name ?? 'User',
        otherUserRole: otherUser?.role ?? 'customer',
        otherUserAvatar: otherUser?.avatar,
        lastMessage: msg.message,
        bookingId: msg.bookingId?.toString(),
        unreadCount,
        updatedAt: msg.createdAt,
        createdAt: msg.createdAt,
      };
    })
  );

  return threads
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 100);
}

export async function getUnreadTotal(userId: string) {
  return Message.countDocuments({
    receiverId: userId,
    $or: [{ readAt: { $exists: false } }, { readAt: null }],
  });
}

export async function markConversationDelivered(userId: string, conversationId: string) {
  assertConversationMember(userId, conversationId);
  const now = new Date();
  const result = await Message.updateMany(
    {
      conversationId,
      receiverId: userId,
      $and: [
        { $or: [{ deliveredAt: { $exists: false } }, { deliveredAt: null }] },
        { $or: [{ readAt: { $exists: false } }, { readAt: null }] },
      ],
    },
    { $set: { deliveredAt: now, status: 'delivered' } }
  );
  return { updated: result.modifiedCount, deliveredAt: now };
}

export async function markConversationRead(userId: string, conversationId: string) {
  if (!conversationId) throw new AppError('conversationId is required', 422);
  assertConversationMember(userId, conversationId);
  const now = new Date();
  const unread = await Message.find({
    conversationId,
    receiverId: userId,
    $or: [{ readAt: { $exists: false } }, { readAt: null }],
  }).select('_id');

  await Message.updateMany(
    {
      conversationId,
      receiverId: userId,
      $or: [{ readAt: { $exists: false } }, { readAt: null }],
    },
    {
      $set: {
        readAt: now,
        deliveredAt: now,
        status: 'read',
      },
    }
  );

  return {
    updated: true,
    messageIds: unread.map((m) => m._id.toString()),
    readAt: now,
  };
}
