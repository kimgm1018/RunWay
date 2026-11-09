import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AppText,
  EmptyState,
  FadeIn,
  Icon,
  type IconName,
} from '../../components';
import {
  useRepositories,
  useResource,
  type Repositories,
  type RunRecordSummary,
} from '../../data';
import { recordsChanged } from '../../data/recordsChanged';
import { navigateTo } from '../../navigation/navigateTo';
import type { HomeStackParamList } from '../../navigation/types';
import { fontFamily, homePalette, size } from '../../theme';
import { GlassIconButton } from '../../components/GlassIconButton';
import {
  frostCard,
  recordsFrame,
  recordsLook,
  RecordsBackdrop,
} from '../records/look';
import { kstDay, kstMonth } from '../records/parts';
import { CalendarPanel, DateLine, WeekStrip } from '../records/DatePicker';
import { DayRecordDetail } from '../records/DayRecords';
import { AnalysisPanel } from './AnalysisPanel';
import { ReadinessPanel } from './ReadinessPanel';
import { useSamsungSleep } from '../../health/useSamsungSleep';
import { RecordsPanel } from './RecordsPanel';

// 2.1 홈 (S15P31E105-564, 담당자 레퍼런스): 인사말, the date (fixed), what the menu shows, and the menu over the tab
// bar. 준비도 · 과거 러닝 기록 · 기록 상세 · 러닝 분석 share the one screen and the one date; the menu swaps only
// the card. On the 1.1 background with its blur and the glass and frost of the records screens.

type Menu = 'readiness' | 'records' | 'detail' | 'analysis';

const menus: { value: Menu; label: string; icon?: IconName }[] = [
  // 준비도 is the main one: the round button first (레퍼런스의 첫 동그라미).
  { value: 'readiness', label: '준비도', icon: 'heartPulse' },
  { value: 'records', label: '과거 러닝 기록' },
  { value: 'detail', label: '기록 상세' },
  { value: 'analysis', label: '러닝 분석' },
];

const menuHeight = 44;
const menuGap = 10;

// Each part loads on its own, so one that fails (the notifications, say) leaves the rest of 2.1 on screen.
const loadMe = (repositories: Repositories) => repositories.profile.getMe();
const loadToday = (repositories: Repositories) =>
  repositories.home.getTodayCondition();
const loadNotifications = (repositories: Repositories) =>
  repositories.notifications.list();

// 반가워요 민준님 👋 in one line beside the profile photo (담당자 요청).
function Greeting({
  nickname,
  photo,
}: {
  nickname: string;
  photo: string | null;
}) {
  return (
    <View style={styles.greeting}>
      <View style={styles.avatar}>
        {photo ? (
          <Image
            source={{ uri: photo }}
            style={StyleSheet.absoluteFill}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <AppText style={styles.initial}>{nickname.slice(0, 1)}</AppText>
        )}
      </View>
      <AppText numberOfLines={1} style={styles.hello}>
        {nickname ? `반가워요 ${nickname}님 👋` : '반가워요 👋'}
      </AppText>
    </View>
  );
}

// The menu over the tab bar (레퍼런스): 준비도 as a round button, then the chips; the chosen one is navy.
function MenuBar({
  value,
  onChange,
  bottom,
}: {
  value: Menu;
  onChange: (menu: Menu) => void;
  bottom: number;
}) {
  return (
    <View style={[styles.menuLayer, { bottom }]} pointerEvents="box-none">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.menu}
      >
        {menus.map(menu => {
          const selected = menu.value === value;
          return (
            <Pressable
              key={menu.value}
              // Buttons rather than tabs, so screen readers keep "탭" for the tab bar under it.
              accessibilityRole="button"
              accessibilityLabel={menu.label}
              accessibilityState={{ selected }}
              onPress={() => onChange(menu.value)}
              style={({ pressed }) => [
                menu.icon ? styles.menuRound : styles.menuChip,
                selected ? styles.menuOn : styles.menuOff,
                pressed && styles.pressed,
              ]}
            >
              {menu.icon ? (
                <Icon
                  name={menu.icon}
                  color={selected ? '#FFFFFF' : recordsLook.ink}
                  size={19}
                  strokeWidth={2}
                />
              ) : (
                <AppText
                  style={[styles.menuText, selected && styles.menuTextOn]}
                >
                  {menu.label}
                </AppText>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function HomeScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<HomeStackParamList, 'Home'>>();
  const insets = useSafeAreaInsets();
  const { clock, records } = useRepositories();
  const today = kstDay(clock.now());
  const me = useResource(loadMe);
  const condition = useResource(loadToday);
  // S15P31E105-572: today's Samsung Health sleep read on this phone, for 2.1 without a score.
  const sleep = useSamsungSleep();
  const notifications = useResource(loadNotifications);
  // Back from 8.2 the greeting shows the saved nickname and photo, and back from 2.9 the bell loses its dot
  // (leaving 2.9 marks all read). The first focus is the first load.
  const refreshMe = me.refresh;
  const refreshNotifications = notifications.refresh;
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) {
        void refreshMe();
        void refreshNotifications();
      }
      focused.current = true;
    }, [refreshMe, refreshNotifications]),
  );
  // Notifications that did not load only leave the bell without its dot.
  const unread = (notifications.data?.unreadCount ?? 0) > 0;

  const [menu, setMenu] = useState<Menu>('readiness');
  const [day, setDay] = useState(today);
  const [runId, setRunId] = useState<string | null>(null);
  const [calendar, setCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(kstMonth(today));
  const choose = (next: string) => {
    setDay(next);
    setRunId(null);
  };
  // A run on 과거 러닝 기록 or 러닝 분석 opens in 기록 상세 on its own day; a group run opens 6.7.
  const openRun = (run: RunRecordSummary) => {
    if (run.runType === 'GROUP') {
      navigateTo(navigation, 'GroupRunResult');
      return;
    }
    setDay(kstDay(run.startedAt));
    setRunId(run.id);
    setMenu('detail');
  };
  // 4.5 기록 보기 and 7.4 open one of my runs here, in 기록 상세 on its day (S15P31E105-564: 5.2 is part of 2.1).
  const opened = route.params?.recordId;
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    if (!opened) {
      return;
    }
    records
      .getDetail(opened)
      .then(record => {
        if (mounted.current) {
          setCalendar(false);
          setDay(kstDay(record.startedAt));
          setRunId(record.id);
          setMenu('detail');
        }
      })
      .catch(() => undefined);
    // Read once: the same run can be opened again later.
    navigation.setParams({ recordId: undefined } as never);
  }, [opened, records, navigation]);

  // Pull to refresh: the spinner stays until every part that reloads has settled.
  const [pending, setPending] = useState(0);
  const onRefresh = () => {
    recordsChanged();
    void sleep.refresh();
    [me, condition, notifications].forEach(resource => {
      setPending(count => count + 1);
      resource.refresh().finally(() => setPending(count => count - 1));
    });
  };

  const barBottom = Math.max(insets.bottom, size.tabBarInset);
  const menuBottom = barBottom + size.tabBar + menuGap;

  const panel =
    menu === 'readiness' ? (
      condition.status === 'loading' ? (
        <ActivityIndicator style={styles.loading} color="#FFFFFF" />
      ) : condition.status === 'error' ? (
        <EmptyState
          icon="alert"
          title="오늘 컨디션을 불러오지 못했어요"
          actionLabel="다시 시도"
          onAction={condition.reload}
        />
      ) : (
        <ReadinessPanel
          today={condition.data}
          phoneSleep={{
            access: sleep.access,
            today: sleep.today,
            requesting: sleep.requesting,
            onConnect: () => {
              void sleep.request();
            },
          }}
        />
      )
    ) : menu === 'records' ? (
      <RecordsPanel day={day} runId={runId} onRun={setRunId} onOpen={openRun} />
    ) : menu === 'detail' ? (
      <DayRecordDetail day={day} runId={runId} onRun={setRunId} />
    ) : (
      <AnalysisPanel day={day} onDay={choose} onOpen={openRun} />
    );

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <RecordsBackdrop />
      {calendar ? (
        // The calendar covers the whole screen (담당자 레퍼런스): a light sheet over the photo, the calendar laid flat
        // on it in place of the week and the card.
        <FadeIn appearKey="calendar" style={styles.cover}>
          <View />
        </FadeIn>
      ) : null}
      <View style={[styles.head, { paddingTop: insets.top + 10 }]}>
        <Greeting
          nickname={me.data?.nickname ?? ''}
          photo={me.data?.profileImageUrl ?? null}
        />
        <GlassIconButton
          icon="bell"
          accessibilityLabel="알림"
          dot={unread}
          onPress={() => navigateTo(navigation, 'Notifications')}
        />
        <GlassIconButton
          icon="settings"
          accessibilityLabel="설정"
          onPress={() => navigateTo(navigation, 'Settings')}
        />
      </View>
      <View style={styles.date}>
        <DateLine
          value={day}
          open={calendar}
          month={calendarMonth}
          onToggle={() => {
            setCalendarMonth(kstMonth(day));
            setCalendar(open => !open);
          }}
        />
        {calendar ? null : (
          <WeekStrip value={day} today={today} onChange={choose} />
        )}
      </View>
      {calendar ? (
        <FadeIn
          appearKey="calendar"
          style={[
            styles.calendar,
            { marginBottom: menuBottom + menuHeight + recordsFrame.gap },
          ]}
        >
          <CalendarPanel
            flat
            value={day}
            today={today}
            onMonthChange={setCalendarMonth}
            onPick={next => {
              setCalendar(false);
              choose(next);
            }}
          />
        </FadeIn>
      ) : null}
      <View
        style={[
          frostCard,
          styles.card,
          { marginBottom: menuBottom + menuHeight + recordsFrame.gap },
          calendar && styles.hidden,
        ]}
      >
        <ScrollView
          contentContainerStyle={styles.cardContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={pending > 0}
              onRefresh={onRefresh}
              tintColor="#FFFFFF"
              colors={[recordsLook.ink]}
            />
          }
        >
          <FadeIn appearKey={menu}>{panel}</FadeIn>
        </ScrollView>
      </View>
      <MenuBar
        value={menu}
        onChange={next => {
          // A menu closes the calendar to show its card.
          setCalendar(false);
          setMenu(next);
        }}
        bottom={menuBottom}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: recordsFrame.side,
    paddingBottom: 12,
  },
  greeting: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: homePalette.avatar,
  },
  initial: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 22,
    color: '#FFFFFF',
  },
  hello: {
    flex: 1,
    fontFamily: fontFamily.bold,
    fontSize: 19,
    lineHeight: 25,
    letterSpacing: -0.4,
    color: recordsLook.ink,
  },
  date: { paddingHorizontal: recordsFrame.side, gap: 8 },
  card: {
    flex: 1,
    marginTop: recordsFrame.gap,
    marginHorizontal: recordsFrame.side,
    overflow: 'hidden',
  },
  cardContent: { paddingHorizontal: 22, paddingTop: 20, paddingBottom: 22 },
  loading: { marginTop: 120 },
  cover: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#F2F4F6',
  },
  calendar: {
    flex: 1,
    marginTop: 8,
    paddingHorizontal: recordsFrame.side,
  },
  hidden: { display: 'none' },
  menuLayer: { position: 'absolute', left: 0, right: 0 },
  menu: {
    gap: 8,
    paddingHorizontal: recordsFrame.side,
    alignItems: 'center',
  },
  menuRound: {
    width: menuHeight,
    height: menuHeight,
    borderRadius: menuHeight / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuChip: {
    height: menuHeight,
    paddingHorizontal: 18,
    borderRadius: menuHeight / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Flat pills (담당자 요청: 입체감 없이): a plain fill, no rim or shadow.
  menuOn: { backgroundColor: recordsLook.ink },
  menuOff: { backgroundColor: 'rgba(255,255,255,0.78)' },
  menuText: {
    fontFamily: fontFamily.bold,
    fontSize: 14.5,
    lineHeight: 19,
    letterSpacing: -0.3,
    color: recordsLook.ink,
  },
  menuTextOn: { color: '#FFFFFF' },
  pressed: { opacity: 0.75 },
});
