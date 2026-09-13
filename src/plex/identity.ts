import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

let cached: string | null = null;

/**
 * Stabile X-Plex-Client-Identifier dieser Installation. Plex knüpft erteilte
 * Tokens an diese ID — sie wird deshalb einmal erzeugt und in DATA_DIR
 * persistiert.
 */
export function getClientIdentifier(): string {
  if (cached) return cached;
  const file = path.join(config.dataDir, 'plex-client-id');
  try {
    cached = fs.readFileSync(file, 'utf8').trim();
    if (cached) return cached;
  } catch {
    /* neu erzeugen */
  }
  cached = crypto.randomUUID();
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file, cached + '\n');
  return cached;
}
