import crypto from 'crypto';
import { Types } from 'mongoose';
import { hashPassword, comparePassword } from '../utils/password';
import { signTokenPair, verifyRefreshToken } from '../utils/jwt';
import { ProviderProfile } from '../models/ProviderProfile';
import { User, type IUser } from '../models/User';
import { PasswordResetToken } from '../models/PasswordResetToken';
import { deliverPasswordResetToken } from './notification/passwordResetDelivery';
import { AppError, assertFound } from '../utils/AppError';
import type { LoginInput, RegisterInput } from '../types/auth.types';

async function withProviderMeta(user: IUser) {
  const json = user.toSafeJSON();
  if (user.role !== 'provider') return json;
  const profile = await ProviderProfile.findOne({ userId: user._id }).select('_id verificationStatus');
  if (profile) {
    json.providerId = profile._id.toString();
    json.providerStatus = profile.verificationStatus;
  }
  return json;
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

export async function register(input: RegisterInput) {
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

  const tokens = signTokenPair({
    sub: user._id.toString(),
    role: user.role,
    email: user.email,
  });

  user.refreshTokenHash = await hashPassword(tokens.refreshToken);
  await user.save();

  return { user: await withProviderMeta(user), tokens };
}

export async function login(input: LoginInput) {
  const user = await User.findOne({ email: input.email.toLowerCase() }).select('+passwordHash');
  if (!user) throw new AppError('Invalid email or password', 401);

  const valid = await comparePassword(input.password, user.passwordHash);
  if (!valid) throw new AppError('Invalid email or password', 401);
  if (user.status !== 'active') throw new AppError('Account is not active', 403);

  const tokens = signTokenPair({
    sub: user._id.toString(),
    role: user.role,
    email: user.email,
  });

  user.refreshTokenHash = await hashPassword(tokens.refreshToken);
  await user.save();

  return { user: await withProviderMeta(user), tokens };
}

export async function refresh(refreshToken: string) {
  const payload = verifyRefreshToken(refreshToken);
  const user = await User.findById(payload.sub).select('+refreshTokenHash');
  if (!user || !user.refreshTokenHash) throw new AppError('Invalid refresh token', 401);

  const match = await comparePassword(refreshToken, user.refreshTokenHash);
  if (!match) throw new AppError('Invalid refresh token', 401);

  const tokens = signTokenPair({
    sub: user._id.toString(),
    role: user.role,
    email: user.email,
  });
  user.refreshTokenHash = await hashPassword(tokens.refreshToken);
  await user.save();
  return { user: await withProviderMeta(user), tokens };
}

export async function logout(userId: string) {
  await User.findByIdAndUpdate(userId, { $unset: { refreshTokenHash: 1 } });
  return { success: true };
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
  // Kill any session the attacker (or the legitimate user) already holds. Without this,
  // resetting the password does not evict an intruder with a live refresh token.
  await User.findByIdAndUpdate(user._id, { $unset: { refreshTokenHash: 1 } });

  record.usedAt = new Date();
  await record.save();
  // Single use: burn every other outstanding token for this user.
  await PasswordResetToken.updateMany(
    { userId: user._id, _id: { $ne: record._id }, usedAt: null },
    { $set: { usedAt: new Date() } }
  );

  return { message: 'Password updated successfully' };
}
