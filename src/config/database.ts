import mongoose from 'mongoose';
import { env } from './env';

export async function connectDatabase(): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  const connection = await mongoose.connect(env.MONGODB_URI);
  console.log(`MongoDB connected: ${connection.connection.host}/${connection.connection.name}`);
  return connection;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
