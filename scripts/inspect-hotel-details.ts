import mongoose from 'mongoose';
import { config } from 'dotenv';

config();

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/banjara';
  await mongoose.connect(uri);
  const docs = await mongoose.connection.db!
    .collection('providerprofiles')
    .find({ services: 'hotel' })
    .project({ businessName: 1, hotelDetails: 1, updatedAt: 1 })
    .sort({ updatedAt: -1 })
    .limit(3)
    .toArray();
  console.log(JSON.stringify(docs, null, 2));
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
