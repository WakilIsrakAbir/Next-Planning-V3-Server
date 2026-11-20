/**
 * Calculates remaining seconds until 12:00 AM (midnight) in Bangladesh (UTC+6)
 * Enforces factory operational security compliance where daily credentials rotate at midnight.
 */
export interface IDhakaMidnightResult {
  seconds: number;
  expiresAt: number;
}

export function getSecondsUntilDhakaMidnight(): IDhakaMidnightResult {
  const now = new Date();
  const dhakaOffsetMs = 6 * 60 * 60 * 1000;
  const dhakaNow = new Date(now.getTime() + dhakaOffsetMs);

  const nextDhakaMidnightUtc = new Date(
    Date.UTC(
      dhakaNow.getUTCFullYear(),
      dhakaNow.getUTCMonth(),
      dhakaNow.getUTCDate() + 1,
      0,
      0,
      0,
      0
    )
  );

  const nextMidnightTimestamp = nextDhakaMidnightUtc.getTime() - dhakaOffsetMs;
  const diffSeconds = Math.floor((nextMidnightTimestamp - now.getTime()) / 1000);

  return {
    seconds: Math.max(diffSeconds, 60),
    expiresAt: nextMidnightTimestamp,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A moment as Bangladesh time (UTC+6, no daylight saving), e.g. '21-Nov-2026 14:05', whatever the server's time zone.
 * Used in "changed by <user> at <time>" messages. '' for a missing or invalid date.
 */
export function formatDhakaDateTime(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const dhaka = new Date(time + 6 * 60 * 60 * 1000);
  const two = (n: number) => String(n).padStart(2, '0');
  return (
    `${two(dhaka.getUTCDate())}-${MONTHS[dhaka.getUTCMonth()]}-${dhaka.getUTCFullYear()} ` +
    `${two(dhaka.getUTCHours())}:${two(dhaka.getUTCMinutes())}`
  );
}
