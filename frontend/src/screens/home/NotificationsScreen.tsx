import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Line } from 'react-native-svg';
import {
  useFocusEffect,
  useNavigation,
  type NavigationProp,
} from '@react-navigation/native';
import {
  AppText,
  Backdrop,
  Button,
  Icon,
  Screen,
  useReduceMotion,
} from '../../components';
import type { IconName } from '../../components/Icon';
import {
  useRepositories,
  useResource,
  type AppNotification,
  type NotificationKind,
  type Repositories,
} from '../../data';
import { formatRelative } from '../../format';
import { openNotificationTarget } from '../../navigation/notificationTargets';
import type { RootStackParamList } from '../../navigation/types';
import { fontFamily, k1 } from '../../theme';
import { BackButton } from '../../components/BackButton';
import { FollowRequestSheet } from '../community/FollowRequestSheet';
import { newerId, newestNotificationId } from './notificationRefresh';

type Navigation = NavigationProp<RootStackParamList>;

// Each kind's title and its icon on the row's tile. The screen a row opens is shared with device push
// (navigation/notificationTargets.ts, S15P31E105-815).
const kinds: Record<NotificationKind, { title: string; icon: IconName }> = {
  GROUP_RUN_PARTICIPATION_CANCELLED: { title: '그룹런 취소', icon: 'circleX' },
  GROUP_RUN_START_REMINDER: { title: '그룹런 곧 시작', icon: 'clock' },
  CREW_JOIN_APPROVED: { title: '크루 가입 승인', icon: 'userCheck' },
  CREW_JOIN_REJECTED: { title: '크루 가입 거절', icon: 'userX' },
  CREW_JOIN_REQUESTED: { title: '새 가입 신청', icon: 'userPlus' },
  POST_COMMENT: { title: '새 댓글', icon: 'message' },
  NEW_FOLLOWER: { title: '새 팔로워', icon: 'userPlus' },
  FOLLOW_REQUEST: { title: '팔로우 요청', icon: 'userPlus' },
  FOLLOW_APPROVED: { title: '팔로우 승인', icon: 'userCheck' },
  READINESS_TODAY: { title: '오늘 준비도', icon: 'heartPulse' },
};

// The part of a message the 2.9 핸드오프 sets in bold: the ‘quoted’ name, or the runner's 님 at the start.
function splitEmphasis(message: string) {
  const match = message.match(/‘[^’]+’/) ?? message.match(/^\S+님/);
  if (!match || match.index === undefined) {
    return { before: message, bold: '', after: '' };
  }
  return {
    before: message.slice(0, match.index),
    bold: match[0],
    after: message.slice(match.index + match[0].length),
  };
}

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

// The page rises from the bottom over 홈, which stays where it is under it, and slows to a stop (레퍼런스 영상:
// about a third of a second). 동작 줄이기 shows it in place.
const riseDuration = 350;

function useRise() {
  const { height } = useWindowDimensions();
  const reduce = useReduceMotion();
  const rise = useRef(new Animated.Value(reduce ? 0 : 1)).current;
  useEffect(() => {
    if (reduce) {
      rise.setValue(0);
      return;
    }
    Animated.timing(rise, {
      toValue: 0,
      duration: riseDuration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    // Once, as the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return {
    transform: [
      {
        translateY: rise.interpolate({
          inputRange: [0, 1],
          outputRange: [0, height],
        }),
      },
    ],
  };
}

const loadNotifications = (repositories: Repositories) =>
  repositories.notifications.list();

// A tile with the kind's icon, then the title with the blue unread dot and the time, and the message with its name
// in bold under it (담당자 레퍼런스: 알림 페이지 영상).
function NotificationRow({
  item,
  now,
  onPress,
}: {
  item: AppNotification;
  now: Date;
  onPress: () => void;
}) {
  const { before, bold, after } = splitEmphasis(item.message);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.read ? '' : '읽지 않음, '}${
        kinds[item.kind].title
      }, ${item.message}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.tile}>
        <Icon
          name={kinds[item.kind].icon}
          color={ink}
          size={20}
          strokeWidth={1.8}
        />
      </View>
      <View style={styles.rowText}>
        <View style={styles.rowHead}>
          {item.read ? null : <View style={styles.unread} />}
          <AppText style={styles.rowTitle} numberOfLines={1}>
            {kinds[item.kind].title}
          </AppText>
          <AppText style={styles.time}>
            {formatRelative(item.createdAt, now)}
          </AppText>
        </View>
        <AppText style={styles.body}>
          {before}
          {bold ? <AppText style={styles.bold}>{bold}</AppText> : null}
          {after}
        </AppText>
      </View>
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
      <AppText style={styles.emptyText}>
        그룹런, 크루, 커뮤니티 소식이 생기면{'\n'}여기에서 알려 드려요.
      </AppText>
    </View>
  );
}

// 2.9 알림 (담당자 레퍼런스: 알림 페이지 영상): a mist page (담당자 요청) that rises over 홈, 뒤로 and a large 알림 on one
// line, then every notification in one list, newest first (담당자 결정: 오늘 · 이번 주 탭 없이, 지우기 없이 - the
// server has no delete). No 모두 읽음: everything shown here counts as read once the screen is left (담당자 결정) -
// only up to the newest row shown, so one that arrived meanwhile stays unread (S15P31E105-801).
// 2.9b 알림 없음 stays. N01 pages past the first 50 join with 더 보기.
export function NotificationsScreen() {
  const navigation = useNavigation<Navigation>();
  const rise = useRise();
  const repositories = useRepositories();
  const resource = useResource(useCallback(loadNotifications, []));
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [followRequestsOpen, setFollowRequestsOpen] = useState(false);
  // N01's count also covers what this page leaves out (older pages, kinds the app does not know).
  const unreadCount = useRef(0);
  // S15P31E105-801: the newest server id among the pages loaded, including kinds the list leaves out.
  const newestLoadedId = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (resource.status === 'ready') {
      setItems(resource.data.items);
      setNextCursor(resource.data.nextCursor);
      unreadCount.current = resource.data.unreadCount;
      newestLoadedId.current = resource.data.newestId;
    }
  }, [resource.status, resource.data]);
  const now = repositories.clock.now();
  // Leaving the screen marks everything read, so the dots stay while the list is open.
  const unread = useRef(false);
  unread.current =
    unreadCount.current > 0 || (items?.some(item => !item.read) ?? false);
  const { notifications } = repositories;
  // S15P31E105-801: leaving marks read only up to the newest row this screen loaded (kinds it leaves out included), so
  // one that arrived meanwhile stays unread. Rows without a numeric id (mock data) keep the old mark-everything call.
  const loadedRows = useRef<typeof items>(null);
  loadedRows.current = items;
  useFocusEffect(
    useCallback(
      () => () => {
        if (unread.current) {
          const loaded = loadedRows.current;
          const upToId = newerId(
            newestLoadedId.current,
            newestNotificationId(loaded),
          );
          if ((!loaded || loaded.length === 0) && upToId === undefined) {
            return;
          }
          unreadCount.current = 0;
          unread.current = false;
          setItems(current =>
            current ? current.map(item => ({ ...item, read: true })) : null,
          );
          notifications.markAllRead(upToId).catch(() => {});
        }
      },
      [notifications],
    ),
  );

  const loadMore = async () => {
    if (!nextCursor || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await notifications.list(nextCursor);
      setItems(current => {
        const shown = current ?? [];
        return [
          ...shown,
          ...page.items.filter(
            item => !shown.some(existing => existing.id === item.id),
          ),
        ];
      });
      setNextCursor(page.nextCursor);
      unreadCount.current = page.unreadCount;
      newestLoadedId.current = newerId(newestLoadedId.current, page.newestId);
    } catch {
      // Keep the page already shown; the next tap can try again.
    } finally {
      setLoadingMore(false);
    }
  };

  const openItem = (item: AppNotification) => {
    if (
      openNotificationTarget(navigation, item.kind, item.targetId) ===
      'followRequests'
    ) {
      setFollowRequestsOpen(true);
    }
  };

  return (
    <Animated.View style={[styles.rise, rise]}>
      <Screen
        background={<Backdrop tail />}
        header={
          <View style={styles.header}>
            <BackButton onPress={navigation.goBack} />
            <AppText accessibilityRole="header" style={styles.title}>
              알림
            </AppText>
          </View>
        }
        contentStyle={[
          styles.content,
          items?.length === 0 && styles.emptyContent,
        ]}
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
          <View style={styles.list}>
            {(items ?? []).map(item => (
              <NotificationRow
                key={item.id}
                item={item}
                now={now}
                onPress={() => openItem(item)}
              />
            ))}
            {nextCursor ? (
              <Button
                title="더 보기"
                variant="text"
                size="small"
                loading={loadingMore}
                onPress={loadMore}
              />
            ) : null}
          </View>
        )}
      </Screen>
      <FollowRequestSheet
        visible={followRequestsOpen}
        onClose={() => setFollowRequestsOpen(false)}
        onDecided={() => {}}
      />
    </Animated.View>
  );
}

const ink = '#0A1631';

const styles = StyleSheet.create({
  rise: { flex: 1 },
  // 뒤로 and the large title on one line, 16 from the side.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 64,
    paddingHorizontal: 16,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.6,
    color: '#02050E',
  },
  content: { paddingHorizontal: 20, paddingTop: 12 },
  list: { gap: 6 },
  // No lines between rows: the tiles keep them apart.
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingVertical: 12,
  },
  pressed: { opacity: 0.6 },
  tile: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,22,49,0.06)',
  },
  rowText: { flex: 1, gap: 3 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unread: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#1E90FF',
    boxShadow: '0 0 6px rgba(30,144,255,0.6)',
  },
  rowTitle: {
    flex: 1,
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: -0.3,
    color: '#02050E',
  },
  time: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 17,
    color: '#56606A',
  },
  body: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
    color: '#56606A',
  },
  bold: { fontFamily: fontFamily.bold, color: '#02050E' },
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
    color: '#02050E',
  },
  emptyText: {
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 10,
    color: '#56606A',
  },
  error: { alignItems: 'center', gap: 10 },
});
