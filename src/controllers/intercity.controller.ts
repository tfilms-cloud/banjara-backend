import { NextFunction, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import * as intercity from '../services/intercityRequest.service';
import * as balance from '../services/driverBalance.service';
import { sendSuccess } from '../utils/apiResponse';
import { AppError } from '../utils/AppError';
import { paramId } from '../utils/params';

function providerId(req: AuthRequest) {
  if (!req.user?.providerId) throw new AppError('Provider profile required', 403);
  return req.user.providerId;
}

const handle =
  (fn: (req: AuthRequest) => Promise<unknown>, message?: string, status?: number) =>
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      return sendSuccess(res, await fn(req), message, status);
    } catch (error) {
      next(error);
    }
  };

/* Public */
export const config = handle(() => intercity.getPublicConfig());
export const cities = handle(() => intercity.listCities());
export const quote = handle((req) => intercity.quote(req.body));
export const sharedTrips = handle((req) => intercity.findSharedTrips(req.query as never));
export const nearby = handle((req) => intercity.nearbyRides(req.query as never));

/* Rider */
export const createRequest = handle((req) => intercity.createRequest(req.user!.id, req.body), 'Ride requested', 201);
export const myRequests = handle((req) => intercity.listMyRequests(req.user!.id));
export const myRequest = handle((req) => intercity.getMyRequest(req.user!.id, paramId(req.params.id)));
export const cancelRequest = handle((req) => intercity.cancelRequest(req.user!.id, paramId(req.params.id)), 'Ride request cancelled');
export const widen = handle((req) => intercity.widenSearch(req.user!.id, paramId(req.params.id)), 'Searching a wider area');
export const chooseOffer = handle((req) => intercity.chooseOffer(req.user!.id, paramId(req.params.id), req.body.offerId), 'Ride booked');
export const requestSharedTrips = handle((req) => intercity.sharedTripsForRequest(req.user!.id, paramId(req.params.id)));
export const joinShared = handle((req) => intercity.joinSharedTrip(req.user!.id, paramId(req.params.id), req.body.tripId), 'Seat requested');

/* Driver */
export const driverSettings = handle((req) => intercity.getDriverSettings(providerId(req)));
export const updateDriverSettings = handle((req) => intercity.updateDriverSettings(providerId(req), req.body), 'Saved');
export const driverFeed = handle((req) => intercity.driverFeed(providerId(req)));
export const driverBalance = handle((req) => balance.getDriverBalance(providerId(req)));
export const reportCommissionPayment = handle(
  (req) => balance.submitPayment(providerId(req), req.body),
  'Payment reported. It counts once BANJARA confirms it.',
  201
);

/* Admin */
export const adminCommissionPayments = handle((req) =>
  balance.listPayments((['pending', 'approved', 'rejected', 'all'].includes(String(req.query.status)) ? req.query.status : 'pending') as never)
);
export const adminApproveCommissionPayment = handle(
  (req) => balance.reviewPayment(req.user!.id, paramId(req.params.id), 'approve'),
  'Payment approved'
);
export const adminRejectCommissionPayment = handle(
  (req) => balance.reviewPayment(req.user!.id, paramId(req.params.id), 'reject', req.body?.reason),
  'Payment rejected'
);
export const adminCommissionSettings = handle(() => balance.getCommissionSettings());
export const adminUpdateCommissionSettings = handle((req) => balance.updateCommissionSettings(req.body), 'Commission settings saved');
export const respond = handle((req) => intercity.respondToRequest(providerId(req), paramId(req.params.id), req.body), 'Answer sent');
export const tripStatus = handle((req) => intercity.setTripStatus(providerId(req), paramId(req.params.id), req.body.status));
export const noShow = handle((req) => intercity.markNoShow(providerId(req), paramId(req.params.id)), 'Marked as no-show');

/* Tracking */
export const recordLocations = handle((req) => intercity.recordLocations(providerId(req), paramId(req.params.id), req.body.points));
export const tripLocation = handle((req) => intercity.getTripLocation(paramId(req.params.id), req.user!));
