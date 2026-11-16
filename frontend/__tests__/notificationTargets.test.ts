import { isNotificationKind } from '../src/data/notificationKinds';
import {
  openNotificationTarget,
  openPushTarget,
} from '../src/navigation/notificationTargets';

// S15P31E105-815 AC-11: a tapped push opens the same screen as its 2.9 row.

const navigation = () => ({ navigate: jest.fn() });

describe('openNotificationTarget', () => {
  it.each([
    ['GROUP_RUN_PARTICIPATION_CANCELLED', 'GroupRunDetail', { groupRunId: '7' }],
    ['GROUP_RUN_START_REMINDER', 'GroupRunDetail', { groupRunId: '7' }],
    ['CREW_JOIN_APPROVED', 'CrewDetail', { crewId: '7' }],
    ['CREW_JOIN_REJECTED', 'CrewDetail', { crewId: '7' }],
    ['CREW_JOIN_REQUESTED', 'CrewDetail', { crewId: '7' }],
    ['POST_COMMENT', 'PostDetail', { postId: '7' }],
    ['NEW_FOLLOWER', 'RunnerProfile', { userId: '7' }],
    ['FOLLOW_APPROVED', 'RunnerProfile', { userId: '7' }],
  ] as const)('%s opens %s', (kind, route, params) => {
    const nav = navigation();
    expect(openNotificationTarget(nav, kind, '7')).toBe('opened');
    expect(nav.navigate).toHaveBeenCalledWith(route, params);
  });

  // S15P31E105-847: 오늘 준비도 opens today's 준비도 on 2.1 whatever its targetId (daily_readiness.id).
  it('READINESS_TODAY opens 2.1 준비도', () => {
    const nav = navigation();
    expect(openNotificationTarget(nav, 'READINESS_TODAY', '7')).toBe('opened');
    expect(nav.navigate).toHaveBeenCalledWith(
      'MainTabs',
      { screen: 'HomeTab', params: { screen: 'Home', params: { menu: 'readiness' } } },
      { pop: true },
    );
  });

  it('leaves FOLLOW_REQUEST to the caller (7.4b 승인·거절)', () => {
    const nav = navigation();
    expect(openNotificationTarget(nav, 'FOLLOW_REQUEST', '7')).toBe(
      'followRequests',
    );
    expect(nav.navigate).not.toHaveBeenCalled();
  });
});

describe('openPushTarget', () => {
  it('opens the target screen from FCM data', () => {
    const nav = navigation();
    openPushTarget(nav, {
      notificationId: '91',
      kind: 'POST_COMMENT',
      targetId: '12',
    });
    expect(nav.navigate).toHaveBeenCalledWith('PostDetail', { postId: '12' });
  });

  it('opens 2.1 준비도 from a 오늘 준비도 push', () => {
    const nav = navigation();
    openPushTarget(nav, {
      notificationId: '91',
      kind: 'READINESS_TODAY',
      targetId: '55',
    });
    expect(nav.navigate).toHaveBeenCalledTimes(1);
    expect(nav.navigate).toHaveBeenCalledWith(
      'MainTabs',
      { screen: 'HomeTab', params: { screen: 'Home', params: { menu: 'readiness' } } },
      { pop: true },
    );
  });

  it.each([
    ['a follow request', { kind: 'FOLLOW_REQUEST', targetId: '3' }],
    ['a kind this build does not know', { kind: 'CREW_DISBANDED', targetId: '3' }],
    ['a missing targetId', { kind: 'POST_COMMENT' }],
    ['a non-numeric targetId', { kind: 'POST_COMMENT', targetId: 'abc' }],
    ['a zero targetId', { kind: 'POST_COMMENT', targetId: '0' }],
    ['a numeric (not string) targetId', { kind: 'POST_COMMENT', targetId: 12 }],
    ['no data', undefined],
  ])('opens 2.9 알림 for %s', (_label, data) => {
    const nav = navigation();
    openPushTarget(nav, data);
    expect(nav.navigate).toHaveBeenCalledTimes(1);
    expect(nav.navigate).toHaveBeenCalledWith('Notifications');
  });
});

describe('isNotificationKind', () => {
  it('knows the server kinds and nothing else', () => {
    expect(isNotificationKind('NEW_FOLLOWER')).toBe(true);
    expect(isNotificationKind('READINESS_TODAY')).toBe(true);
    expect(isNotificationKind('new_follower')).toBe(false);
    expect(isNotificationKind(undefined)).toBe(false);
  });
});
