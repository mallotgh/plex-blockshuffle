import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../server.js';
import {
  createBlock,
  updateBlock,
  setBlockItems,
  addTrackToBlock,
  removeTrackFromBlock,
  deleteBlock,
  getBlock,
} from '../services/blocks.js';
import { playlistDetail, requirePlaylist } from './playlists.js';
import { requireUser } from '../auth/session.js';

export function registerBlockRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/playlists/:id/blocks', async (req, reply) => {
    const { userId } = requireUser(req, ctx);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        trackIds: z.array(z.string()).min(2),
        name: z.string().optional(),
        color: z.string().optional(),
      })
      .parse(req.body);
    requirePlaylist(ctx.db, userId, id);
    createBlock(ctx.db, userId, id, body.trackIds, body);
    reply.status(201);
    return { detail: playlistDetail(ctx.db, userId, id) };
  });

  app.patch('/api/blocks/:blockId', async (req) => {
    const { userId } = requireUser(req, ctx);
    const { blockId } = z.object({ blockId: z.string() }).parse(req.params);
    const body = z.object({ name: z.string().optional(), color: z.string().optional() }).parse(req.body);
    const block = updateBlock(ctx.db, userId, blockId, body);
    return { detail: playlistDetail(ctx.db, userId, block.playlist_id) };
  });

  app.put('/api/blocks/:blockId/items', async (req) => {
    const { userId } = requireUser(req, ctx);
    const { blockId } = z.object({ blockId: z.string() }).parse(req.params);
    const body = z.object({ trackIds: z.array(z.string()).min(2) }).parse(req.body);
    const block = setBlockItems(ctx.db, userId, blockId, body.trackIds);
    return { detail: playlistDetail(ctx.db, userId, block.playlist_id) };
  });

  app.post('/api/blocks/:blockId/items', async (req) => {
    const { userId } = requireUser(req, ctx);
    const { blockId } = z.object({ blockId: z.string() }).parse(req.params);
    const body = z.object({ trackId: z.string() }).parse(req.body);
    const block = addTrackToBlock(ctx.db, userId, blockId, body.trackId);
    return { detail: playlistDetail(ctx.db, userId, block.playlist_id) };
  });

  app.delete('/api/blocks/:blockId/items/:trackId', async (req) => {
    const { userId } = requireUser(req, ctx);
    const params = z.object({ blockId: z.string(), trackId: z.string() }).parse(req.params);
    const playlistId = getBlock(ctx.db, userId, params.blockId).playlist_id;
    const result = removeTrackFromBlock(ctx.db, userId, params.blockId, params.trackId);
    return { ...result, detail: playlistDetail(ctx.db, userId, playlistId) };
  });

  app.delete('/api/blocks/:blockId', async (req) => {
    const { userId } = requireUser(req, ctx);
    const { blockId } = z.object({ blockId: z.string() }).parse(req.params);
    const playlistId = getBlock(ctx.db, userId, blockId).playlist_id;
    deleteBlock(ctx.db, userId, blockId);
    return { ok: true, detail: playlistDetail(ctx.db, userId, playlistId) };
  });
}
