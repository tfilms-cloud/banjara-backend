import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { randomUUID } from 'crypto';
import mongoSanitize from 'express-mongo-sanitize';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import { env } from './config/env';
import { logger, requestContext } from './utils/logger';
import { globalRateLimiter } from './middleware/rateLimit.middleware';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { sendSuccess } from './utils/apiResponse';

import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import providerRoutes from './routes/provider.routes';
import businessRoutes from './routes/business.routes';
import vehicleRoutes from './routes/vehicle.routes';
import tripRoutes from './routes/trip.routes';
import routeRoutes from './routes/route.routes';
import pickupPointRoutes from './routes/pickupPoint.routes';
import hotelRoutes from './routes/hotel.routes';
import roomRoutes from './routes/room.routes';
import availabilityRoutes from './routes/availability.routes';
import bookingRoutes from './routes/booking.routes';
import paymentRoutes from './routes/payment.routes';
import reviewRoutes from './routes/review.routes';
import favoriteRoutes from './routes/favorite.routes';
import notificationRoutes from './routes/notification.routes';
import messageRoutes from './routes/message.routes';
import supportRoutes from './routes/support.routes';
import adminRoutes from './routes/admin.routes';
import uploadRoutes from './routes/upload.routes';

export function createApp() {
  const app = express();

  // Required on Railway / Render / Nginx so rate-limit and IPs work.
  app.set('trust proxy', 1);

  app.use(helmet());

  const allowedOrigins = [
    env.CLIENT_URL,
    ...env.CLIENT_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ];

  app.use(
    cors({
      origin(origin, callback) {
        // Mobile native apps and server-to-server calls often send no Origin header.
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`CORS blocked for origin: ${origin}`));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  // express-mongo-sanitize is incompatible with Express 5's read-only req.query.
  // Sanitize mutable request payloads in place instead.
  app.use((req, _res, next) => {
    if (req.body && typeof req.body === 'object') {
      mongoSanitize.sanitize(req.body);
    }
    if (req.params && typeof req.params === 'object') {
      mongoSanitize.sanitize(req.params);
    }
    next();
  });
  // Request id + structured access log. The id is propagated through AsyncLocalStorage so
  // every log line emitted while handling the request carries it.
  app.use((req, res, next) => {
    const headerId = req.headers['x-request-id'];
    const requestId = typeof headerId === 'string' && headerId ? headerId : randomUUID();
    res.setHeader('x-request-id', requestId);
    const start = Date.now();
    requestContext.run({ requestId }, () => {
      res.on('finish', () => {
        logger.info(
          {
            requestId,
            method: req.method,
            url: req.originalUrl,
            status: res.statusCode,
            durationMs: Date.now() - start,
          },
          'request'
        );
      });
      next();
    });
  });
  app.use(globalRateLimiter);

  app.get('/api/health', (_req, res) => {
    const dbState = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    return sendSuccess(res, { database: dbState }, 'Banjara API is running');
  });

  // Readiness: unlike liveness this must fail when a dependency is down, so orchestrators
  // and load balancers stop routing traffic to a process that cannot serve it.
  app.get('/api/ready', (_req, res) => {
    const dbState = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        message: 'Banjara API is not ready',
        data: { database: dbState },
        errors: [],
      });
    }
    return sendSuccess(res, { database: dbState }, 'Banjara API is ready');
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/providers', providerRoutes);
  app.use('/api/businesses', businessRoutes);
  app.use('/api/vehicles', vehicleRoutes);
  app.use('/api/trips', tripRoutes);
  app.use('/api/routes', routeRoutes);
  app.use('/api/pickup-points', pickupPointRoutes);
  app.use('/api/hotels', hotelRoutes);
  app.use('/api/rooms', roomRoutes);
  app.use('/api/availability', availabilityRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/reviews', reviewRoutes);
  app.use('/api/favorites', favoriteRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/support', supportRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/uploads', uploadRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
