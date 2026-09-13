import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

type Migration = string | ((db: DB) => void);

const MIGRATIONS: Migration[] = [
  // 1: Grundschema (Mehrbenutzer von Anfang an)
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT,
    plex_token TEXT NOT NULL DEFAULT '',
    server_machine_id TEXT,
    server_name TEXT,
    server_uri TEXT,
    server_token TEXT,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE playlists (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    smart INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT,
    track_total INTEGER NOT NULL DEFAULT 0,
    stale INTEGER NOT NULL DEFAULT 0,
    last_synced_at INTEGER,
    PRIMARY KEY (user_id, id)
  );

  CREATE TABLE tracks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    artists_json TEXT NOT NULL,
    album_name TEXT,
    duration_ms INTEGER NOT NULL
  );

  CREATE TABLE playlist_items (
    user_id TEXT NOT NULL,
    playlist_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    track_id TEXT NOT NULL REFERENCES tracks(id),
    PRIMARY KEY (user_id, playlist_id, position),
    FOREIGN KEY (user_id, playlist_id) REFERENCES playlists(user_id, id) ON DELETE CASCADE
  );
  CREATE INDEX idx_playlist_items_track ON playlist_items(user_id, playlist_id, track_id);

  CREATE TABLE blocks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    playlist_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id, playlist_id) REFERENCES playlists(user_id, id) ON DELETE CASCADE
  );
  CREATE INDEX idx_blocks_playlist ON blocks(user_id, playlist_id);

  CREATE TABLE block_items (
    block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (block_id, track_id),
    UNIQUE (block_id, position)
  );

  CREATE TABLE shuffle_runs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    playlist_id TEXT NOT NULL,
    seed TEXT NOT NULL,
    order_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id, playlist_id) REFERENCES playlists(user_id, id) ON DELETE CASCADE
  );
  CREATE INDEX idx_shuffle_runs_playlist ON shuffle_runs(user_id, playlist_id, created_at);

  CREATE TABLE shadow_playlists (
    user_id TEXT NOT NULL,
    playlist_id TEXT NOT NULL,
    shadow_playlist_id TEXT NOT NULL,
    PRIMARY KEY (user_id, playlist_id),
    FOREIGN KEY (user_id, playlist_id) REFERENCES playlists(user_id, id) ON DELETE CASCADE
  );
  `,
];

export function openDb(dataDir: string): DB {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'plex-blockshuffle.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

/** In-Memory-DB für Tests. */
export function openMemoryDb(upTo?: number): DB {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db, upTo);
  return db;
}

export function migrate(db: DB, upTo: number = MIGRATIONS.length): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let i = current; i < Math.min(upTo, MIGRATIONS.length); i++) {
    db.transaction(() => {
      const m = MIGRATIONS[i]!;
      if (typeof m === 'string') db.exec(m);
      else m(db);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
