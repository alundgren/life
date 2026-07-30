import { getDb } from "@/lib/db/client";

export type ModeValue = "work" | "vacation";

interface ModeRow {
  value: ModeValue;
}

/** The system's single current Mode. Always resolves — migration seeds a default row. */
export function getMode(): ModeValue {
  const row = getDb().prepare("SELECT value FROM mode WHERE id = 1").get() as ModeRow;
  return row.value;
}

/** Switches the system's Mode. */
export function setMode(value: ModeValue): void {
  getDb()
    .prepare("UPDATE mode SET value = @value, updated_at = datetime('now') WHERE id = 1")
    .run({ value });
}
