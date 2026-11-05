import mongoose, { Schema, Types } from 'mongoose';
import type { UserRole, UserStatus } from '../types/auth.types';

export interface IUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  avatar?: string;
  refreshTokenHash?: string;
  preferences?: Record<string, unknown>;
  /** Wrong passwords / 2-step codes in a row; reaching the limit sets `lockedUntil`. */
  failedLoginAttempts?: number;
  lockedUntil?: Date;
  twoFactor?: {
    enabled: boolean;
    /** Sealed (AES-GCM) base32 TOTP secret. */
    secret?: string;
    /** Secret being set up, until the first code confirms it. */
    pendingSecret?: string;
    /** SHA-256 of unused one-time recovery codes. */
    recoveryCodes?: string[];
    /** Last accepted TOTP step, so a code cannot be used twice. */
    lastUsedStep?: number;
    enabledAt?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
  toSafeJSON(): Record<string, unknown>;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    phone: { type: String, required: true, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['customer', 'provider', 'admin'], default: 'customer', index: true },
    status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active' },
    avatar: String,
    refreshTokenHash: { type: String, select: false },
    preferences: { type: Schema.Types.Mixed, default: {} },
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, select: false },
    twoFactor: {
      enabled: { type: Boolean, default: false },
      secret: { type: String, select: false },
      pendingSecret: { type: String, select: false },
      recoveryCodes: { type: [String], select: false, default: undefined },
      lastUsedStep: { type: Number, select: false },
      enabledAt: Date,
    },
  },
  { timestamps: true }
);

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    phone: this.phone,
    role: this.role,
    status: this.status,
    avatar: this.avatar,
    preferences: this.preferences,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const User = mongoose.model<IUser>('User', userSchema);
