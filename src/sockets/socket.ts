import { Server as HttpServer } from 'http';
import { Server, type Socket } from 'socket.io';
import { env } from '../config/env';
import { verifyAccessToken } from '../utils/jwt';
import * as messageService from '../services/message.service';

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
  io.emit('user_status_changed', snapshot);
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

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string;
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

    socket.on('joinTrip', (tripId: string) => {
      socket.join(`trip:${tripId}`);
    });

    socket.on('driverLocationUpdate', (payload) => {
      socket.to(`trip:${payload.tripId}`).emit('driverLocationUpdate', {
        ...payload,
        updatedAt: new Date().toISOString(),
      });
    });

    socket.on('tripStatusUpdate', (payload) => {
      socket.to(`trip:${payload.tripId}`).emit('tripStatusUpdate', payload);
    });

    socket.on('leaveTrip', (tripId: string) => {
      socket.leave(`trip:${tripId}`);
    });

    socket.on('disconnect', () => {
      const snapshot = setOffline(userId, socket.id);
      emitPresence(io, userId, snapshot);
    });
  });

  return io;
}
