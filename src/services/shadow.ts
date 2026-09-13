import type { DB } from '../db.js';
import { PlexClient, PlexApiError } from '../plex/client.js';
import { playlistDetailResponseSchema } from '../plex/schemas.js';
import { ApiError } from '../errors.js';

/** Schlüssel pro Request begrenzen, damit die URL-Länge unkritisch bleibt. */
const CHUNK_SIZE = 200;

function metadataUri(machineId: string, keys: string[]): string {
  return `server://${machineId}/com.plexapp.plugins.library/library/metadata/${keys.join(',')}`;
}

export interface ShadowResult {
  shadowPlaylistId: string;
  openUrl: string;
}

export function openUrlFor(machineId: string, shadowId: string): string {
  return `https://app.plex.tv/desktop/#!/server/${machineId}/playlist?key=${encodeURIComponent(`/playlists/${shadowId}`)}`;
}

/**
 * Der Standardweg ohne Player-Steuerung: Shadow-Playlist auf dem Plex-Server
 * anlegen/leeren, die gewürfelte Reihenfolge hineinschreiben und die
 * Beschreibung mit Blockzahl, Seed und Zeitstempel versehen.
 */
export async function writeShadowPlaylist(
  db: DB,
  plex: PlexClient,
  args: {
    playlistId: string;
    playlistName: string;
    trackIds: string[];
    blockCount: number;
    seed: string;
  },
): Promise<ShadowResult> {
  const auth = plex.getAuth();
  const machineId = auth?.server_machine_id;
  if (!machineId) throw new ApiError(409, 'no_server', 'Kein Plex-Server verbunden.');
  const userId = plex.userId;
  const title = `🔀 ${args.playlistName} (Blockshuffle)`;

  let shadowId = (
    db
      .prepare('SELECT shadow_playlist_id FROM shadow_playlists WHERE user_id = ? AND playlist_id = ?')
      .get(userId, args.playlistId) as { shadow_playlist_id: string } | undefined
  )?.shadow_playlist_id;

  // Bestehende Shadow-Playlist prüfen und leeren; ist sie weg oder lässt sie
  // sich nicht leeren, wird frisch angelegt.
  if (shadowId) {
    try {
      await plex.request(`/playlists/${shadowId}`);
      await plex.request(`/playlists/${shadowId}/items`, { method: 'DELETE' });
    } catch (err) {
      if (err instanceof PlexApiError) {
        try {
          await plex.request(`/playlists/${shadowId}`, { method: 'DELETE' });
        } catch {
          /* schon weg */
        }
        shadowId = undefined;
      } else {
        throw err;
      }
    }
  }

  const chunks: string[][] = [];
  for (let i = 0; i < args.trackIds.length; i += CHUNK_SIZE) {
    chunks.push(args.trackIds.slice(i, i + CHUNK_SIZE));
  }

  let rest = chunks;
  if (!shadowId) {
    const created = await plex.requestParsed(playlistDetailResponseSchema, '/playlists', {
      method: 'POST',
      query: { type: 'audio', title, smart: 0, uri: metadataUri(machineId, chunks[0]!) },
    });
    shadowId = created.MediaContainer.Metadata[0]!.ratingKey;
    rest = chunks.slice(1);
  }
  for (const chunk of rest) {
    await plex.request(`/playlists/${shadowId}/items`, {
      method: 'PUT',
      query: { uri: metadataUri(machineId, chunk) },
    });
  }

  const stamp = new Date().toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  try {
    await plex.request(`/playlists/${shadowId}`, {
      method: 'PUT',
      query: { title, summary: `Blockshuffle · ${args.blockCount} Blöcke · Seed ${args.seed} · ${stamp}` },
    });
  } catch {
    // Beschreibung ist Komfort — ein Fehler hier darf das Würfeln nicht scheitern lassen.
  }

  db.prepare(
    `INSERT INTO shadow_playlists (user_id, playlist_id, shadow_playlist_id) VALUES (?, ?, ?)
     ON CONFLICT(user_id, playlist_id) DO UPDATE SET shadow_playlist_id = excluded.shadow_playlist_id`,
  ).run(userId, args.playlistId, shadowId);

  return { shadowPlaylistId: shadowId, openUrl: openUrlFor(machineId, shadowId) };
}
