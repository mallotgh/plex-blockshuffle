import type { DB } from '../db.js';
import { PlexClient } from '../plex/client.js';
import { z } from 'zod';
import { ApiError } from '../errors.js';

/**
 * Sortiert die Original-Playlist auf dem Plex-Server in die gewürfelte
 * Reihenfolge um — nicht-destruktiv über einzelne Move-Aufrufe
 * (PUT /playlists/{id}/items/{itemId}/move?after=…). Kein Löschen, kein
 * Neubefüllen: Bricht etwas ab, ist die Playlist nur teilweise umsortiert,
 * aber nie beschädigt.
 */

const itemsWithIdsSchema = z.object({
  MediaContainer: z.object({
    size: z.number().optional(),
    totalSize: z.number().optional(),
    Metadata: z
      .array(
        z.object({
          ratingKey: z.string(),
          playlistItemID: z.number(),
        }),
      )
      .default([]),
  }),
});

export function openUrlFor(machineId: string, playlistId: string): string {
  return `https://app.plex.tv/desktop/#!/server/${machineId}/playlist?key=${encodeURIComponent(`/playlists/${playlistId}`)}`;
}

export interface ReorderResult {
  moves: number;
  /** Zielpositionen, die mangels vorhandenem Playlist-Eintrag entfielen (z. B. Track in mehreren Blöcken). */
  skippedDuplicates: number;
}

export async function applyShuffleOrder(
  db: DB,
  plex: PlexClient,
  args: { playlistId: string; order: string[] },
): Promise<ReorderResult> {
  // Aktuelle Einträge mit ihren playlistItemIDs holen (Moves adressieren IDs, nicht Tracks)
  const entries: { ratingKey: string; playlistItemID: number }[] = [];
  let start = 0;
  for (;;) {
    const page = await plex.requestParsed(itemsWithIdsSchema, `/playlists/${args.playlistId}/items`, {
      query: { 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': 200 },
    });
    entries.push(...page.MediaContainer.Metadata);
    const got = page.MediaContainer.Metadata.length;
    const total = page.MediaContainer.totalSize ?? page.MediaContainer.size ?? got;
    start += got;
    if (got === 0 || start >= total) break;
  }

  // Zielreihenfolge in playlistItemIDs übersetzen; jedes vorhandene Exemplar
  // wird genau einmal vergeben. Zielpositionen ohne freies Exemplar (Track in
  // mehreren Blöcken, aber nur einmal in der Playlist) entfallen.
  const pool = new Map<string, number[]>();
  for (const e of entries) {
    const list = pool.get(e.ratingKey) ?? [];
    list.push(e.playlistItemID);
    pool.set(e.ratingKey, list);
  }
  const targetIds: number[] = [];
  let skippedDuplicates = 0;
  for (const ratingKey of args.order) {
    const ids = pool.get(ratingKey);
    if (ids && ids.length > 0) targetIds.push(ids.shift()!);
    else skippedDuplicates++;
  }

  // Moves anwenden; eine mitgeführte Simulation überspringt schon korrekte Positionen.
  const current = entries.map((e) => e.playlistItemID);
  let moves = 0;
  for (let k = 0; k < targetIds.length; k++) {
    const id = targetIds[k]!;
    if (current[k] === id) continue;
    await plex.request(`/playlists/${args.playlistId}/items/${id}/move`, {
      method: 'PUT',
      query: k === 0 ? {} : { after: targetIds[k - 1]! },
    });
    const from = current.indexOf(id);
    current.splice(from, 1);
    current.splice(k, 0, id);
    moves++;
  }

  // Altlasten aus der Shadow-Playlist-Ära aufräumen (einmalig pro Playlist)
  const shadow = db
    .prepare('SELECT shadow_playlist_id FROM shadow_playlists WHERE user_id = ? AND playlist_id = ?')
    .get(plex.userId, args.playlistId) as { shadow_playlist_id: string } | undefined;
  if (shadow) {
    try {
      await plex.request(`/playlists/${shadow.shadow_playlist_id}`, { method: 'DELETE' });
    } catch {
      // schon gelöscht oder nicht erreichbar — Aufräumen ist best effort
    }
    db.prepare('DELETE FROM shadow_playlists WHERE user_id = ? AND playlist_id = ?').run(
      plex.userId,
      args.playlistId,
    );
  }

  return { moves, skippedDuplicates };
}

export function assertReorderable(playlist: { smart: number; name: string }): void {
  if (playlist.smart === 1) {
    throw new ApiError(
      409,
      'smart_not_reorderable',
      `„${playlist.name}" ist eine Smart-Playlist — Plex erzeugt ihre Reihenfolge aus einem Filter, umsortieren ist nicht möglich. Lege in Plex eine normale Playlist mit diesen Tracks an.`,
    );
  }
}
