import type { NotificationKind } from './types';

/** Every kind this app knows (N01 `kind` = notifications.notification_type, docs/design/api/notifications.md). */
export const notificationKinds: readonly NotificationKind[] = [
  'GROUP_RUN_PARTICIPATION_CANCELLED',
  'GROUP_RUN_START_REMINDER',
  'CREW_JOIN_APPROVED',
  'CREW_JOIN_REJECTED',
  'CREW_JOIN_REQUESTED',
  'POST_COMMENT',
  'NEW_FOLLOWER',
  'FOLLOW_REQUEST',
  'FOLLOW_APPROVED',
  'READINESS_TODAY',
];

/** A kind a newer server may send is not one of these; the inbox leaves it out and a push opens 2.9 알림. */
export const isNotificationKind = (kind: unknown): kind is NotificationKind =>
  typeof kind === 'string' &&
  (notificationKinds as readonly string[]).includes(kind);
