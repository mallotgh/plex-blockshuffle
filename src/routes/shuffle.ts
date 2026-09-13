import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../server.js';
import type { DB } from '../db.js';
import { blockShuffle, type ShuffleUnit } from '../shuffle/engine.js';
import { generateSeed } from '../shuffle/rng.js';
import { syncPlaylistItems } from '../services/sync.js';
import { getBlocks } from '../services/blocks.js';
import { applyShuffleOrder, assertReorderable, openUrlFor } from '../services/reorder.js';
import { requirePlaylist, getTrackMap } from './playlists.js';
import { requireUser } from '../auth/session.js';
import { ApiError } from '../errors.js';

export interface ShuffleRunRow {
  id: string;
  user_id: string;
  playlist_id: string;
  seed: string;
  order_json: string;
  created_at: number;
}

export function latestRun(db: DB, userId: string, playlistId: string): ShuffleRunRow | undefined {
  return db
    .prepare(
      'SELECT * FROM shuffle_runs WHERE user_id = ? AND playlist_id = ? ORDER BY created_at DESC, id LIMIT 1',
    )
    .get(userId, playlistId) as ShuffleRunRow | undefined;
}

function runDto(db: DB, run: ShuffleRunRow, machineId: string | null) {
  const units = JSON.parse(run.order_json) as ShuffleUnit[];
  const trackMap = getTrackMap(db, units.flatMap((u) => u.trackIds));
  return {
    runId: run.id,
    playlistId: run.playlist_id,
    seed: run.seed,
    createdAt: run.created_at,
    openUrl: machineId ? openUrlFor(machineId, run.playlist_id) : null,
    blockCount: units.filter((u) => u.blockId !== null).length,
    trackCount: units.reduce((n, u) => n + u.trackIds.length, 0),
    units: units.map((u) => ({
      blockId: u.blockId,
      blockName: u.blockName,
      tracks: u.trackIds.map((id) => ({ trackId: id, track: trackMap.get(id) ?? null })),
    })),
  };
}

export function registerShuffleRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Würfelt neu, speichert den Lauf und schreibt die Shadow-Playlist auf den Plex-Server. */
  app.post('/api/playlists/:id/shuffle', async (req, reply) => {
    const { userId, user, plex } = requireUser(req, ctx);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ seed: z.string().trim().min(1).optional() }).parse(req.body ?? {});

    await syncPlaylistItems(ctx.db, plex, id);
    const playlist = requirePlaylist(ctx.db, userId, id);
    assertReorderable(playlist);
    const playlistOrder = (
      ctx.db
        .prepare('SELECT track_id FROM playlist_items WHERE user_id = ? AND playlist_id = ? ORDER BY position')
        .all(userId, id) as { track_id: string }[]
    ).map((r) => r.track_id);
    if (playlistOrder.length === 0) {
      throw new ApiError(409, 'playlist_empty', 'Die Playlist enthält keine Tracks.');
    }

    const blocks = getBlocks(ctx.db, userId, id).map((b) => ({
      id: b.id,
      name: b.name,
      trackIds: b.items.map((i) => i.trackId),
    }));

    const seed = body.seed ?? generateSeed();
    const result = blockShuffle({ playlistOrder, blocks }, seed);

    const run: ShuffleRunRow = {
      id: crypto.randomUUID(),
      user_id: userId,
      playlist_id: id,
      seed,
      order_json: JSON.stringify(result.units),
      created_at: Date.now(),
    };
    ctx.db
      .prepare(
        'INSERT INTO shuffle_runs (id, user_id, playlist_id, seed, order_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(run.id, run.user_id, run.playlist_id, run.seed, run.order_json, run.created_at);

    // Kein Shadow: die Original-Playlist wird direkt in die gewürfelte
    // Reihenfolge gebracht.
    const reorder = await applyShuffleOrder(ctx.db, plex, { playlistId: id, order: result.order });
    // Das Umsortieren ändert updatedAt auf dem Server — Stand übernehmen,
    // damit der nächste Sync nicht unnötig volläuft, aber die neue
    // Reihenfolge lokal ankommt.
    await syncPlaylistItems(ctx.db, plex, id, { force: true });

    reply.status(201);
    return {
      ...runDto(ctx.db, run, user.server_machine_id),
      skippedOrphans: result.skippedOrphans,
      moves: reorder.moves,
      skippedDuplicates: reorder.skippedDuplicates,
    };
  });

  /** Letzter Lauf einer Playlist (z. B. um die Vorschau wieder zu öffnen). */
  app.get('/api/playlists/:id/shuffle/latest', async (req) => {
    const { userId, user } = requireUser(req, ctx);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const run = latestRun(ctx.db, userId, id);
    if (!run) return { run: null };
    return { run: runDto(ctx.db, run, user.server_machine_id) };
  });
}
