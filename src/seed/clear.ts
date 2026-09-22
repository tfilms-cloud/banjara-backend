import { connectDatabase, disconnectDatabase } from '../config/database';
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

async function clearDatabase() {
  await connectDatabase();

  console.log('Removing all BANJARA collections (including users)...');

  const results = await Promise.all([
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

  const labels = [
    'users',
    'providerProfiles',
    'vehicles',
    'routes',
    'pickupPoints',
    'trips',
    'hotels',
    'rooms',
    'roomAvailabilities',
    'bookings',
    'payments',
    'reviews',
    'favorites',
    'notifications',
    'messages',
    'supportTickets',
    'counters',
  ];

  labels.forEach((label, index) => {
    console.log(`  ${label}: deleted ${results[index].deletedCount}`);
  });

  console.log('Database cleared. No seed users remain.');
  await disconnectDatabase();
}

clearDatabase().catch(async (error) => {
  console.error('Failed to clear database:', error);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
