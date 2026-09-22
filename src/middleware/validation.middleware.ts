import { NextFunction, Request, Response } from 'express';
import { ZodError, ZodTypeAny } from 'zod';
import { AppError } from '../utils/AppError';

export function validate(schema: ZodTypeAny, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse(req[source]);

      if (source === 'body') {
        req.body = parsed;
      } else if (source === 'params') {
        Object.assign(req.params, parsed);
      } else {
        // Express 5 makes req.query a read-only getter — redefine it with parsed values.
        Object.defineProperty(req, 'query', {
          value: parsed,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return next(
          new AppError(
            'Validation failed',
            422,
            error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            }))
          )
        );
      }
      next(error);
    }
  };
}
