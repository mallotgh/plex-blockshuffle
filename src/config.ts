import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8973),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  STATIC_DIR: z.string().default('./web/dist'),
  /** Öffentliche Basis-URL der App — Ziel der Rückleitung nach dem Plex-Login. */
  APP_BASE_URL: z.string().default(''),
  PLEX_PRODUCT: z.string().default('Plex Blockshuffle'),
});

const env = envSchema.parse(process.env);

export const config = {
  port: env.PORT,
  host: env.HOST,
  dataDir: path.resolve(env.DATA_DIR),
  staticDir: path.resolve(env.STATIC_DIR),
  appBaseUrl: env.APP_BASE_URL.replace(/\/+$/, ''),
  plex: {
    product: env.PLEX_PRODUCT,
  },
};

export function assertLoginConfig(): void {
  if (!config.appBaseUrl) {
    throw new Error('APP_BASE_URL ist nicht gesetzt — ohne sie kann Plex nicht zurückleiten.');
  }
}
