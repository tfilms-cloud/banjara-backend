import { paramId } from '../utils/params';
import { NextFunction, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import { User } from '../models/User';
import { ProviderProfile } from '../models/ProviderProfile';
import { Booking } from '../models/Booking';
import { Review } from '../models/Review';
import * as adminService from '../services/admin.service';
import * as vehicleService from '../services/vehicle.service';
import { assertFound } from '../utils/AppError';
import { sendSuccess } from '../utils/apiResponse';

export async function dashboard(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.getDashboard());
  } catch (error) {
    next(error);
  }
}

export async function listProviders(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.listProvidersAdmin(req.query as Record<string, unknown>));
  } catch (error) {
    next(error);
  }
}

export async function getProvider(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      assertFound(
        await ProviderProfile.findById(paramId(req.params.id)).populate('userId', 'name email phone status'),
        'Provider not found'
      )
    );
  } catch (error) {
    next(error);
  }
}

export async function approveProvider(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await adminService.setProviderStatus(paramId(req.params.id), 'approved'),
      'Provider approved'
    );
  } catch (error) {
    next(error);
  }
}

export async function rejectProvider(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    return sendSuccess(
      res,
      await adminService.setProviderStatus(paramId(req.params.id), 'rejected', reason),
      'Provider rejected'
    );
  } catch (error) {
    next(error);
  }
}

export async function suspendProvider(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    return sendSuccess(
      res,
      await adminService.setProviderStatus(paramId(req.params.id), 'suspended', reason),
      'Provider suspended'
    );
  } catch (error) {
    next(error);
  }
}

export async function listCustomers(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const customers = await User.find({ role: 'customer' }).select('-passwordHash -refreshTokenHash');
    return sendSuccess(
      res,
      customers.map((u) => u.toSafeJSON())
    );
  } catch (error) {
    next(error);
  }
}

export async function getCustomer(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.getCustomerDetail(paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function listVehicles(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.listVehicles(req.query as Record<string, unknown>));
  } catch (error) {
    next(error);
  }
}

export async function getVehicle(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.getVehicle(paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function approveVehicle(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await vehicleService.approveVehicle(paramId(req.params.id), req.user!.id),
      'Vehicle approved successfully'
    );
  } catch (error) {
    next(error);
  }
}

export async function rejectVehicle(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    return sendSuccess(
      res,
      await vehicleService.rejectVehicle(paramId(req.params.id), req.user!.id, reason),
      'Vehicle rejected'
    );
  } catch (error) {
    next(error);
  }
}

export async function suspendVehicle(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    return sendSuccess(
      res,
      await vehicleService.suspendVehicle(paramId(req.params.id), req.user!.id, reason),
      'Vehicle suspended'
    );
  } catch (error) {
    next(error);
  }
}

export async function getVehicleTrips(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await vehicleService.getVehicleTripSummary(paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function listRoutes(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.listRoutes());
  } catch (error) {
    next(error);
  }
}

export async function getRoute(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.getRoute(paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function listPickupPoints(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.listPickupPoints());
  } catch (error) {
    next(error);
  }
}

export async function getPickupPoint(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.getPickupPoint(paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function listTrips(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.listTrips());
  } catch (error) {
    next(error);
  }
}

export async function getTrip(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.getTrip(paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function listHotels(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.listHotels());
  } catch (error) {
    next(error);
  }
}

export async function getHotel(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.getHotel(paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function approveHotel(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await adminService.setHotelStatus(paramId(req.params.id), 'approved'),
      'Hotel approved'
    );
  } catch (error) {
    next(error);
  }
}

export async function rejectHotel(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    return sendSuccess(
      res,
      await adminService.setHotelStatus(paramId(req.params.id), 'rejected', reason),
      'Hotel rejected'
    );
  } catch (error) {
    next(error);
  }
}

export async function suspendHotel(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    return sendSuccess(
      res,
      await adminService.setHotelStatus(paramId(req.params.id), 'suspended', reason),
      'Hotel suspended'
    );
  } catch (error) {
    next(error);
  }
}

export async function requestHotelChanges(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    return sendSuccess(
      res,
      await adminService.setHotelStatus(paramId(req.params.id), 'changes_requested', reason),
      'Changes requested'
    );
  } catch (error) {
    next(error);
  }
}

export async function listRooms(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.listRooms());
  } catch (error) {
    next(error);
  }
}

export async function getRoom(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.getRoom(paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function listAvailability(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.listAvailability(req.query as Record<string, unknown>));
  } catch (error) {
    next(error);
  }
}

export async function listBookings(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await Booking.find()
        .populate('customerId', 'name email')
        .populate('providerId', 'businessName')
        .sort({ createdAt: -1 })
        .limit(200)
    );
  } catch (error) {
    next(error);
  }
}

export async function getBooking(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.getBooking(paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function listPayments(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.listPayments());
  } catch (error) {
    next(error);
  }
}

export async function getPayment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.getPayment(paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function listReviews(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await Review.find().sort({ createdAt: -1 }).limit(200));
  } catch (error) {
    next(error);
  }
}

export async function listNotifications(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.listNotificationsAdmin());
  } catch (error) {
    next(error);
  }
}

export async function listMessages(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.listMessagesAdmin());
  } catch (error) {
    next(error);
  }
}

export async function listSupport(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.listSupportTickets());
  } catch (error) {
    next(error);
  }
}

export async function getSupport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await adminService.getSupportTicket(paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function updateSupport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await adminService.updateSupportTicket(paramId(req.params.id), {
        status: req.body?.status,
        priority: req.body?.priority,
      }),
      'Support ticket updated'
    );
  } catch (error) {
    next(error);
  }
}

export async function getReports(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const range = typeof req.query.range === 'string' ? req.query.range : '7d';
    return sendSuccess(res, await adminService.getReports(range));
  } catch (error) {
    next(error);
  }
}
