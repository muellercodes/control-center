import type { DatabaseSync } from "node:sqlite";

/**
 * Extensions keep their collector snapshots in their own table.
 *
 * Deliberately does NOT bump `user_version`. database.ts refuses to open a
 * directory whose schema is newer than it understands, so bumping it here would
 * make this data unreadable by upstream Control Center — a one-way door. An
 * additive `CREATE TABLE IF NOT EXISTS` is invisible to code that never selects
 * from it, which keeps the fork reversible.
 */
export function initializeExtensionStore(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS extension_snapshots (
      extension TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      checked_at TEXT NOT NULL
    );
  `);
  return database;
}

export function writeExtensionSnapshot<T>(
  database: DatabaseSync,
  extension: string,
  scope: string,
  payload: T,
  checkedAt = new Date().toISOString(),
) {
  database
    .prepare(`
      INSERT INTO extension_snapshots (extension, scope, payload_json, checked_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (extension) DO UPDATE SET
        scope = excluded.scope,
        payload_json = excluded.payload_json,
        checked_at = excluded.checked_at
    `)
    .run(extension, scope, JSON.stringify(payload), checkedAt);
  return payload;
}

export function readExtensionSnapshot<T>(
  database: DatabaseSync,
  extension: string,
  scope?: string,
) {
  const row = database
    .prepare(
      "SELECT scope, payload_json, checked_at FROM extension_snapshots WHERE extension = ?",
    )
    .get(extension) as unknown as
    | { scope: string; payload_json: string; checked_at: string }
    | undefined;
  if (!row || (scope !== undefined && row.scope !== scope)) return null;
  try {
    const payload = JSON.parse(row.payload_json) as T;
    if (!payload || typeof payload !== "object") return null;
    return { scope: row.scope, checkedAt: row.checked_at, payload };
  } catch {
    return null;
  }
}
