import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  AppText,
  Button,
  EmptyState,
  Icon,
  Screen,
  ScreenHeader,
  type IconName,
} from '../../components';
import {
  useRepositories,
  useResource,
  type AppNotification,
  type NotificationKind,
  type Repositories,
} from '../../data';
import { formatRelative, isSameDay } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RouteName } from '../../navigation/routes';
import { palette, radius, spacing, useTheme } from '../../theme';

// Each kind's icon, tint and the screen it opens (6.4 그룹런, 6.2 크루, 7.2 게시물, 7.4 러너).
const kinds: Record<
  NotificationKind,
  { icon: IconName; tint: string; route: RouteName }
> = {
  GROUP_RUN_STARTING: {
    icon: 'clock',
    tint: palette.mint,
    route: 'GroupRunDetail',
  },
  CREW_JOIN_APPROVED: {
    icon: 'userCheck',
    tint: palette.lavender,
    route: 'CrewDetail',
  },
  CREW_JOIN_REJECTED: {
    icon: 'userX',
    tint: palette.coral,
    route: 'CrewDetail',
  },
  POST_COMMENT: { icon: 'community', tint: palette.pale, route: 'PostDetail' },
  GROUP_RUN_CANCELED: {
    icon: 'circleX',
    tint: palette.coral,
    route: 'GroupRunDetail',
  },
  FOLLOW_REQUEST: {
    icon: 'userPlus',
    tint: palette.lavender,
    route: 'RunnerProfile',
  },
};

const loadNotifications = (repositories: Repositories) =>
  repositories.notifications.list();

function NotificationRow({
  item,
  now,
  onPress,
}: {
  item: AppNotification;
  now: Date;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const kind = kinds[item.kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.read ? '' : '읽지 않음, '}${item.message}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !item.read && {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.icon, { backgroundColor: colors.surfaceMuted }]}>
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.iconTint,
            { backgroundColor: kind.tint },
          ]}
        />
        <Icon name={kind.icon} color={kind.tint} size={16} />
      </View>
      <View style={styles.text}>
        <AppText
          variant={item.read ? 'caption' : 'captionStrong'}
          tone={item.read ? 'textSecondary' : 'text'}
          numberOfLines={1}
        >
          {item.message}
        </AppText>
        <AppText variant="label" tone="textTertiary">
          {formatRelative(item.createdAt, now)}
        </AppText>
      </View>
      {item.read ? null : (
        <View style={[styles.dot, { backgroundColor: colors.accent }]} />
      )}
    </Pressable>
  );
}

// 2.9 알림 and 2.9b 알림 없음.
export function NotificationsScreen() {
  const navigation = useNavigation();
  const repositories = useRepositories();
  const resource = useResource(useCallback(loadNotifications, []));
  const [items, setItems] = useState<AppNotification[] | null>(null);
  useEffect(() => {
    if (resource.status === 'ready') {
      setItems(resource.data);
    }
  }, [resource.status, resource.data]);
  const now = repositories.clock.now();
  const unread = items?.some(item => !item.read) ?? false;
  const markAllRead = async () => {
    setItems(
      current => current?.map(item => ({ ...item, read: true })) ?? null,
    );
    await repositories.notifications.markAllRead();
  };
  const groups = items
    ? [
        {
          title: '오늘',
          items: items.filter(item => isSameDay(item.createdAt, now)),
        },
        {
          title: '이번 주',
          items: items.filter(item => !isSameDay(item.createdAt, now)),
        },
      ].filter(group => group.items.length > 0)
    : [];

  return (
    <Screen
      header={
        <ScreenHeader
          title="알림"
          onBack={navigation.goBack}
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="모두 읽음"
              accessibilityState={{ disabled: !unread }}
              disabled={!unread}
              onPress={markAllRead}
              hitSlop={8}
            >
              <AppText
                variant="captionStrong"
                tone={unread ? 'textSecondary' : 'textDisabled'}
              >
                모두 읽음
              </AppText>
            </Pressable>
          }
        />
      }
      contentStyle={items?.length === 0 ? styles.emptyContent : undefined}
    >
      {resource.status === 'loading' ? (
        <ActivityIndicator />
      ) : resource.status === 'error' ? (
        <View style={styles.error}>
          <AppText tone="danger">알림을 불러오지 못했어요</AppText>
          <Button
            title="다시 시도"
            variant="secondary"
            size="small"
            onPress={resource.reload}
          />
        </View>
      ) : items?.length === 0 ? (
        <EmptyState
          icon="bell"
          title="아직 받은 알림이 없어요"
          description="그룹런, 크루, 커뮤니티 소식이 생기면 여기에서 알려 드려요."
        />
      ) : (
        groups.map(group => (
          <View key={group.title} style={styles.group}>
            <AppText
              variant="caption"
              tone="textTertiary"
              style={styles.groupTitle}
            >
              {group.title}
            </AppText>
            {group.items.map(item => (
              <NotificationRow
                key={item.id}
                item={item}
                now={now}
                onPress={() => navigateTo(navigation, kinds[item.kind].route)}
              />
            ))}
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.md },
  groupTitle: { paddingHorizontal: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pressed: { opacity: 0.7 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iconTint: { opacity: 0.16 },
  text: { flex: 1, gap: spacing.xxs },
  dot: { width: 7, height: 7, borderRadius: 4 },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },
  error: { alignItems: 'center', gap: spacing.md },
});
