export function parseBooleanString(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (!value || value.trim() === '') return defaultValue;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

export function parseOptionalFloat(value: string | undefined): number | null {
  if (!value || value.trim() === '') return null;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function parseIntegerOrDefault(
  value: string | undefined,
  defaultValue: number,
): number {
  if (!value || value.trim() === '') return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export function parseIsoOrDmyDateTime(value: string | undefined): Date | null {
  if (!value) return null;

  const isoDate = new Date(value);
  if (!Number.isNaN(isoDate.getTime())) return isoDate;

  const [datePart, timePart] = value.split(' ');
  if (!datePart) return null;

  const [day, month, year] = datePart.split('/');
  if (!day || !month || !year) return null;

  let hours = 0;
  let minutes = 0;
  if (timePart) {
    const isPM = timePart.toLowerCase().includes('pm');
    const timeOnly = timePart.replace(/[ap]m/i, '');
    const [h, m] = timeOnly.split(':');
    if (!h || !m) return null;
    hours = Number.parseInt(h, 10);
    minutes = Number.parseInt(m, 10);

    if (isPM && hours !== 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
  }

  return new Date(
    Number.parseInt(year, 10),
    Number.parseInt(month, 10) - 1,
    Number.parseInt(day, 10),
    hours,
    minutes,
  );
}
