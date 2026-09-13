import type { DB } from '../db.js';
import { PlexClient } from '../plex/client.js';
import {
  playlistsResponseSchema,
  playlistDetailResponseSchema,
  playlistItemsResponseSchema,
  type PlexTrack,
} from '../plex/schemas.js';

const PAGE_SIZE = 200;

export interface PlaylistRow {
  user_id: string;
  id: string;
  name: string;
  smart: number;
  updated_at: string | null;
  track_total: number;
  stale: number;
  last_synced_at: number | null;
}

/** Lädt alle Audio-Playlists des Nutzers vom Plex-Server und persistiert sie. */
export async function syncPlaylists(db: DB, plex: PlexClient): Promise<void> {
  const userId = plex.userId;
  const res = await plex.requestParsed(playlistsResponseSchema, '/playlists', {
    query: { playlistType: 'audio' },
  });
  const upsert = db.prepare(
    `INSERT INTO playlists (user_id, id, name, smart, updated_at, track_total, stale)
     VALUES (@user_id, @id, @name, @smart, @updated_at, @track_total, 0)
     ON CONFLICT(user_id, id) DO UPDATE SET
       name = @name, smart = @smart, updated_at = @updated_at, track_total = @track_total, stale = 0`,
  );
  const seen: string[] = [];
  db.transaction(() => {
    for (const pl of res.MediaContainer.Metadata) {
      seen.push(pl.ratingKey);
      upsert.run({
        user_id: userId,
        id: pl.ratingKey,
        name: pl.title,
        smart: pl.smart ? 1 : 0,
        updated_at: pl.updatedAt != null ? String(pl.updatedAt) : null,
        track_total: pl.leafCount ?? 0,
      });
    }
  })();
  // Nicht mehr vorhandene Playlists nur markieren — Blöcke bleiben erhalten.
  if (seen.length > 0) {
    db.prepare(
      `UPDATE playlists SET stale = 1 WHERE user_id = ? AND id NOT IN (${seen.map(() => '?').join(',')})`,
    ).run(userId, ...seen);
  } else {
    db.prepare('UPDATE playlists SET stale = 1 WHERE user_id = ?').run(userId);
  }
}

export interface SyncItemsResult {
  synced: boolean;
}

/**
 * Synchronisiert die Trackliste einer Playlist. Änderungserkennung über das
 * updatedAt-Feld der Playlist; unverändert -> kein erneuter Volllauf.
 */
export async function syncPlaylistItems(
  db: DB,
  plex: PlexClient,
  playlistId: string,
  opts: { force?: boolean } = {},
): Promise<SyncItemsResult> {
  const userId = plex.userId;
  const existing = db
    .prepare('SELECT * FROM playlists WHERE user_id = ? AND id = ?')
    .get(userId, playlistId) as PlaylistRow | undefined;

  const detail = await plex.requestParsed(playlistDetailResponseSchema, `/playlists/${playlistId}`);
  const meta = detail.MediaContainer.Metadata[0]!;
  const updatedAt = meta.updatedAt != null ? String(meta.updatedAt) : null;

  const hasItems =
    (
      db
        .prepare('SELECT COUNT(*) AS n FROM playlist_items WHERE user_id = ? AND playlist_id = ?')
        .get(userId, playlistId) as { n: number }
    ).n > 0;
  const unchanged =
    !opts.force &&
    existing?.last_synced_at != null &&
    existing.updated_at != null &&
    updatedAt != null &&
    existing.updated_at === updatedAt &&
    hasItems;

  db.prepare(
    `INSERT INTO playlists (user_id, id, name, smart, stale)
     VALUES (@user_id, @id, @name, @smart, 0)
     ON CONFLICT(user_id, id) DO UPDATE SET name = @name, smart = @smart, stale = 0`,
  ).run({ user_id: userId, id: meta.ratingKey, name: meta.title, smart: meta.smart ? 1 : 0 });

  if (unchanged) return { synced: false };

  const entries = await fetchAllItems(plex, playlistId);

  db.transaction(() => {
    const upsertTrack = db.prepare(
      `INSERT INTO tracks (id, name, artists_json, album_name, duration_ms)
       VALUES (@id, @name, @artists_json, @album_name, @duration_ms)
       ON CONFLICT(id) DO UPDATE SET
         name = @name, artists_json = @artists_json, album_name = @album_name, duration_ms = @duration_ms`,
    );
    const insertItem = db.prepare(
      'INSERT INTO playlist_items (user_id, playlist_id, position, track_id) VALUES (?, ?, ?, ?)',
    );
    db.prepare('DELETE FROM playlist_items WHERE user_id = ? AND playlist_id = ?').run(userId, playlistId);
    let position = 0;
    for (const track of entries) {
      const artist = track.originalTitle || track.grandparentTitle || 'Unbekannt';
      upsertTrack.run({
        id: track.ratingKey,
        name: track.title,
        artists_json: JSON.stringify([artist]),
        album_name: track.parentTitle ?? null,
        duration_ms: track.duration ?? 0,
      });
      insertItem.run(userId, playlistId, position, track.ratingKey);
      position++;
    }
    db.prepare(
      'UPDATE playlists SET updated_at = ?, track_total = ?, last_synced_at = ? WHERE user_id = ? AND id = ?',
    ).run(updatedAt, position, Date.now(), userId, playlistId);
  })();

  return { synced: true };
}

async function fetchAllItems(plex: PlexClient, playlistId: string): Promise<PlexTrack[]> {
  const result: PlexTrack[] = [];
  let start = 0;
  for (;;) {
    const page = await plex.requestParsed(playlistItemsResponseSchema, `/playlists/${playlistId}/items`, {
      query: { 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': PAGE_SIZE },
    });
    const items = page.MediaContainer.Metadata.filter((t) => !t.type || t.type === 'track');
    result.push(...items);
    const got = page.MediaContainer.Metadata.length;
    const total = page.MediaContainer.totalSize ?? page.MediaContainer.size ?? got;
    start += got;
    if (got === 0 || start >= total) break;
  }
  return result;
}
