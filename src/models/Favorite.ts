import mongoose, { Schema, Types } from 'mongoose';

export interface IFavorite {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  targetType: 'trip' | 'hotel' | 'provider';
  targetId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const favoriteSchema = new Schema<IFavorite>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    targetType: { type: String, enum: ['trip', 'hotel', 'provider'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true }
);

favoriteSchema.index({ userId: 1, targetType: 1, targetId: 1 }, { unique: true });

export const Favorite = mongoose.model<IFavorite>('Favorite', favoriteSchema);
