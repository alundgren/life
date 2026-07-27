ALTER TABLE weekly_plan ADD COLUMN revised_at TEXT;

UPDATE weekly_plan SET revised_at = created_at WHERE revised_at IS NULL;
