import { paramId } from '../utils/params';
import { NextFunction, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import * as reviewService from '../services/review.service';
import * as favoriteService from '../services/favorite.service';
import * as notificationService from '../services/notification.service';
import * as messageService from '../services/message.service';
import { SupportTicket } from '../models/SupportTicket';
import { sendSuccess } from '../utils/apiResponse';
import { AppError, assertFound } from '../utils/AppError';
import { getPagination, paginatedResult } from '../utils/pagination';

export async function createReview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await reviewService.createReview(req.user!.id, req.body), 'Review created', 201);
  } catch (error) {
    next(error);
  }
}

export async function listProviderReviews(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await reviewService.listProviderReviews(paramId(req.params.providerId)));
  } catch (error) {
    next(error);
  }
}

export async function updateReview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await reviewService.updateReview(req.user!.id, paramId(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
}

export async function replyReview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user?.providerId) throw new AppError('Provider required', 403);
    return sendSuccess(res, await reviewService.replyToReview(req.user.providerId, paramId(req.params.id), req.body.reply));
  } catch (error) {
    next(error);
  }
}

export async function addFavorite(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await favoriteService.addFavorite(req.user!.id, req.body), 'Added', 201);
  } catch (error) {
    next(error);
  }
}

export async function listFavorites(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await favoriteService.listFavorites(req.user!.id));
  } catch (error) {
    next(error);
  }
}

export async function removeFavorite(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await favoriteService.removeFavorite(req.user!.id, paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function listNotifications(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await notificationService.listNotifications(req.user!.id, req.query as Record<string, unknown>));
  } catch (error) {
    next(error);
  }
}

export async function readNotification(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await notificationService.markRead(req.user!.id, paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function readAllNotifications(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await notificationService.markAllRead(req.user!.id));
  } catch (error) {
    next(error);
  }
}

export async function sendMessage(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await messageService.sendMessage({
        senderId: req.user!.id,
        receiverId: req.body.receiverId,
        message: req.body.message,
        bookingId: req.body.bookingId,
        attachments: req.body.attachments,
        type: req.body.type,
      }),
      'Message sent',
      201
    );
  } catch (error) {
    next(error);
  }
}

export async function listMessages(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (req.query.withUserId) {
      return sendSuccess(
        res,
        await messageService.getConversation(req.user!.id, String(req.query.withUserId), req.query as Record<string, unknown>)
      );
    }
    return sendSuccess(res, await messageService.listConversations(req.user!.id));
  } catch (error) {
    next(error);
  }
}

export async function unreadTotal(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, { total: await messageService.getUnreadTotal(req.user!.id) });
  } catch (error) {
    next(error);
  }
}

export async function markMessagesRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const conversationId = typeof req.body?.conversationId === 'string' ? req.body.conversationId : '';
    return sendSuccess(
      res,
      await messageService.markConversationRead(req.user!.id, conversationId),
      'Messages marked as read'
    );
  } catch (error) {
    next(error);
  }
}

export async function createSupport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ticket = await SupportTicket.create({ ...req.body, userId: req.user!.id });
    return sendSuccess(res, ticket, 'Support ticket created', 201);
  } catch (error) {
    next(error);
  }
}

export async function listSupport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = getPagination(req.query as Record<string, unknown>);
    const filter = req.user!.role === 'admin' ? {} : { userId: req.user!.id };
    const [items, total] = await Promise.all([
      SupportTicket.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      SupportTicket.countDocuments(filter),
    ]);
    return sendSuccess(res, paginatedResult(items, total, page, limit));
  } catch (error) {
    next(error);
  }
}

export async function getSupport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ticket = await SupportTicket.findById(paramId(req.params.id));
    if (!ticket) throw new AppError('Ticket not found', 404);
    if (req.user!.role !== 'admin' && ticket.userId.toString() !== req.user!.id) {
      throw new AppError('Forbidden', 403);
    }
    return sendSuccess(res, ticket);
  } catch (error) {
    next(error);
  }
}

export async function updateSupport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const ticket = assertFound(
      await SupportTicket.findByIdAndUpdate(paramId(req.params.id), req.body, { new: true }),
      'Ticket not found'
    );
    return sendSuccess(res, ticket);
  } catch (error) {
    next(error);
  }
}
