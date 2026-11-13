import type { NotificationKind, NotificationList, Repositories } from '../types';
import { apiRequest } from './http';

// N01·N02 알림함 (docs/design/api/notifications.md). kind is the server's notification_type.
type NotificationResponse = {
  id: number;
  kind: string;
  message: string;
  createdAt: string;
  read: boolean;
  targetId: number;
};
type NotificationListResponse = {
  items: NotificationResponse[];
  nextCursor: string | null;
  hasNext: boolean;
  unreadCount: number;
};

const knownKinds: readonly string[] = [
  'GROUP_RUN_PARTICIPATION_CANCELLED',
  'GROUP_RUN_START_REMINDER',
  'CREW_JOIN_APPROVED',
  'CREW_JOIN_REJECTED',
  'CREW_JOIN_REQUESTED',
  'POST_COMMENT',
  'NEW_FOLLOWER',
  'FOLLOW_REQUEST',
  'FOLLOW_APPROVED',
] satisfies NotificationKind[];

const isKnown = (
  item: NotificationResponse,
): item is NotificationResponse & { kind: NotificationKind } =>
  knownKinds.includes(item.kind);

const pageOf = (response: NotificationListResponse): NotificationList => ({
  items: response.items.filter(isKnown).map(item => ({
    id: String(item.id),
    kind: item.kind,
    message: item.message,
    createdAt: item.createdAt,
    read: item.read,
    targetId: String(item.targetId),
  })),
  unreadCount: response.unreadCount,
  nextCursor: response.hasNext ? response.nextCursor : null,
  // S15P31E105-801: taken before the unknown kinds are left out, so N02 upToId covers them too.
  newestId: response.items.reduce<number | undefined>(
    (newest, item) =>
      Number.isSafeInteger(item.id) &&
      item.id > 0 &&
      (newest === undefined || item.id > newest)
        ? item.id
        : newest,
    undefined,
  ),
});

// N01 pages of up to 50; cursor null reads the newest page. A kind this app does not know yet is left out.
export const notificationsApi: Repositories['notifications'] = {
  list: async (cursor = null) => {
    const response = await apiRequest<NotificationListResponse>(
      '/notifications',
      { query: { limit: 50, cursor: cursor ?? undefined } },
    );
    return pageOf(response);
  },
  markAllRead: upToId =>
    apiRequest<void>('/notifications/read-all', {
      method: 'POST',
      query: { upToId },
    }),
};
