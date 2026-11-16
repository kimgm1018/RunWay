import type { NavigationProp } from '@react-navigation/native';
import { isNotificationKind } from '../data/notificationKinds';
import { openReadiness } from './navigateTo';
import type { NotificationKind } from '../data/types';
import type { RootStackParamList } from './types';

type Navigation = Pick<NavigationProp<RootStackParamList>, 'navigate'>;

/**
 * Opens the screen a notification points at (6.4 그룹런, 6.2 크루, 7.2 게시물, 7.4 러너, 2.1 준비도) — the same from a 2.9 row and from a
 * device push (S15P31E105-815). FOLLOW_REQUEST has no screen of its own: its targetId is the requester's users.id, not
 * the follow-request id, so it returns `'followRequests'` and the caller shows 7.4b 승인·거절.
 */
export function openNotificationTarget(
  navigation: Navigation,
  kind: NotificationKind,
  targetId: string,
): 'opened' | 'followRequests' {
  switch (kind) {
    case 'GROUP_RUN_PARTICIPATION_CANCELLED':
    case 'GROUP_RUN_START_REMINDER':
      navigation.navigate('GroupRunDetail', { groupRunId: targetId });
      return 'opened';
    case 'CREW_JOIN_APPROVED':
    case 'CREW_JOIN_REJECTED':
    case 'CREW_JOIN_REQUESTED':
      navigation.navigate('CrewDetail', { crewId: targetId });
      return 'opened';
    case 'POST_COMMENT':
      navigation.navigate('PostDetail', { postId: targetId });
      return 'opened';
    case 'NEW_FOLLOWER':
    case 'FOLLOW_APPROVED':
      navigation.navigate('RunnerProfile', { userId: targetId });
      return 'opened';
    case 'FOLLOW_REQUEST':
      return 'followRequests';
    case 'READINESS_TODAY':
      // targetId is daily_readiness.id; 2.1 shows today's score on its own (S15P31E105-847).
      openReadiness(navigation);
      return 'opened';
  }
}

/** What a tapped push carries in its FCM data (all strings). */
export type PushData = { [key: string]: unknown } | undefined;

/**
 * Opens a tapped push. A known kind with a positive integer targetId opens its screen; FOLLOW_REQUEST, a kind this
 * build does not know yet and broken data open 2.9 알림 instead. A FOLLOW_REQUEST row is listed there (and its
 * 7.4b sheet); a kind this build does not know is left out of the list, so 2.9 is only a safe landing for it.
 */
export function openPushTarget(navigation: Navigation, data: PushData): void {
  const kind = data?.kind;
  const targetId = data?.targetId;
  if (
    isNotificationKind(kind) &&
    typeof targetId === 'string' &&
    /^[1-9][0-9]{0,18}$/.test(targetId) &&
    openNotificationTarget(navigation, kind, targetId) === 'opened'
  ) {
    return;
  }
  navigation.navigate('Notifications');
}
