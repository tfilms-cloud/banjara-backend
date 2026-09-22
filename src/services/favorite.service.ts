import { Favorite } from '../models/Favorite';
import { AppError, assertFound } from '../utils/AppError';

export async function addFavorite(
  userId: string,
  input: { targetType: 'trip' | 'hotel' | 'provider'; targetId: string }
) {
  try {
    // Build explicitly: spreading `input` after `userId` would let a caller override it.
    return await Favorite.create({
      userId,
      targetType: input.targetType,
      targetId: input.targetId,
    });
  } catch {
    throw new AppError('Already in favorites', 409);
  }
}

export async function listFavorites(userId: string) {
  return Favorite.find({ userId }).sort({ createdAt: -1 });
}

export async function removeFavorite(userId: string, id: string) {
  const favorite = assertFound(await Favorite.findById(id), 'Favorite not found');
  if (favorite.userId.toString() !== userId) throw new AppError('Forbidden', 403);
  await favorite.deleteOne();
  return { deleted: true };
}
