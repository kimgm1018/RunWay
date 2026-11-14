import { DataError } from '../../data/errors';
import {
  GROUP_RUN_NOTE_MAX,
  GROUP_RUN_PLACE_NAME_MAX,
} from '../inputLimits';
import { scheduleRefusedText } from './groupRunSchedule';

// 서버가 일정 범위를 벗어난 요청에 주는 메시지의 앞부분(ErrorCode VALIDATION_ERROR_GROUPRUN_SCHEDULE).
// 이 경우만 details.fields 없이 온다.
const scheduleMessageStart = '출발 시각';

// 어느 입력인지 알 수 없을 때: 일정이라고 단정하지 않는다.
export const validationRefusedText =
  '입력한 내용을 서버가 받지 못했어요. 날짜·시간, 장소 이름, 찾아오는 법을 확인해 주세요';

// 필드 이름만 알려 주고 이유(길이 초과인지, @NotBlank의 빈 값인지)는 구분하지 않으므로 "너무 길어요"로 단정하지 않는다.
// Map이라 서버가 보낸 이름이 `constructor` 같은 Object 속성이어도 조회되지 않는다.
const fieldTexts = new Map<string, string>([
  [
    'meetingPlaceName',
    `장소 이름을 확인해 주세요. 비워 둘 수 없고 ${GROUP_RUN_PLACE_NAME_MAX}자 이하여야 해요`,
  ],
  [
    'description',
    `찾아오는 법을 확인해 주세요. ${GROUP_RUN_NOTE_MAX}자 이하여야 해요`,
  ],
  ['meetingAddress', '고른 장소의 주소를 쓸 수 없어요. 다른 장소를 골라 주세요'],
  ['scheduledAt', scheduleRefusedText],
]);

function fieldNames(error: DataError): string[] {
  const fields = error.details?.fields;
  if (!Array.isArray(fields)) {
    return [];
  }
  return fields.flatMap(item => {
    const name = (item as { name?: unknown } | null)?.name;
    return typeof name === 'string' ? [name] : [];
  });
}

// G01·G04의 400 VALIDATION_ERROR에 맞는 안내(S15P31E105-818). 서버가 알려 준 입력 칸 이름으로 고르고,
// 일정 거절은 메시지로 알아본다. 어느 쪽도 아니면 일정이라고 단정하지 않는 문구를 쓴다.
export function groupRunValidationText(error: unknown): string {
  if (!(error instanceof DataError)) {
    return validationRefusedText;
  }
  for (const name of fieldNames(error)) {
    const text = fieldTexts.get(name);
    if (text) {
      return text;
    }
  }
  return error.message.startsWith(scheduleMessageStart)
    ? scheduleRefusedText
    : validationRefusedText;
}
