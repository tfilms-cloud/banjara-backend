import { User } from '../models/User';
import { AppError, assertFound } from '../utils/AppError';
import { comparePassword, hashPassword } from '../utils/password';
import { revokeAllSessions } from './session.service';

export async function getMe(userId: string) {
  const user = assertFound(await User.findById(userId), 'User not found');
  return user.toSafeJSON();
}

export async function updateMe(
  userId: string,
  patch: Partial<{ name: string; phone: string; email: string; avatar: string; preferences: Record<string, unknown> }>
) {
  // Build the update from named fields only. Never forward a caller-derived object
  // into findByIdAndUpdate — `role`, `status`, `passwordHash` and `refreshTokenHash`
  // are legitimate schema paths and strict mode would happily write them.
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.phone !== undefined) update.phone = patch.phone;
  if (patch.avatar !== undefined) update.avatar = patch.avatar;
  if (patch.preferences !== undefined) update.preferences = patch.preferences;
  if (patch.email !== undefined) {
    const email = patch.email.toLowerCase();
    const exists = await User.findOne({ email, _id: { $ne: userId } });
    if (exists) throw new AppError('Email already in use', 409);
    update.email = email;
  }

  if (Object.keys(update).length === 0) {
    const current = assertFound(await User.findById(userId), 'User not found');
    return current.toSafeJSON();
  }

  const user = assertFound(
    await User.findByIdAndUpdate(userId, update, { new: true, runValidators: true }),
    'User not found'
  );
  return user.toSafeJSON();
}

/**
 * Changes the password and signs out every other device. The device making the change
 * (`currentSessionId`) stays signed in.
 */
export async function updatePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  currentSessionId?: string
) {
  const user = assertFound(
    await User.findById(userId).select('+passwordHash'),
    'User not found'
  );
  const ok = await comparePassword(currentPassword, user.passwordHash);
  if (!ok) throw new AppError('Current password is incorrect', 400);
  user.passwordHash = await hashPassword(newPassword);
  await user.save();
  const signedOut = await revokeAllSessions(userId, 'password-changed', currentSessionId);
  return { message: 'Password updated', otherDevicesSignedOut: signedOut };
}

export async function updateAvatar(userId: string, avatarUrl: string) {
  return updateMe(userId, { avatar: avatarUrl });
}
