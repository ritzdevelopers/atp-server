/** Shared in/out inference when the device only sends C1 = 'in'. */

export function parseRawDirection(raw) {
  const d = String(raw ?? "").toLowerCase();
  if (d.includes("out") || d === "o" || d === "1") return "out";
  if (d.includes("in") || d === "i" || d === "0") return "in";
  return "unknown";
}

export function wallTimeToMinutesSinceMidnight(value) {
  if (value == null || value === "") return NaN;
  const s = String(value).trim();
  const m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return NaN;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const sec = Number(m[3] ?? 0);
  if (![h, mi, sec].every((x) => Number.isFinite(x))) return NaN;
  return h * 60 + mi + sec / 60;
}

export function timeToMinutes(time) {
  if (!time) return NaN;
  const [h, m, s] = String(time).split(":").map(Number);
  return h * 60 + m + (s || 0) / 60;
}

function getCheckoutAfterMinutes(shiftEndTime) {
  if (shiftEndTime) {
    const fromShift = timeToMinutes(shiftEndTime);
    if (Number.isFinite(fromShift)) return fromShift;
  }
  const fallback = process.env.BIOMETRIC_CHECKOUT_AFTER || "18:30:00";
  return timeToMinutes(fallback);
}

function isAtOrAfterCheckoutThreshold(punchTimePart, shiftEndTime) {
  const punchMin = wallTimeToMinutesSinceMidnight(punchTimePart);
  const threshold = getCheckoutAfterMinutes(shiftEndTime);
  return (
    Number.isFinite(punchMin) &&
    Number.isFinite(threshold) &&
    punchMin >= threshold
  );
}

/**
 * Resolve effective punch direction.
 * Device 'in' after shift end + already checked in → treat as checkout.
 */
export function resolvePunchDirection({
  rawDirection,
  punchTimePart,
  hasCheckIn,
  hasCheckOut,
  shiftEndTime,
}) {
  const parsed =
    rawDirection === "in" || rawDirection === "out" || rawDirection === "unknown"
      ? rawDirection
      : parseRawDirection(rawDirection);

  if (parsed === "out") return "out";

  if (!hasCheckIn) return "in";

  if (
    !hasCheckOut &&
    isAtOrAfterCheckoutThreshold(punchTimePart, shiftEndTime)
  ) {
    return "out";
  }

  return "in";
}

/** Replay today's punches in order to derive check-in, check-out, and latest punch. */
export function deriveDayAttendanceFromPunches(punches, shiftEndTime) {
  if (!punches?.length) {
    return {
      check_in: null,
      check_out: null,
      latest_punch_at: null,
      latest_punch_direction: null,
      punch_count: 0,
    };
  }

  let checkIn = null;
  let checkOut = null;

  for (const p of punches) {
    if (!p.punch_at) continue;

    const timePart = p.punch_at.includes(" ")
      ? p.punch_at.split(" ")[1]
      : p.punch_at;

    const dir = resolvePunchDirection({
      rawDirection: p.direction,
      punchTimePart: timePart,
      hasCheckIn: !!checkIn,
      hasCheckOut: !!checkOut,
      shiftEndTime,
    });

    if (dir === "in" && !checkIn) {
      checkIn = p.punch_at;
    } else if (dir === "out" && checkIn && !checkOut) {
      checkOut = p.punch_at;
    }
  }

  const latest = punches[punches.length - 1];

  return {
    check_in: checkIn ?? punches[0]?.punch_at ?? null,
    check_out: checkOut,
    latest_punch_at: latest?.punch_at ?? null,
    latest_punch_direction: latest?.direction ?? null,
    punch_count: punches.length,
  };
}
