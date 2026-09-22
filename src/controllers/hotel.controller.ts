import { paramId } from '../utils/params';
import { NextFunction, Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import * as hotelService from '../services/hotel.service';
import { sendSuccess } from '../utils/apiResponse';
import { AppError } from '../utils/AppError';

function providerId(req: AuthRequest) {
  if (!req.user?.providerId) throw new AppError('Provider profile required', 403);
  return req.user.providerId;
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await hotelService.createHotel(providerId(req), req.body), 'Hotel created', 201);
  } catch (error) {
    next(error);
  }
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await hotelService.listHotels(req.user?.role === 'provider' ? req.user.providerId : undefined));
  } catch (error) {
    next(error);
  }
}

export async function search(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await hotelService.searchHotels(req.query as Record<string, unknown>));
  } catch (error) {
    next(error);
  }
}

export async function getById(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await hotelService.getHotel(paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await hotelService.updateHotel(providerId(req), paramId(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await hotelService.deleteHotel(providerId(req), paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function createRoom(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await hotelService.createRoom(providerId(req), req.body), 'Room created', 201);
  } catch (error) {
    next(error);
  }
}

export async function listRooms(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await hotelService.listRoomsByHotel(paramId(req.params.hotelId), req.query as Record<string, unknown>)
    );
  } catch (error) {
    next(error);
  }
}

export async function getRoom(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await hotelService.getRoom(paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function updateRoom(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await hotelService.updateRoom(providerId(req), paramId(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
}

export async function deleteRoom(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await hotelService.deleteRoom(providerId(req), paramId(req.params.id)));
  } catch (error) {
    next(error);
  }
}

export async function getAvailability(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const providerId =
      req.user?.role === 'provider' ? req.user.providerId : undefined;
    return sendSuccess(
      res,
      await hotelService.getRoomAvailability(paramId(req.params.roomId), providerId)
    );
  } catch (error) {
    next(error);
  }
}

export async function updateAvailability(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await hotelService.upsertAvailability(
        providerId(req),
        paramId(req.params.roomId),
        req.body.date,
        req.body
      )
    );
  } catch (error) {
    next(error);
  }
}

export async function block(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await hotelService.blockRooms(
        providerId(req),
        req.body.roomId,
        req.body.date,
        req.body.count
      )
    );
  } catch (error) {
    next(error);
  }
}

export async function unblock(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await hotelService.unblockRooms(
        providerId(req),
        req.body.roomId,
        req.body.date,
        req.body.count
      )
    );
  } catch (error) {
    next(error);
  }
}

export async function bulkAvailability(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await hotelService.bulkUpsertAvailability(providerId(req), req.body));
  } catch (error) {
    next(error);
  }
}

export async function quote(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await hotelService.getHotelQuote(req.body));
  } catch (error) {
    next(error);
  }
}

export async function providerDashboard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(res, await hotelService.getProviderHotelDashboard(providerId(req)));
  } catch (error) {
    next(error);
  }
}

export async function lookupBooking(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await hotelService.lookupBookingByCode(String(req.query.code ?? ''), providerId(req))
    );
  } catch (error) {
    next(error);
  }
}

export async function checkIn(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await hotelService.providerCheckIn(paramId(req.params.bookingId), providerId(req)),
      'Guest checked in'
    );
  } catch (error) {
    next(error);
  }
}

export async function checkOut(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return sendSuccess(
      res,
      await hotelService.providerCheckOut(paramId(req.params.bookingId), providerId(req)),
      'Guest checked out'
    );
  } catch (error) {
    next(error);
  }
}
