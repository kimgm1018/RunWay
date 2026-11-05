import {
  daysInMonth,
  birthDateError,
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
  parseClock,
  parseDistanceKm,
  passwordChecks,
  toBirthDate,
} from '../src/screens/onboarding/validation';

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

test('phone numbers are Korean mobile numbers shown with dashes', () => {
  expect(isValidPhoneNumber('01024835917')).toBe(true);
  expect(isValidPhoneNumber('0102483591')).toBe(true);
  expect(isValidPhoneNumber('0212345678')).toBe(false);
  expect(formatPhoneNumber('01024835917')).toBe('010-2483-5917');
  expect(formatPhoneNumber('0102483591')).toBe('010-248-3591');
  expect(formatPhoneNumber('0102')).toBe('010-2');
});

test('nicknames are 2–10 characters', () => {
  expect(isValidNickname('민')).toBe(false);
  expect(isValidNickname('민준')).toBe(true);
  expect(isValidNickname('가'.repeat(11))).toBe(false);
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

test.each([
  ['1950', '1', '1', '1950-01-01'],
  ['2010', '12', '31', '2010-12-31'],
  ['2000', '02', '29', '2000-02-29'],
  ['1991', '02', '29', null],
  ['2000', '02', '30', null],
  ['2001', '04', '31', null],
  ['1949', '12', '31', null],
  ['2011', '01', '01', null],
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
    expect(parseBirthDate(parts)).toBe(expected);
    expect(birthDateError(parts) === null).toBe(expected !== null);
  },
);
