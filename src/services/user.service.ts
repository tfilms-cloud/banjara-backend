import { User } from '../models/User';
import { AppError, assertFound } from '../utils/AppError';
import { comparePassword, hashPassword } from '../utils/password';

export async function getMe(userId: string) {
  const user = assertFound(await User.findById(userId), 'User not found');
  return user.toSafeJSON();
}

export async function updateMe(
  userId: string,
  patch: Partial<{ name: string; phone: string; email: string; avatar: string; preferences: Record<string, unknown> }>
) {
  if (patch.email) {
    const exists = await User.findOne({ email: patch.email.toLowerCase(), _id: { $ne: userId } });
    if (exists) throw new AppError('Email already in use', 409);
    patch.email = patch.email.toLowerCase();
  }
  const user = assertFound(
    await User.findByIdAndUpdate(userId, patch, { new: true }),
    'User not found'
  );
  return user.toSafeJSON();
}

export async function updatePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = assertFound(
    await User.findById(userId).select('+passwordHash'),
    'User not found'
  );
  const ok = await comparePassword(currentPassword, user.passwordHash);
  if (!ok) throw new AppError('Current password is incorrect', 400);
  user.passwordHash = await hashPassword(newPassword);
  await user.save();
  return { message: 'Password updated' };
}

export async function updateAvatar(userId: string, avatarUrl: string) {
  return updateMe(userId, { avatar: avatarUrl });
}
