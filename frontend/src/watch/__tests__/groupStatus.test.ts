import type { GroupRunLive } from '../../data/types';
import {
  createGapAlertTracker,
  createPaceChangeTracker,
  GROUP_GAP_ALERT_M,
  GROUP_GAP_REARM_MARGIN_M,
  watchGroupStatus,
} from '../groupStatus';

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
      paceChanged: null,
      gapWidened: null,
    });
  });

  it('carries the pace change the phone saw', () => {
    expect(watchGroupStatus('77', live(), { from: 360, to: 370 })?.paceChanged).toEqual({ from: 360, to: 370 });
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

// S15P31E105-604: 공동 페이스 변경은 한 번의 연속 조회에서 직전 유효값과 정수로 비교해 달라질 때만 알린다.
describe('createPaceChangeTracker', () => {
  it('reports 360 -> 370 once and stays quiet for the first value and repeats', () => {
    const { next } = createPaceChangeTracker();
    expect(next(live({ guidePaceSecPerKm: null }))).toBeNull();
    expect(next(live({ guidePaceSecPerKm: 360 }))).toBeNull();
    expect(next(live({ guidePaceSecPerKm: 360 }))).toBeNull();
    expect(next(live({ guidePaceSecPerKm: 370 }))).toEqual({ from: 360, to: 370 });
    expect(next(live({ guidePaceSecPerKm: 370 }))).toBeNull();
  });

  it('clears the base on a missing value, so the next value is quiet', () => {
    const { next } = createPaceChangeTracker();
    next(live({ guidePaceSecPerKm: 360 }));
    expect(next(live({ guidePaceSecPerKm: null }))).toBeNull();
    expect(next(live({ guidePaceSecPerKm: 370 }))).toBeNull();
    expect(next(live({ guidePaceSecPerKm: 380 }))).toEqual({ from: 370, to: 380 });
  });

  it('clears the base after a failed read, so the next value is quiet', () => {
    const { next, reset } = createPaceChangeTracker();
    next(live({ guidePaceSecPerKm: 360 }));
    reset();
    expect(next(live({ guidePaceSecPerKm: 370 }))).toBeNull();
    expect(next(live({ guidePaceSecPerKm: 380 }))).toEqual({ from: 370, to: 380 });
  });

  it('compares whole seconds and treats invalid values as missing', () => {
    const { next } = createPaceChangeTracker();
    next(live({ guidePaceSecPerKm: 360 }));
    expect(next(live({ guidePaceSecPerKm: 360.4 }))).toBeNull();
    expect(next(live({ guidePaceSecPerKm: Number.NaN }))).toBeNull();
    expect(next(live({ guidePaceSecPerKm: 370 }))).toBeNull();
  });

  it('only tells a change while the group runs, but takes the waiting value as the base', () => {
    const { next } = createPaceChangeTracker();
    next(live({ status: 'SCHEDULED', guidePaceSecPerKm: 360 }));
    expect(next(live({ status: 'SCHEDULED', guidePaceSecPerKm: 370 }))).toBeNull();
    expect(next(live({ guidePaceSecPerKm: 370 }))).toBeNull();
    expect(next(live({ guidePaceSecPerKm: 380 }))).toEqual({ from: 370, to: 380 });
  });

  it('starts over for a new read, so a change from before re-entry is not told again', () => {
    createPaceChangeTracker().next(live({ guidePaceSecPerKm: 360 }));
    expect(createPaceChangeTracker().next(live({ guidePaceSecPerKm: 380 }))).toBeNull();
  });
});

// S15P31E105-629: 그룹장 폰만, 선두–후미 거리가 기준을 넘는 순간 1회 알리고 기준-30m 아래로 내려와야 다시 알린다.
describe('createGapAlertTracker', () => {
  // 나(그룹장)는 선두, '민수'가 후미.
  const hostLive = (spreadM: number | null, over: Partial<GroupRunLive> = {}) =>
    live({
      spreadM,
      members: [
        member({ userId: '1', nickname: '나', isMe: true, isHost: true, rank: 1 }),
        member({ userId: '2', nickname: '민수', rank: 2 }),
      ],
      ...over,
    });

  it('uses 150 m with a 30 m re-arm margin by default', () => {
    expect([GROUP_GAP_ALERT_M, GROUP_GAP_REARM_MARGIN_M]).toEqual([150, 30]);
  });

  it('tells the crossing once, names the last runner and keeps the notice until the gap closes', () => {
    const { next } = createGapAlertTracker();
    expect(next(hostLive(100))).toBeNull();
    expect(next(hostLive(150))).toBeNull();
    expect(next(hostLive(160))).toEqual({ gapM: 160, memberName: '민수', isNew: true });
    expect(next(hostLive(171.6))).toEqual({ gapM: 172, memberName: '민수', isNew: false });
    expect(next(hostLive(140))).toEqual({ gapM: 140, memberName: '민수', isNew: false });
    expect(next(hostLive(119))).toBeNull();
  });

  it('does not tell again while the gap jitters around the threshold', () => {
    const { next } = createGapAlertTracker();
    next(hostLive(100));
    expect(next(hostLive(151))?.isNew).toBe(true);
    for (const gap of [149, 152, 125, 151, 120, 155]) {
      expect(next(hostLive(gap))?.isNew).toBe(false);
    }
  });

  it('re-arms only below threshold - 30 m, then tells the next crossing', () => {
    const { next } = createGapAlertTracker();
    next(hostLive(100));
    expect(next(hostLive(160))?.isNew).toBe(true);
    expect(next(hostLive(121))?.isNew).toBe(false);
    expect(next(hostLive(119))).toBeNull();
    expect(next(hostLive(130))).toBeNull();
    expect(next(hostLive(151))).toEqual({ gapM: 151, memberName: '민수', isNew: true });
  });

  it('stays quiet on the first value even when it is already wide', () => {
    const { next } = createGapAlertTracker();
    expect(next(hostLive(300))).toBeNull();
    expect(next(hostLive(310))).toBeNull();
    expect(next(hostLive(100))).toBeNull();
    expect(next(hostLive(160))?.isNew).toBe(true);
  });

  it('starts over after a failed read or a new subscription (reconnect)', () => {
    const tracker = createGapAlertTracker();
    tracker.next(hostLive(100));
    tracker.reset();
    expect(tracker.next(hostLive(200))).toBeNull();
    expect(tracker.next(hostLive(210))).toBeNull();

    createGapAlertTracker().next(hostLive(100));
    expect(createGapAlertTracker().next(hostLive(200))).toBeNull();
  });

  it('does not tell a stale snapshot without a gap, and keeps its state through it', () => {
    const { next } = createGapAlertTracker();
    next(hostLive(100));
    expect(next(hostLive(null))).toBeNull();
    expect(next(hostLive(Number.NaN))).toBeNull();
    expect(next(hostLive(160))?.isNew).toBe(true);
    expect(next(hostLive(null))).toBeNull();
    expect(next(hostLive(165))?.isNew).toBe(false);
  });

  it('tells only the host', () => {
    const { next } = createGapAlertTracker();
    const asMember = (spreadM: number) =>
      hostLive(spreadM, {
        members: [
          member({ userId: '1', nickname: '방장', isHost: true, rank: 1 }),
          member({ userId: '2', nickname: '나', isMe: true, isHost: false, rank: 2 }),
        ],
      });
    next(asMember(100));
    expect(next(asMember(200))).toBeNull();
    expect(next(asMember(220))).toBeNull();
  });

  it('only tells while the group runs', () => {
    const { next } = createGapAlertTracker();
    next(hostLive(100, { status: 'SCHEDULED' }));
    expect(next(hostLive(200, { status: 'SCHEDULED' }))).toBeNull();
    expect(next(hostLive(210))).toBeNull();
  });

  it('falls back to no name for ties, unknown names, or when I am last', () => {
    const tie = createGapAlertTracker();
    const tied = (spreadM: number) =>
      hostLive(spreadM, {
        members: [
          member({ userId: '1', isMe: true, isHost: true, rank: 1 }),
          member({ userId: '2', nickname: '민수', rank: 2 }),
          member({ userId: '3', nickname: '지영', rank: 2 }),
        ],
      });
    tie.next(tied(100));
    expect(tie.next(tied(160))).toEqual({ gapM: 160, memberName: null, isNew: true });

    const unknown = createGapAlertTracker();
    const noName = (spreadM: number) =>
      hostLive(spreadM, {
        members: [
          member({ userId: '1', isMe: true, isHost: true, rank: 1 }),
          member({ userId: '2', nickname: '알 수 없음', rank: 2 }),
        ],
      });
    unknown.next(noName(100));
    expect(unknown.next(noName(160))?.memberName).toBeNull();

    const meLast = createGapAlertTracker();
    const last = (spreadM: number) =>
      hostLive(spreadM, {
        members: [
          member({ userId: '1', nickname: '민수', rank: 1 }),
          member({ userId: '2', nickname: '나', isMe: true, isHost: true, rank: 2 }),
        ],
      });
    meLast.next(last(100));
    expect(meLast.next(last(160))?.memberName).toBeNull();
  });

  it('can use a demo threshold', () => {
    const { next } = createGapAlertTracker(50, 10);
    next(hostLive(30));
    expect(next(hostLive(55))?.isNew).toBe(true);
    expect(next(hostLive(41))?.isNew).toBe(false);
    expect(next(hostLive(39))).toBeNull();
  });

  it('carries the gap notice in GROUP_STATUS', () => {
    const gap = { gapM: 160, memberName: '민수', isNew: true };
    expect(watchGroupStatus('77', live(), null, gap)?.gapWidened).toEqual(gap);
  });
});
