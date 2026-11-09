import type { GroupRunLive } from '../../data/types';
import { watchGroupStatus } from '../groupStatus';

// S15P31E105-420: 워치에 보내는 그룹 현황은 G10 값을 그대로 옮긴다.

const member = (
  over: Partial<GroupRunLive['members'][number]>,
): GroupRunLive['members'][number] => ({
  userId: '1',
  nickname: '나',
  isMe: false,
  gapM: null,
  paceSecPerKm: 360,
  rank: 1,
  stale: false,
  gapToAheadM: null,
  gapToBehindM: 10,
  aheadCount: 0,
  behindCount: 1,
  ...over,
});

const live = (over: Partial<GroupRunLive> = {}): GroupRunLive => ({
  members: [
    member({ userId: '1', rank: 1, gapToAheadM: null, gapToBehindM: 12.5, aheadCount: 0, behindCount: 1 }),
    member({ userId: '2', isMe: true, rank: 2, gapToAheadM: 12.5, gapToBehindM: null, aheadCount: 1, behindCount: 0 }),
  ],
  spreadM: 13,
  inRange: null,
  guidePaceSecPerKm: 370,
  loadAlert: null,
  status: 'RUNNING',
  updatedAt: '2026-11-09T01:05:00Z',
  ...over,
});

describe('watchGroupStatus', () => {
  it('copies my G10 standing, the shared pace, the spread and updatedAt', () => {
    expect(watchGroupStatus('77', live())).toEqual({
      groupRunId: '77',
      phase: 'RUNNING',
      guidePaceSecPerKm: 370,
      standing: { rank: 2, aheadCount: 1, behindCount: 0, gapToAheadM: 12.5, gapToBehindM: null },
      stale: false,
      leaderToLastGapM: 13,
      updatedAt: '2026-11-09T01:05:00Z',
      rankedCount: 2,
    });
  });

  it('counts the ranked runners, so a tie at the same distance still shows everyone', () => {
    // 실기기 E2E: 둘 다 0m에서 동점이면 앞·뒤 인원이 모두 0이라 워치가 "/ 1명"으로 보였다.
    const tie = live({
      members: [
        member({ userId: '1', rank: 1, aheadCount: 0, behindCount: 0 }),
        member({ userId: '2', isMe: true, rank: 1, aheadCount: 0, behindCount: 0 }),
        member({ userId: '3', rank: null, stale: true }),
      ],
    });
    expect(watchGroupStatus('77', tie)?.rankedCount).toBe(2);
  });

  it('sends no standing for a stale or unranked entry instead of a made-up one', () => {
    const stale = live({
      members: [member({ isMe: true, rank: null, stale: true, gapToAheadM: null, gapToBehindM: null })],
      spreadM: null,
    });
    expect(watchGroupStatus('77', stale)).toMatchObject({
      standing: null,
      stale: true,
      leaderToLastGapM: null,
      rankedCount: null,
    });
  });

  it('marks the update stale when I am not in the list at all', () => {
    const missing = live({ members: [member({ userId: '1' })] });
    expect(watchGroupStatus('77', missing)).toMatchObject({ standing: null, stale: true });
  });

  it('maps the group phase and leaves a cancelled group to the session state', () => {
    expect(watchGroupStatus('77', live({ status: 'SCHEDULED' }))?.phase).toBe('WAITING');
    expect(watchGroupStatus('77', live({ status: 'COMPLETED' }))?.phase).toBe('FINISHED');
    expect(watchGroupStatus('77', live({ status: 'CANCELLED' }))).toBeNull();
  });
});
