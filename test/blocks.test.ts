import { describe, it, expect, beforeEach } from 'vitest';
import { openMemoryDb, type DB } from '../src/db.js';
import {
  createBlock,
  setBlockItems,
  addTrackToBlock,
  removeTrackFromBlock,
  deleteBlock,
  getBlocks,
  updateBlock,
} from '../src/services/blocks.js';
import { ApiError } from '../src/errors.js';

const PL = 'pl1';
const U = 'user-a';
const OTHER = 'user-b';

function seedPlaylist(db: DB, trackIds: string[], userId = U): void {
  db.prepare(
    "INSERT OR IGNORE INTO users (id, created_at, last_login_at) VALUES (?, 0, 0)",
  ).run(userId);
  db.prepare(
    "INSERT INTO playlists (user_id, id, name, track_total) VALUES (?, ?, 'Test', ?)",
  ).run(userId, PL, trackIds.length);
  const insTrack = db.prepare(
    "INSERT OR IGNORE INTO tracks (id, name, artists_json, duration_ms) VALUES (?, ?, '[]', 1000)",
  );
  const insItem = db.prepare(
    'INSERT INTO playlist_items (user_id, playlist_id, position, track_id) VALUES (?, ?, ?, ?)',
  );
  trackIds.forEach((t, i) => {
    insTrack.run(t, `Track ${t}`);
    insItem.run(userId, PL, i, t);
  });
}

describe('Blockverwaltung', () => {
  let db: DB;

  beforeEach(() => {
    db = openMemoryDb();
    seedPlaylist(db, ['t0', 't1', 't2', 't3', 't4', 't5']);
  });

  it('erstellt einen Block mit Playlist-Reihenfolge als Initialreihenfolge', () => {
    const block = createBlock(db, U, PL, ['t3', 't1']);
    expect(block.items.map((i) => i.trackId)).toEqual(['t1', 't3']);
    expect(block.name).toBe('Track t1');
    expect(block.color).toBeTruthy();
  });

  it('lehnt Blöcke mit weniger als 2 Tracks ab', () => {
    expect(() => createBlock(db, U, PL, ['t1'])).toThrowError(ApiError);
  });

  it('lehnt Tracks ab, die nicht in der Playlist sind', () => {
    expect(() => createBlock(db, U, PL, ['t1', 'fremd'])).toThrowError(/nicht zu dieser Playlist/);
  });

  it('erlaubt, dass ein Track zu mehreren Blöcken gehört', () => {
    const b1 = createBlock(db, U, PL, ['t0', 't1']);
    const b2 = createBlock(db, U, PL, ['t1', 't2']);
    const blocks = getBlocks(db, U, PL);
    expect(blocks).toHaveLength(2);
    expect(blocks.find((b) => b.id === b1.id)!.items.map((i) => i.trackId)).toEqual(['t0', 't1']);
    expect(blocks.find((b) => b.id === b2.id)!.items.map((i) => i.trackId)).toEqual(['t1', 't2']);
  });

  it('löst einen Block automatisch auf, wenn er auf einen Track schrumpft', () => {
    const block = createBlock(db, U, PL, ['t0', 't1']);
    const result = removeTrackFromBlock(db, U, block.id, 't0');
    expect(result.dissolved).toBe(true);
    expect(getBlocks(db, U, PL)).toHaveLength(0);
  });

  it('hält Positionen nach Entfernen lückenlos ab 0', () => {
    const block = createBlock(db, U, PL, ['t0', 't1', 't2', 't3']);
    removeTrackFromBlock(db, U, block.id, 't1');
    const items = getBlocks(db, U, PL)[0]!.items;
    expect(items.map((i) => i.position)).toEqual([0, 1, 2]);
    expect(items.map((i) => i.trackId)).toEqual(['t0', 't2', 't3']);
  });

  it('setBlockItems ändert die Reihenfolge dauerhaft', () => {
    const block = createBlock(db, U, PL, ['t0', 't1', 't2']);
    setBlockItems(db, U, block.id, ['t2', 't0', 't1']);
    expect(getBlocks(db, U, PL)[0]!.items.map((i) => i.trackId)).toEqual(['t2', 't0', 't1']);
  });

  it('addTrackToBlock hängt hinten an, auch wenn der Track schon in einem anderen Block ist', () => {
    const b1 = createBlock(db, U, PL, ['t0', 't1']);
    createBlock(db, U, PL, ['t4', 't5']);
    addTrackToBlock(db, U, b1.id, 't2');
    addTrackToBlock(db, U, b1.id, 't4');
    expect(getBlocks(db, U, PL).find((b) => b.id === b1.id)!.items.map((i) => i.trackId)).toEqual([
      't0',
      't1',
      't2',
      't4',
    ]);
  });

  it('markiert Tracks als verwaist, die aus der Playlist verschwunden sind', () => {
    const block = createBlock(db, U, PL, ['t0', 't1', 't2']);
    db.prepare("DELETE FROM playlist_items WHERE user_id = ? AND playlist_id = ? AND track_id = 't1'").run(U, PL);
    const items = getBlocks(db, U, PL).find((b) => b.id === block.id)!.items;
    expect(items.find((i) => i.trackId === 't1')!.orphaned).toBe(true);
    expect(items.find((i) => i.trackId === 't0')!.orphaned).toBe(false);
    // Verwaiste werden nicht stillschweigend gelöscht
    expect(items).toHaveLength(3);
  });

  it('fremde Blöcke sind für andere Nutzer unsichtbar und unveränderbar', () => {
    const block = createBlock(db, U, PL, ['t0', 't1']);
    seedPlaylist(db, ['t0', 't1'], OTHER);
    expect(getBlocks(db, OTHER, PL)).toHaveLength(0);
    expect(() => updateBlock(db, OTHER, block.id, { name: 'gekapert' })).toThrowError(/nicht gefunden/);
    expect(() => deleteBlock(db, OTHER, block.id)).toThrowError(/nicht gefunden/);
    expect(() => setBlockItems(db, OTHER, block.id, ['t1', 't0'])).toThrowError(/nicht gefunden/);
    expect(getBlocks(db, U, PL)[0]!.name).toBe('Track t0');
  });

  it('umbenennen und löschen', () => {
    const block = createBlock(db, U, PL, ['t0', 't1']);
    updateBlock(db, U, block.id, { name: 'Original + Samples' });
    expect(getBlocks(db, U, PL)[0]!.name).toBe('Original + Samples');
    deleteBlock(db, U, block.id);
    expect(getBlocks(db, U, PL)).toHaveLength(0);
  });
});
