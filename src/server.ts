import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import type { AppContext } from './auth/session.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPlaylistRoutes } from './routes/playlists.js';
import { registerBlockRoutes } from './routes/blocks.js';
import { registerShuffleRoutes } from './routes/shuffle.js';
import { registerBackupRoutes } from './routes/backup.js';
import { ApiError } from './errors.js';

export type { AppContext };

export function buildServer(ctx: AppContext): FastifyInstance {
  const app = Fastify({
    // Hinter Tailscale Serve / Reverse Proxy: Protokoll und Host aus den
    // X-Forwarded-Headern lesen.
    trustProxy: true,
    logger: {
      level: 'info',
      redact: ['req.headers.authorization'],
    },
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ApiError) {
      reply.status(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
      return;
    }
    if (err instanceof ZodError) {
      reply.status(400).send({ error: 'bad_request', message: 'Ungültige Anfrage.', details: err.issues });
      return;
    }
    if (typeof err === 'object' && err !== null && 'validation' in err) {
      reply.status(400).send({ error: 'bad_request', message: 'Ungültige Anfrage.' });
      return;
    }
    req.log.error(err);
    reply.status(500).send({ error: 'internal', message: 'Interner Fehler. Details im Server-Log.' });
  });

  app.register(fastifyCookie);
  // Grundschutz für den öffentlichen Betrieb; Auth-Routen haben engere Limits.
  app.register(fastifyRateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: 'rate_limited',
      message: 'Zu viele Anfragen — bitte kurz warten.',
    }),
  });

  app.get('/api/health', async () => ({ status: 'ok' }));

  registerAuthRoutes(app, ctx);
  registerPlaylistRoutes(app, ctx);
  registerBlockRoutes(app, ctx);
  registerShuffleRoutes(app, ctx);
  registerBackupRoutes(app, ctx);

  if (fs.existsSync(ctx.staticDir)) {
    app.register(fastifyStatic, { root: ctx.staticDir });
    // SPA-Fallback: alles außer /api und /callback bekommt die index.html
    app.setNotFoundHandler((req, reply) => {
      // Fehlende Assets (z. B. alte Bundle-Hashes) dürfen kein HTML mit 200 bekommen
      if (
        req.raw.url?.startsWith('/api/') ||
        req.raw.url?.startsWith('/callback') ||
        req.raw.url?.startsWith('/assets/')
      ) {
        reply.status(404).send({ error: 'not_found', message: 'Nicht gefunden.' });
        return;
      }
      reply.sendFile('index.html');
    });
  }

  return app;
}
