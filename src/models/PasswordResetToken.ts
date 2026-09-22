import mongoose, { Schema, Types } from 'mongoose';

export interface IPasswordResetToken {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** SHA-256 hash of the token — the plaintext token is never stored. */
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date | null;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

const passwordResetTokenSchema = new Schema<IPasswordResetToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/** Expired rows self-clean. */
passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
/** Fast lookup of the live token for a user. */
passwordResetTokenSchema.index({ userId: 1, usedAt: 1 });

export const PasswordResetToken = mongoose.model<IPasswordResetToken>(
  'PasswordResetToken',
  passwordResetTokenSchema
);
