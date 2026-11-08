import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import {
  useFocusEffect,
  useNavigation,
  type NavigationProp,
} from '@react-navigation/native';
import { AppText, Button, Icon, Logo, Screen } from '../../components';
import {
  useRepositories,
  useResource,
  type AppNotification,
  type NotificationKind,
  type Repositories,
} from '../../data';
import { formatRelative, isSameDay } from '../../format';
import type { RootStackParamList } from '../../navigation/types';
import { fontFamily, k1 } from '../../theme';
import { BackButton } from '../../components/BackButton';

type Navigation = NavigationProp<RootStackParamList>;
type Open = (navigation: Navigation, targetId: string) => void;

const openGroupRun: Open = (navigation, groupRunId) =>
  navigation.navigate('GroupRunDetail', { groupRunId });
const openCrew: Open = (navigation, crewId) =>
  navigation.navigate('CrewDetail', { crewId });
const openRunner: Open = (navigation, userId) =>
  navigation.navigate('RunnerProfile', { userId });

// Each kind's title and the screen its targetId opens (6.4 그룹런, 6.2 크루, 7.2 게시물, 7.4 러너).
const kinds: Record<NotificationKind, { title: string; open: Open }> = {
  GROUP_RUN_PARTICIPATION_CANCELLED: {
    title: '그룹런 취소',
    open: openGroupRun,
  },
  GROUP_RUN_START_REMINDER: { title: '그룹런 곧 시작', open: openGroupRun },
  CREW_JOIN_APPROVED: { title: '크루 가입 승인', open: openCrew },
  CREW_JOIN_REJECTED: { title: '크루 가입 거절', open: openCrew },
  POST_COMMENT: {
    title: '새 댓글',
    open: (navigation, postId) => navigation.navigate('PostDetail', { postId }),
  },
  NEW_FOLLOWER: { title: '새 팔로워', open: openRunner },
  FOLLOW_REQUEST: { title: '팔로우 요청', open: openRunner },
  FOLLOW_APPROVED: { title: '팔로우 승인', open: openRunner },
};

type Tab = 'today' | 'week';
const tabs: { value: Tab; label: string }[] = [
  { value: 'today', label: '오늘' },
  { value: 'week', label: '이번 주' },
];

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

const loadNotifications = (repositories: Repositories) =>
  repositories.notifications.list();

// Title with the blue unread dot and the time, then the message with its name in bold.
function NotificationRow({
  item,
  first,
  now,
  onPress,
}: {
  item: AppNotification;
  first: boolean;
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
      style={({ pressed }) => [
        styles.row,
        !first && styles.divided,
        pressed && styles.pressed,
      ]}
    >
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

// 2.9 알림 (S15P31E105-374 핸드오프): no card behind the list, 오늘 · 이번 주 tabs, and no 모두 읽음
// button. Everything shown here counts as read once the screen is left (담당자 결정). 2.9b 알림 없음 stays.
export function NotificationsScreen() {
  const navigation = useNavigation<Navigation>();
  const repositories = useRepositories();
  const resource = useResource(useCallback(loadNotifications, []));
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [tab, setTab] = useState<Tab>('today');
  // N01's count also covers what this page leaves out (older pages, kinds the app does not know).
  const unreadCount = useRef(0);
  useEffect(() => {
    if (resource.status === 'ready') {
      setItems(resource.data.items);
      unreadCount.current = resource.data.unreadCount;
    }
  }, [resource.status, resource.data]);
  const now = repositories.clock.now();
  // Leaving the screen marks everything read, so the dots stay while the list is open.
  const unread = useRef(false);
  unread.current =
    unreadCount.current > 0 || (items?.some(item => !item.read) ?? false);
  const { notifications } = repositories;
  useFocusEffect(
    useCallback(
      () => () => {
        if (unread.current) {
          unreadCount.current = 0;
          unread.current = false;
          setItems(current =>
            current ? current.map(item => ({ ...item, read: true })) : null,
          );
          notifications.markAllRead().catch(() => {});
        }
      },
      [notifications],
    ),
  );
  const shown = (items ?? []).filter(item =>
    tab === 'today'
      ? isSameDay(item.createdAt, now)
      : !isSameDay(item.createdAt, now),
  );

  return (
    <Screen
      header={
        <View style={styles.header}>
          <BackButton onPress={navigation.goBack} style={styles.back} />
          <View style={styles.logo} pointerEvents="none">
            <Logo width={34} symbol />
          </View>
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
        <>
          <View style={styles.titleRow}>
            <AppText accessibilityRole="header" style={styles.title}>
              알림
            </AppText>
          </View>
          <View accessibilityRole="tablist" style={styles.tabs}>
            {tabs.map(item => {
              const on = tab === item.value;
              return (
                <Pressable
                  key={item.value}
                  accessibilityRole="tab"
                  accessibilityLabel={item.label}
                  accessibilityState={{ selected: on }}
                  onPress={() => setTab(item.value)}
                  style={[styles.tab, on && styles.tabOn]}
                >
                  <AppText style={[styles.tabText, on && styles.tabTextOn]}>
                    {item.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.list}>
            {shown.length ? (
              shown.map((item, index) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  first={index === 0}
                  now={now}
                  onPress={() =>
                    kinds[item.kind].open(navigation, item.targetId)
                  }
                />
              ))
            ) : (
              <AppText style={styles.none}>
                {tab === 'today'
                  ? '오늘 받은 알림이 없어요'
                  : '이번 주에 받은 알림이 없어요'}
              </AppText>
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

const ink = '#0A1631';

const styles = StyleSheet.create({
  header: { height: 56 },
  // 44 round glass 뒤로, centred on the 56 header.
  back: { position: 'absolute', left: 16, top: 6 },

  logo: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The mockup's list sits 12 + 6 + 18 from the edges, without the old glass card.
  content: { paddingHorizontal: 36, paddingTop: 34 },
  titleRow: { height: 38, justifyContent: 'center' },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 21,
    lineHeight: 27,
    letterSpacing: -0.5,
    color: '#02050E',
  },
  tabs: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 16,
    padding: 4,
    borderRadius: 14,
    backgroundColor: 'rgba(10,22,49,0.05)',
  },
  tab: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabOn: {
    backgroundColor: ink,
    boxShadow: '0 2px 6px rgba(10,22,49,0.3)',
  },
  tabText: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: ink,
  },
  tabTextOn: { fontFamily: fontFamily.bold, color: '#FFFFFF' },
  list: { marginTop: 6 },
  row: { paddingVertical: 16, paddingHorizontal: 2, gap: 5 },
  divided: { borderTopWidth: 1, borderTopColor: 'rgba(27,30,34,0.1)' },
  pressed: { opacity: 0.6 },
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
    color: '#3F4851',
  },
  bold: { fontFamily: fontFamily.bold, color: '#02050E' },
  none: {
    marginTop: 24,
    textAlign: 'center',
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
    color: '#56606A',
  },
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
