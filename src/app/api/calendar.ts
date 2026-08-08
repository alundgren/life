const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a value is a real ISO calendar date in YYYY-MM-DD form. */
export function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
