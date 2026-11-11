import { canEnterRoom } from '../src/screens/group/parts';
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
