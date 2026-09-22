import { hashPassword, comparePassword } from '../utils/password';
import { signTokenPair, verifyRefreshToken } from '../utils/jwt';
import { ProviderProfile } from '../models/ProviderProfile';
import { User, type IUser } from '../models/User';
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

const resetCodes = new Map<string, string>();

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
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    return { message: 'If the email exists, a reset code was sent' };
  }
  const code = '123456';
  resetCodes.set(email.toLowerCase(), code);
  return { message: 'If the email exists, a reset code was sent', demoCode: code };
}

export async function resetPassword(email: string, code: string, newPassword: string) {
  const expected = resetCodes.get(email.toLowerCase());
  if (!expected || expected !== code) throw new AppError('Invalid reset code', 400);
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) throw new AppError('User not found', 404);
  user.passwordHash = await hashPassword(newPassword);
  await user.save();
  resetCodes.delete(email.toLowerCase());
  return { message: 'Password updated successfully' };
}
