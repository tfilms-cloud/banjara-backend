import { Schema, model } from 'mongoose';

// Keep requests durable: storage outages and unsaved edits must not lose cleanup work.
const schema = new Schema({
  projectOrigin: { type: String, required: true },
  bucket: { type: String, required: true },
  path: { type: String, required: true },
  ownerId: { type: String, required: true },
  nextAttemptAt: { type: Date, required: true, default: Date.now },
  attempts: { type: Number, default: 0 },
}, { timestamps: true });
schema.index({ projectOrigin: 1, bucket: 1, path: 1 }, { unique: true });
schema.index({ nextAttemptAt: 1 });

export const MediaDeletion = model('MediaDeletion', schema);
