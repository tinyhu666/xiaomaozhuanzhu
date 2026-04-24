export function toMySqlDateTime(value: string | Date | null | undefined) {
  if (value == null) {
    return null;
  }

  if (value instanceof Date) {
    return formatUtcDateTime(value);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const mysqlMatch = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/
  );
  if (mysqlMatch) {
    return `${mysqlMatch[1]} ${mysqlMatch[2]}.${normalizeMilliseconds(mysqlMatch[3])}`;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid datetime value: ${value}`);
  }

  return formatUtcDateTime(date);
}

export function fromMySqlDateTime(value: string | Date | null | undefined) {
  if (value == null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const mysqlMatch = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/
  );
  if (mysqlMatch) {
    return `${mysqlMatch[1]}T${mysqlMatch[2]}.${normalizeMilliseconds(mysqlMatch[3])}Z`;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid datetime value: ${value}`);
  }

  return date.toISOString();
}

function formatUtcDateTime(value: Date) {
  return `${value.getUTCFullYear()}-${padNumber(value.getUTCMonth() + 1)}-${padNumber(value.getUTCDate())} ${padNumber(value.getUTCHours())}:${padNumber(value.getUTCMinutes())}:${padNumber(value.getUTCSeconds())}.${padNumber(value.getUTCMilliseconds(), 3)}`;
}

function normalizeMilliseconds(value?: string) {
  return (value ?? "").slice(0, 3).padEnd(3, "0");
}

function padNumber(value: number, width = 2) {
  return String(value).padStart(width, "0");
}
