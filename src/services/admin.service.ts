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
import { Notification } from '../models/Notification';
import { Message } from '../models/Message';
import { SupportTicket } from '../models/SupportTicket';
import { env } from '../config/env';
import { AppError, assertFound } from '../utils/AppError';
import { getPagination, paginatedResult } from '../utils/pagination';
import type { VerificationStatus } from '../types/provider.types';
import * as vehicleService from './vehicle.service';
import * as hotelService from './hotel.service';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function startOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysAgo(n: number): Date {
  const d = startOfDay();
  d.setDate(d.getDate() - n);
  return d;
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getDashboard() {
  const today = todayIso();
  const sevenDaysAgo = daysAgo(6);

  const [
    totalCustomers,
    totalProviders,
    pendingProviders,
    activeProviders,
    totalTrips,
    totalHotels,
    confirmedBookings,
    todaysBookings,
    pendingPayments,
    openTickets,
    todaysTripsDocs,
    upcomingTrips,
    rooms,
    recentBookings,
    recentProviders,
    recentPayments,
    recentTickets,
    chartBookings,
  ] = await Promise.all([
    User.countDocuments({ role: 'customer' }),
    ProviderProfile.countDocuments(),
    ProviderProfile.countDocuments({ verificationStatus: 'pending' }),
    ProviderProfile.countDocuments({ verificationStatus: 'approved' }),
    Trip.countDocuments(),
    Hotel.countDocuments(),
    Booking.find({ bookingStatus: { $in: ['confirmed', 'completed'] } }),
    Booking.countDocuments({
      createdAt: { $gte: startOfDay() },
    }),
    Payment.countDocuments({ status: 'pending' }),
    SupportTicket.countDocuments({ status: { $in: ['open', 'inProgress'] } }),
    Trip.find({ departureDate: today, status: { $nin: ['cancelled'] } }),
    Trip.countDocuments({
      departureDate: { $gt: today },
      status: { $nin: ['cancelled', 'completed'] },
    }),
    Room.find({ status: 'active' }),
    Booking.find().sort({ createdAt: -1 }).limit(10),
    ProviderProfile.find({ verificationStatus: 'pending' }).sort({ createdAt: -1 }).limit(10),
    Payment.find().sort({ createdAt: -1 }).limit(10),
    SupportTicket.find().sort({ createdAt: -1 }).limit(10),
    Booking.find({
      createdAt: { $gte: sevenDaysAgo },
      bookingStatus: { $nin: ['cancelled'] },
    }).select('createdAt totalAmount paymentStatus bookingStatus'),
  ]);

  const revenue = confirmedBookings.reduce((sum, b) => sum + b.totalAmount, 0);
  const platformFees = Math.round(revenue * env.PLATFORM_FEE_RATE);

  const bookedSeats = todaysTripsDocs.reduce((sum, t) => sum + (t.bookedSeats ?? 0), 0);
  const availableSeats = todaysTripsDocs.reduce((sum, t) => sum + (t.availableSeats ?? 0), 0);

  const totalRooms = rooms.reduce((sum, r) => sum + (r.totalRooms ?? 0), 0);
  const availableRooms = rooms.reduce((sum, r) => sum + (r.availableRooms ?? 0), 0);
  const occupiedRooms = rooms.reduce(
    (sum, r) => sum + Math.max(0, (r.totalRooms ?? 0) - (r.availableRooms ?? 0)),
    0
  );

  const hotelBookingsToday = await Booking.find({
    bookingType: 'hotel',
    bookingStatus: { $in: ['confirmed', 'pending', 'completed'] },
  }).select('hotelBooking bookingStatus');

  const todaysCheckIns = hotelBookingsToday.filter(
    (b) => b.hotelBooking?.checkIn === today && ['confirmed', 'pending'].includes(b.bookingStatus)
  ).length;
  const todaysCheckOuts = hotelBookingsToday.filter(
    (b) => b.hotelBooking?.checkOut === today && ['confirmed', 'completed'].includes(b.bookingStatus)
  ).length;

  const chartMap = new Map<string, { date: string; bookings: number; revenue: number }>();
  for (let i = 6; i >= 0; i--) {
    const key = dateKey(daysAgo(i));
    chartMap.set(key, { date: key, bookings: 0, revenue: 0 });
  }
  for (const b of chartBookings) {
    const key = dateKey(new Date(b.createdAt));
    const row = chartMap.get(key);
    if (!row) continue;
    row.bookings += 1;
    if (['paid'].includes(b.paymentStatus) || ['confirmed', 'completed'].includes(b.bookingStatus)) {
      row.revenue += b.totalAmount;
    }
  }

  return {
    totalCustomers,
    totalProviders,
    pendingProviders,
    activeProviders,
    totalTrips,
    totalHotels,
    totalBookings: confirmedBookings.length,
    revenue,
    platformFees,
    openTickets,
    todaysBookings,
    pendingPayments,
    todaysTrips: todaysTripsDocs.length,
    upcomingTrips,
    bookedSeats,
    availableSeats,
    totalRooms,
    occupiedRooms,
    availableRooms,
    todaysCheckIns,
    todaysCheckOuts,
    recentBookings,
    recentProviders,
    recentPayments,
    recentTickets,
    charts: Array.from(chartMap.values()),
  };
}

export async function listProvidersAdmin(query: Record<string, unknown>) {
  const { page, limit, skip, search } = getPagination(query);
  const filter: Record<string, unknown> = {};

  const status = typeof query.status === 'string' ? query.status.trim() : '';
  if (status) filter.verificationStatus = status;

  if (search) {
    filter.$or = [
      { businessName: { $regex: search, $options: 'i' } },
      { ownerName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { city: { $regex: search, $options: 'i' } },
    ];
  }

  const [items, total] = await Promise.all([
    ProviderProfile.find(filter)
      .populate('userId', 'name email phone status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    ProviderProfile.countDocuments(filter),
  ]);

  return paginatedResult(items, total, page, limit);
}

export async function setProviderStatus(
  providerId: string,
  status: VerificationStatus,
  reason?: string
) {
  const update: Record<string, unknown> = { verificationStatus: status };
  if (status === 'approved') {
    update.$unset = { rejectionReason: 1 };
  } else if (reason != null && String(reason).trim()) {
    update.rejectionReason = String(reason).trim();
  }

  // Avoid mixing top-level fields with operators incorrectly when $unset is present
  if (update.$unset) {
    return assertFound(
      await ProviderProfile.findByIdAndUpdate(
        providerId,
        { $set: { verificationStatus: status }, $unset: { rejectionReason: 1 } },
        { new: true, runValidators: true }
      ),
      'Provider not found'
    );
  }

  return assertFound(
    await ProviderProfile.findByIdAndUpdate(providerId, update, { new: true, runValidators: true }),
    'Provider not found'
  );
}

export async function getCustomerDetail(customerId: string) {
  const customer = assertFound(
    await User.findOne({ _id: customerId, role: 'customer' }).select('-passwordHash -refreshTokenHash'),
    'Customer not found'
  );
  const bookings = await Booking.find({ customerId }).sort({ createdAt: -1 }).limit(100);
  return {
    customer: customer.toSafeJSON(),
    bookings,
  };
}

export async function listVehicles(query: Record<string, unknown> = {}) {
  const filter: Record<string, unknown> = {};
  if (typeof query.status === 'string' && query.status.trim()) {
    filter.status = query.status.trim();
  }
  if (typeof query.type === 'string' && query.type.trim()) {
    filter.type = query.type.trim();
  }
  if (typeof query.providerId === 'string' && query.providerId.trim()) {
    filter.providerId = query.providerId.trim();
  }

  const vehicles = await Vehicle.find(filter)
    .populate('providerId', 'businessName verificationStatus rating totalReviews')
    .populate('approvedBy', 'name email')
    .sort({ createdAt: -1 })
    .limit(500);

  const stats = {
    total: await Vehicle.countDocuments(),
    pending: await Vehicle.countDocuments({ status: 'pending' }),
    active: await Vehicle.countDocuments({ status: 'active' }),
    rejected: await Vehicle.countDocuments({ status: 'rejected' }),
    suspended: await Vehicle.countDocuments({ status: 'suspended' }),
  };

  return { items: vehicles, stats };
}

export async function getVehicle(id: string) {
  const vehicle = assertFound(
    await Vehicle.findById(id)
      .populate('providerId', 'businessName ownerName verificationStatus rating totalReviews phone email city')
      .populate('approvedBy', 'name email')
      .populate('rejectedBy', 'name email')
      .populate('suspendedBy', 'name email'),
    'Vehicle not found'
  );

  const seatSummary = await vehicleService.getVehicleTripSummary(id);
  return { vehicle, seatSummary };
}

export async function listRoutes() {
  return Route.find().populate('providerId', 'businessName').sort({ createdAt: -1 }).limit(500);
}

export async function getRoute(id: string) {
  return assertFound(
    await Route.findById(id).populate('providerId', 'businessName'),
    'Route not found'
  );
}

export async function listPickupPoints() {
  return PickupPoint.find()
    .populate('providerId', 'businessName')
    .sort({ createdAt: -1 })
    .limit(500);
}

export async function getPickupPoint(id: string) {
  return assertFound(
    await PickupPoint.findById(id).populate('providerId', 'businessName'),
    'Pickup point not found'
  );
}

export async function listTrips() {
  return Trip.find()
    .populate('providerId', 'businessName')
    .populate('vehicleId', 'name type registrationNumber')
    .sort({ departureDate: -1, createdAt: -1 })
    .limit(500);
}

export async function getTrip(id: string) {
  return assertFound(
    await Trip.findById(id)
      .populate('providerId', 'businessName')
      .populate('vehicleId', 'name type registrationNumber seatCount')
      .populate('routeId')
      .populate('pickupPoints')
      .populate('dropoffPoints'),
    'Trip not found'
  );
}

export async function listHotels() {
  await hotelService.syncHotelListingsFromApplications();
  return Hotel.find().populate('providerId', 'businessName').sort({ createdAt: -1 }).limit(500);
}

export async function getHotel(id: string) {
  const hotel = assertFound(
    await Hotel.findById(id).populate('providerId', 'businessName'),
    'Hotel not found'
  );
  const rooms = await Room.find({ hotelId: id }).sort({ createdAt: -1 });
  return { hotel, rooms };
}

export async function setHotelStatus(
  hotelId: string,
  status: 'approved' | 'rejected' | 'suspended' | 'changes_requested' | 'pending',
  reason?: string
) {
  return hotelService.setHotelApprovalStatus(hotelId, status, reason);
}

export async function listRooms() {
  return Room.find()
    .populate('hotelId', 'name city')
    .populate('providerId', 'businessName')
    .sort({ createdAt: -1 })
    .limit(500);
}

export async function getRoom(id: string) {
  return assertFound(
    await Room.findById(id)
      .populate('hotelId', 'name city')
      .populate('providerId', 'businessName'),
    'Room not found'
  );
}

export async function listAvailability(query: Record<string, unknown>) {
  const filter: Record<string, unknown> = {};
  if (typeof query.roomId === 'string' && query.roomId.trim()) {
    filter.roomId = query.roomId.trim();
  }
  const dateFilter: Record<string, string> = {};
  if (typeof query.from === 'string' && query.from.trim()) {
    dateFilter.$gte = query.from.trim();
  }
  if (typeof query.to === 'string' && query.to.trim()) {
    dateFilter.$lte = query.to.trim();
  }
  if (Object.keys(dateFilter).length) {
    filter.date = dateFilter;
  }

  return RoomAvailability.find(filter)
    .populate('roomId', 'name roomType hotelId')
    .sort({ date: 1 })
    .limit(1000);
}

export async function getBooking(id: string) {
  return assertFound(
    await Booking.findById(id)
      .populate('customerId', 'name email phone')
      .populate('providerId', 'businessName')
      .populate('paymentId'),
    'Booking not found'
  );
}

export async function listPayments() {
  return Payment.find()
    .populate('customerId', 'name email')
    .populate('providerId', 'businessName')
    .populate('bookingId', 'bookingNumber bookingType totalAmount')
    .sort({ createdAt: -1 })
    .limit(200);
}

export async function getPayment(id: string) {
  return assertFound(
    await Payment.findById(id)
      .populate('customerId', 'name email phone')
      .populate('providerId', 'businessName')
      .populate('bookingId'),
    'Payment not found'
  );
}

export async function listNotificationsAdmin() {
  return Notification.find().sort({ createdAt: -1 }).limit(200);
}

export async function listMessagesAdmin() {
  const messages = await Message.find()
    .populate('senderId', 'name email role')
    .populate('receiverId', 'name email role')
    .sort({ createdAt: -1 })
    .limit(500);

  const map = new Map<string, (typeof messages)[0]>();
  for (const msg of messages) {
    if (!map.has(msg.conversationId)) map.set(msg.conversationId, msg);
  }
  return {
    conversations: Array.from(map.values()),
    recentMessages: messages.slice(0, 100),
  };
}

export async function listSupportTickets() {
  return SupportTicket.find()
    .populate('userId', 'name email phone')
    .populate('bookingId', 'bookingNumber')
    .sort({ createdAt: -1 })
    .limit(200);
}

export async function getSupportTicket(id: string) {
  return assertFound(
    await SupportTicket.findById(id)
      .populate('userId', 'name email phone')
      .populate('bookingId'),
    'Support ticket not found'
  );
}

export async function updateSupportTicket(
  id: string,
  patch: { status?: string; priority?: string }
) {
  const update: Record<string, unknown> = {};
  if (patch.status != null) {
    const allowed = ['open', 'inProgress', 'resolved', 'closed'];
    if (!allowed.includes(patch.status)) {
      throw new AppError('Invalid status', 400);
    }
    update.status = patch.status;
  }
  if (patch.priority != null) {
    const allowed = ['low', 'medium', 'high'];
    if (!allowed.includes(patch.priority)) {
      throw new AppError('Invalid priority', 400);
    }
    update.priority = patch.priority;
  }
  if (Object.keys(update).length === 0) {
    throw new AppError('Provide status and/or priority', 400);
  }

  return assertFound(
    await SupportTicket.findByIdAndUpdate(id, update, { new: true, runValidators: true })
      .populate('userId', 'name email phone')
      .populate('bookingId'),
    'Support ticket not found'
  );
}

function rangeStart(range: string): Date {
  const now = startOfDay();
  switch (range) {
    case '30d':
      return daysAgo(29);
    case '90d':
      return daysAgo(89);
    case 'year': {
      const y = new Date(now);
      y.setFullYear(y.getFullYear() - 1);
      return y;
    }
    case '7d':
    default:
      return daysAgo(6);
  }
}

export async function getReports(rangeRaw?: string) {
  const range = ['7d', '30d', '90d', 'year'].includes(String(rangeRaw)) ? String(rangeRaw) : '7d';
  const from = rangeStart(range);
  const to = new Date();

  const [bookings, newCustomers, newProviders, payments] = await Promise.all([
    Booking.find({
      createdAt: { $gte: from, $lte: to },
      bookingStatus: { $nin: ['cancelled'] },
    }),
    User.countDocuments({ role: 'customer', createdAt: { $gte: from, $lte: to } }),
    ProviderProfile.countDocuments({ createdAt: { $gte: from, $lte: to } }),
    Payment.find({
      createdAt: { $gte: from, $lte: to },
      status: 'paid',
    }),
  ]);

  const revenue = payments.reduce((sum, p) => sum + p.amount, 0);
  const bookingRevenue = bookings
    .filter((b) => ['confirmed', 'completed'].includes(b.bookingStatus) || b.paymentStatus === 'paid')
    .reduce((sum, b) => sum + b.totalAmount, 0);

  return {
    range,
    from: from.toISOString(),
    to: to.toISOString(),
    revenue: revenue || bookingRevenue,
    bookings: bookings.length,
    customers: newCustomers,
    providers: newProviders,
    platformFees: Math.round((revenue || bookingRevenue) * env.PLATFORM_FEE_RATE),
  };
}
