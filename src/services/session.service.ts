import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import mongoose, { Types } from 'mongoose';
import { Session, type ISession } from '../models/Session';
import { User } from '../models/User';
import type { AuthTokens, SessionContext, UserRole } from '../types/auth.types';
import { AppError } from '../utils/AppError';
import { log } from '../utils/logger';
import { signTokenPair, verifyRefreshToken } from '../utils/jwt';

/** A rotated-out token shown again within this window is a client race, not theft. */
const REUSE_GRACE_MS = 30_000;

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function expiryOf(token: string): Date {
  const exp = (jwt.decode(token) as { exp?: number } | null)?.exp;
  return new Date(exp ? exp * 1000 : Date.now() + 7 * 24 * 3600 * 1000);
}

function clip(value: string | undefined, max: number) {
  return value ? value.slice(0, max) : undefined;
}

type TokenUser = { _id: Types.ObjectId; role: UserRole; email: string };

function tokensFor(user: TokenUser, sid: string): AuthTokens {
  return signTokenPair({ sub: user._id.toString(), role: user.role, email: user.email, sid });
}

/** Starts a new device session and returns its first token pair. */
export async function createSession(user: TokenUser, context: SessionContext) {
  const sid = new Types.ObjectId();
  const tokens = tokensFor(user, sid.toString());
  await Session.create({
    _id: sid,
    userId: user._id,
    client: context.client,
    tokenHash: hashToken(tokens.refreshToken),
    userAgent: clip(context.userAgent, 300),
    ip: clip(context.ip, 64),
    lastUsedAt: new Date(),
    expiresAt: expiryOf(tokens.refreshToken),
  });
  return { tokens, sessionId: sid.toString() };
}

/**
 * Swaps a session's current refresh token for a new pair.
 *
 * The update only matches while `tokenHash` is still the presented token, so two
 * concurrent refreshes with the same token cannot both succeed. A token that has
 * already been replaced is treated as stolen (outside a short race window) and the
 * whole session is revoked: whoever holds it, attacker or owner, must sign in again.
 */
export async function rotateSession(refreshToken: string, sid: string) {
  if (!mongoose.isValidObjectId(sid)) throw new AppError('Invalid refresh token', 401);
  const presented = hashToken(refreshToken);
  const now = new Date();

  const session = await Session.findById(sid).select('+tokenHash +previousTokenHash');
  if (!session || session.revokedAt || session.expiresAt <= now) {
    throw new AppError('Session has ended. Please sign in again.', 401);
  }

  const user = await User.findById(session.userId);
  if (!user || user.status !== 'active') {
    await revokeSession(sid, 'revoked');
    throw new AppError('Invalid or inactive account', 401);
  }

  const tokens = tokensFor(user, sid);
  const rotated = await Session.findOneAndUpdate(
    { _id: sid, tokenHash: presented, revokedAt: null },
    {
      $set: {
        tokenHash: hashToken(tokens.refreshToken),
        previousTokenHash: presented,
        rotatedAt: now,
        lastUsedAt: now,
        expiresAt: expiryOf(tokens.refreshToken),
      },
    },
    { returnDocument: 'after' }
  );
  if (rotated) return { user, tokens, sessionId: sid };

  // Not the current token. Was it the one just replaced, in a client-side race?
  const fresh = await Session.findById(sid).select('+previousTokenHash');
  const racing =
    fresh?.previousTokenHash === presented &&
    fresh.rotatedAt &&
    now.getTime() - fresh.rotatedAt.getTime() < REUSE_GRACE_MS;
  if (!racing) {
    await revokeSession(sid, 'reuse-detected');
    log().warn({ sessionId: sid, userId: session.userId.toString() }, 'refresh token reuse detected; session revoked');
  }
  throw new AppError('Session has ended. Please sign in again.', 401);
}

/** The live session a refresh token belongs to, without rotating it. Never throws. */
export async function sessionForRefreshToken(refreshToken: string) {
  try {
    const payload = verifyRefreshToken(refreshToken);
    if (!payload.sid || !mongoose.isValidObjectId(payload.sid)) return null;
    const session = await Session.findById(payload.sid).select('+tokenHash');
    if (!session || session.revokedAt || session.tokenHash !== hashToken(refreshToken)) return null;
    return { userId: session.userId.toString(), sessionId: session._id.toString() };
  } catch {
    return null;
  }
}

export async function isSessionActive(sid: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(sid)) return false;
  return Boolean(await Session.exists({ _id: sid, revokedAt: null, expiresAt: { $gt: new Date() } }));
}

export async function revokeSession(sid: string, reason: ISession['revokedReason'], userId?: string) {
  if (!mongoose.isValidObjectId(sid)) return false;
  const filter: Record<string, unknown> = { _id: sid, revokedAt: null };
  if (userId) filter.userId = userId;
  const res = await Session.updateOne(filter, { $set: { revokedAt: new Date(), revokedReason: reason } });
  return res.modifiedCount > 0;
}

/** Ends every session of a user, optionally keeping the caller's own. */
export async function revokeAllSessions(userId: string, reason: ISession['revokedReason'], exceptSid?: string) {
  const filter: Record<string, unknown> = { userId, revokedAt: null };
  if (exceptSid && mongoose.isValidObjectId(exceptSid)) filter._id = { $ne: exceptSid };
  const res = await Session.updateMany(filter, { $set: { revokedAt: new Date(), revokedReason: reason } });
  // Pre-session tokens are tracked on the user; end those too.
  await User.updateOne({ _id: userId }, { $unset: { refreshTokenHash: 1 } });
  return res.modifiedCount;
}

export async function listSessions(userId: string, currentSid?: string) {
  const sessions = await Session.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastUsedAt: -1 })
    .limit(50)
    .lean();
  return sessions.map((s) => ({
    id: s._id.toString(),
    client: s.client,
    userAgent: s.userAgent ?? null,
    ip: s.ip ?? null,
    createdAt: s.createdAt,
    lastUsedAt: s.lastUsedAt,
    current: s._id.toString() === currentSid,
  }));
}
