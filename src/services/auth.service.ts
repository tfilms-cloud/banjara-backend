import crypto from 'crypto';
import { Types } from 'mongoose';
import { hashPassword, comparePassword } from '../utils/password';
import { signMfaToken, verifyMfaToken, verifyRefreshToken } from '../utils/jwt';
import * as sessionService from './session.service';
import { recordAdminEvent } from './audit.service';
import { MFA_FIELDS, verifyCode as verifyMfaCode } from './mfa.service';
import { ProviderProfile } from '../models/ProviderProfile';
import { User, type IUser } from '../models/User';
import { PasswordResetToken } from '../models/PasswordResetToken';
import { deliverPasswordResetToken } from './notification/passwordResetDelivery';
import { AppError, assertFound } from '../utils/AppError';
import type { LoginInput, RegisterInput, SessionContext } from '../types/auth.types';
import { env } from '../config/env';

async function withProviderMeta(user: IUser) {
  const json = user.toSafeJSON();
  if (user.role === 'admin') {
    // The admin portal sends admins to set up 2-step verification when it is required.
    json.twoFactorEnabled = Boolean(user.twoFactor?.enabled);
    json.twoFactorSetupRequired = env.ADMIN_REQUIRE_2FA && !user.twoFactor?.enabled;
    return json;
  }
  if (user.role !== 'provider') return json;
  const profile = await ProviderProfile.findOne({ userId: user._id }).select('_id verificationStatus');
  if (profile) {
    json.providerId = profile._id.toString();
    json.providerStatus = profile.verificationStatus;
  }
  return json;
}

/** Pre-session tokens: SHA-256, or bcrypt from before the 72-byte truncation fix. */
async function legacyRefreshTokenMatches(token: string, stored: string): Promise<boolean> {
  if (stored.startsWith('$2')) return comparePassword(token, stored);
  const a = Buffer.from(sessionService.hashToken(token), 'hex');
  const b = Buffer.from(stored, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;
const RESET_REQUEST_COOLDOWN_MS = 60 * 1000;
const GENERIC_RESET_MESSAGE = 'If the email exists, a reset code was sent';

function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function resetTokensMatch(provided: string, storedHash: string): boolean {
  const providedHash = Buffer.from(hashResetToken(provided), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (providedHash.length !== stored.length) return false;
  return crypto.timingSafeEqual(providedHash, stored);
}

export async function register(input: RegisterInput, context: SessionContext) {
  const existing = await User.findOne({ email: input.email.toLowerCase() });
  if (existing) throw new AppError('Email already registered', 409);

  const passwordHash = await hashPassword(input.password);
  const user = await User.create({
    name: input.name,
    email: input.email.toLowerCase(),
    phone: input.phone,
    passwordHash,
    role: input.role ?? 'customer',
    status: 'active',
  });

  const { tokens } = await sessionService.createSession(user, context);
  return { user: await withProviderMeta(user), tokens };
}

/** Wrong passwords / 2-step codes in a row before the account pauses sign-in. */
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

function lockedMessage(until: Date) {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60000));
  return `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

async function assertNotLocked(user: IUser) {
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(lockedMessage(user.lockedUntil), 429);
  }
}

/**
 * Counts a failure; the one that reaches the limit locks the account. Per-IP rate
 * limiting cannot stop a slow attack spread across many addresses at one account
 * (an admin, say); this can.
 */
async function recordFailedLogin(user: IUser, reason: string, context: SessionContext) {
  const updated = await User.findOneAndUpdate(
    { _id: user._id },
    { $inc: { failedLoginAttempts: 1 } },
    { returnDocument: 'after', projection: { failedLoginAttempts: 1, role: 1 } }
  );
  const attempts = updated?.failedLoginAttempts ?? 0;
  let lockedUntil: Date | undefined;
  if (attempts >= MAX_FAILED_LOGINS) {
    lockedUntil = new Date(Date.now() + LOCKOUT_MS);
    await User.updateOne({ _id: user._id }, { $set: { lockedUntil, failedLoginAttempts: 0 } });
  }
  await recordAdminEvent(user, lockedUntil ? 'auth.locked' : 'auth.login.failed', {
    reason,
    attempts,
    ip: context.ip,
    userAgent: context.userAgent?.slice(0, 300),
  });
  if (lockedUntil) throw new AppError(lockedMessage(lockedUntil), 429);
}

async function clearFailedLogins(user: IUser) {
  if (user.failedLoginAttempts || user.lockedUntil) {
    await User.updateOne({ _id: user._id }, { $set: { failedLoginAttempts: 0 }, $unset: { lockedUntil: 1 } });
  }
}

async function finishLogin(user: IUser, context: SessionContext) {
  await clearFailedLogins(user);
  // Each sign-in is its own session: signing in here does not sign you out elsewhere.
  const { tokens } = await sessionService.createSession(user, context);
  await recordAdminEvent(user, 'auth.login', {
    client: context.client,
    ip: context.ip,
    userAgent: context.userAgent?.slice(0, 300),
    twoFactor: Boolean(user.twoFactor?.enabled),
  });
  return { user: await withProviderMeta(user), tokens };
}

export type LoginResult =
  | Awaited<ReturnType<typeof finishLogin>>
  | { mfaRequired: true; mfaToken: string };

export async function login(input: LoginInput, context: SessionContext): Promise<LoginResult> {
  const user = await User.findOne({ email: input.email.toLowerCase() }).select(
    '+passwordHash +failedLoginAttempts +lockedUntil'
  );
  if (!user) throw new AppError('Invalid email or password', 401);
  await assertNotLocked(user);

  const valid = await comparePassword(input.password, user.passwordHash);
  if (!valid) {
    await recordFailedLogin(user, 'password', context);
    throw new AppError('Invalid email or password', 401);
  }
  if (user.status !== 'active') throw new AppError('Account is not active', 403);

  // Password was right; with 2-step verification on, no session until the code is too.
  if (user.twoFactor?.enabled) return { mfaRequired: true, mfaToken: signMfaToken(user._id.toString()) };
  return finishLogin(user, context);
}

/** Second step of sign-in: the code from the authenticator app (or a recovery code). */
export async function completeMfaLogin(mfaToken: string, code: string, context: SessionContext) {
  let userId: string;
  try {
    userId = verifyMfaToken(mfaToken).sub;
  } catch {
    throw new AppError('Your sign-in took too long. Please enter your password again.', 401);
  }
  const user = await User.findById(userId).select(`+failedLoginAttempts +lockedUntil ${MFA_FIELDS}`);
  if (!user) throw new AppError('Invalid sign-in', 401);
  await assertNotLocked(user);
  if (user.status !== 'active') throw new AppError('Account is not active', 403);

  if (!(await verifyMfaCode(user, code))) {
    await recordFailedLogin(user, '2fa-code', context);
    throw new AppError('That code is not right', 401);
  }
  return finishLogin(user, context);
}

export async function refresh(refreshToken: string, context: SessionContext) {
  const payload = verifyRefreshToken(refreshToken);
  if (payload.sid) {
    const { user, tokens } = await sessionService.rotateSession(refreshToken, payload.sid);
    return { user: await withProviderMeta(user), tokens };
  }

  // A token from before per-device sessions: checked against the single hash on the
  // user, then upgraded to a session. Remove once JWT_REFRESH_EXPIRES_IN has passed.
  const user = await User.findById(payload.sub).select('+refreshTokenHash');
  if (!user || !user.refreshTokenHash) throw new AppError('Invalid refresh token', 401);
  if (!(await legacyRefreshTokenMatches(refreshToken, user.refreshTokenHash))) {
    throw new AppError('Invalid refresh token', 401);
  }
  if (user.status !== 'active') throw new AppError('Invalid or inactive account', 401);
  await User.updateOne({ _id: user._id }, { $unset: { refreshTokenHash: 1 } });
  const { tokens } = await sessionService.createSession(user, context);
  return { user: await withProviderMeta(user), tokens };
}

/** Who a still-valid refresh token belongs to, without rotating it. Never throws. */
export async function identifyRefreshToken(
  refreshToken: string
): Promise<{ userId: string; sessionId?: string } | null> {
  const session = await sessionService.sessionForRefreshToken(refreshToken);
  if (session) return session;
  try {
    const payload = verifyRefreshToken(refreshToken);
    if (payload.sid) return null;
    const user = await User.findById(payload.sub).select('+refreshTokenHash');
    if (!user?.refreshTokenHash) return null;
    return (await legacyRefreshTokenMatches(refreshToken, user.refreshTokenHash))
      ? { userId: user._id.toString() }
      : null;
  } catch {
    return null;
  }
}

/** Ends one session (this device). */
export async function logout(sessionId: string | undefined, userId: string) {
  if (sessionId) await sessionService.revokeSession(sessionId, 'logout', userId);
  // A pre-session login has no session id; its token lives on the user.
  else await User.updateOne({ _id: userId }, { $unset: { refreshTokenHash: 1 } });
  return { success: true };
}

/** Ends every session of the user, on every device. */
export async function logoutAll(userId: string) {
  const revoked = await sessionService.revokeAllSessions(userId, 'logout-all');
  return { revoked };
}

export async function me(userId: string) {
  const user = await User.findById(userId);
  if (!user) throw new AppError('User not found', 404);
  return withProviderMeta(user);
}

export async function forgotPassword(email: string) {
  const normalized = email.toLowerCase();
  const user = await User.findOne({ email: normalized });

  if (!user) {
    // Mirror the known branch's database round trip so response time is not itself an
    // enumeration oracle. (No bcrypt is involved on either branch, so a dummy hash would
    // only make the unknown branch conspicuously slower.)
    await PasswordResetToken.findOne({ userId: new Types.ObjectId() });
    return { message: GENERIC_RESET_MESSAGE };
  }

  // Per-account throttle. Per-IP rate limiting does not stop a distributed attempt
  // against one known admin address.
  const recent = await PasswordResetToken.findOne({
    userId: user._id,
    createdAt: { $gte: new Date(Date.now() - RESET_REQUEST_COOLDOWN_MS) },
  }).sort({ createdAt: -1 });
  if (recent) {
    return { message: GENERIC_RESET_MESSAGE };
  }

  const token = crypto.randomBytes(32).toString('hex');
  await PasswordResetToken.create({
    userId: user._id,
    tokenHash: hashResetToken(token),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  });

  await deliverPasswordResetToken(user.email, token);
  return { message: GENERIC_RESET_MESSAGE };
}

export async function resetPassword(email: string, code: string, newPassword: string) {
  const normalized = email.toLowerCase();
  const user = await User.findOne({ email: normalized });
  if (!user) {
    await PasswordResetToken.findOne({ userId: new Types.ObjectId() });
    throw new AppError('Invalid reset code', 400);
  }

  const record = await PasswordResetToken.findOne({
    userId: user._id,
    usedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!record) throw new AppError('Invalid reset code', 400);

  if (!resetTokensMatch(code, record.tokenHash)) {
    record.attempts += 1;
    if (record.attempts >= RESET_MAX_ATTEMPTS) {
      record.usedAt = new Date();
    }
    await record.save();
    throw new AppError('Invalid reset code', 400);
  }

  user.passwordHash = await hashPassword(newPassword);
  await user.save();
  // Kill every session the attacker (or the legitimate user) already holds, on every
  // device. Without this, resetting the password does not evict an intruder.
  await sessionService.revokeAllSessions(user._id.toString(), 'password-reset');

  record.usedAt = new Date();
  await record.save();
  // Single use: burn every other outstanding token for this user.
  await PasswordResetToken.updateMany(
    { userId: user._id, _id: { $ne: record._id }, usedAt: null },
    { $set: { usedAt: new Date() } }
  );

  return { message: 'Password updated successfully' };
}
