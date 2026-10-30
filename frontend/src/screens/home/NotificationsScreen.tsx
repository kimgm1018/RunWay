import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import {
  AppText,
  Button,
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
import { fontFamily, k1, spacing, useTheme } from '../../theme';

// Each kind's icon and the screen it opens (6.4 그룹런, 6.2 크루, 7.2 게시물, 7.4 러너).
const kinds: Record<NotificationKind, { icon: IconName; route: RouteName }> = {
  GROUP_RUN_STARTING: { icon: 'clock', route: 'GroupRunDetail' },
  CREW_JOIN_APPROVED: { icon: 'userCheck', route: 'CrewDetail' },
  CREW_JOIN_REJECTED: { icon: 'userX', route: 'CrewDetail' },
  POST_COMMENT: { icon: 'community', route: 'PostDetail' },
  GROUP_RUN_CANCELED: { icon: 'circleX', route: 'GroupRunDetail' },
  FOLLOW_REQUEST: { icon: 'userPlus', route: 'RunnerProfile' },
};

// 2.9b 알림 없음: 60 ticks between radius 80 and 92 around the 190 ring.
const ring = 190;
const ticks = Array.from({ length: 60 }, (_, index) => {
  const angle = (index * 6 * Math.PI) / 180;
  const at = (r: number) => ({
    x: ring / 2 + r * Math.sin(angle),
    y: ring / 2 - r * Math.cos(angle),
  });
  return { from: at(80), to: at(92) };
});

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
  // Unread is a white card with a black icon circle; read is a plain line with a coral icon (DESIGN.md 2-6).
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.read ? '' : '읽지 않음, '}${item.message}`}
      onPress={onPress}
      style={({ pressed }) => [
        item.read
          ? [styles.readRow, { borderBottomColor: colors.border }]
          : [styles.card, { backgroundColor: colors.surfaceRaised }],
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.icon,
          item.read ? styles.readIcon : { backgroundColor: colors.accent },
        ]}
      >
        <Icon
          name={kind.icon}
          color={item.read ? k1.coral : colors.onAccent}
          size={18}
          strokeWidth={1.6}
        />
      </View>
      <View style={styles.text}>
        <AppText
          style={[styles.message, !item.read && styles.messageUnread]}
          numberOfLines={1}
        >
          {item.message}
        </AppText>
        <AppText variant="label" tone="textSecondary" style={styles.time}>
          {formatRelative(item.createdAt, now)}
        </AppText>
      </View>
      {item.read ? null : <View style={styles.dot} />}
    </Pressable>
  );
}

function EmptyBell() {
  return (
    <View style={styles.empty}>
      <View style={styles.ring}>
        <Svg width={ring} height={ring} style={StyleSheet.absoluteFill}>
          {ticks.map(({ from, to }, index) => (
            <Line
              key={index}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={k1.night}
              strokeOpacity={0.5}
              strokeWidth={1.8}
            />
          ))}
        </Svg>
        <View style={styles.core}>
          <Icon name="bell" color={k1.ice} size={28} strokeWidth={1.6} />
        </View>
      </View>
      <AppText style={styles.emptyTitle}>아직 받은 알림이 없어요</AppText>
      <AppText variant="caption" tone="textSecondary" style={styles.emptyText}>
        그룹런, 크루, 커뮤니티 소식이 생기면{'\n'}여기에서 알려 드려요.
      </AppText>
    </View>
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
          symbol
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
        <EmptyBell />
      ) : (
        groups.map(group => (
          <View key={group.title}>
            <AppText
              variant="caption"
              tone="textSecondary"
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
  groupTitle: {
    fontFamily: fontFamily.medium,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    marginHorizontal: spacing.xs,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 22,
    marginBottom: spacing.md,
  },
  readRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: 1,
  },
  pressed: { transform: [{ scale: 0.96 }] },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Coral 14% behind a read notification's icon.
  readIcon: { backgroundColor: 'rgba(226,135,111,0.14)' },
  text: { flex: 1, gap: 2 },
  message: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 19 },
  messageUnread: { fontFamily: fontFamily.medium },
  time: { fontFamily: fontFamily.regular },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: k1.deep },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', paddingBottom: 60 },
  ring: {
    width: ring,
    height: ring,
    alignItems: 'center',
    justifyContent: 'center',
  },
  core: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: k1.night,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontFamily: fontFamily.medium,
    fontSize: 17,
    lineHeight: 24,
    marginTop: 26,
  },
  emptyText: {
    fontSize: 12.5,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  error: { alignItems: 'center', gap: spacing.md },
});
