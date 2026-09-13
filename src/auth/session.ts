import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from '../db.js';
import { PlexClient, type UserRow } from '../plex/client.js';
import { notAuthenticated } from '../errors.js';

export const SESSION_COOKIE = 'pbs_session';
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export interface AppContext {
  db: DB;
  staticDir: string;
  /** Cookies nur über HTTPS senden (abgeleitet aus APP_BASE_URL). */
  secureCookies: boolean;
}

export interface CurrentUser {
  userId: string;
  user: UserRow;
  plex: PlexClient;
}

export function createSession(db: DB, userId: string): string {
  const id = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    id,
    userId,
    now,
    now + SESSION_TTL_MS,
  );
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  return id;
}

export function deleteSession(db: DB, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function setSessionCookie(reply: FastifyReply, sessionId: string, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function currentUser(req: FastifyRequest, ctx: AppContext): CurrentUser | null {
  const sessionId = req.cookies[SESSION_COOKIE];
  if (!sessionId) return null;
  const session = ctx.db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?')
    .get(sessionId) as { user_id: string; expires_at: number } | undefined;
  if (!session || session.expires_at < Date.now()) return null;
  const plex = new PlexClient(ctx.db, session.user_id);
  const user = plex.getAuth();
  if (!user) return null;
  return { userId: session.user_id, user, plex };
}

export function requireUser(req: FastifyRequest, ctx: AppContext): CurrentUser {
  const u = currentUser(req, ctx);
  if (!u) throw notAuthenticated();
  return u;
}
