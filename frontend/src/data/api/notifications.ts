import type { NotificationKind, Repositories } from '../types';
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
  'POST_COMMENT',
  'NEW_FOLLOWER',
  'FOLLOW_REQUEST',
  'FOLLOW_APPROVED',
] satisfies NotificationKind[];

const isKnown = (
  item: NotificationResponse,
): item is NotificationResponse & { kind: NotificationKind } =>
  knownKinds.includes(item.kind);

// 2.9 shows one page of the newest 50 (N01's largest limit); a kind this app does not know yet is left out.
export const notificationsApi: Repositories['notifications'] = {
  list: async () => {
    const response = await apiRequest<NotificationListResponse>(
      '/notifications',
      { query: { limit: 50 } },
    );
    return {
      items: response.items.filter(isKnown).map(item => ({
        id: String(item.id),
        kind: item.kind,
        message: item.message,
        createdAt: item.createdAt,
        read: item.read,
        targetId: String(item.targetId),
      })),
      unreadCount: response.unreadCount,
    };
  },
  markAllRead: () =>
    apiRequest<void>('/notifications/read-all', { method: 'POST' }),
};
