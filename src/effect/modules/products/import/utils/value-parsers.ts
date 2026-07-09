export function parseDate(value: string): Date | null {
  const dateStr = value.trim();
  if (!dateStr) return null;

  const slashDateMatch = dateStr.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?:\s*([ap]m))?)?$/i,
  );

  if (slashDateMatch) {
    const dayRaw = slashDateMatch[1];
    const monthRaw = slashDateMatch[2];
    const yearRaw = slashDateMatch[3];
    if (!dayRaw || !monthRaw || !yearRaw) return null;

    const dayNumber = Number.parseInt(dayRaw, 10);
    const monthNumber = Number.parseInt(monthRaw, 10);
    const yearNumber = Number.parseInt(yearRaw, 10);
    const meridiem = slashDateMatch[6]?.toLowerCase();
    const hourRaw = slashDateMatch[4];
    const minuteRaw = slashDateMatch[5];
    let hours = hourRaw ? Number.parseInt(hourRaw, 10) : 0;
    const minutes = minuteRaw ? Number.parseInt(minuteRaw, 10) : 0;

    if (
      !Number.isFinite(dayNumber) ||
      !Number.isFinite(monthNumber) ||
      !Number.isFinite(yearNumber) ||
      !Number.isFinite(hours) ||
      !Number.isFinite(minutes) ||
      monthNumber < 1 ||
      monthNumber > 12 ||
      dayNumber < 1 ||
      dayNumber > 31 ||
      minutes < 0 ||
      minutes > 59
    ) {
      return null;
    }

    if (meridiem) {
      if (hours < 1 || hours > 12) return null;
      if (meridiem === 'pm' && hours !== 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;
    } else if (hours < 0 || hours > 23) {
      return null;
    }

    const date = new Date(
      yearNumber,
      monthNumber - 1,
      dayNumber,
      hours,
      minutes,
    );
    if (
      date.getFullYear() !== yearNumber ||
      date.getMonth() !== monthNumber - 1 ||
      date.getDate() !== dayNumber ||
      date.getHours() !== hours ||
      date.getMinutes() !== minutes
    ) {
      return null;
    }
    return date;
  }

  if (dateStr.includes('/')) return null;

  const isoDate = new Date(dateStr);
  return Number.isNaN(isoDate.getTime()) ? null : isoDate;
}

export function parseBoolean(value: string, defaultValue: boolean): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === '') return defaultValue;
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

export function parseProductImportNumber(value: string): number | null {
  const compact = value.trim().replace(/[\s\u00a0']/g, '');
  if (compact === '') return null;

  const commaCount = (compact.match(/,/g) ?? []).length;
  const dotCount = (compact.match(/\./g) ?? []).length;
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  let normalized = compact;

  if (commaCount > 0 && dotCount > 0) {
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    normalized = compact
      .replace(new RegExp(`\\${thousandsSeparator}`, 'g'), '')
      .replace(decimalSeparator, '.');
  } else if (commaCount > 0) {
    normalized = /^\d{1,3}(,\d{3})+$/.test(compact)
      ? compact.replace(/,/g, '')
      : compact.replace(/,/g, '.');
  } else if (dotCount > 0) {
    normalized = /^\d{1,3}(\.\d{3})+$/.test(compact)
      ? compact.replace(/\./g, '')
      : compact;
  }

  if (normalized === '') return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseInteger(value: string, defaultValue: number): number {
  const parsed = parseProductImportNumber(value);
  return parsed === null ? defaultValue : Math.trunc(parsed);
}

export const nullableText = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};
