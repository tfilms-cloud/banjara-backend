import { Server as HttpServer } from 'http';
import mongoose from 'mongoose';
import { Server, type Socket } from 'socket.io';
import { env } from '../config/env';
import { verifyAccessToken } from '../utils/jwt';
import { Booking } from '../models/Booking';
import { ProviderProfile } from '../models/ProviderProfile';
import { Trip } from '../models/Trip';
import { User } from '../models/User';
import type { UserRole } from '../types/auth.types';
import * as messageService from '../services/message.service';

const TRIP_STATUSES = ['scheduled', 'boarding', 'departed', 'inTransit', 'completed', 'cancelled'];

type TripAuthorization = { canView: boolean; canPublish: boolean };

/**
 * Resolves the caller's relationship to a trip against the database.
 *
 * `payload.tripId` is never trusted as authorization input — it is resolved here on
 * join and the result cached on the socket.
 */
async function authorizeTrip(
  tripId: string,
  userId: string,
  role: UserRole,
  providerId?: string
): Promise<TripAuthorization | null> {
  if (!mongoose.isValidObjectId(tripId)) return null;
  const trip = await Trip.findById(tripId).select('providerId');
  if (!trip) return null;

  if (role === 'admin') return { canView: true, canPublish: true };
  if (role === 'provider') {
    const owns = Boolean(providerId) && trip.providerId.toString() === providerId;
    return owns ? { canView: true, canPublish: true } : null;
  }

  const hasBooking = await Booking.exists({
    customerId: userId,
    'transportBooking.tripId': tripId,
    bookingStatus: { $ne: 'cancelled' },
  });
  return hasBooking ? { canView: true, canPublish: false } : null;
}

type Presence = {
  online: boolean;
  lastSeenAt: string | null;
  sockets: Set<string>;
};

const presenceByUser = new Map<string, Presence>();

function getPresenceSnapshot(userId: string) {
  const entry = presenceByUser.get(userId);
  return {
    userId,
    online: Boolean(entry?.online),
    lastSeenAt: entry?.lastSeenAt ?? null,
  };
}

function setOnline(userId: string, socketId: string) {
  const existing = presenceByUser.get(userId) ?? {
    online: false,
    lastSeenAt: null,
    sockets: new Set<string>(),
  };
  existing.sockets.add(socketId);
  existing.online = true;
  presenceByUser.set(userId, existing);
  return getPresenceSnapshot(userId);
}

function setOffline(userId: string, socketId: string) {
  const existing = presenceByUser.get(userId);
  if (!existing) return getPresenceSnapshot(userId);
  existing.sockets.delete(socketId);
  if (existing.sockets.size === 0) {
    existing.online = false;
    existing.lastSeenAt = new Date().toISOString();
  }
  presenceByUser.set(userId, existing);
  return getPresenceSnapshot(userId);
}

function emitPresence(io: Server, userId: string, snapshot: ReturnType<typeof getPresenceSnapshot>) {
  // Scope presence to the user's own room. A global io.emit() leaked every user's
  // online/offline transition to every connected socket.
  io.to(`user:${userId}`).emit('user_status_changed', snapshot);
}

function otherParticipant(conversationId: string, userId: string) {
  const [a, b] = conversationId.split(':');
  return a === userId ? b : a;
}

export function initSocket(httpServer: HttpServer) {
  const allowedOrigins = [
    env.CLIENT_URL,
    ...env.CLIENT_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ];

  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ||
        (socket.handshake.headers.authorization?.replace('Bearer ', '') as string | undefined);
      if (!token) return next(new Error('Unauthorized'));
      const payload = verifyAccessToken(token);
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const userId = socket.data.userId as string;

    const user = await User.findById(userId).select('role status');
    if (!user || user.status !== 'active') {
      socket.disconnect(true);
      return;
    }
    const role = user.role as UserRole;
    let providerId: string | undefined;
    if (role === 'provider') {
      const profile = await ProviderProfile.findOne({ userId }).select('_id');
      providerId = profile?._id.toString();
    }

    // Rooms this socket is authorized to view / publish into, cached at join time.
    // Resolving authorization on every GPS event would be a per-event DB load problem.
    const tripRooms = new Set<string>();
    const publisherRooms = new Set<string>();

    socket.join(`user:${userId}`);

    const onlineSnapshot = setOnline(userId, socket.id);
    emitPresence(io, userId, onlineSnapshot);

    socket.on('getPresence', (targetUserId: string, ack?: (data: unknown) => void) => {
      const snapshot = getPresenceSnapshot(String(targetUserId));
      if (typeof ack === 'function') ack(snapshot);
      socket.emit('user_status_changed', snapshot);
    });

    const joinHandler = (payload: string | { conversationId?: string }) => {
      const conversationId =
        typeof payload === 'string' ? payload : String(payload?.conversationId ?? '');
      if (!conversationId) return;
      try {
        messageService.assertConversationMember(userId, conversationId);
        socket.join(`conversation:${conversationId}`);
        void messageService.markConversationDelivered(userId, conversationId).then((result) => {
          if (result.updated > 0) {
            socket.to(`conversation:${conversationId}`).emit('message_delivered', {
              conversationId,
              userId,
              deliveredAt: result.deliveredAt,
            });
          }
        });
      } catch {
        // ignore unauthorized joins
      }
    };

    socket.on('joinConversation', joinHandler);
    socket.on('join_conversation', joinHandler);

    const leaveHandler = (payload: string | { conversationId?: string }) => {
      const conversationId =
        typeof payload === 'string' ? payload : String(payload?.conversationId ?? '');
      if (!conversationId) return;
      socket.leave(`conversation:${conversationId}`);
    };
    socket.on('leaveConversation', leaveHandler);
    socket.on('leave_conversation', leaveHandler);

    socket.on('sendMessage', async (payload, ack) => {
      try {
        const saved = await messageService.sendMessage({
          senderId: userId,
          receiverId: payload.receiverId,
          message: payload.message,
          bookingId: payload.bookingId,
          attachments: payload.attachments,
          type: payload.type,
        });

        io.to(`conversation:${saved.conversationId}`).emit('receiveMessage', saved);
        io.to(`conversation:${saved.conversationId}`).emit('new_message', saved);
        io.to(`user:${payload.receiverId}`).emit('receiveMessage', saved);
        io.to(`user:${payload.receiverId}`).emit('new_message', saved);
        io.to(`user:${userId}`).emit('conversation_updated', {
          conversationId: saved.conversationId,
          lastMessage: saved.message,
          updatedAt: saved.createdAt,
        });
        io.to(`user:${payload.receiverId}`).emit('conversation_updated', {
          conversationId: saved.conversationId,
          lastMessage: saved.message,
          updatedAt: saved.createdAt,
        });

        if (typeof ack === 'function') ack({ success: true, data: saved });
      } catch (error) {
        if (typeof ack === 'function') {
          ack({ success: false, message: error instanceof Error ? error.message : 'Failed' });
        }
      }
    });

    const typingStart = (payload: { conversationId?: string }) => {
      if (!payload?.conversationId) return;
      try {
        messageService.assertConversationMember(userId, payload.conversationId);
        socket.to(`conversation:${payload.conversationId}`).emit('typing', {
          userId,
          conversationId: payload.conversationId,
        });
        socket.to(`conversation:${payload.conversationId}`).emit('user_typing', {
          userId,
          conversationId: payload.conversationId,
        });
      } catch {
        // ignore
      }
    };
    const typingStop = (payload: { conversationId?: string }) => {
      if (!payload?.conversationId) return;
      socket.to(`conversation:${payload.conversationId}`).emit('stopTyping', {
        userId,
        conversationId: payload.conversationId,
      });
      socket.to(`conversation:${payload.conversationId}`).emit('user_stopped_typing', {
        userId,
        conversationId: payload.conversationId,
      });
    };
    socket.on('typing', typingStart);
    socket.on('typing_start', typingStart);
    socket.on('stopTyping', typingStop);
    socket.on('typing_stop', typingStop);

    const deliveredHandler = async (payload: { conversationId?: string }) => {
      if (!payload?.conversationId) return;
      try {
        const result = await messageService.markConversationDelivered(userId, payload.conversationId);
        if (result.updated > 0) {
          const event = {
            conversationId: payload.conversationId,
            userId,
            deliveredAt: result.deliveredAt,
          };
          socket.to(`conversation:${payload.conversationId}`).emit('message_delivered', event);
          socket.to(`conversation:${payload.conversationId}`).emit('messageDelivered', event);
        }
      } catch {
        // ignore
      }
    };
    socket.on('messageDelivered', deliveredHandler);
    socket.on('message_delivered', deliveredHandler);

    const readHandler = async (payload: { conversationId?: string }) => {
      if (!payload?.conversationId) return;
      try {
        const result = await messageService.markConversationRead(userId, payload.conversationId);
        const event = {
          userId,
          conversationId: payload.conversationId,
          messageIds: result.messageIds,
          readAt: result.readAt,
        };
        socket.to(`conversation:${payload.conversationId}`).emit('messageRead', event);
        socket.to(`conversation:${payload.conversationId}`).emit('message_read', event);
        const peer = otherParticipant(payload.conversationId, userId);
        if (peer) io.to(`user:${peer}`).emit('message_read', event);
      } catch {
        // ignore
      }
    };
    socket.on('messageRead', readHandler);
    socket.on('message_read', readHandler);

    socket.on('joinTrip', async (tripId: string, ack?: (data: unknown) => void) => {
      const id = String(tripId ?? '');
      const authz = await authorizeTrip(id, userId, role, providerId);
      if (!authz?.canView) {
        if (typeof ack === 'function') ack({ success: false, message: 'Not authorized for this trip' });
        return;
      }
      socket.join(`trip:${id}`);
      tripRooms.add(id);
      if (authz.canPublish) publisherRooms.add(id);
      if (typeof ack === 'function') ack({ success: true });
    });

    socket.on('driverLocationUpdate', (payload) => {
      const tripId = String(payload?.tripId ?? '');
      if (!publisherRooms.has(tripId)) return;

      const latitude = Number(payload?.latitude ?? payload?.lat);
      const longitude = Number(payload?.longitude ?? payload?.lng);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return;
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return;

      const speed = Number(payload?.speed);
      const heading = Number(payload?.heading);
      // Emit a constructed object — never spread arbitrary client data into other clients' UI.
      socket.to(`trip:${tripId}`).emit('driverLocationUpdate', {
        tripId,
        latitude,
        longitude,
        ...(Number.isFinite(speed) ? { speed } : {}),
        ...(Number.isFinite(heading) ? { heading } : {}),
        updatedAt: new Date().toISOString(),
      });
    });

    socket.on('tripStatusUpdate', (payload) => {
      const tripId = String(payload?.tripId ?? '');
      if (!publisherRooms.has(tripId)) return;

      const status = String(payload?.status ?? '');
      if (!TRIP_STATUSES.includes(status)) return;

      socket.to(`trip:${tripId}`).emit('tripStatusUpdate', {
        tripId,
        status,
        updatedAt: new Date().toISOString(),
      });
    });

    socket.on('leaveTrip', (tripId: string) => {
      const id = String(tripId ?? '');
      socket.leave(`trip:${id}`);
      tripRooms.delete(id);
      publisherRooms.delete(id);
    });

    socket.on('disconnect', () => {
      const snapshot = setOffline(userId, socket.id);
      emitPresence(io, userId, snapshot);
    });
  });

  return io;
}
