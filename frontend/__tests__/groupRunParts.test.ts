import { canEnterRoom, dDay, startsIn } from '../src/screens/group/parts';
import type { GroupRunSummary } from '../src/data';

// canEnterRoom stays SCHEDULED-only; RUNNING/COMPLETED use detail CTAs instead (S15P31E105-637).

const now = new Date('2026-10-19T12:50:00+09:00');

function run(
  status: GroupRunSummary['status'],
  overrides: Partial<GroupRunSummary> = {},
): GroupRunSummary {
  return {
    id: 'gr-today',
    crewId: 'crew-gwangalli',
    crewName: '광안리 새벽 크루',
    title: '월요일 점심, 함께 5km',
    hostId: 'user-seongyun',
    hostNickname: '성윤',
    isHost: false,
    scheduledAt: '2026-10-19T13:00:00+09:00',
    meetingPlaceName: '광안리해수욕장 입구',
    meetingAddress: '부산 수영구 광안해변로 219',
    courseId: 'course-minrak',
    courseName: '민락수변공원 출발 5.0km',
    targetDistanceM: 5000,
    targetDurationSec: null,
    participantCount: 5,
    joined: true,
    status,
    ...overrides,
  };
}

test('canEnterRoom opens only for joined SCHEDULED runs in the 30-minute window', () => {
  expect(canEnterRoom(run('SCHEDULED'), now)).toBe(true);
  expect(canEnterRoom(run('SCHEDULED', { joined: false }), now)).toBe(false);
  expect(
    canEnterRoom(run('SCHEDULED'), new Date('2026-10-19T12:20:00+09:00')),
  ).toBe(false);
  expect(canEnterRoom(run('RUNNING'), now)).toBe(false);
  expect(canEnterRoom(run('COMPLETED'), now)).toBe(false);
  expect(canEnterRoom(run('CANCELLED'), now)).toBe(false);
});

// S15P31E105-823: a run whose KST day has passed is not 오늘, and an old start no longer reads 곧 출발.
test('dDay tells past, today and coming KST days apart', () => {
  const at = '2026-11-09T11:00:00+09:00';
  expect(dDay(at, new Date('2026-11-14T18:00:00+09:00'))).toBe('지남');
  expect(dDay(at, new Date('2026-11-10T00:00:00+09:00'))).toBe('지남');
  expect(dDay(at, new Date('2026-11-09T23:59:00+09:00'))).toBe('오늘');
  expect(dDay(at, new Date('2026-11-09T00:00:00+09:00'))).toBe('오늘');
  expect(dDay(at, new Date('2026-11-08T23:59:00+09:00'))).toBe('D-1');
  expect(dDay(at, new Date('2026-11-05T09:00:00+09:00'))).toBe('D-4');
  // KST midnight, not UTC: 11.10 00:30 KST is still 11.09 in UTC.
  expect(
    dDay('2026-11-09T23:30:00+09:00', new Date('2026-11-10T00:30:00+09:00')),
  ).toBe('지남');
});

test('dDay says a run under way regardless of its date', () => {
  const evening = new Date('2026-11-14T18:00:00+09:00');
  expect(dDay('2026-11-13T23:30:00+09:00', evening, 'RUNNING')).toBe('진행 중');
  expect(dDay('2026-11-09T11:00:00+09:00', evening, 'SCHEDULED')).toBe('지남');
  expect(dDay('2026-11-16T11:00:00+09:00', evening, 'SCHEDULED')).toBe('D-2');
});

test('startsIn keeps 곧 출발 only while a late start is still likely', () => {
  const at = '2026-11-14T18:00:00+09:00';
  expect(startsIn(at, new Date('2026-11-14T17:45:00+09:00'))).toBe(
    '15분 뒤 출발',
  );
  expect(startsIn(at, new Date('2026-11-14T16:30:00+09:00'))).toBe(
    '1시간 30분 뒤 출발',
  );
  expect(startsIn(at, new Date('2026-11-14T18:00:00+09:00'))).toBe('곧 출발');
  expect(startsIn(at, new Date('2026-11-14T19:00:00+09:00'))).toBe('곧 출발');
  expect(startsIn(at, new Date('2026-11-14T19:01:00+09:00'))).toBe(
    '출발 시각 지남',
  );
  expect(
    startsIn(
      '2026-11-09T11:00:00+09:00',
      new Date('2026-11-14T18:00:00+09:00'),
    ),
  ).toBe('출발 시각 지남');
});
