import mongoose, { Schema, Types } from 'mongoose';

export type SessionClient = 'web-admin' | 'web-site' | 'mobile';

/**
 * One signed-in device. A refresh token names its session (`sid`), and only the
 * session's current token is valid: every refresh replaces `tokenHash`, so an older
 * token presented again means it was copied. That revokes the session.
 */
export interface ISession {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  client: SessionClient;
  /** SHA-256 of the current refresh token. */
  tokenHash: string;
  /** SHA-256 of the token it replaced, kept briefly to tell a network race from theft. */
  previousTokenHash?: string;
  rotatedAt?: Date;
  userAgent?: string;
  ip?: string;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  revokedReason?: 'logout' | 'logout-all' | 'revoked' | 'reuse-detected' | 'password-changed' | 'password-reset';
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    client: { type: String, enum: ['web-admin', 'web-site', 'mobile'], required: true },
    tokenHash: { type: String, required: true, select: false },
    previousTokenHash: { type: String, select: false },
    rotatedAt: Date,
    userAgent: { type: String, maxlength: 300 },
    ip: { type: String, maxlength: 64 },
    lastUsedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    revokedReason: String,
  },
  { timestamps: true }
);

// MongoDB deletes sessions once they can no longer be refreshed.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.model<ISession>('Session', sessionSchema);
