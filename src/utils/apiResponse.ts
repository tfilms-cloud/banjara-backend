import { Response } from 'express';

export function sendSuccess<T>(
  res: Response,
  data: T,
  message = 'Request successful',
  statusCode = 200
) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

export function sendError(
  res: Response,
  message: string,
  statusCode = 400,
  errors: unknown[] = []
) {
  return res.status(statusCode).json({
    success: false,
    message,
    errors,
  });
}
