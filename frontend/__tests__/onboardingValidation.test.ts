import {
  passwordGuide,
  daysInMonth,
  birthDateError,
  birthDateOptions,
  clampBirthDate,
  parseBirthDate,
  editClock,
  formatClockDigits,
  formatClock,
  formatPace,
  formatPhoneNumber,
  isValidLoginId,
  isValidNickname,
  isValidPassword,
  isValidPhoneNumber,
  nicknameError,
  phoneNumberError,
  parseClock,
  parseDistanceKm,
  passwordChecks,
  toBirthDate,
  cleanDistance,
  cleanLoginId,
  isValidCurrentPassword,
  cleanPassword,
  sameAsLoginId,
} from '../src/screens/onboarding/validation';

// S15P31E105-773: 아이디는 영문·숫자, 비밀번호는 영문·숫자·키보드 특수문자(ASCII 0x21~0x7E)만 남는다.
test('ID and password fields keep only the characters they take', () => {
  expect(cleanLoginId('러너runner_01 😀')).toBe('runner01');
  expect(cleanPassword('run way비번😀１2!~')).toBe('runway2!~');
  const symbols = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
  expect(cleanPassword(symbols)).toBe(symbols);
  expect(isValidPassword('runway12é')).toBe(false);
});

test('a password already set is checked against the server format only', () => {
  expect(isValidCurrentPassword('runner비번12')).toBe(true);
  expect(isValidCurrentPassword('비밀번호비밀번호')).toBe(true);
  expect(isValidCurrentPassword('short1')).toBe(false);
  expect(isValidCurrentPassword('has space1')).toBe(false);
  expect(isValidCurrentPassword('a'.repeat(21))).toBe(false);
});

test('a password that is the ID in any case is not taken', () => {
  expect(sameAsLoginId('Runner01', 'runner01')).toBe(true);
  expect(sameAsLoginId('runner01!', 'runner01')).toBe(false);
  expect(sameAsLoginId('runner01', undefined)).toBe(false);
  expect(isValidPassword('RUNNER01', 'runner01')).toBe(false);
  expect(isValidPassword('runner012', 'runner01')).toBe(true);
  expect(passwordGuide('Runner01', 'runner01')).toEqual({
    status: 'error',
    helper: '아이디와 다른 비밀번호를 입력해 주세요',
  });
});

// 페이스·완주 시간 칸은 숫자만, 거리 칸은 숫자와 소수점 하나만 남는다(S15P31E105-773).
test('pace, time and distance fields keep digits only', () => {
  expect(formatClockDigits('6분30초', 4)).toBe('6:30');
  expect(formatClockDigits('6:3a0', 4)).toBe('6:30');
  expect(formatClockDigits('６:30', 4)).toBe('30');
  expect(editClock('', '30m00', 6).text).toBe('30:00');
  expect(cleanDistance('5.5km')).toBe('5.5');
  expect(cleanDistance('5,5')).toBe('5.5');
  expect(cleanDistance('1..2')).toBe('1.');
  expect(cleanDistance('1.2.3')).toBe('1.2');
  expect(cleanDistance('.5')).toBe('.5');
  expect(parseDistanceKm(cleanDistance('1..2'))).toBeNull();
  expect(cleanDistance('-10')).toBe('10');
  expect(parseDistanceKm(cleanDistance('5.5km'))).toBe(5.5);
});

test('login IDs take 4–16 letters or digits only', () => {
  expect(isValidLoginId('minjun01')).toBe(true);
  expect(isValidLoginId('abc')).toBe(false);
  expect(isValidLoginId('a'.repeat(17))).toBe(false);
  expect(isValidLoginId('minjun_run')).toBe(false);
  expect(isValidLoginId('민준1234')).toBe(false);
});

test('passwords need 8 characters with a letter and a digit', () => {
  expect(passwordChecks('abc')).toEqual({
    length: false,
    letter: true,
    digit: false,
  });
  expect(isValidPassword('runway123')).toBe(true);
  expect(isValidPassword('12345678')).toBe(false);
  expect(isValidPassword('runwayrun')).toBe(false);
});

// S15P31E105-781: 서버와 같이 010으로 시작하는 11자리만 받는다.
test('phone numbers are 010 numbers with 11 digits, shown with dashes', () => {
  expect(isValidPhoneNumber('01024835917')).toBe(true);
  expect(isValidPhoneNumber('0102483591')).toBe(false);
  expect(isValidPhoneNumber('01124835917')).toBe(false);
  expect(isValidPhoneNumber('0112483591')).toBe(false);
  expect(isValidPhoneNumber('01624835917')).toBe(false);
  expect(isValidPhoneNumber('01924835917')).toBe(false);
  expect(isValidPhoneNumber('0212345678')).toBe(false);
  expect(isValidPhoneNumber('010248359170')).toBe(false);
  expect(formatPhoneNumber('01024835917')).toBe('010-2483-5917');
  expect(formatPhoneNumber('0102483591')).toBe('010-248-3591');
  expect(formatPhoneNumber('0102')).toBe('010-2');
});

test('the phone field tells why a number is refused', () => {
  const prefix = '010으로 시작하는 휴대폰 번호만 쓸 수 있어요';
  const length = '휴대폰 번호 11자리를 입력해 주세요';
  expect(phoneNumberError('')).toBeNull();
  expect(phoneNumberError('0')).toBeNull();
  expect(phoneNumberError('01')).toBeNull();
  expect(phoneNumberError('010')).toBeNull();
  // 앞자리가 틀리면 칸을 벗어나기 전에도 바로 알린다.
  expect(phoneNumberError('011')).toBe(prefix);
  expect(phoneNumberError('0162483591')).toBe(prefix);
  expect(phoneNumberError('02')).toBe(prefix);
  expect(phoneNumberError('1')).toBe(prefix);
  // 자릿수 부족은 칸을 벗어난 뒤에 알린다.
  expect(phoneNumberError('0102483591')).toBeNull();
  expect(phoneNumberError('0102483591', true)).toBe(length);
  expect(phoneNumberError('01024835917', true)).toBeNull();
});

// S15P31E105-781: 서버와 같이 완성형 한글·영문·숫자만 2~10자.
test('nicknames are 2–10 Korean letters, English letters or digits', () => {
  expect(isValidNickname('민')).toBe(false);
  expect(isValidNickname('민준')).toBe(true);
  expect(isValidNickname('Runner12')).toBe(true);
  expect(isValidNickname('가'.repeat(10))).toBe(true);
  expect(isValidNickname('가'.repeat(11))).toBe(false);
  // 앞뒤 공백은 잘라서 보내므로 통과하고, 가운데 공백은 서버가 거절하므로 막는다.
  expect(isValidNickname(' 민준 ')).toBe(true);
  expect(isValidNickname('홍 길동')).toBe(false);
  expect(isValidNickname('😀😀')).toBe(false);
  expect(isValidNickname('러너😀')).toBe(false);
  expect(isValidNickname('러너!')).toBe(false);
  expect(isValidNickname('run_ner')).toBe(false);
  expect(isValidNickname('ㅋㅋ')).toBe(false);
  expect(isValidNickname('가​나')).toBe(false);
  expect(isValidNickname('ｒｕｎ')).toBe(false);
});

test('the nickname field tells why a nickname is refused', () => {
  expect(nicknameError('')).toBeNull();
  expect(nicknameError('민준')).toBeNull();
  expect(nicknameError('홍 길동')).toBe('닉네임에는 공백을 쓸 수 없어요');
  expect(nicknameError('😀😀')).toBe('한글·영문·숫자만 쓸 수 있어요');
  expect(nicknameError('ㅋㅋ')).toBe('한글·영문·숫자만 쓸 수 있어요');
  expect(nicknameError('러너!')).toBe('한글·영문·숫자만 쓸 수 있어요');
  // 한글 조합 중 끝 글자가 잠깐 자모인 것은 칸을 벗어나기 전에는 알리지 않는다(781 리뷰 B-2).
  expect(nicknameError('민ㅈ')).toBeNull();
  expect(nicknameError('ㅁ')).toBeNull();
  expect(nicknameError('민ㅈ', true)).toBe('한글·영문·숫자만 쓸 수 있어요');
  expect(nicknameError('ㅋㅋ')).toBe('한글·영문·숫자만 쓸 수 있어요');
  // 한 글자는 칸을 벗어난 뒤에 알린다.
  expect(nicknameError('민')).toBeNull();
  expect(nicknameError('민', true)).toBe('닉네임은 2–10자로 입력해 주세요');
  expect(nicknameError('가'.repeat(11))).toBe('닉네임은 2–10자로 입력해 주세요');
});

test('birth dates respect month length and leap years', () => {
  expect(daysInMonth(2000, 2)).toBe(29);
  expect(daysInMonth(1991, 2)).toBe(28);
  expect(toBirthDate(1991, 3, 4)).toBe('1991-03-04');
});

test('finish time and pace convert both ways', () => {
  expect(parseClock('30:00')).toBe(1800);
  expect(parseClock('1:05:30')).toBe(3930);
  expect(parseClock('30:75')).toBeNull();
  expect(parseClock('30')).toBeNull();
  expect(parseDistanceKm('5')).toBe(5);
  expect(parseDistanceKm('10.55')).toBe(10.55);
  expect(parseDistanceKm('0')).toBeNull();
  expect(formatPace(1800 / 5)).toBe('6′00″/km');
  expect(formatClock(3930)).toBe('1:05:30');
  expect(formatClock(1800)).toBe('30:00');
});

test('digits typed for a time get the colons put in', () => {
  expect(formatClockDigits('3000', 6)).toBe('30:00');
  expect(formatClockDigits('10530', 6)).toBe('1:05:30');
  expect(formatClockDigits('600', 4)).toBe('6:00');
  expect(formatClockDigits('5', 4)).toBe('5');
  expect(formatClockDigits('0530', 4)).toBe('05:30');
  expect(formatClockDigits('12345', 4)).toBe('12:34');
  expect(formatClockDigits('', 6)).toBe('');
  expect(parseClock(formatClockDigits('10530', 6))).toBe(3930);
});

test('editing a time keeps the value and cursor on the digits', () => {
  // Typing at the end.
  expect(editClock('3:00', '3:000', 6)).toEqual({ text: '30:00', cursor: 5 });
  // Backspace at the end.
  expect(editClock('30:00', '30:0', 6)).toEqual({ text: '3:00', cursor: 4 });
  expect(editClock('6:00', '6:0', 4)).toEqual({ text: '60', cursor: 2 });
  // Backspace right after a colon removes the digit before it.
  expect(editClock('30:00', '3000', 6)).toEqual({ text: '3:00', cursor: 1 });
  // Typing in the middle keeps the cursor after the new digit.
  expect(editClock('30:00', '310:00', 6)).toEqual({
    text: '3:10:00',
    cursor: 3,
  });
  // Pasted or typed punctuation is ignored.
  expect(editClock('', '30:00', 6)).toEqual({ text: '30:00', cursor: 5 });
  // Beyond the length limit nothing changes.
  expect(editClock('12:34', '12:345', 4)).toEqual({ text: '12:34', cursor: 5 });
});

// A fixed today, so the 2026 cases do not move with the calendar.
const today = new Date('2026-11-07T03:00:00Z');

test.each([
  ['1950', '1', '1', '1950-01-01'],
  ['2010', '12', '31', '2010-12-31'],
  ['2011', '01', '01', '2011-01-01'],
  ['2026', '11', '07', '2026-11-07'],
  ['2000', '02', '29', '2000-02-29'],
  ['1991', '02', '29', null],
  ['2000', '02', '30', null],
  ['2001', '04', '31', null],
  ['1949', '12', '31', null],
  ['2026', '11', '08', null],
  ['2026', '12', '01', null],
  ['2027', '01', '01', null],
  ['2000', '00', '01', null],
  ['2000', '13', '01', null],
  ['2000', '01', '00', null],
  ['200', '01', '01', null],
  ['2000', '', '01', null],
  ['2000', '01', '', null],
  ['abcd', '01', '01', null],
])(
  'birth date %s-%s-%s parses without normalizing invalid dates',
  (year, month, day, expected) => {
    const parts = { year, month, day };
    expect(parseBirthDate(parts, today)).toBe(expected);
    expect(birthDateError(parts, today) === null).toBe(expected !== null);
  },
);

test('birth date wheels list 1950–2026 and nothing after today (UTC)', () => {
  const full = birthDateOptions({ year: 2000, month: 2, day: 1 }, today);
  expect(full.years[0]).toBe(1950);
  expect(full.years[full.years.length - 1]).toBe(2026);
  expect(full.months).toHaveLength(12);
  expect(full.days).toHaveLength(29);
  // November 2026 stops at the 7th, and 2026 itself at November.
  const latest = birthDateOptions({ year: 2026, month: 11, day: 1 }, today);
  expect(latest.months[latest.months.length - 1]).toBe(11);
  expect(latest.days[latest.days.length - 1]).toBe(7);
  // 00:30 on the 8th in Korea is still the 7th in UTC, which U15 checks.
  const korea = birthDateOptions(
    { year: 2026, month: 11, day: 1 },
    new Date('2026-11-07T15:30:00Z'),
  );
  expect(korea.days[korea.days.length - 1]).toBe(7);
});

test('birth date wheels pull a date back inside their lists', () => {
  expect(clampBirthDate({ year: 1991, month: 2, day: 31 }, today)).toEqual({
    year: 1991,
    month: 2,
    day: 28,
  });
  expect(clampBirthDate({ year: 2026, month: 12, day: 25 }, today)).toEqual({
    year: 2026,
    month: 11,
    day: 7,
  });
  expect(clampBirthDate({ year: 1940, month: 5, day: 5 }, today)).toEqual({
    year: 1950,
    month: 5,
    day: 5,
  });
});

// S15P31E105-646: 비밀번호 칸 아래 안내. 입력 전 없음, 조건 미충족은 빨간 상태로 영문 · 숫자 · 8자 이상과 만족한 조건의 ✓.
test('the password guide is empty before typing and red until every rule is met', () => {
  expect(passwordGuide('')).toEqual({ status: 'default', helper: undefined });
  expect(passwordGuide('runway')).toEqual({
    status: 'error',
    helper: '✓ 영문 · 숫자 · 8자 이상',
  });
  expect(passwordGuide('12345678')).toEqual({
    status: 'error',
    helper: '영문 · ✓ 숫자 · ✓ 8자 이상',
  });
  expect(passwordGuide('runway12')).toEqual({
    status: 'success',
    helper: '사용할 수 있는 비밀번호예요',
  });
  expect(passwordGuide('run way12')).toEqual({
    status: 'error',
    helper: '공백 없이 8~20자로 입력해 주세요',
  });
});
