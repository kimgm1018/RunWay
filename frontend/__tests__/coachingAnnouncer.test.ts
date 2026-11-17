import type { CoachingGuide, CoachingLevel } from '../src/data/types';
import { createCoachingAnnouncer } from '../src/screens/run/coachingAnnouncer';

// S15P31E105-579: 언제 읽고 언제 읽지 않는지(Jira 579 "언제 읽나", 완료 조건 1·2).

let commandId = 0;
const guide = (
  pace: number,
  level: CoachingLevel | null,
  id = String(++commandId),
): CoachingGuide => ({
  commandId: id,
  coachingId: `c${id}`,
  expectedVersion: 1,
  targetBpm: 160,
  recommendedPaceSecPerKm: pace,
  expiresAt: '2026-11-10T01:00:00Z',
  coachingLevel: level,
});

function setup(enabled = true) {
  const out = {
    enabled: jest.fn(() => enabled),
    speak: jest.fn(),
    stop: jest.fn(),
  };
  const announcer = createCoachingAnnouncer(out);
  return { out, announcer };
}

test('reads a changed guide once while running, after the silent first one', () => {
  const { out, announcer } = setup();
  announcer.setRunning(true);
  announcer.applied(guide(360, 'OK'));
  expect(out.speak).not.toHaveBeenCalled();
  const caution = guide(370, 'CAUTION');
  announcer.applied(caution);
  expect(out.speak).toHaveBeenCalledWith(
    '심박이 오르고 있어요. 6분 10초 페이스로 늦춰 주세요.',
  );
  // 같은 명령을 다시 받아도(재전송) 다시 읽지 않는다.
  announcer.applied(caution);
  expect(out.speak).toHaveBeenCalledTimes(1);
});

test('an unchanged reminder is read again only at DANGER', () => {
  const { out, announcer } = setup();
  announcer.setRunning(true);
  announcer.applied(guide(360, 'OK'));
  announcer.applied(guide(370, 'CAUTION'));
  // 2분 재안내: 새 명령이지만 페이스·단계가 그대로다.
  announcer.applied(guide(370, 'CAUTION'));
  expect(out.speak).toHaveBeenCalledTimes(1);
  announcer.applied(guide(400, 'DANGER'));
  announcer.applied(guide(400, 'DANGER'));
  expect(out.speak).toHaveBeenCalledTimes(3);
  expect(out.speak).toHaveBeenLastCalledWith(
    '심박이 너무 높아요. 6분 40초 페이스로 늦춰 주세요.',
  );
});

test('with the voice setting off nothing is read, but the guide still becomes the previous one', () => {
  const { out, announcer } = setup(false);
  announcer.setRunning(true);
  announcer.applied(guide(360, 'OK'));
  announcer.applied(guide(370, 'CAUTION'));
  expect(out.speak).not.toHaveBeenCalled();
  expect(out.enabled).toHaveBeenCalled();
});

test('nothing is read while paused, and pausing cuts the sentence being read', () => {
  const { out, announcer } = setup();
  announcer.setRunning(true);
  announcer.applied(guide(360, 'OK'));
  announcer.setRunning(false);
  expect(out.stop).toHaveBeenCalledTimes(1);
  // 일시정지 중 받은 코칭은 읽지 않지만 직전 안내로 남는다.
  announcer.applied(guide(370, 'CAUTION'));
  expect(out.speak).not.toHaveBeenCalled();
  announcer.setRunning(true);
  // 직전이 6분 10초 CAUTION이므로 같은 페이스·단계의 재안내는 읽지 않는다.
  announcer.applied(guide(370, 'CAUTION'));
  expect(out.speak).not.toHaveBeenCalled();
  // 계속 멈춰 있는 동안에는 stop을 반복하지 않는다.
  announcer.setRunning(false);
  announcer.setRunning(false);
  expect(out.stop).toHaveBeenCalledTimes(2);
});

test('reset forgets the previous guide and handled commands', () => {
  const { out, announcer } = setup();
  announcer.setRunning(true);
  const first = guide(360, 'OK');
  announcer.applied(first);
  announcer.reset();
  expect(out.stop).toHaveBeenCalledTimes(1);
  announcer.setRunning(true);
  // 새 세션처럼 첫 안내는 읽지 않는다. 같은 commandId도 다시 다룬다.
  announcer.applied(guide(400, 'DANGER'));
  expect(out.speak).not.toHaveBeenCalled();
  announcer.applied(first);
  expect(out.speak).toHaveBeenCalledWith(
    '여유가 있어요. 6분 페이스로 올려도 좋아요.',
  );
});

// S15P31E105-906: 그룹런 공동 페이스 음성이 같은 페이스를 방금 말했으면 코칭은 읽지 않는다(다음 비교의 기준은 이어 간다).
test('skips a guide the group pace voice just announced and keeps it as the next baseline', () => {
  const duplicate = jest.fn((pace: number) => pace === 400);
  const spoken = jest.fn();
  const out = {
    enabled: jest.fn(() => true),
    speak: jest.fn(),
    stop: jest.fn(),
    duplicate,
    spoken,
  };
  const announcer = createCoachingAnnouncer(out);
  announcer.setRunning(true);
  announcer.applied(guide(360, 'OK'));
  announcer.applied(guide(400, 'OK'));
  expect(out.speak).not.toHaveBeenCalled();
  expect(spoken).not.toHaveBeenCalled();
  // 400이 기준이 됐으므로 403은 변화가 작아 읽지 않고, 380은 읽는다.
  announcer.applied(guide(403, 'OK'));
  expect(out.speak).not.toHaveBeenCalled();
  announcer.applied(guide(380, 'OK'));
  expect(out.speak).toHaveBeenCalledTimes(1);
  expect(spoken).toHaveBeenCalledWith(380);
});
