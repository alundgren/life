import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getEnv } from "@/lib/env";

export function createDbClient(filePath: string): Database.Database {
  if (filePath !== ":memory:") {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

// Likely duplicated per module instance (see ADR 0009); not yet confirmed safe or fixed, tracked in #98.
// eslint-disable-next-line no-restricted-syntax
let dbInstance: Database.Database | undefined;

/** Lazily creates the app's SQLite singleton from SQLITE_DB_PATH. */
export function getDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = createDbClient(getEnv().SQLITE_DB_PATH);
  }
  return dbInstance;
}

/** Test-only seam: inject an in-memory db so callers don't touch the real file or env. */
export function setDb(db: Database.Database): void {
  dbInstance = db;
}

export function resetDb(): void {
  dbInstance?.close();
  dbInstance = undefined;
}
