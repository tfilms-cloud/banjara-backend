import { Message } from '../models/Message';
import { User } from '../models/User';
import { AppError } from '../utils/AppError';
import { getPagination, paginatedResult } from '../utils/pagination';

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
  const messages = await Message.find({
    $or: [{ senderId: userId }, { receiverId: userId }],
  }).sort({ createdAt: -1 });

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

  return threads.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
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
