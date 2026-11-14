import { DataError } from '../src/data/errors';
import {
  groupRunValidationText,
  validationRefusedText,
} from '../src/screens/group/groupRunErrors';
import { scheduleRefusedText } from '../src/screens/group/groupRunSchedule';

// S15P31E105-818: a 400 VALIDATION_ERROR of G01·G04 names the input the server pointed at, and only a schedule
// refusal says the date and time cannot be used. The server names the field for a too long text and for an empty
// one alike, so the text asks to check the input instead of saying it is too long.
const refused = (fields: { name: string; reason: string }[], message = '') =>
  new DataError('VALIDATION_ERROR', message, null, 400, { fields });

test('a refused 장소 이름 is told as such, not as a schedule problem', () => {
  const text = groupRunValidationText(
    refused([{ name: 'meetingPlaceName', reason: '크기가 0에서 200 사이여야 합니다' }]),
  );
  expect(text).toBe(
    '장소 이름을 확인해 주세요. 비워 둘 수 없고 200자 이하여야 해요',
  );
  expect(text).not.toContain('날짜');
  expect(text).not.toContain('너무 길어요');
});

test('a refused 찾아오는 법 and a refused address are told apart', () => {
  expect(
    groupRunValidationText(refused([{ name: 'description', reason: '길이' }])),
  ).toBe('찾아오는 법을 확인해 주세요. 10000자 이하여야 해요');
  expect(
    groupRunValidationText(refused([{ name: 'meetingAddress', reason: '길이' }])),
  ).toBe('고른 장소의 주소를 쓸 수 없어요. 다른 장소를 골라 주세요');
});

test('the schedule refusal (no fields, 출발 시각 message, or a scheduledAt field) keeps the schedule notice', () => {
  expect(
    groupRunValidationText(
      new DataError(
        'VALIDATION_ERROR',
        '출발 시각은 지금 이후 13일 안, 05:00~22:00(한국 시간)이어야 합니다.',
        null,
        400,
        {},
      ),
    ),
  ).toBe(scheduleRefusedText);
  expect(
    groupRunValidationText(refused([{ name: 'scheduledAt', reason: '형식' }])),
  ).toBe(scheduleRefusedText);
});

test('an unknown 400 does not blame the date and time', () => {
  const text = groupRunValidationText(
    new DataError('VALIDATION_ERROR', '요청 값이 유효하지 않습니다.', null, 400, null),
  );
  expect(text).toBe(validationRefusedText);
  expect(text).not.toBe(scheduleRefusedText);
  expect(groupRunValidationText(new Error('x'))).toBe(validationRefusedText);
});

test('an empty 장소 이름 (@NotBlank) is not called too long', () => {
  const text = groupRunValidationText(
    refused([{ name: 'meetingPlaceName', reason: '공백일 수 없습니다' }]),
  );
  expect(text).not.toContain('너무 길어요');
});

test('a field name that is an Object property is not looked up as a field', () => {
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    expect(groupRunValidationText(refused([{ name, reason: '?' }]))).toBe(
      validationRefusedText,
    );
  }
});
