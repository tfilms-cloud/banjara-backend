import mongoose, { Schema, Types } from 'mongoose';

export interface INotification {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    data: { type: Schema.Types.Mixed },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Notification = mongoose.model<INotification>('Notification', notificationSchema);
