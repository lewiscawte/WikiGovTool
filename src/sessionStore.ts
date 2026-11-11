import session, { SessionData } from 'express-session';
import { TtlCache } from './cache';

// Replaces express-session's MemoryStore, which never drops a record: every visit to
// /api/auth/login stores one, so anyone could grow it until the process ran out of memory.
// Sessions without a logged-in user (a login in progress) live in a small, short-lived pool
// of their own, so a flood of them can't push out the sessions of people who are logged in.
const PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 1000;
const MAX_LOGGED_IN = 10000;

export class BoundedSessionStore extends session.Store {
  // Stored as JSON, as MemoryStore does, so a request's changes only land when it saves.
  private pending = new TtlCache<string>(PENDING_TTL_MS, MAX_PENDING);
  private loggedIn: TtlCache<string>;

  constructor(loggedInTtlMs: number) {
    super();
    this.loggedIn = new TtlCache<string>(loggedInTtlMs, MAX_LOGGED_IN);
  }

  get(sid: string, callback: (err: any, session?: SessionData | null) => void): void {
    const json = this.loggedIn.get(sid) ?? this.pending.get(sid);
    callback(null, json ? JSON.parse(json) : null);
  }

  set(sid: string, sess: SessionData, callback?: (err?: any) => void): void {
    const json = JSON.stringify(sess);
    if (sess.user) {
      this.pending.delete(sid);
      this.loggedIn.set(sid, json);
    } else {
      this.loggedIn.delete(sid);
      this.pending.set(sid, json);
    }
    callback?.();
  }

  // Called on requests that don't change the session; restarts its expiry. Only for a session
  // that's still stored, so a request finishing after logout can't bring it back.
  touch(sid: string, sess: SessionData, callback?: () => void): void {
    if (this.loggedIn.get(sid) === undefined && this.pending.get(sid) === undefined) {
      callback?.();
      return;
    }
    this.set(sid, sess, () => callback?.());
  }

  destroy(sid: string, callback?: (err?: any) => void): void {
    this.pending.delete(sid);
    this.loggedIn.delete(sid);
    callback?.();
  }
}
