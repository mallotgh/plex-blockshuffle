import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { DB } from '../db.js';
import { BLOCK_COLORS } from './blocks.js';
import { z } from 'zod';

const KEEP_BACKUPS = 14;

function todayStamp(): string {
  // sv-SE liefert ISO-Format YYYY-MM-DD
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
}

/** Tägliches bzw. Start-Backup per VACUUM INTO; behält die letzten 14 Dateien. */
export function runBackup(db: DB, dataDir: string): string {
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `plex-blockshuffle-${todayStamp()}.sqlite`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);

  const files = fs
    .readdirSync(dir)
    .filter((f) => /^plex-blockshuffle-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f))
    .sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP_BACKUPS))) {
    fs.unlinkSync(path.join(dir, f));
  }
  return file;
}

export function scheduleBackups(db: DB, dataDir: string, log: { info: (m: string) => void; warn: (m: string) => void }): void {
  const attempt = () => {
    try {
      const file = runBackup(db, dataDir);
      log.info(`Backup geschrieben: ${file}`);
    } catch (err) {
      log.warn(`Backup fehlgeschlagen: ${(err as Error).message}`);
    }
  };
  attempt();
  setInterval(attempt, 24 * 60 * 60 * 1000).unref();
}

/** Menschenlesbares Exportformat für alle Blockdefinitionen. */
export const blockExportSchema = z.object({
  format: z.literal('plex-blockshuffle-blocks'),
  version: z.literal(1),
  exportedAt: z.string().optional(),
  playlists: z.array(
    z.object({
      playlistId: z.string(),
      playlistName: z.string().optional(),
      blocks: z.array(
        z.object({
          name: z.string(),
          color: z.string().optional(),
          trackIds: z.array(z.string()).min(1),
        }),
      ),
    }),
  ),
});

export type BlockExport = z.infer<typeof blockExportSchema>;

export function exportBlocks(db: DB, userId: string): BlockExport {
  const playlists = db
    .prepare(
      `SELECT DISTINCT p.id, p.name FROM playlists p
       JOIN blocks b ON b.user_id = p.user_id AND b.playlist_id = p.id
       WHERE p.user_id = ? ORDER BY p.name COLLATE NOCASE`,
    )
    .all(userId) as { id: string; name: string }[];
  return {
    format: 'plex-blockshuffle-blocks',
    version: 1,
    exportedAt: new Date().toISOString(),
    playlists: playlists.map((p) => ({
      playlistId: p.id,
      playlistName: p.name,
      blocks: (
        db
          .prepare('SELECT id, name, color FROM blocks WHERE user_id = ? AND playlist_id = ? ORDER BY created_at, id')
          .all(userId, p.id) as {
          id: string;
          name: string;
          color: string;
        }[]
      ).map((b) => ({
        name: b.name,
        color: b.color,
        trackIds: (
          db.prepare('SELECT track_id FROM block_items WHERE block_id = ? ORDER BY position').all(b.id) as {
            track_id: string;
          }[]
        ).map((r) => r.track_id),
      })),
    })),
  };
}

export interface ImportResult {
  imported: number;
  skipped: { playlist: string; block: string; reason: string }[];
}

/** Additiver Import: bestehende Blöcke bleiben, Duplikate und Unbekanntes werden gemeldet. */
export function importBlocks(db: DB, userId: string, data: BlockExport): ImportResult {
  const result: ImportResult = { imported: 0, skipped: [] };

  db.transaction(() => {
    for (const pl of data.playlists) {
      const label = pl.playlistName ?? pl.playlistId;
      const exists = db.prepare('SELECT 1 FROM playlists WHERE user_id = ? AND id = ?').get(userId, pl.playlistId);
      if (!exists) {
        for (const b of pl.blocks) {
          result.skipped.push({
            playlist: label,
            block: b.name,
            reason: 'Playlist unbekannt — zuerst die Playlist-Liste aktualisieren und die Playlist einmal öffnen',
          });
        }
        continue;
      }
      const existingSequences = new Set(
        (
          db.prepare('SELECT id FROM blocks WHERE user_id = ? AND playlist_id = ?').all(userId, pl.playlistId) as {
            id: string;
          }[]
        ).map((b) =>
          JSON.stringify(
            (
              db.prepare('SELECT track_id FROM block_items WHERE block_id = ? ORDER BY position').all(b.id) as {
                track_id: string;
              }[]
            ).map((r) => r.track_id),
          ),
        ),
      );
      for (const b of pl.blocks) {
        if (b.trackIds.length < 2) {
          result.skipped.push({ playlist: label, block: b.name, reason: 'weniger als 2 Tracks' });
          continue;
        }
        const key = JSON.stringify(b.trackIds);
        if (existingSequences.has(key)) {
          result.skipped.push({ playlist: label, block: b.name, reason: 'identischer Block existiert bereits' });
          continue;
        }
        const id = crypto.randomUUID();
        db.prepare(
          'INSERT INTO blocks (id, user_id, playlist_id, name, color, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(
          id,
          userId,
          pl.playlistId,
          b.name,
          b.color ?? BLOCK_COLORS[result.imported % BLOCK_COLORS.length]!,
          Date.now(),
        );
        const insert = db.prepare('INSERT INTO block_items (block_id, track_id, position) VALUES (?, ?, ?)');
        b.trackIds.forEach((t, i) => insert.run(id, t, i));
        existingSequences.add(key);
        result.imported++;
      }
    }
  })();

  return result;
}
