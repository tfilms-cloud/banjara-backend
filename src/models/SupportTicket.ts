import mongoose, { Schema, Types } from 'mongoose';

export interface ISupportTicket {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  bookingId?: Types.ObjectId;
  category: 'booking' | 'payment' | 'transport' | 'hotel' | 'provider' | 'technical' | 'other';
  subject: string;
  message: string;
  status: 'open' | 'inProgress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high';
  createdAt: Date;
  updatedAt: Date;
}

const supportTicketSchema = new Schema<ISupportTicket>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
    category: {
      type: String,
      enum: ['booking', 'payment', 'transport', 'hotel', 'provider', 'technical', 'other'],
      required: true,
    },
    subject: { type: String, required: true },
    message: { type: String, required: true },
    status: {
      type: String,
      enum: ['open', 'inProgress', 'resolved', 'closed'],
      default: 'open',
    },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  },
  { timestamps: true }
);

export const SupportTicket = mongoose.model<ISupportTicket>('SupportTicket', supportTicketSchema);
