import type { NextFunction, Response } from 'express';
import mongoose from 'mongoose';
import type { AuthRequest } from '../middleware/auth.middleware';
import { AdminAuditLog } from '../models/AdminAuditLog';
import type { IUser } from '../models/User';
import { log } from '../utils/logger';

/** Request fields worth keeping. Never passwords, tokens or codes. */
const SAFE_BODY_KEYS = ['status', 'reason', 'priority', 'platformFeeRate', 'note', 'notes', 'message', 'action'];

function safeBody(body: unknown) {
  if (!body || typeof body !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const key of SAFE_BODY_KEYS) {
    const value = (body as Record<string, unknown>)[key];
    if (value === undefined) continue;
    out[key] = typeof value === 'string' ? value.slice(0, 500) : value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** An audit write must never break the request it records. */
async function write(entry: Parameters<typeof AdminAuditLog.create>[0]) {
  try {
    await AdminAuditLog.create(entry);
  } catch (err) {
    log().error({ err }, 'admin audit log write failed');
  }
}

/** Records an auth event (sign-in, 2-step change, …) for admin accounts only. */
export async function recordAdminEvent(
  user: Pick<IUser, '_id' | 'role'>,
  action: string,
  meta?: Record<string, unknown>
) {
  if (user.role !== 'admin') return;
  await write({ action, entityType: 'user', entityId: user._id, adminId: user._id, meta });
}

/**
 * Called by `authenticate` for every admin request: each successful change
 * (non-GET, status < 400) an admin makes, on any route, is recorded with who,
 * what and where. Other roles are never recorded.
 */
export function auditAdminChanges(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.user?.role !== 'admin') return next();
  res.on('finish', () => {
    if (res.statusCode >= 400 || !req.user) return;
    // `/api/admin/providers/6a1…/approve` → "PUT /providers/:id/approve", entity "providers";
    // `/api/payments/6a1…/refund` → "POST /payments/:id/refund", entity "payments".
    // Taken from the path itself: req.route/req.params are not reliable after routing.
    const path = req.originalUrl.split('?')[0].replace(/^\/api(\/admin)?/, '') || '/';
    const id = path.match(/[0-9a-f]{24}/i)?.[0];
    const ua = req.headers['user-agent'];
    void write({
      action: `${req.method} ${path.replace(/[0-9a-f]{24}/gi, ':id')}`,
      entityType: path.split('/').filter(Boolean)[0] ?? 'admin',
      entityId: id ? new mongoose.Types.ObjectId(id) : undefined,
      adminId: new mongoose.Types.ObjectId(req.user.id),
      meta: {
        status: res.statusCode,
        ip: req.ip,
        userAgent: typeof ua === 'string' ? ua.slice(0, 300) : undefined,
        sessionId: req.user.sessionId,
        body: safeBody(req.body),
      },
    });
  });
  next();
}

export async function listAuditLogs(query: Record<string, unknown> = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
  const filter: Record<string, unknown> = {};
  if (typeof query.adminId === 'string' && mongoose.isValidObjectId(query.adminId)) filter.adminId = query.adminId;
  if (typeof query.entityType === 'string' && query.entityType.trim()) filter.entityType = query.entityType.trim();
  return AdminAuditLog.find(filter).populate('adminId', 'name email').sort({ createdAt: -1 }).limit(limit).lean();
}
