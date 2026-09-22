export class AppError extends Error {
  statusCode: number;
  errors: unknown[];
  isOperational: boolean;

  constructor(message: string, statusCode = 400, errors: unknown[] = []) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.errors = errors;
    this.isOperational = true;
  }
}

export function assertFound<T>(value: T, message = 'Resource not found'): NonNullable<T> {
  if (value == null) {
    throw new AppError(message, 404);
  }
  return value as NonNullable<T>;
}
