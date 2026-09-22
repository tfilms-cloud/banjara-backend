import mongoose, { Schema, Types } from 'mongoose';

export interface IAdminAuditLog {
  _id: Types.ObjectId;
  action: string;
  entityType: string;
  entityId: Types.ObjectId;
  adminId: Types.ObjectId;
  meta?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const adminAuditLogSchema = new Schema<IAdminAuditLog>(
  {
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true, index: true },
    entityId: { type: Schema.Types.ObjectId, required: true, index: true },
    adminId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

export const AdminAuditLog = mongoose.model<IAdminAuditLog>('AdminAuditLog', adminAuditLogSchema);
