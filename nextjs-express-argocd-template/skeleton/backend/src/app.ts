import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { healthRouter } from './routes/health';
import { itemsRouter } from './routes/items';

/**
 * Builds the Express application.
 *
 * The API lives under `/api`. The JSON body parser and the request logger are
 * scoped to that prefix so they cannot interfere with unrelated middleware.
 */
export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use('/api', express.json({ limit: '1mb' }));

  if (process.env.NODE_ENV !== 'test') {
    app.use('/api', (req, res, next) => {
      const startedAt = Date.now();
      res.on('finish', () => {
        console.log(
          `[api] ${req.method} ${req.originalUrl} ${res.statusCode} ${
            Date.now() - startedAt
          }ms`,
        );
      });
      next();
    });
  }

  app.use('/api', healthRouter);
  app.use('/api/items', itemsRouter);

  // Unknown API routes must return JSON.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // Convert errors raised by API handlers (for example malformed JSON) into
  // JSON responses as well.
  app.use(
    '/api',
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (res.headersSent) {
        return;
      }

      // body-parser rejects malformed JSON with status 400; everything else is
      // an unexpected server error.
      const status =
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        typeof (error as { status?: unknown }).status === 'number'
          ? (error as { status: number }).status
          : 500;

      if (status >= 500) {
        console.error('[api] unhandled error', error);
      }

      res.status(status).json({
        error: status === 400 ? 'Invalid JSON body' : 'Internal Server Error',
      });
    },
  );

  return app;
}
