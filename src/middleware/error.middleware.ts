import { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import { sendError } from '../utils/apiResponse';

export function notFoundHandler(_req: Request, res: Response) {
  return sendError(res, 'Route not found', 404);
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return sendError(res, err.message, err.statusCode, err.errors);
  }

  const anyErr = err as { name?: string; code?: number; message?: string };
  if (anyErr?.name === 'ValidationError') {
    return sendError(res, 'Validation error', 422, [anyErr.message]);
  }
  if (anyErr?.name === 'CastError') {
    return sendError(res, 'Invalid identifier', 400);
  }
  if (anyErr?.code === 11000) {
    return sendError(res, 'Duplicate value already exists', 409);
  }
  if (anyErr?.name === 'JsonWebTokenError' || anyErr?.name === 'TokenExpiredError') {
    return sendError(res, 'Invalid or expired token', 401);
  }

  console.error(err);
  return sendError(res, 'Internal server error', 500);
}
