import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Image,
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
  PressableScale,
  useReduceMotion,
  useToast,
  type IconName,
} from '../../components';
import {
  useRepositories,
  useResource,
  type Repositories,
  type RunRecordSummary,
} from '../../data';
import { recordsChanged } from '../../data/recordsChanged';
import { navigateTo, openGroupRunResult } from '../../navigation/navigateTo';
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
import {
  CalendarPanel,
  DateLine,
  longDay,
  WeekStrip,
} from '../records/DatePicker';
import { DayRecordDetail } from '../records/DayRecords';
import { AnalysisPanel } from './AnalysisPanel';
import { ReadinessPanel } from './ReadinessPanel';
import { useSamsungSleep } from '../../health/useSamsungSleep';
import { RecordsPanel } from './RecordsPanel';

// 2.1 홈 (S15P31E105-564, 담당자 레퍼런스; S15P31E105-574 수정사항): 인사말, the date, what the menu shows, and the
// menu over the tab bar. 준비도 is today only; 러닝 기록 and 러닝 분석 share one chosen date. 기록 상세 is a step inside
// 러닝 기록 (a run opens it, 기록으로 돌아가기 leaves it) rather than a menu. On the 1.1 background with its blur and
// the glass and frost of the records screens.

type Menu = 'readiness' | 'records' | 'analysis';

// Every menu is its icon on the left and its name (S15P31E105-574): one size and stroke for the three icons.
// 준비도 · 러닝 분석 · 러닝 기록 (S15P31E105-615, 담당자 요청).
const menus: { value: Menu; label: string; icon: IconName }[] = [
  { value: 'readiness', label: '준비도', icon: 'heartPulse' },
  { value: 'analysis', label: '러닝 분석', icon: 'activity' },
  { value: 'records', label: '러닝 기록', icon: 'clock' },
];

const menuHeight = 54;
// The gap between the menu's tiles (as the week strip's days), and the room either side of a tile's icon and name.
const menuPad = 8;
// The menu is the card's foot (담당자 레퍼런스: 전단지 아래 뜯어 가는 쪽지, then 점선 없이 자연스럽게 하나의 카드):
// drawn inside the card, so card and menu are one frost with no joint, split in three by thin lines; the chosen
// part is navy to its edges, the card's round corners clipping the outer two.
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

// The menu in the card's foot: three equal parts across the card, the chosen one navy. With large text a part grows
// to its icon and name rather than cutting them, and the row then scrolls sideways; the chosen part is scrolled into
// view when it changes.
function MenuBar({
  value,
  onChange,
}: {
  value: Menu;
  onChange: (menu: Menu) => void;
}) {
  const row = useRef<ScrollView>(null);
  const places = useRef<Partial<Record<Menu, { x: number; width: number }>>>(
    {},
  );
  const [rowWidth, setRowWidth] = useState(0);
  // The widest icon and name, so no part is ever narrower than its content.
  const [content, setContent] = useState(0);
  const part = Math.max(rowWidth / menus.length, content + menuPad * 2);
  // The navy slides from the old part to the chosen one (담당자 요청: 버튼 모션), in place with 동작 줄이기.
  const reduce = useReduceMotion();
  const chosen = menus.findIndex(menu => menu.value === value);
  const slide = useRef(new Animated.Value(chosen)).current;
  useEffect(() => {
    if (reduce) {
      slide.setValue(chosen);
      return;
    }
    Animated.spring(slide, {
      toValue: chosen,
      speed: 14,
      bounciness: 5,
      useNativeDriver: true,
    }).start();
  }, [chosen, reduce, slide]);
  const scrollX = useRef(0);
  useEffect(() => {
    const place = places.current[value];
    if (!place || !rowWidth) {
      return;
    }
    const side = 0;
    if (place.x - side < scrollX.current) {
      row.current?.scrollTo({ x: Math.max(0, place.x - side), animated: true });
    } else if (place.x + place.width + side > scrollX.current + rowWidth) {
      row.current?.scrollTo({
        x: place.x + place.width + side - rowWidth,
        animated: true,
      });
    }
  }, [value, rowWidth, part]);
  return (
    <View style={styles.menuInCard}>
      <View>
        <ScrollView
          ref={row}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.menu}
          onLayout={event => setRowWidth(event.nativeEvent.layout.width)}
          onScroll={event => {
            scrollX.current = event.nativeEvent.contentOffset.x;
          }}
          scrollEventThrottle={32}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              styles.menuSlider,
              {
                width: part,
                transform: [{ translateX: Animated.multiply(slide, part) }],
              },
            ]}
          />
          {menus.map((menu, index) => {
            const selected = menu.value === value;
            const color = '#FFFFFF';
            return (
              <PressableScale
                key={menu.value}
                // Buttons rather than tabs, so screen readers keep "탭" for the tab bar under it. The name read out is
                // the one on the pill; the icon is decoration.
                accessibilityRole="button"
                accessibilityLabel={menu.label}
                accessibilityState={{ selected }}
                onPress={() => onChange(menu.value)}
                onLayout={event => {
                  const { x, width } = event.nativeEvent.layout;
                  places.current[menu.value] = { x, width };
                }}
                style={[
                  styles.menuPart,
                  { width: part },
                  index > 0 && styles.menuDivided,
                ]}
              >
                <View style={styles.menuFace}>
                  <View
                    style={styles.menuInner}
                    onLayout={event => {
                      const measured = Math.ceil(
                        event.nativeEvent.layout.width,
                      );
                      setContent(widest => Math.max(widest, measured));
                    }}
                  >
                    <Icon
                      name={menu.icon}
                      color={color}
                      size={17}
                      strokeWidth={2}
                    />
                    <AppText style={[styles.menuText, { color }]}>
                      {menu.label}
                    </AppText>
                  </View>
                </View>
              </PressableScale>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

// A run opened in 기록 상세: its own day and id, so the 러닝 기록 date under it stays as it was.
type Detail = { day: string; runId: string };

export function HomeScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<HomeStackParamList, 'Home'>>();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { clock, records } = useRepositories();
  const today = kstDay(clock.now());
  const me = useResource(loadMe);
  const condition = useResource(loadToday);
  // S15P31E105-572·600: today's Samsung Health sleep and resting heart rate read on this phone, for 2.1 without a
  // score.
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
  // The date of 러닝 기록 and 러닝 분석; 준비도 does not change it.
  const [day, setDay] = useState(today);
  const [runId, setRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [calendar, setCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(kstMonth(today));
  const choose = (next: string) => {
    setDay(next);
    setRunId(null);
  };

  // Where the 러닝 기록 card was scrolled, to come back to it from a detail.
  const card = useRef<ScrollView>(null);
  const recordsY = useRef(0);
  const closeDetail = useCallback(() => {
    setDetail(null);
    const y = recordsY.current;
    // The 러닝 기록 card stayed mounted under the detail, so it is laid out again at once.
    setTimeout(() => card.current?.scrollTo({ y, animated: false }), 0);
  }, []);
  // A run on 러닝 기록, its month list or 러닝 분석 opens its own detail in 러닝 기록; a group run opens 6.7.
  const openRun = (run: RunRecordSummary) => {
    if (run.runType === 'GROUP' && openGroupRunResult(navigation, run.group)) {
      return;
    }
    setCalendar(false);
    setMenu('records');
    setDetail({ day: kstDay(run.startedAt), runId: run.id });
    card.current?.scrollTo({ y: 0, animated: false });
  };
  // Android back leaves the detail first, as 기록으로 돌아가기 does.
  useFocusEffect(
    useCallback(() => {
      if (!detail) {
        return undefined;
      }
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          closeDetail();
          return true;
        },
      );
      return () => subscription.remove();
    }, [detail, closeDetail]),
  );
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
          const runDay = kstDay(record.startedAt);
          setCalendar(false);
          setDay(runDay);
          setRunId(record.id);
          setMenu('records');
          setDetail({ day: runDay, runId: record.id });
        }
      })
      .catch(() => {
        if (mounted.current) {
          toast('기록을 불러오지 못했어요. 러닝 기록에서 다시 열어 주세요');
        }
      });
    // Read once: the same run can be opened again later.
    navigation.setParams({ recordId: undefined } as never);
  }, [opened, records, navigation, toast]);

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
  // 날짜 · 달력 belong to 러닝 기록 and 러닝 분석, not to 준비도 or an open detail.
  const picking = menu !== 'readiness' && !detail;
  // A menu closes the calendar to show its card; 러닝 기록 again leaves an open detail.
  const pickMenu = (next: Menu) => {
    setCalendar(false);
    if (detail) {
      setDetail(null);
    }
    setMenu(next);
  };
  const showCalendar = calendar && picking;

  const readiness =
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
        todayDay={today}
        phoneSleep={{
          access: sleep.access,
          today: sleep.today,
          heartAccess: sleep.heartAccess,
          restingHr: sleep.todayRestingHr,
          exerciseAccess: sleep.exerciseAccess,
          requesting: sleep.requesting,
          onConnect: () => {
            void sleep.request();
          },
        }}
      />
    );

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <RecordsBackdrop />
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
        {menu === 'readiness' ? (
          // 준비도 is about today only (S15P31E105-574): the week stays on today, and another day opens that
          // day's 러닝 기록 instead (담당자 요청: 준비도에도 날짜 줄).
          <>
            <View style={styles.todayLine}>
              <View style={styles.todayTag}>
                <AppText style={styles.todayTagText}>오늘</AppText>
              </View>
              <AppText style={styles.todayText}>{longDay(today)}</AppText>
            </View>
            <WeekStrip
              value={today}
              today={today}
              onChange={next => {
                if (next !== today) {
                  choose(next);
                  setMenu('records');
                }
              }}
            />
          </>
        ) : detail ? (
          <View style={styles.todayLine}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="기록으로 돌아가기"
              hitSlop={6}
              onPress={closeDetail}
              style={styles.backPill}
            >
              <Icon
                name="back"
                color={recordsLook.ink}
                size={15}
                strokeWidth={2.2}
              />
              <AppText style={styles.backText}>기록으로 돌아가기</AppText>
            </PressableScale>
            <AppText style={styles.detailDay} numberOfLines={1}>
              {longDay(detail.day)}
            </AppText>
          </View>
        ) : (
          <>
            <View style={styles.dateRow}>
              <View style={styles.flex}>
                <DateLine
                  value={day}
                  open={calendar}
                  month={calendarMonth}
                  onToggle={() => {
                    setCalendarMonth(kstMonth(day));
                    setCalendar(open => !open);
                  }}
                />
              </View>
              {day !== today && !calendar ? (
                // A past date goes back to today in one tap; it fades in as the date leaves today.
                <FadeIn appearKey="today">
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="오늘로 이동"
                    hitSlop={6}
                    onPress={() => choose(today)}
                    style={styles.todayButton}
                  >
                    <AppText style={styles.todayButtonText}>오늘</AppText>
                  </PressableScale>
                </FadeIn>
              ) : null}
            </View>
            {calendar ? null : (
              <WeekStrip value={day} today={today} onChange={choose} />
            )}
          </>
        )}
      </View>
      <View style={[frostCard, styles.card, { marginBottom: menuBottom }]}>
        {showCalendar ? (
          // The calendar opens in the card, down to the menu and no further (담당자 요청), on white.
          <FadeIn appearKey="calendar" style={styles.calendar}>
            <ScrollView
              contentContainerStyle={styles.calendarContent}
              showsVerticalScrollIndicator={false}
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
            </ScrollView>
          </FadeIn>
        ) : null}
        {/* Kept mounted under the calendar, so closing it finds the card where it was. */}
        <View style={showCalendar ? styles.hidden : styles.flex}>
          <ScrollView
            ref={card}
            contentContainerStyle={styles.cardContent}
            showsVerticalScrollIndicator={false}
            onScroll={event => {
              if (menu === 'records' && !detail) {
                recordsY.current = event.nativeEvent.contentOffset.y;
              }
            }}
            scrollEventThrottle={32}
            refreshControl={
              <RefreshControl
                refreshing={pending > 0}
                onRefresh={onRefresh}
                tintColor="#FFFFFF"
                colors={[recordsLook.ink]}
              />
            }
          >
            {menu === 'records' ? (
              <>
                {/* Kept mounted under an open detail, so coming back finds the same month and place. */}
                <View style={detail ? styles.hidden : null}>
                  <FadeIn appearKey="month">
                    <RecordsPanel day={day} onOpen={openRun} />
                  </FadeIn>
                </View>
                {detail ? (
                  <FadeIn appearKey={`detail:${detail.runId}`}>
                    <DayRecordDetail
                      day={detail.day}
                      runId={detail.runId}
                      onRun={id => setDetail({ ...detail, runId: id })}
                    />
                  </FadeIn>
                ) : null}
              </>
            ) : (
              <FadeIn appearKey={menu}>
                {menu === 'readiness' ? (
                  readiness
                ) : (
                  <AnalysisPanel
                    day={day}
                    runId={runId}
                    onRun={setRunId}
                    onOpen={openRun}
                    onShowList={() => pickMenu('records')}
                  />
                )}
              </FadeIn>
            )}
          </ScrollView>
        </View>
        <MenuBar value={menu} onChange={pickMenu} />
      </View>
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
  // As tall as 준비도's line and the 오늘 button, so the date does not jump when 오늘 comes and goes.
  dateRow: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // 준비도's 오늘 · 11월 9일 월요일, and the detail's way back: one line where the date line is.
  todayLine: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  todayTag: {
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 12,
    justifyContent: 'center',
    backgroundColor: recordsLook.ink,
  },
  todayTagText: {
    fontFamily: fontFamily.bold,
    fontSize: 12.5,
    lineHeight: 16,
    color: '#FFFFFF',
  },
  todayText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.3,
    color: recordsLook.ink,
  },
  todayButton: {
    height: 30,
    paddingHorizontal: 14,
    borderRadius: 15,
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.78)',
  },
  todayButtonText: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: recordsLook.ink,
  },
  backPill: {
    height: 32,
    paddingLeft: 10,
    paddingRight: 14,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.78)',
  },
  backText: {
    fontFamily: fontFamily.bold,
    fontSize: 13.5,
    lineHeight: 18,
    color: recordsLook.ink,
  },
  detailDay: {
    flexShrink: 1,
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    lineHeight: 18,
    color: recordsLook.ink,
  },
  card: {
    flex: 1,
    marginTop: recordsFrame.gap,
    marginHorizontal: recordsFrame.side,
    overflow: 'hidden',
  },
  cardContent: { paddingHorizontal: 22, paddingTop: 20, paddingBottom: 22 },
  loading: { marginTop: 120 },
  calendar: { flex: 1, backgroundColor: '#FFFFFF' },
  calendarContent: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8 },
  hidden: { display: 'none' },
  // Under the card's scrolling content, never squeezed by it.
  menuInCard: { flexShrink: 0 },
  menu: { flexGrow: 1 },
  menuPart: { height: menuHeight },
  menuDivided: {
    borderLeftWidth: frostCard.borderWidth,
    borderLeftColor: frostCard.borderColor,
  },
  menuFace: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  menuInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // The chosen part's navy, under the names, moved by its index.
  menuSlider: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: menuHeight,
    backgroundColor: recordsLook.ink,
  },
  menuText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: -0.3,
  },
});
