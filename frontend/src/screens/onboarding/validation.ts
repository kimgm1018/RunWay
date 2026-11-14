// Input rules from docs/design/api/users.md (U01·U15) and the messages on prototype v15 1.x.

export const loginIdRule = '영문/숫자 4~16자';
export const nicknameRule = '한글·영문·숫자 2–10자 · 그룹런과 커뮤니티에 표시돼요';

export function isValidLoginId(value: string) {
  return /^[A-Za-z0-9]{4,16}$/.test(value);
}

// S15P31E105-773: 아이디·비밀번호 칸은 쓸 수 없는 문자(한글·이모지·공백 등)를 입력하는 즉시 지운다. 아이디는 영문·숫자만, 비밀번호는
// 영문·숫자·키보드 특수문자(ASCII 0x21~0x7E)만 받는다(users.md U15·U30). 지운 문자가 있으면 칸 아래에 이 안내를 보인다.
export const loginIdCharsNotice = '영문·숫자만 입력할 수 있어요';
export const passwordCharsNotice = '영문·숫자·특수문자만 입력할 수 있어요';

export function cleanLoginId(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, '');
}

export function cleanPassword(value: string) {
  return value.replace(/[^\x21-\x7E]/g, '');
}

// 아이디와 같은 비밀번호는 대소문자와 상관없이 쓸 수 없다(users.md U15·U30, S15P31E105-773).
export const passwordSameAsIdRule = '아이디와 다른 비밀번호를 입력해 주세요';

export function sameAsLoginId(password: string, loginId?: string) {
  return !!loginId && password.toLowerCase() === loginId.toLowerCase();
}

// 1.3 shows each password condition as its own chip.
export function passwordChecks(value: string) {
  return {
    length: [...value].length >= 8,
    letter: /[A-Za-z]/.test(value),
    digit: /\d/.test(value),
  };
}

// The server's shared password policy (users.md U15·U30): at most 20 characters and no spaces. Checked here so a
// password the server would turn down with 422 is never sent (S15P31E105-560 review R-3).
export const passwordLimitRule = '공백 없이 8~20자로 입력해 주세요';

export function passwordWithinLimit(value: string) {
  return [...value].length <= 20 && !/\s/.test(value);
}

// 이미 정한 비밀번호를 확인할 때(탈퇴 등): 서버 공통 형식(8~20자·공백 없음)만 본다. 773 이전에 가입한 계정의 한글 등
// 비밀번호도 막지 않는다(users.md, S15P31E105-773 리뷰 A-1).
export function isValidCurrentPassword(value: string) {
  return [...value].length >= 8 && passwordWithinLimit(value);
}

export function isValidPassword(value: string, loginId?: string) {
  return (
    Object.values(passwordChecks(value)).every(Boolean) &&
    passwordWithinLimit(value) &&
    cleanPassword(value) === value &&
    !sameAsLoginId(value, loginId)
  );
}

// 1.3 회원가입·1.2q 새 비밀번호 칸(S15P31E105-627): 아이디 칸처럼 안 글씨에 규칙을 보이고, 아래 안내에서 만족한 조건마다
// ✓를 붙인다. 모두 만족하면 success가 되어 TextField가 안내 앞에 ✓를 붙이고 초록색으로 보인다.
// 아이디(영문/숫자 아무거나)와 달리 영문과 숫자가 모두 있어야 해서 '포함'으로 구분한다(S15P31E105-646, 담당자 결정).
export const passwordRule = '영문, 숫자 포함 8자 이상';
// 아이디 칸 규칙(영문/숫자 4~16자)과 같은 순서로 보인다(S15P31E105-646).
const passwordLabels = { letter: '영문', digit: '숫자', length: '8자 이상' };

export function passwordGuide(
  value: string,
  loginId?: string,
): {
  status: 'default' | 'success' | 'error';
  helper: string | undefined;
} {
  // 아무것도 입력하지 않았으면 안 글씨(규칙)만 보이고 아래 안내는 없다(S15P31E105-646).
  if (!value) {
    return { status: 'default', helper: undefined };
  }
  if (value && !passwordWithinLimit(value)) {
    return { status: 'error', helper: passwordLimitRule };
  }
  if (cleanPassword(value) !== value) {
    return { status: 'error', helper: passwordCharsNotice };
  }
  if (sameAsLoginId(value, loginId)) {
    return { status: 'error', helper: passwordSameAsIdRule };
  }
  if (value && isValidPassword(value, loginId)) {
    return { status: 'success', helper: '사용할 수 있는 비밀번호예요' };
  }
  // 아이디 칸처럼 조건을 다 채우기 전에는 빨간 테두리·글씨로 알리고, 만족한 조건에는 ✓를 붙인다(S15P31E105-646).
  const checks = passwordChecks(value);
  const keys = Object.keys(passwordLabels) as (keyof typeof passwordLabels)[];
  return {
    status: 'error',
    helper: keys
      .map(key =>
        checks[key] ? `✓ ${passwordLabels[key]}` : passwordLabels[key],
      )
      .join(' · '),
  };
}

// 비밀번호 확인 칸: 입력하면 일치 여부를 알려 준다.
export function confirmGuide(password: string, confirm: string) {
  if (!confirm) {
    return { status: 'default' as const, helper: undefined };
  }
  return confirm === password
    ? { status: 'success' as const, helper: '비밀번호가 일치해요' }
    : { status: 'error' as const, helper: '비밀번호가 일치하지 않아요' };
}

export function digitsOnly(value: string) {
  return value.replace(/\D/g, '');
}

// 서버와 같은 규칙: 010으로 시작하는 숫자 11자리(users.md U15·U28 phoneNumber, S15P31E105-781). 숫자만 저장한다.
export function isValidPhoneNumber(digits: string) {
  return /^010\d{8}$/.test(digits);
}

// 휴대폰 번호 칸 아래 안내. 앞자리가 010이 아니면 바로, 자릿수가 모자라면 칸을 벗어난 뒤(done) 알린다.
export function phoneNumberError(digits: string, done = false) {
  if (!digits) {
    return null;
  }
  if (!'010'.startsWith(digits.slice(0, 3))) {
    return '010으로 시작하는 휴대폰 번호만 쓸 수 있어요';
  }
  if (done && !isValidPhoneNumber(digits)) {
    return '휴대폰 번호 11자리를 입력해 주세요';
  }
  return null;
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

// 서버와 같은 닉네임 규칙(users.md U15·U05, S15P31E105-781): 완성형 한글·영문·숫자만 2~10자. 앞뒤 공백은 잘라서 보낸다.
export function isValidNickname(value: string) {
  return /^[가-힣A-Za-z0-9]{2,10}$/.test(value.trim());
}

// 닉네임 칸 아래 안내. 공백·허용하지 않는 문자는 바로, 길이 부족은 칸을 벗어난 뒤(done) 알린다.
export function nicknameError(value: string, done = false) {
  const nickname = value.trim();
  if (!nickname) {
    return null;
  }
  if (/\s/.test(nickname)) {
    return '닉네임에는 공백을 쓸 수 없어요';
  }
  // 한글을 조합하는 중에는 끝 글자가 잠깐 자모(ㅈ 등)가 된다. 칸을 벗어나기 전에는 이것만으로 안내하지 않는다(781 리뷰 B-2).
  const composing = done ? nickname : nickname.replace(/[ㄱ-ㆎ]$/, '');
  if (/[^가-힣A-Za-z0-9]/.test(composing)) {
    return '한글·영문·숫자만 쓸 수 있어요';
  }
  if ([...nickname].length > 10 || (done && [...nickname].length < 2)) {
    return '닉네임은 2–10자로 입력해 주세요';
  }
  return null;
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

// The app offers birth years 1950–2026 (S15P31E105-520); users.md only forbids dates after today (UTC).
export const birthYearMin = 1950;
export const birthYearMax = 2026;
// 1.5b's wheels start here until a date is picked.
export const defaultBirthDate: BirthDate = { year: 2002, month: 1, day: 1 };

export type BirthDateParts = { year: string; month: string; day: string };
export type BirthDate = { year: number; month: number; day: number };

// U15 · U05 compare with today in UTC, so a date that is already today in Korea can still be "future" there.
function utcToday(now: Date): BirthDate {
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
  };
}

const range = (first: number, last: number) =>
  Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);

// The years, months and days the wheels list for a date: nothing before 1950, after 2026 or after today.
export function birthDateOptions(
  { year, month }: BirthDate,
  now = new Date(),
) {
  const today = utcToday(now);
  const lastMonth = year === today.year ? today.month : 12;
  const lastDay =
    year === today.year && month === today.month
      ? today.day
      : daysInMonth(year, month);
  return {
    years: range(birthYearMin, Math.min(birthYearMax, today.year)),
    months: range(1, lastMonth),
    days: range(1, lastDay),
  };
}

// Pulls a date back inside those lists: a shorter month moves the 31st to its last day.
export function clampBirthDate(date: BirthDate, now = new Date()): BirthDate {
  const clamp = (value: number, list: number[]) =>
    Math.min(Math.max(value, list[0]), list[list.length - 1]);
  const year = clamp(date.year, birthDateOptions(date, now).years);
  const month = clamp(
    date.month,
    birthDateOptions({ ...date, year }, now).months,
  );
  const day = clamp(
    date.day,
    birthDateOptions({ ...date, year, month }, now).days,
  );
  return { year, month, day };
}

export function birthDateError(
  { year, month, day }: BirthDateParts,
  now = new Date(),
) {
  if (
    !/^\d{4}$/.test(year) ||
    !/^\d{1,2}$/.test(month) ||
    !/^\d{1,2}$/.test(day)
  ) {
    return '연도와 월·일을 모두 골라 주세요';
  }
  if (Number(year) < birthYearMin || Number(year) > birthYearMax) {
    return `연도는 ${birthYearMin}~${birthYearMax}년 사이로 골라 주세요`;
  }
  if (
    Number(month) < 1 ||
    Number(month) > 12 ||
    Number(day) < 1 ||
    Number(day) > daysInMonth(Number(year), Number(month))
  ) {
    return '존재하는 날짜를 골라 주세요';
  }
  const today = utcToday(now);
  if (
    toBirthDate(Number(year), Number(month), Number(day)) >
    toBirthDate(today.year, today.month, today.day)
  ) {
    return '오늘 이후 날짜는 고를 수 없어요';
  }
  return null;
}

export function parseBirthDate(parts: BirthDateParts, now = new Date()) {
  return birthDateError(parts, now) === null
    ? toBirthDate(Number(parts.year), Number(parts.month), Number(parts.day))
    : null;
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

// 거리 칸은 숫자와 소수점 하나만 남긴다. 붙여넣은 '5.5km'는 5.5가 되고, 소수점 키가 쉼표인 기기의 '5,5'도 5.5다.
// 두 번째 소수점부터는 버려 '1.2.3'이 다른 거리(1.23)로 바뀌지 않게 한다(S15P31E105-773 리뷰 A-3·B-2).
export function cleanDistance(value: string) {
  const [whole, fraction] = value
    .replace(/,/g, '.')
    .replace(/[^0-9.]/g, '')
    .split('.');
  return fraction === undefined ? whole : `${whole}.${fraction}`;
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
