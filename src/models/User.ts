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
