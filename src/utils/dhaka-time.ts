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
