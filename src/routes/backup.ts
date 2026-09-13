import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../server.js';
import { exportBlocks, importBlocks, blockExportSchema } from '../services/backup.js';
import { ApiError } from '../errors.js';
import { requireUser } from '../auth/session.js';

export function registerBackupRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/export/blocks', async (req, reply) => {
    const { userId } = requireUser(req, ctx);
    const data = exportBlocks(ctx.db, userId);
    reply
      .header(
        'Content-Disposition',
        `attachment; filename="plex-blockshuffle-bloecke-${new Date().toISOString().slice(0, 10)}.json"`,
      )
      .type('application/json; charset=utf-8');
    return data;
  });

  app.post('/api/import/blocks', async (req) => {
    const { userId } = requireUser(req, ctx);
    const parsed = blockExportSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(
        400,
        'invalid_import',
        'Die Datei ist kein gültiger Blockshuffle-Export (Format "blockshuffle-blocks", Version 1).',
        parsed.error.issues.slice(0, 5),
      );
    }
    return importBlocks(ctx.db, userId, parsed.data);
  });
}
