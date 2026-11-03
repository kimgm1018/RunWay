// Input rules from docs/design/api/users.md (U01·U15) and the messages on prototype v15 1.x.

export const loginIdRule = '영문·숫자 4–16자';
export const nicknameRule = '2–10자 · 그룹런과 커뮤니티에 표시돼요';

export function isValidLoginId(value: string) {
  return /^[A-Za-z0-9]{4,16}$/.test(value);
}

// 1.3 shows each password condition as its own chip.
export function passwordChecks(value: string) {
  return {
    length: value.length >= 8,
    letter: /[A-Za-z]/.test(value),
    digit: /\d/.test(value),
  };
}

export function isValidPassword(value: string) {
  return Object.values(passwordChecks(value)).every(Boolean);
}

export function digitsOnly(value: string) {
  return value.replace(/\D/g, '');
}

// Korean mobile numbers, stored as digits only (U15 phoneNumber).
export function isValidPhoneNumber(digits: string) {
  return /^01[016789]\d{7,8}$/.test(digits);
}

export function formatPhoneNumber(digits: string) {
  const value = digitsOnly(digits).slice(0, 11);
  if (value.length < 4) {
    return value;
  }
  if (value.length < 8) {
    return `${value.slice(0, 3)}-${value.slice(3)}`;
  }
  const middle = value.length === 11 ? 4 : 3;
  return `${value.slice(0, 3)}-${value.slice(3, 3 + middle)}-${value.slice(
    3 + middle,
  )}`;
}

export function isValidVerificationCode(value: string) {
  return /^\d{6}$/.test(value);
}

export function isValidNickname(value: string) {
  const length = [...value.trim()].length;
  return length >= 2 && length <= 10;
}

export function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export function toBirthDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(
    2,
    '0',
  )}`;
}

// "30:00" or "1:05:30" → seconds; "6:00" pace → seconds per km.
export function parseClock(value: string) {
  const parts = value.trim().split(':');
  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some(part => !/^\d+$/.test(part))
  ) {
    return null;
  }
  const numbers = parts.map(Number);
  const [seconds, minutes, hours = 0] = [...numbers].reverse();
  if (seconds >= 60 || (parts.length === 3 && minutes >= 60)) {
    return null;
  }
  const total = hours * 3600 + minutes * 60 + seconds;
  return total > 0 ? total : null;
}

export function formatClock(totalSeconds: number) {
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = String(rounded % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

// 6′00″/km as in 1.6.
export function formatPace(secondsPerKm: number) {
  const rounded = Math.round(secondsPerKm);
  return `${Math.floor(rounded / 60)}′${String(rounded % 60).padStart(
    2,
    '0',
  )}″/km`;
}

export function parseDistanceKm(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) {
    return null;
  }
  const km = Number(value);
  return km > 0 && km <= 100 ? km : null;
}

// Time inputs take digits only and put the colons in: 3000 → 30:00, 10530 → 1:05:30, 600 → 6:00.
export function formatClockDigits(value: string, maxDigits: number) {
  const digits = digitsOnly(value).slice(0, maxDigits);
  if (digits.length <= 2) {
    return digits;
  }
  if (digits.length <= 4) {
    return `${digits.slice(0, -2)}:${digits.slice(-2)}`;
  }
  return `${digits.slice(0, -4)}:${digits.slice(-4, -2)}:${digits.slice(-2)}`;
}

// Text position right after the given number of digits.
function positionAfterDigits(text: string, count: number) {
  if (count <= 0) {
    return 0;
  }
  let seen = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (/\d/.test(text[index])) {
      seen += 1;
      if (seen === count) {
        return index + 1;
      }
    }
  }
  return text.length;
}

// Reformats one edit of a time input and keeps the cursor next to the same digit.
// Deleting a colon deletes the digit before it, so backspace never gets stuck.
export function editClock(previous: string, raw: string, maxDigits: number) {
  let prefix = 0;
  while (
    prefix < previous.length &&
    prefix < raw.length &&
    previous[prefix] === raw[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  const room = Math.min(previous.length, raw.length) - prefix;
  while (
    suffix < room &&
    previous[previous.length - 1 - suffix] === raw[raw.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  let digits = digitsOnly(raw);
  let digitsBeforeCursor = digitsOnly(raw.slice(0, raw.length - suffix)).length;
  if (digits === digitsOnly(previous) && raw.length < previous.length) {
    const before = digitsOnly(raw.slice(0, prefix)).length;
    if (before > 0) {
      digits = digits.slice(0, before - 1) + digits.slice(before);
      digitsBeforeCursor = before - 1;
    }
  }
  if (digits.length > maxDigits) {
    return { text: previous, cursor: Math.min(prefix, previous.length) };
  }
  const text = formatClockDigits(digits, maxDigits);
  return { text, cursor: positionAfterDigits(text, digitsBeforeCursor) };
}
