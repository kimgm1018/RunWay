import { controlNotice } from '../src/screens/run/controlNotice';

// S15P31E105-446: 종료 저장 미확인은 원인별로 안내하고, 성공으로 보이지 않게 '다시 확인'을 함께 둔다.
test('save unconfirmed tells a missing watch result from an unsaved last record', () => {
  expect(controlNotice({ kind: 'saveUnconfirmed', reason: 'NO_RESULT' }, ['RESUME', 'END'])).toEqual({
    text: '워치의 종료 결과를 받지 못했어요',
    recheck: true,
  });
  expect(controlNotice({ kind: 'saveUnconfirmed', reason: 'UPLOAD_PENDING' }, ['RESUME', 'END'])).toEqual({
    text: '마지막 기록 저장을 확인하지 못했어요',
    recheck: true,
  });
  // 종료가 없는 화면(진행 중)은 종료 저장 문제를 보여 주지 않는다.
  expect(controlNotice({ kind: 'saveUnconfirmed', reason: 'NO_RESULT' }, ['PAUSE', 'RESUME'])).toBeNull();
});
