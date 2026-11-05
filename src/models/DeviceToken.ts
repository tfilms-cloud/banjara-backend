import mongoose, { Schema, Types } from 'mongoose';

export type DevicePlatform = 'ios' | 'android' | 'web';
export type DeviceAppRole = 'customer' | 'provider';

export interface IDeviceToken {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  token: string;
  platform: DevicePlatform;
  appRole: DeviceAppRole;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const deviceTokenSchema = new Schema<IDeviceToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token: { type: String, required: true, unique: true, trim: true },
    platform: { type: String, enum: ['ios', 'android', 'web'], required: true },
    appRole: { type: String, enum: ['customer', 'provider'], default: 'customer', index: true },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

deviceTokenSchema.index({ userId: 1, appRole: 1 });

export const DeviceToken = mongoose.model<IDeviceToken>('DeviceToken', deviceTokenSchema);
