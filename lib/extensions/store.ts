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

/**
 * Businesses saved for a future spotlight. Separate from snapshots because a
 * shortlist is durable intent, not a cached collector result: re-running
 * research must never drop something already chosen.
 */
export function initializeShortlistStore(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS research_shortlist (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      town TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      added_at TEXT NOT NULL
    );
  `);
  return database;
}

export type ShortlistStatus = "candidate" | "visiting" | "posted" | "passed";

export type ShortlistEntry = {
  id: string;
  name: string;
  town: string;
  status: ShortlistStatus;
  note: string;
  payload: unknown;
  addedAt: string;
};

export function listShortlist(database: DatabaseSync): ShortlistEntry[] {
  const rows = database
    .prepare("SELECT id, name, town, status, note, payload_json, added_at FROM research_shortlist ORDER BY added_at DESC")
    .all() as unknown as Array<{
      id: string; name: string; town: string; status: string;
      note: string; payload_json: string; added_at: string;
    }>;
  return rows.map((row) => {
    let payload: unknown = null;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      payload = null;
    }
    return {
      id: row.id,
      name: row.name,
      town: row.town,
      status: row.status as ShortlistStatus,
      note: row.note,
      payload,
      addedAt: row.added_at,
    };
  });
}

export function upsertShortlistEntry(
  database: DatabaseSync,
  entry: Omit<ShortlistEntry, "addedAt"> & { addedAt?: string },
) {
  database
    .prepare(`
      INSERT INTO research_shortlist (id, name, town, status, note, payload_json, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        status = excluded.status,
        note = excluded.note,
        payload_json = excluded.payload_json
    `)
    .run(
      entry.id,
      entry.name,
      entry.town,
      entry.status,
      entry.note,
      JSON.stringify(entry.payload ?? null),
      entry.addedAt ?? new Date().toISOString(),
    );
}

export function removeShortlistEntry(database: DatabaseSync, id: string) {
  return database
    .prepare("DELETE FROM research_shortlist WHERE id = ?")
    .run(id).changes;
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
