import mongoose, { Schema, Types } from 'mongoose';

export type MessageType = 'text' | 'image' | 'file' | 'location' | 'trip';
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface IMessage {
  _id: Types.ObjectId;
  conversationId: string;
  senderId: Types.ObjectId;
  receiverId: Types.ObjectId;
  bookingId?: Types.ObjectId;
  type: MessageType;
  message: string;
  attachments: string[];
  status: MessageStatus;
  deliveredAt?: Date;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    conversationId: { type: String, required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    receiverId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
    type: {
      type: String,
      enum: ['text', 'image', 'file', 'location', 'trip'],
      default: 'text',
    },
    message: { type: String, required: true },
    attachments: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read', 'failed'],
      default: 'sent',
      index: true,
    },
    deliveredAt: Date,
    readAt: Date,
  },
  { timestamps: true }
);

messageSchema.index({ conversationId: 1, createdAt: -1 });

export const Message = mongoose.model<IMessage>('Message', messageSchema);
