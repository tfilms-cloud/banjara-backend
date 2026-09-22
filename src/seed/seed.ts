import { connectDatabase, disconnectDatabase } from '../config/database';
import { hashPassword } from '../utils/password';
import { User } from '../models/User';
import { ProviderProfile } from '../models/ProviderProfile';
import { Vehicle } from '../models/Vehicle';
import { Route } from '../models/Route';
import { PickupPoint } from '../models/PickupPoint';
import { Trip } from '../models/Trip';
import { Hotel } from '../models/Hotel';
import { Room } from '../models/Room';
import { RoomAvailability } from '../models/RoomAvailability';
import { Booking } from '../models/Booking';
import { Payment } from '../models/Payment';
import { Review } from '../models/Review';
import { Favorite } from '../models/Favorite';
import { Notification } from '../models/Notification';
import { Message } from '../models/Message';
import { SupportTicket } from '../models/SupportTicket';
import { Counter } from '../models/Counter';

async function seed() {
  await connectDatabase();

  console.log('Clearing collections...');
  await Promise.all([
    User.deleteMany({}),
    ProviderProfile.deleteMany({}),
    Vehicle.deleteMany({}),
    Route.deleteMany({}),
    PickupPoint.deleteMany({}),
    Trip.deleteMany({}),
    Hotel.deleteMany({}),
    Room.deleteMany({}),
    RoomAvailability.deleteMany({}),
    Booking.deleteMany({}),
    Payment.deleteMany({}),
    Review.deleteMany({}),
    Favorite.deleteMany({}),
    Notification.deleteMany({}),
    Message.deleteMany({}),
    SupportTicket.deleteMany({}),
    Counter.deleteMany({}),
  ]);

  const passwordHash = await hashPassword('demo1234');

  await User.create({
    name: 'BANJARA Admin',
    email: 'admin@banjara.com',
    phone: '+92 300 0000001',
    passwordHash,
    role: 'admin',
    status: 'active',
  });

  console.log('Seed complete — admin only (no demo customers/providers/trips/hotels).');
  console.log('Admin: admin@banjara.com / demo1234');

  await disconnectDatabase();
}

seed().catch(async (error) => {
  console.error(error);
  await disconnectDatabase();
  process.exit(1);
});
