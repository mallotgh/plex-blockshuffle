import { z } from 'zod';
import type { DB } from '../db.js';
import { ApiError, notAuthenticated } from '../errors.js';
import { resolveServer } from './plextv.js';

export interface UserRow {
  id: string;
  username: string | null;
  plex_token: string;
  server_machine_id: string | null;
  server_name: string | null;
  server_uri: string | null;
  server_token: string | null;
  created_at: number;
  last_login_at: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
}

export class PlexApiError extends ApiError {
  constructor(
    public status: number,
    message: string,
    public endpoint: string,
  ) {
    super(status >= 500 ? 502 : status, 'plex_api_error', message, { endpoint, status });
    this.name = 'PlexApiError';
  }
}

/** Laufende Verbindungs-Neuauflösungen pro Nutzer (Client-Instanzen sind kurzlebig). */
const inflightReconnect = new Map<string, Promise<boolean>>();

/**
 * HTTP-Client gegen den Plex Media Server des Nutzers über dessen
 * Remote-Access-URL (plex.direct). Bricht die Verbindung weg (Server-Neustart,
 * neue IP, widerrufene Freigabe), wird sie einmal über plex.tv neu aufgelöst.
 */
export class PlexClient {
  constructor(
    private db: DB,
    public readonly userId: string,
  ) {}

  getAuth(): UserRow | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(this.userId) as UserRow | undefined;
    if (!row || !row.plex_token || !row.server_uri || !row.server_token) return null;
    return row;
  }

  get machineId(): string | null {
    return this.getAuth()?.server_machine_id ?? null;
  }

  /** Widerrufener Zugriff: Anmeldung erlischt, Blöcke bleiben erhalten. */
  private invalidate(): void {
    this.db.prepare("UPDATE users SET plex_token = '', server_token = NULL WHERE id = ?").run(this.userId);
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(this.userId);
  }

  private reconnect(): Promise<boolean> {
    const running = inflightReconnect.get(this.userId);
    if (running) return running;
    const p = this.doReconnect().finally(() => inflightReconnect.delete(this.userId));
    inflightReconnect.set(this.userId, p);
    return p;
  }

  private async doReconnect(): Promise<boolean> {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(this.userId) as UserRow | undefined;
    if (!row || !row.plex_token) return false;
    let server;
    try {
      server = await resolveServer(row.plex_token);
    } catch {
      return false;
    }
    if (!server) return false;
    this.db
      .prepare('UPDATE users SET server_machine_id = ?, server_name = ?, server_uri = ?, server_token = ? WHERE id = ?')
      .run(server.machineId, server.name, server.uri, server.token, this.userId);
    return true;
  }

  async request(path: string, opts: RequestOptions = {}): Promise<unknown> {
    let reconnected = false;
    for (;;) {
      const auth = this.getAuth();
      if (!auth) throw notAuthenticated();
      const url = new URL(auth.server_uri! + path);
      for (const [k, v] of Object.entries(opts.query ?? {})) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
      let res: Response;
      try {
        res = await fetch(url, {
          method: opts.method ?? 'GET',
          headers: { Accept: 'application/json', 'X-Plex-Token': auth.server_token! },
          signal: AbortSignal.timeout(20_000),
        });
      } catch (err) {
        // Netzwerkfehler/Timeout: Verbindung einmal über plex.tv neu auflösen
        if (!reconnected && (await this.reconnect())) {
          reconnected = true;
          continue;
        }
        throw new ApiError(
          502,
          'plex_unreachable',
          'Der Plex-Server ist über seine Remote-Access-URL nicht erreichbar. Prüfe in Plex: Einstellungen → Fernzugriff.',
          { endpoint: path, cause: (err as Error).message },
        );
      }
      if (res.status === 401) {
        if (!reconnected && (await this.reconnect())) {
          reconnected = true;
          continue;
        }
        this.invalidate();
        throw notAuthenticated();
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new PlexApiError(
          res.status,
          `Plex-API ${opts.method ?? 'GET'} ${path}: HTTP ${res.status}${text ? ` – ${text.slice(0, 200)}` : ''}`,
          path,
        );
      }
      if (res.status === 204) return null;
      const text = await res.text();
      if (text.length === 0) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    }
  }

  /** request + Zod-Validierung; wirft eine klare Fehlermeldung bei Schema-Drift. */
  async requestParsed<T>(schema: z.ZodType<T>, path: string, opts: RequestOptions = {}): Promise<T> {
    const raw = await this.request(path, opts);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new ApiError(
        502,
        'unexpected_api_schema',
        `Unerwartetes Antwortformat vom Plex-Server für ${path}.`,
        parsed.error.issues.slice(0, 5),
      );
    }
    return parsed.data;
  }
}
