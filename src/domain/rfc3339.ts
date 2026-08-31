const STRICT_RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

const NANOSECONDS_PER_SECOND = 1_000_000_000n;

function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0) ? 29 : 28;
    default:
      return 0;
  }
}

function daysFromCivil(year: number, month: number, day: number): number {
  const shiftedYear = year - Number(month <= 2);
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const shiftedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

/**
 * Parses the closed RFC3339 profile shared with the FEAT-137 native boundary.
 * It validates the Gregorian calendar and retains up to nanosecond precision,
 * avoiding Date.parse's normalization of impossible dates such as February 31.
 */
export function parseStrictRfc3339EpochNanoseconds(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const match = STRICT_RFC3339_PATTERN.exec(value);
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year === 0 || month < 1 || month > 12 || day < 1 ||
      day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  const offsetHour = match[8] === "Z" ? 0 : Number(match[10]);
  const offsetMinute = match[8] === "Z" ? 0 : Number(match[11]);
  if (offsetHour > 23 || offsetMinute > 59) return null;
  const offsetSign = match[9] === "-" ? -1 : 1;
  const offsetSeconds = match[8] === "Z"
    ? 0
    : offsetSign * (offsetHour * 3_600 + offsetMinute * 60);

  const seconds = daysFromCivil(year, month, day) * 86_400 +
    hour * 3_600 + minute * 60 + second - offsetSeconds;
  const fractionNanoseconds = BigInt((match[7] ?? "").padEnd(9, "0") || "0");
  return BigInt(seconds) * NANOSECONDS_PER_SECOND + fractionNanoseconds;
}

export function isStrictRfc3339(value: unknown): value is string {
  return parseStrictRfc3339EpochNanoseconds(value) !== null;
}
