/**
 * @drais/repo-sqlite — connection management.
 *
 * better-sqlite3 is synchronous by design (no connection pool, no async
 * driver overhead — the whole point of an embedded single-writer database).
 * Repo methods below are still declared `async` to satisfy the shared
 * `Repos` contract (§8) so callers never need to know which engine they're
 * talking to; the synchronous call underneath just resolves immediately.
 *
 * Still not imported by src/lib/db/db-mode.ts or src/lib/db/pools.ts
 * directly, and never will be — per §8.1's isolation rule, and because
 * db-mode.ts must stay free of any better-sqlite3 knowledge (see
 * ../resolve.ts's header). The actual integration point is one layer up:
 * ./singleton.ts opens the one long-lived local file this function
 * describes, and ../resolve.ts's getActiveRepos() is what a caller
 * actually asks for a mode-aware Repos — this module itself remains a
 * standalone connection helper, used directly only by tests and
 * provisioning, which intentionally manage their own connection lifecycle
 * rather than sharing the singleton.
 *
 * The require() below is deliberately NOT `require('better-sqlite3')` as a
 * literal. Turbopack (the build's bundler since Aug 2026, see next.config.js)
 * statically resolves literal require()/import specifiers at BUILD time even
 * for packages listed in serverExternalPackages, and fails the whole build
 * if an optionalDependency didn't install — unlike webpack, which treats an
 * external as a pure runtime require with no build-time resolution. Building
 * the specifier from parts keeps this invisible to that static analysis, so
 * a school/deployment without better-sqlite3 installed still builds fine and
 * only throws if local-sqlite mode is actually used at runtime.
 */
import type Database from 'better-sqlite3';
import { ensureSchema } from './schema';

export type SqliteConnection = Database.Database;

const BETTER_SQLITE3_PKG = ['better', 'sqlite3'].join('-');

/**
 * Open (or create) a SQLite database at `path`. Pass ':memory:' for a
 * throwaway in-process database — used by the parity tests, since it needs
 * no filesystem cleanup and is safe to run anywhere (matches the
 * architecture-scan.mjs convention already established in this repo).
 */
export function openSqliteDb(path: string): SqliteConnection {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const DatabaseCtor = require(BETTER_SQLITE3_PKG) as typeof Database;
  const db = new DatabaseCtor(path);
  // WAL = the mode Electron/desktop local mode will actually run under
  // (concurrent readers don't block the single writer). Harmless for
  // ':memory:' (SQLite ignores journal_mode there).
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  return db;
}

export function closeSqliteDb(db: SqliteConnection): void {
  db.close();
}
