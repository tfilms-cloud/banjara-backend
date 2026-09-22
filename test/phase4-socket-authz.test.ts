import http from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../src/app';
import { Booking } from '../src/models/Booking';
import { Trip } from '../src/models/Trip';
import { Vehicle } from '../src/models/Vehicle';
import { initSocket } from '../src/sockets/socket';
import { clearDatabase, setupTestDb, teardownTestDb } from './helpers/db';
import { makeUser } from './helpers/auth';

function connect(baseUrl: string, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (error) => reject(error));
  });
}

function emitWithAck(socket: ClientSocket, event: string, payload: unknown, timeout = 1000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout for ${event}`)), timeout);
    socket.emit(event, payload, (data: unknown) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function expectNoEvent(socket: ClientSocket, event: string, wait = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = () => {
      socket.off(event, handler);
      reject(new Error(`unexpected ${event} received`));
    };
    socket.on(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, wait);
  });
}

function waitForEvent(socket: ClientSocket, event: string, wait = 1500): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, wait);
    const handler = (data: unknown) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    };
    socket.on(event, handler);
  });
}

/** Emits joinTrip without an ack and gives the server a moment to process it. */
async function joinTripQuiet(socket: ClientSocket, tripId: string) {
  socket.emit('joinTrip', tripId);
  await new Promise((resolve) => setTimeout(resolve, 150));
}

describe('Phase 4.2 — Socket.IO trip authorization', () => {
  const app = createApp();
  let server: http.Server;
  let io: ReturnType<typeof initSocket>;
  let baseUrl: string;
  const clients: ClientSocket[] = [];

  beforeAll(async () => {
    await setupTestDb();
    server = http.createServer();
    io = initSocket(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    for (const client of clients) client.disconnect();
    io.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  async function track(socket: ClientSocket) {
    clients.push(socket);
    return socket;
  }

  async function makeTripWithBooking() {
    const customer = await makeUser(app, 'customer');
    const provider = await makeUser(app, 'provider', { service: 'transport' });
    const vehicle = await Vehicle.create({
      providerId: provider.providerId,
      name: 'Bus',
      type: 'bus',
      brand: 'Hino',
      vehicleModel: 'AK',
      year: 2021,
      registrationNumber: `REG-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      seatCount: 10,
      status: 'active',
    });
    const trip = await Trip.create({
      providerId: provider.providerId,
      vehicleId: vehicle._id,
      origin: 'Islamabad',
      destination: 'Gilgit',
      departureDate: '2030-01-01',
      departureTime: '08:00',
      price: 5000,
      totalSeats: 10,
      availableSeats: 10,
      seatLayout: [],
      status: 'scheduled',
    });
    await Booking.create({
      bookingNumber: `TEST-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      customerId: customer.id,
      providerId: provider.providerId,
      bookingType: 'transport',
      transportBooking: {
        tripId: trip._id.toString(),
        seats: ['A1'],
        passengerDetails: [{ name: 'Passenger' }],
      },
      subtotal: 5000,
      totalAmount: 5500,
      bookingStatus: 'confirmed',
      paymentStatus: 'paid',
    });
    return { customer, provider, tripId: trip._id.toString() };
  }

  it('rejects a non-participant joining a trip room', async () => {
    const { tripId } = await makeTripWithBooking();
    const outsider = await makeUser(app, 'customer');
    const socket = await track(await connect(baseUrl, outsider.token));

    const ack = (await emitWithAck(socket, 'joinTrip', tripId)) as { success?: boolean } | undefined;
    expect(ack?.success).toBe(false);
  });

  it('does not let a non-provider publish a trip status update', async () => {
    const { customer, provider, tripId } = await makeTripWithBooking();
    const providerSocket = await track(await connect(baseUrl, provider.token));
    const customerSocket = await track(await connect(baseUrl, customer.token));

    await joinTripQuiet(providerSocket, tripId);
    await joinTripQuiet(customerSocket, tripId);

    // Customer is a participant (can view) but must not be able to publish.
    const noUpdate = expectNoEvent(providerSocket, 'tripStatusUpdate');
    customerSocket.emit('tripStatusUpdate', { tripId, status: 'cancelled' });
    await noUpdate;
  });

  it('delivers a valid update from the trip provider to a participant', async () => {
    const { customer, provider, tripId } = await makeTripWithBooking();
    const providerSocket = await track(await connect(baseUrl, provider.token));
    const customerSocket = await track(await connect(baseUrl, customer.token));

    await joinTripQuiet(providerSocket, tripId);
    await joinTripQuiet(customerSocket, tripId);

    const received = waitForEvent(customerSocket, 'tripStatusUpdate');
    providerSocket.emit('tripStatusUpdate', { tripId, status: 'departed' });
    const payload = (await received) as { status?: string };
    expect(payload.status).toBe('departed');
  });

  it('does not relay a driver location with out-of-range coordinates', async () => {
    const { customer, provider, tripId } = await makeTripWithBooking();
    const providerSocket = await track(await connect(baseUrl, provider.token));
    const customerSocket = await track(await connect(baseUrl, customer.token));

    await joinTripQuiet(providerSocket, tripId);
    await joinTripQuiet(customerSocket, tripId);

    const noUpdate = expectNoEvent(customerSocket, 'driverLocationUpdate');
    providerSocket.emit('driverLocationUpdate', { tripId, latitude: 999, longitude: 999 });
    await noUpdate;
  });
});
