import { z } from 'zod';
import { config } from '../config.js';
import { getClientIdentifier } from './identity.js';
import { ApiError } from '../errors.js';

/**
 * plex.tv-Seite der Anmeldung: PIN-Flow, Nutzerprofil und die Auflösung der
 * Remote-Access-Verbindung (plex.direct) zum Media-Server des Nutzers.
 */

const PLEXTV = 'https://plex.tv/api/v2';

function plexHeaders(token?: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'X-Plex-Product': config.plex.product,
    'X-Plex-Client-Identifier': getClientIdentifier(),
    ...(token ? { 'X-Plex-Token': token } : {}),
  };
}

const pinSchema = z.object({
  id: z.number(),
  code: z.string(),
  authToken: z.string().nullable().optional(),
});

export interface PlexPin {
  id: number;
  code: string;
}

export async function createPin(): Promise<PlexPin> {
  const res = await fetch(`${PLEXTV}/pins?strong=true`, { method: 'POST', headers: plexHeaders() });
  if (!res.ok) {
    throw new ApiError(502, 'plex_pin_failed', `plex.tv-PIN konnte nicht erzeugt werden (HTTP ${res.status}).`);
  }
  const pin = pinSchema.parse(await res.json());
  return { id: pin.id, code: pin.code };
}

export function authUrl(pin: PlexPin, forwardUrl: string): string {
  const params =
    `clientID=${encodeURIComponent(getClientIdentifier())}` +
    `&code=${encodeURIComponent(pin.code)}` +
    `&context%5Bdevice%5D%5Bproduct%5D=${encodeURIComponent(config.plex.product)}` +
    `&forwardUrl=${encodeURIComponent(forwardUrl)}`;
  return `https://app.plex.tv/auth#?${params}`;
}

/** Fragt den PIN-Status ab; liefert den Auth-Token, sobald der Nutzer bestätigt hat. */
export async function pollPin(pin: PlexPin): Promise<string | null> {
  const res = await fetch(`${PLEXTV}/pins/${pin.id}?code=${encodeURIComponent(pin.code)}`, {
    headers: plexHeaders(),
  });
  if (!res.ok) return null;
  const parsed = pinSchema.safeParse(await res.json());
  return parsed.success ? (parsed.data.authToken ?? null) : null;
}

const userSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  username: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
});

export async function getPlexUser(token: string): Promise<{ id: string; username: string | null }> {
  const res = await fetch(`${PLEXTV}/user`, { headers: plexHeaders(token) });
  if (!res.ok) {
    throw new ApiError(502, 'plex_user_failed', `Plex-Profil nicht abrufbar (HTTP ${res.status}).`);
  }
  const u = userSchema.parse(await res.json());
  return { id: u.id, username: u.username ?? u.title ?? null };
}

const resourcesSchema = z.array(
  z.object({
    name: z.string(),
    provides: z.string(),
    clientIdentifier: z.string(),
    accessToken: z.string().nullable().optional(),
    owned: z.boolean().optional(),
    connections: z
      .array(
        z.object({
          uri: z.string(),
          local: z.boolean(),
          relay: z.boolean().optional(),
        }),
      )
      .default([]),
  }),
);

export interface ResolvedServer {
  machineId: string;
  name: string;
  uri: string;
  token: string;
}

/**
 * Sucht über plex.tv alle Server des Nutzers und probiert deren Verbindungen
 * in sinnvoller Reihenfolge aus: direkte Remote-Access-URLs (plex.direct)
 * zuerst, dann Relay, zuletzt lokale Adressen (nur relevant, wenn die App im
 * selben Netz läuft). Liefert die erste Verbindung, die antwortet.
 */
export async function resolveServer(token: string): Promise<ResolvedServer | null> {
  const res = await fetch(`${PLEXTV}/resources?includeHttps=1&includeRelay=1`, {
    headers: plexHeaders(token),
  });
  if (!res.ok) {
    throw new ApiError(502, 'plex_resources_failed', `Serverliste nicht abrufbar (HTTP ${res.status}).`);
  }
  const resources = resourcesSchema.parse(await res.json());
  const servers = resources
    .filter((r) => r.provides.split(',').includes('server'))
    .sort((a, b) => Number(b.owned ?? false) - Number(a.owned ?? false));

  for (const server of servers) {
    const serverToken = server.accessToken ?? token;
    const ordered = [...server.connections].sort((a, b) => rank(a) - rank(b));
    for (const conn of ordered) {
      if (await probe(conn.uri, serverToken)) {
        return { machineId: server.clientIdentifier, name: server.name, uri: conn.uri.replace(/\/+$/, ''), token: serverToken };
      }
    }
  }
  return null;
}

function rank(c: { local: boolean; relay?: boolean }): number {
  if (!c.local && !c.relay) return 0; // direkte Remote-Access-URL
  if (c.relay) return 1; // Plex-Relay (gedrosselt, aber für API-Aufrufe ausreichend)
  return 2; // lokal
}

async function probe(uri: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${uri}/identity`, {
      headers: { Accept: 'application/json', 'X-Plex-Token': token },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
