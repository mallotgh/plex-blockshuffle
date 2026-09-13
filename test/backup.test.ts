import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openMemoryDb, type DB } from '../src/db.js';
import { createBlock, getBlocks } from '../src/services/blocks.js';
import { exportBlocks, importBlocks, runBackup, blockExportSchema } from '../src/services/backup.js';

const PL = 'pl1';
const U = 'user-a';

function seedPlaylist(db: DB, trackIds: string[]): void {
  db.prepare('INSERT INTO users (id, created_at, last_login_at) VALUES (?, 0, 0)').run(U);
  db.prepare("INSERT INTO playlists (user_id, id, name) VALUES (?, ?, 'Meine Playlist')").run(U, PL);
  const insTrack = db.prepare(
    "INSERT OR IGNORE INTO tracks (id, name, artists_json, duration_ms) VALUES (?, ?, '[]', 1000)",
  );
  const insItem = db.prepare(
    'INSERT INTO playlist_items (user_id, playlist_id, position, track_id) VALUES (?, ?, ?, ?)',
  );
  trackIds.forEach((t, i) => {
    insTrack.run(t, `Track ${t}`);
    insItem.run(U, PL, i, t);
  });
}

describe('Datensicherung', () => {
  let db: DB;

  beforeEach(() => {
    db = openMemoryDb();
    seedPlaylist(db, ['t0', 't1', 't2', 't3']);
  });

  it('Export enthält alle Blöcke im dokumentierten Format', () => {
    createBlock(db, U, PL, ['t0', 't1'], { name: 'B1' });
    const data = exportBlocks(db, U);
    expect(blockExportSchema.parse(data)).toBeTruthy();
    expect(data.playlists).toHaveLength(1);
    expect(data.playlists[0]!.blocks[0]).toMatchObject({ name: 'B1', trackIds: ['t0', 't1'] });
  });

  it('Roundtrip: Export -> Blöcke löschen -> Import stellt alles wieder her', () => {
    createBlock(db, U, PL, ['t0', 't1'], { name: 'B1' });
    createBlock(db, U, PL, ['t2', 't3'], { name: 'B2' });
    const data = exportBlocks(db, U);
    db.prepare('DELETE FROM blocks').run();
    const result = importBlocks(db, U, data);
    expect(result.imported).toBe(2);
    expect(result.skipped).toHaveLength(0);
    const blocks = getBlocks(db, U, PL);
    expect(blocks.map((b) => b.name).sort()).toEqual(['B1', 'B2']);
    expect(blocks.find((b) => b.name === 'B1')!.items.map((i) => i.trackId)).toEqual(['t0', 't1']);
  });

  it('Import ist additiv und meldet Konflikte', () => {
    createBlock(db, U, PL, ['t0', 't1'], { name: 'Bestehend' });
    const result = importBlocks(db, U, {
      format: 'plex-blockshuffle-blocks',
      version: 1,
      playlists: [
        {
          playlistId: PL,
          blocks: [
            { name: 'Duplikat', trackIds: ['t0', 't1'] },
            { name: 'Neu', trackIds: ['t2', 't3'] },
            { name: 'ZuKlein', trackIds: ['t2'] },
          ],
        },
        { playlistId: 'unbekannt', blocks: [{ name: 'Fremd', trackIds: ['x', 'y'] }] },
      ],
    });
    expect(result.imported).toBe(1);
    expect(result.skipped).toHaveLength(3);
    expect(getBlocks(db, U, PL)).toHaveLength(2);
    const reasons = result.skipped.map((s) => s.reason).join(' | ');
    expect(reasons).toContain('identischer Block');
    expect(reasons).toContain('weniger als 2');
    expect(reasons).toContain('Playlist unbekannt');
  });

  it('runBackup schreibt eine lesbare SQLite-Kopie und behält höchstens 14', () => {
    createBlock(db, U, PL, ['t0', 't1']);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-backup-'));
    // Alte Dummy-Backups anlegen
    fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
    for (let i = 1; i <= 20; i++) {
      fs.writeFileSync(path.join(dir, 'backups', `plex-blockshuffle-2026-01-${String(i).padStart(2, '0')}.sqlite`), '');
    }
    const file = runBackup(db, dir);
    const copy = new Database(file, { readonly: true });
    expect((copy.prepare('SELECT COUNT(*) AS n FROM blocks').get() as { n: number }).n).toBe(1);
    copy.close();
    const remaining = fs.readdirSync(path.join(dir, 'backups'));
    expect(remaining.length).toBeLessThanOrEqual(14);
    expect(remaining).toContain(path.basename(file));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
