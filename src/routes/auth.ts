import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { config, assertLoginConfig } from '../config.js';
import { createPin, authUrl, pollPin, getPlexUser, resolveServer, type PlexPin } from '../plex/plextv.js';
import {
  type AppContext,
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  currentUser,
  deleteSession,
  setSessionCookie,
} from '../auth/session.js';

/** Laufende Login-Versuche: state -> PIN (mit Ablauf). */
const pendingLogins = new Map<string, { pin: PlexPin; expiresAt: number }>();

function prunePendingLogins(): void {
  const now = Date.now();
  for (const [state, entry] of pendingLogins) {
    if (entry.expiresAt < now) pendingLogins.delete(state);
  }
  while (pendingLogins.size > 500) {
    const oldest = pendingLogins.keys().next().value;
    if (oldest === undefined) break;
    pendingLogins.delete(oldest);
  }
}

/** Enges Limit für die öffentlich erreichbaren Anmelde-Endpunkte. */
const authRateLimit = {
  config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
};

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/auth/status', async (req) => {
    const u = currentUser(req, ctx);
    if (!u) return { authenticated: false };
    return {
      authenticated: true,
      user: { id: u.user.id, displayName: u.user.username },
      server: u.user.server_name,
    };
  });

  app.get('/api/auth/login', authRateLimit, async (req, reply) => {
    assertLoginConfig();
    prunePendingLogins();
    const state = crypto.randomBytes(16).toString('base64url');
    const pin = await createPin();
    pendingLogins.set(state, { pin, expiresAt: Date.now() + 10 * 60_000 });
    reply.redirect(authUrl(pin, `${config.appBaseUrl}/callback?state=${state}`));
  });

  app.get('/callback', authRateLimit, async (req, reply) => {
    const query = z.object({ state: z.string().optional() }).parse(req.query);
    const pending = query.state ? pendingLogins.get(query.state) : undefined;
    if (!pending) {
      reply
        .type('text/html; charset=utf-8')
        .send(callbackErrorPage('Ungültiger oder abgelaufener Login-Versuch. Bitte erneut anmelden.'));
      return;
    }

    // Die Rückleitung erfolgt unmittelbar nach der Bestätigung — der Token ist
    // meist sofort da, plex.tv braucht aber manchmal einen Moment.
    let token: string | null = null;
    for (let attempt = 0; attempt < 6 && !token; attempt++) {
      token = await pollPin(pending.pin);
      if (!token) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!token) {
      reply
        .type('text/html; charset=utf-8')
        .send(callbackErrorPage('Plex hat die Anmeldung nicht bestätigt. Bitte erneut versuchen.'));
      return;
    }
    pendingLogins.delete(query.state!);

    const profile = await getPlexUser(token);
    const server = await resolveServer(token);
    if (!server) {
      reply
        .type('text/html; charset=utf-8')
        .send(
          callbackErrorPage(
            'Kein erreichbarer Plex-Server für diesen Account gefunden. Entweder fehlt die Server-Freigabe für dich, oder auf dem Server ist der Fernzugriff aus (Plex: Einstellungen → Fernzugriff).',
          ),
        );
      return;
    }

    const now = Date.now();
    ctx.db
      .prepare(
        `INSERT INTO users (id, username, plex_token, server_machine_id, server_name, server_uri, server_token, created_at, last_login_at)
         VALUES (@id, @username, @plex_token, @mid, @sname, @suri, @stoken, @now, @now)
         ON CONFLICT(id) DO UPDATE SET
           username = @username, plex_token = @plex_token, server_machine_id = @mid,
           server_name = @sname, server_uri = @suri, server_token = @stoken, last_login_at = @now`,
      )
      .run({
        id: profile.id,
        username: profile.username,
        plex_token: token,
        mid: server.machineId,
        sname: server.name,
        suri: server.uri,
        stoken: server.token,
        now,
      });

    const sessionId = createSession(ctx.db, profile.id);
    setSessionCookie(reply, sessionId, ctx.secureCookies);
    reply.redirect('/');
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const sessionId = req.cookies[SESSION_COOKIE];
    if (sessionId) deleteSession(ctx.db, sessionId);
    clearSessionCookie(reply);
    return { ok: true };
  });
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function callbackErrorPage(message: string): string {
  return `<!doctype html><html lang="de"><meta charset="utf-8"><title>Anmeldung fehlgeschlagen</title>
<body style="font-family:system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem">
<h1>Anmeldung fehlgeschlagen</h1><p>${escapeHtml(message)}</p><p><a href="/">Zurück zur App</a></p></body></html>`;
}
