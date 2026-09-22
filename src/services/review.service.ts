import mongoose from 'mongoose';
import { Booking } from '../models/Booking';
import { ProviderProfile } from '../models/ProviderProfile';
import { Review } from '../models/Review';
import { AppError, assertFound } from '../utils/AppError';
import * as notificationService from './notification.service';

async function recomputeProviderRating(providerId: mongoose.Types.ObjectId) {
  const stats = await Review.aggregate([
    { $match: { providerId } },
    { $group: { _id: '$providerId', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  await ProviderProfile.findByIdAndUpdate(providerId, {
    rating: stats[0] ? Math.round(stats[0].avg * 10) / 10 : 0,
    totalReviews: stats[0] ? stats[0].count : 0,
  });
}

export async function createReview(
  customerId: string,
  input: {
    bookingId: string;
    rating: number;
    comment?: string;
    categories?: Record<string, number>;
  }
) {
  const booking = assertFound(await Booking.findById(input.bookingId), 'Booking not found');
  if (booking.customerId.toString() !== customerId) throw new AppError('Forbidden', 403);
  if (booking.bookingStatus !== 'completed') {
    throw new AppError('Only completed bookings can be reviewed', 400);
  }

  const existing = await Review.findOne({ bookingId: booking._id });
  if (existing) throw new AppError('Booking already reviewed', 409);

  const review = await Review.create({
    bookingId: booking._id,
    customerId,
    providerId: booking.providerId,
    serviceType: booking.bookingType === 'hotel' ? 'hotel' : 'transport',
    rating: input.rating,
    comment: input.comment ?? '',
    categories: input.categories ?? {},
  });

  await recomputeProviderRating(booking.providerId);

  await notificationService.createNotification({
    userId: customerId,
    type: 'newReview',
    title: 'Review submitted',
    message: 'Thanks for sharing your experience.',
    data: { reviewId: review._id.toString() },
  });

  return review;
}

export async function listProviderReviews(providerId: string) {
  return Review.find({ providerId }).sort({ createdAt: -1 });
}

export async function updateReview(
  customerId: string,
  id: string,
  patch: { rating?: number; comment?: string; categories?: Record<string, number> }
) {
  const review = assertFound(await Review.findById(id), 'Review not found');
  if (review.customerId.toString() !== customerId) throw new AppError('Forbidden', 403);

  // Only rating/comment/categories are editable. providerId, bookingId and serviceType
  // are identity fields and must never be reassigned by the reviewer.
  if (patch.rating !== undefined) review.rating = patch.rating;
  if (patch.comment !== undefined) review.comment = patch.comment;
  if (patch.categories !== undefined) review.categories = patch.categories;
  await review.save();

  // An edited rating must update the aggregate or ProviderProfile.rating stays wrong.
  await recomputeProviderRating(review.providerId);
  return review;
}

export async function replyToReview(providerId: string, id: string, reply: string) {
  const review = assertFound(await Review.findById(id), 'Review not found');
  if (review.providerId.toString() !== providerId) throw new AppError('Forbidden', 403);
  review.providerReply = reply;
  await review.save();
  return review;
}
