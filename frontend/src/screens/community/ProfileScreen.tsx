import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  StackActions,
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PagerView from 'react-native-pager-view';
import Svg, {
  Defs,
  LinearGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import {
  AppText,
  Backdrop,
  EmptyState,
  Icon,
  MistFill,
  PressableScale,
  useToast,
} from '../../components';
import {
  DataError,
  ownImageSource,
  useRepositories,
  type CourseMapData,
  type FollowListKind,
  useResource,
  type Post,
  type Repositories,
  type RunnerProfile,
  type RunRecordSummary,
  type SavedCourse,
  type SelfReportedLevel,
} from '../../data';
import {
  formatDotDateWeekday,
  formatDuration,
  formatKm,
  formatPace,
} from '../../format';
import { FollowRequestSheet } from './FollowRequestSheet';
import { navigateTo, openRecord } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import { fontFamily, size, ThemeProvider } from '../../theme';
import {
  CardViewportContext,
  CourseMapThumb,
  createCardViewport,
  useOpenSavedCourse,
} from '../course/SavedCoursesScreen';
import { communityLook } from './look';
import { BackButton } from '../../components/BackButton';
import { runRouteOf } from '../../components/mapRoute';
import { GlassIconButton } from '../../components/GlassIconButton';
import { usePostPages } from './usePostPages';
import { PhotoZoom, zoomablePhoto } from './PhotoZoom';

// 7.4 · 7.4b after the user's reference (담당자 요청): the top half is a picture fading into the mist (홈 · 러닝과
// 같은 배경, S15P31E105-483), the name sits over its foot, then one wide navy button, a row of three numbers, a
// glass card and the runs
// as two-column photo tiles. The picture is the runner's profile photo; without one it is a mist-to-teal
// gradient with the nickname's first letter large on it (담당자 결정). Only what the screen already showed is drawn.
const look = {
  // The picture without a photo: pale mist at the top, through steel and teal; the mist covers its foot.
  hero: [
    '#C4D4DC',
    '#A4BDC9',
    '#8DACBA',
    '#7DA0B2',
    '#5D8194',
    '#3A5A6C',
    '#182E3D',
    '#091019',
  ],
  heroStops: [0, 0.16, 0.3, 0.42, 0.56, 0.7, 0.86, 1],
  white: '#FFFFFF',
  // The page under the picture: the mist, with navy text (S15P31E105-483).
  mist: ['#E9EFF2', '#DEE6EA', '#CDDBE1', '#B3C4CD'],
  ink: communityLook.ink,
  inkSub: 'rgba(2,5,14,0.6)',
  inkMuted: 'rgba(2,5,14,0.45)',
  lightGlass: 'rgba(255,255,255,0.55)',
  lightGlassEdge: 'rgba(255,255,255,0.8)',
};

const levelLabels: Record<SelfReportedLevel, string> = {
  BEGINNER: '초급',
  INTERMEDIATE: '중급',
  ADVANCED: '고급',
};

// A closed private profile has no counts (U21), so they show as a dash.
const countText = (count: number | null) =>
  count === null ? '–' : String(count);

// A vertical gradient whose stops can fade: alpha goes through stopOpacity, which Android keeps.
function FadeFill({
  id,
  colors,
  offsets,
  opacities,
  style,
}: {
  id: string;
  colors: string[];
  offsets: number[];
  opacities: number[];
  style?: object;
}) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  const measure = (event: LayoutChangeEvent) =>
    setBox(event.nativeEvent.layout);
  return (
    <View style={[styles.fill, style]} onLayout={measure} pointerEvents="none">
      {box ? (
        <Svg width={box.width} height={box.height}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              {colors.map((color, index) => (
                <Stop
                  key={index}
                  offset={offsets[index]}
                  stopColor={color}
                  stopOpacity={opacities[index]}
                />
              ))}
            </LinearGradient>
          </Defs>
          <Rect width={box.width} height={box.height} fill={`url(#${id})`} />
        </Svg>
      ) : null}
    </View>
  );
}

// The tint over the info area starts this far above the hero's foot, so the name sits on it.
const panelLead = 130;
const blurAmount = 26;
// The photo's blur once the page has scrolled (Image blurRadius).
const photoBlur = 24;
// The nickname's first letter, drawn huge so its lower half reaches behind the info area.
const letterSize = 330;
const letterTop = 70;
// Where the sharp letter fades, as parts of its height: whole down to fadeFrom, gone by fadeTo.
const fadeFrom = 0.5;
const fadeTo = 0.86;

// The letter as Svg text, so its fill can fade toward the foot. Both copies are drawn the same way, so
// the sharp one lies exactly over the blurred one.
function Letter({
  initial,
  id,
  width,
  fade,
}: {
  initial: string;
  id: string;
  width: number;
  fade: boolean;
}) {
  const height = letterSize * 1.25;
  return (
    <Svg
      width={width}
      height={height}
      style={[styles.letter, { top: letterTop }]}
    >
      {fade ? (
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.92} />
            <Stop offset={fadeFrom} stopColor="#FFFFFF" stopOpacity={0.92} />
            <Stop offset={fadeTo} stopColor="#FFFFFF" stopOpacity={0} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>
        </Defs>
      ) : null}
      <SvgText
        x={width / 2}
        y={letterSize * 0.98}
        textAnchor="middle"
        fontFamily={fontFamily.bold}
        fontSize={letterSize}
        fill={fade ? `url(#${id})` : '#FFFFFF'}
        fillOpacity={fade ? 1 : 0.92}
      >
        {initial}
      </SvgText>
    </Svg>
  );
}

// The reference's look (담당자 요청): one picture fixed behind the screen, sharp when the profile opens, and
// the information scrolls up over it; the further it scrolls, the blurrier and darker the picture gets
// (담당자 요청: 스크롤 내릴수록 흐려지게). React Native cannot blur what lies behind a view, so a blurred copy of the
// picture (filter: blur, Android only; iOS stays sharp) fades in over the sharp one as the page scrolls.
// The sharp letter's foot fades out so the info area starts calm, with a dark tint deepening below it.
function HeroBackdrop({
  initial,
  photo: address,
  heroHeight,
  scrollY,
}: {
  initial: string;
  // The runner's photo (U21 profileImageUrl); without one the gradient and the letter stand in.
  photo: string | null;
  heroHeight: number;
  scrollY: Animated.Value;
}) {
  const { width, height } = useWindowDimensions();
  // A photo that does not load leaves the gradient and the letter, as without one.
  const [failed, setFailed] = useState<string | null>(null);
  const photo = address && address !== failed ? address : null;
  // Wider than the screen so the blur does not fade in at the sides.
  const blurWidth = width + 120;
  const blurred = scrollY.interpolate({
    inputRange: [0, heroHeight * 0.6],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const sharp = scrollY.interpolate({
    inputRange: [0, heroHeight * 0.6],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const darker = scrollY.interpolate({
    inputRange: [0, heroHeight],
    outputRange: [0, 0.85],
    extrapolate: 'clamp',
  });
  return (
    <View pointerEvents="none" style={[styles.backdrop, { height }]}>
      {photo ? (
        <>
          {/* The photo over the whole background, and its blurred copy (blurRadius works on both
              platforms) fading in as the page scrolls. */}
          <Image
            source={{ uri: photo }}
            style={styles.fill}
            resizeMode="cover"
            onError={() => setFailed(photo)}
            accessibilityIgnoresInvertColors
          />
          {/* A large photo barely softens under blurRadius alone, so on Android filter: blur is added
              on a wrapper (Image styles do not take filter). */}
          <Animated.View
            style={[
              styles.photoBlur,
              { opacity: blurred, filter: [{ blur: blurAmount }] },
            ]}
          >
            <Image
              source={{ uri: photo }}
              style={styles.fill}
              resizeMode="cover"
              blurRadius={photoBlur}
            />
          </Animated.View>
        </>
      ) : (
        <>
          <MistFill
            id="profilePicture"
            colors={look.hero}
            offsets={look.heroStops}
            style={styles.fillBleed}
          />
          <Animated.View
            style={[
              styles.blurCopy,
              {
                width: blurWidth,
                height,
                opacity: blurred,
                filter: [{ blur: blurAmount }],
              },
            ]}
          >
            <Letter
              initial={initial}
              id="profileLetterBlur"
              width={blurWidth}
              fade={false}
            />
          </Animated.View>
          <Animated.View style={[styles.fill, { opacity: sharp }]}>
            <Letter
              initial={initial}
              id="profileLetterSharp"
              width={width}
              fade
            />
          </Animated.View>
        </>
      )}
      {/* The picture's foot melts into the mist, which is opaque by the counts so the navy text reads. */}
      <FadeFill
        id="profileFrostTint"
        colors={[...look.mist]}
        offsets={[0, 0.14, 0.32, 1]}
        opacities={[0, 0.7, 1, 1]}
        style={{ top: heroHeight - panelLead }}
      />
      <Animated.View
        style={[styles.fill, styles.darken, { opacity: darker }]}
      />
    </View>
  );
}

// One of the three numbers under the button. 팔로워 · 팔로잉 open 7.4c when the profile is open to me.
function Count({
  value,
  unit,
  label,
  onPress,
}: {
  value: string;
  unit?: string;
  label: string;
  onPress?: () => void;
}) {
  const content = (
    <>
      <AppText style={styles.countValue}>
        {value}
        {unit ? <AppText style={styles.countUnit}>{unit}</AppText> : null}
      </AppText>
      <AppText style={styles.countLabel}>{label}</AppText>
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${value}명 목록`}
      onPress={onPress}
      style={({ pressed }) => [styles.count, pressed && styles.countPressed]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={styles.count}>{content}</View>
  );
}

// The wide navy button: 팔로우 + · 팔로잉 ✓ · 요청됨 ✓ (U22·U23), or 프로필 수정 on my own profile.
function MainButton({
  label,
  icon,
  busy = false,
  onPress,
}: {
  label: string;
  icon: 'plus' | 'check' | 'pencil';
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={styles.main}
    >
      <AppText style={[styles.mainText, busy && styles.busy]}>{label}</AppText>
      <Icon name={icon} color={look.white} size={16} strokeWidth={2.4} />
    </PressableScale>
  );
}

const tileGap = 12;

// A run as a photo tile (공유한 러닝 결과 · 최근 기록): the run's gradient and outline, its name, day and
// pace in white over the darkened foot; the pace turns coral when slower than the goal.
function RunTile({
  record,
  width,
  loadRoute,
  noRouteLabel,
  ownThumbnail = false,
  onPress,
}: {
  record: RunRecordSummary;
  width: number;
  loadRoute?: () => Promise<CourseMapData | null>;
  // 내 기록: the server's OSM thumbnail of the run, asked with my token, and never a live Naver map (S15P31E105-756).
  ownThumbnail?: boolean;
  // 내 기록 only: a run with no route says so (S15P31E105-756); a post may just not share its course.
  noRouteLabel?: string;
  onPress: () => void;
}) {
  const detail = record.group
    ? `${formatDotDateWeekday(record.startedAt)} · ${record.group.crewName} · ${
        record.group.finisherCount
      }명 완주`
    : `${formatDotDateWeekday(record.startedAt)} · ${formatDuration(
        record.durationSec,
      )}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${record.title}, ${detail}, ${formatKm(
        record.distanceM,
      )}km`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { width, height: Math.round(width * 1.18) },
        pressed && styles.tilePressed,
      ]}
    >
      {/* The run on its map (S15P31E105-612), the words over its dark foot. */}
      <CourseMapThumb
        load={loadRoute}
        shape={record.shape}
        km={record.distanceM / 1000}
        area={{ top: 0.08, bottom: 0.5 }}
        shadeFrom={0.42}
        emptyLabel={noRouteLabel}
        basemap={
          ownThumbnail && record.routePreviewImageUrl
            ? { imageUrl: record.routePreviewImageUrl, osmDataTimestamp: null }
            : undefined
        }
        imageSource={ownThumbnail ? ownImageSource : undefined}
        liveMap={!ownThumbnail}
      />
      <View style={styles.tileText}>
        {record.runType === 'GROUP' ? (
          <View style={styles.badge}>
            <AppText style={styles.badgeText}>그룹런</AppText>
          </View>
        ) : null}
        <AppText style={styles.tileTitle} numberOfLines={1}>
          {record.title}
        </AppText>
        <AppText style={styles.tileDetail} numberOfLines={2}>
          {detail}
        </AppText>
        <AppText
          style={[
            styles.tilePace,
            record.goalAchieved === false && styles.tilePaceMissed,
          ]}
        >
          {formatPace(record.averagePaceSecPerKm)}
        </AppText>
      </View>
    </Pressable>
  );
}

// A saved course as a tile beside the runs: the course on its map, its name and distance · time.
function CourseTile({
  course,
  width,
  onPress,
}: {
  course: SavedCourse;
  width: number;
  onPress: () => void;
}) {
  const title = course.myAlias ?? course.name;
  const detail = `${formatKm(course.distanceM, 1)}km · ${
    course.expectedMinutes
  }분`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { width, height: Math.round(width * 1.18) },
        pressed && styles.tilePressed,
      ]}
    >
      <CourseMapThumb
        route={course.route}
        basemap={course.basemap}
        unmeasuredEdges={course.unmeasuredEdges}
        shape={course.shape}
        km={course.distanceM / 1000}
        area={{ top: 0.08, bottom: 0.5 }}
        shadeFrom={0.42}
      />
      <View style={styles.tileText}>
        <AppText style={styles.tileTitle} numberOfLines={2}>
          {title}
        </AppText>
        <AppText style={styles.tileDetail} numberOfLines={1}>
          {detail}
        </AppText>
      </View>
    </Pressable>
  );
}

// S15P31E105-732: my profile lists 기록 · 스크랩 · 저장된 코스 as left-to-right tabs.
type ProfileTab = 'records' | 'scraps' | 'courses';
const myTabs: { id: ProfileTab; label: string }[] = [
  { id: 'records', label: '기록' },
  { id: 'scraps', label: '스크랩' },
  { id: 'courses', label: '저장된 코스' },
];
const recordPageSize = 20;

function ProfileTabs({
  value,
  onChange,
}: {
  value: ProfileTab;
  onChange: (tab: ProfileTab) => void;
}) {
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {myTabs.map(tab => {
        const on = tab.id === value;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(tab.id)}
            style={[styles.tab, on && styles.tabOn]}
          >
            <AppText style={[styles.tabText, on && styles.tabTextOn]}>
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function ListStatus({
  loading,
  errorLabel,
  retryLabel,
  empty,
  onRetry,
  loadingMore,
  moreError,
  onRetryMore,
}: {
  loading: boolean;
  errorLabel: string | null;
  retryLabel?: string;
  empty: string | null;
  onRetry?: () => void;
  loadingMore?: boolean;
  moreError?: string | null;
  onRetryMore?: () => void;
}) {
  if (loading) {
    return <ActivityIndicator color={look.ink} />;
  }
  if (errorLabel) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={retryLabel ?? errorLabel}
        onPress={onRetry}
      >
        <AppText style={styles.empty}>{errorLabel}</AppText>
      </Pressable>
    );
  }
  if (empty) {
    return <AppText style={styles.empty}>{empty}</AppText>;
  }
  return (
    <>
      {loadingMore ? (
        <ActivityIndicator color={look.ink} style={styles.moreSpinner} />
      ) : null}
      {moreError ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={moreError}
          onPress={onRetryMore}
        >
          <AppText style={styles.empty}>{moreError}</AppText>
        </Pressable>
      ) : null}
    </>
  );
}

// My runs for the 기록 tab: H01 newest page, then the next chunk when the profile scrolls near the foot.
function useMyRecords(active: boolean) {
  const { records } = useRepositories();
  const [items, setItems] = useState<RunRecordSummary[]>([]);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>(
    'loading',
  );
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const busy = useRef(false);

  const loadFirst = useCallback(() => {
    busy.current = true;
    setStatus('loading');
    setMoreError(false);
    records
      .getRecent('recent', recordPageSize)
      .then(next => {
        setItems(next);
        setHasMore(next.length >= recordPageSize);
        setStatus('ready');
      })
      .catch(() => setStatus('error'))
      .finally(() => {
        busy.current = false;
      });
  }, [records]);

  useFocusEffect(
    useCallback(() => {
      if (active) {
        loadFirst();
      }
    }, [active, loadFirst]),
  );

  const loadMore = useCallback(() => {
    if (!active || busy.current || !hasMore || status !== 'ready') {
      return;
    }
    busy.current = true;
    setLoadingMore(true);
    setMoreError(false);
    const limit = items.length + recordPageSize;
    records
      .getRecent('recent', limit)
      .then(next => {
        setItems(next);
        setHasMore(next.length >= limit);
      })
      .catch(() => setMoreError(true))
      .finally(() => {
        busy.current = false;
        setLoadingMore(false);
      });
  }, [active, hasMore, items.length, records, status]);

  return {
    items,
    status,
    hasMore,
    loadingMore,
    moreError,
    loadMore,
    retry: loadFirst,
    retryMore: loadMore,
  };
}

const loadSaved = (repositories: Repositories) =>
  repositories.courses.getSaved();

// S15P31E105-732: 기록 · 스크랩 · 저장된 코스 share the same two-column tiles; swipe or tap to change.
function MyProfileLists({
  tileWidth,
  onNearEnd,
}: {
  tileWidth: number;
  onNearEnd: (loadMore: (() => void) | null) => void;
}) {
  const navigation = useNavigation();
  const openCourse = useOpenSavedCourse();
  const { records: recordsRepo, community } = useRepositories();
  const pager = useRef<PagerView>(null);
  const [page, setPage] = useState(0);
  const tab = myTabs[page]?.id ?? 'records';
  const [pageHeights, setPageHeights] = useState([0, 0, 0]);
  const records = useMyRecords(page === 0);
  const loadScraps = useCallback(
    (cursor: string | null) => community.listMyBookmarks(cursor),
    [community],
  );
  const scraps = usePostPages(loadScraps);
  const saved = useResource(useCallback(loadSaved, []));
  const { reload: reloadSaved } = saved;
  useFocusEffect(useCallback(() => reloadSaved(), [reloadSaved]));

  // react-native-pager-view 8 on Android can start with swiping off; turn it on once mounted.
  useEffect(() => {
    pager.current?.setScrollEnabled(true);
  }, []);

  const selectTab = useCallback((next: ProfileTab) => {
    const index = myTabs.findIndex(item => item.id === next);
    if (index < 0) {
      return;
    }
    pager.current?.setPage(index);
    setPage(index);
  }, []);

  const setPageHeight = useCallback((index: number, height: number) => {
    setPageHeights(current => {
      if (current[index] === height) {
        return current;
      }
      const next = [...current];
      next[index] = height;
      return next;
    });
  }, []);

  useEffect(() => {
    if (tab === 'records') {
      onNearEnd(
        records.moreError
          ? records.retryMore
          : records.hasMore
          ? records.loadMore
          : null,
      );
      return;
    }
    if (tab === 'scraps') {
      onNearEnd(
        scraps.moreError
          ? scraps.retry
          : scraps.hasMore
          ? scraps.loadMore
          : null,
      );
      return;
    }
    onNearEnd(null);
  }, [
    tab,
    records.hasMore,
    records.loadMore,
    records.moreError,
    records.retryMore,
    scraps.hasMore,
    scraps.loadMore,
    scraps.moreError,
    scraps.retry,
    onNearEnd,
  ]);

  const courses = saved.status === 'ready' ? saved.data : null;
  const pagerHeight = Math.max(pageHeights[page] || 120, 120);

  return (
    <>
      <ProfileTabs value={tab} onChange={selectTab} />
      <PagerView
        ref={pager}
        style={[styles.pager, { height: pagerHeight }]}
        initialPage={0}
        // The tab follows the page that covers most of the screen while dragging.
        onPageScroll={event => {
          const { position, offset } = event.nativeEvent;
          const shown = offset > 0.5 ? position + 1 : position;
          setPage(current =>
            current === shown || !myTabs[shown] ? current : shown,
          );
        }}
        onPageSelected={event => setPage(event.nativeEvent.position)}
      >
        <View key="records" style={styles.pagerPage} collapsable={false}>
          <View
            onLayout={event =>
              setPageHeight(0, event.nativeEvent.layout.height)
            }
          >
            {records.status === 'ready' && records.items.length > 0 ? (
              <View style={styles.tiles}>
                {records.items.map(record => (
                  <RunTile
                    key={record.id}
                    record={record}
                    width={tileWidth}
                    // S11 measured route (S15P31E105-756): H02 detail leaves route null, so read the parts.
                    loadRoute={() =>
                      recordsRepo.getRoute(record.id).then(parts => {
                        const run = runRouteOf(parts);
                        return run ? { route: run.route, basemap: null } : null;
                      })
                    }
                    noRouteLabel="경로 기록 없음"
                    ownThumbnail
                    onPress={() => openRecord(navigation, record.id)}
                  />
                ))}
              </View>
            ) : null}
            <ListStatus
              loading={records.status === 'loading'}
              errorLabel={
                records.status === 'error'
                  ? '기록을 불러오지 못했어요 · 다시 시도'
                  : null
              }
              retryLabel="기록 다시 불러오기"
              empty={
                records.status === 'ready' && records.items.length === 0
                  ? '아직 기록이 없어요'
                  : null
              }
              onRetry={records.retry}
              loadingMore={records.loadingMore}
              moreError={
                records.moreError ? '더 불러오지 못했어요 · 다시 시도' : null
              }
              onRetryMore={records.retryMore}
            />
          </View>
        </View>
        <View key="scraps" style={styles.pagerPage} collapsable={false}>
          <View
            onLayout={event =>
              setPageHeight(1, event.nativeEvent.layout.height)
            }
          >
            {scraps.status === 'ready' && scraps.posts.length > 0 ? (
              <View style={styles.tiles}>
                {scraps.posts.map((post: Post) => (
                  <RunTile
                    key={post.id}
                    record={post.record}
                    width={tileWidth}
                    loadRoute={() => community.getRoute(post.id)}
                    onPress={() =>
                      navigation.navigate('PostDetail', { postId: post.id })
                    }
                  />
                ))}
              </View>
            ) : null}
            <ListStatus
              loading={scraps.status === 'loading'}
              errorLabel={
                scraps.status === 'error'
                  ? '스크랩을 불러오지 못했어요 · 다시 시도'
                  : null
              }
              retryLabel="스크랩 다시 불러오기"
              empty={scraps.empty ? '아직 스크랩한 게시물이 없어요' : null}
              onRetry={scraps.retry}
              loadingMore={scraps.loadingMore}
              moreError={
                scraps.moreError ? '더 불러오지 못했어요 · 다시 시도' : null
              }
              onRetryMore={scraps.retry}
            />
          </View>
        </View>
        <View key="courses" style={styles.pagerPage} collapsable={false}>
          <View
            onLayout={event =>
              setPageHeight(2, event.nativeEvent.layout.height)
            }
          >
            {courses && courses.length > 0 ? (
              <View style={styles.tiles}>
                {courses.map(course => (
                  <CourseTile
                    key={course.id}
                    course={course}
                    width={tileWidth}
                    onPress={() => openCourse(course)}
                  />
                ))}
              </View>
            ) : null}
            <ListStatus
              loading={saved.status !== 'ready' && saved.status !== 'error'}
              errorLabel={
                saved.status === 'error'
                  ? '저장한 코스를 불러오지 못했어요 · 다시 시도'
                  : null
              }
              retryLabel="저장한 코스 다시 불러오기"
              empty={
                courses && courses.length === 0
                  ? '아직 저장한 코스가 없어요'
                  : null
              }
              onRetry={reloadSaved}
            />
          </View>
        </View>
      </PagerView>
    </>
  );
}

// Someone else's shared runs as the same two-column tiles, loaded with CMT02 author pages.
function SharedRunsList({
  userId,
  tileWidth,
  onNearEnd,
}: {
  userId: string;
  tileWidth: number;
  onNearEnd: (loadMore: (() => void) | null) => void;
}) {
  const navigation = useNavigation();
  const { community } = useRepositories();
  const load = useCallback(
    (cursor: string | null) => community.listAuthorPosts(userId, cursor),
    [community, userId],
  );
  const pages = usePostPages(load);
  useEffect(() => {
    onNearEnd(
      pages.moreError ? pages.retry : pages.hasMore ? pages.loadMore : null,
    );
  }, [pages.hasMore, pages.loadMore, pages.moreError, pages.retry, onNearEnd]);
  return (
    <>
      <AppText style={styles.section} accessibilityRole="header">
        공유한 러닝 결과
      </AppText>
      {pages.status === 'ready' && pages.posts.length > 0 ? (
        <View style={styles.tiles}>
          {pages.posts.map(post => (
            <RunTile
              key={post.id}
              record={post.record}
              width={tileWidth}
              loadRoute={() => community.getRoute(post.id)}
              onPress={() =>
                navigation.navigate('PostDetail', { postId: post.id })
              }
            />
          ))}
        </View>
      ) : null}
      <ListStatus
        loading={pages.status === 'loading'}
        errorLabel={
          pages.status === 'error'
            ? '공유한 러닝을 불러오지 못했어요 · 다시 시도'
            : null
        }
        empty={pages.empty ? '아직 기록이 없어요' : null}
        onRetry={pages.retry}
        loadingMore={pages.loadingMore}
        moreError={pages.moreError ? '더 불러오지 못했어요 · 다시 시도' : null}
        onRetryMore={pages.retry}
      />
    </>
  );
}

function Profile({
  profile,
  onFollow,
  onRequestsChanged,
  busy,
  inTab,
}: {
  profile: RunnerProfile;
  onFollow: () => void;
  // 7.4b after a follow request is answered: the follower and request counts change.
  onRequestsChanged: () => void;
  busy: boolean;
  // Shown as the 프로필 tab (S15P31E105-428): no 뒤로, and room for the tab bar at the foot.
  inTab: boolean;
}) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const locked = !profile.accessible;
  const heroHeight = Math.round(screenHeight * 0.48);
  const tileWidth = Math.floor((screenWidth - 32 - tileGap) / 2);
  // The page's scroll drives the picture's blur behind it.
  const scrollY = useRef(new Animated.Value(0)).current;
  const loadMoreRef = useRef<(() => void) | null>(null);
  const onNearEnd = useCallback((loadMore: (() => void) | null) => {
    loadMoreRef.current = loadMore;
  }, []);
  // The run tiles' small maps go to the tiles on screen (S15P31E105-756), told at most every 120 ms while the page
  // moves and once more after it stops.
  const viewport = useMemo(() => createCardViewport(), []);
  const viewportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tellViewport = useCallback(() => {
    if (viewportTimer.current) {
      return;
    }
    viewportTimer.current = setTimeout(() => {
      viewportTimer.current = null;
      viewport.changed();
    }, 120);
  }, [viewport]);
  useEffect(
    () => () => {
      if (viewportTimer.current) {
        clearTimeout(viewportTimer.current);
      }
    },
    [],
  );
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      tellViewport();
      const { layoutMeasurement, contentOffset, contentSize } =
        event.nativeEvent;
      if (
        layoutMeasurement.height + contentOffset.y >=
        contentSize.height - 320
      ) {
        loadMoreRef.current?.();
      }
    },
    [tellViewport],
  );
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const zoomable = zoomablePhoto(profile);
  // 팔로우 요청 N건, or N건+ when U24 has more pages.
  const requestText = profile.followRequests
    ? `${profile.followRequests.count}건${
        profile.followRequests.more ? '+' : ''
      }`
    : null;
  // A closed private profile hides its lists as it hides the counts (U26 · U27 answer 403).
  const openList = (kind: FollowListKind) =>
    locked
      ? undefined
      : () =>
          // Pushed, so a list opened from a profile reached through another list stacks on top.
          navigation.dispatch(
            StackActions.push('FollowList', {
              userId: profile.userId,
              kind,
              nickname: profile.nickname,
            }),
          );
  const followLabel =
    profile.followStatus === 'FOLLOWING'
      ? '팔로잉'
      : profile.followStatus === 'PENDING'
      ? '요청됨'
      : '팔로우';
  return (
    <CardViewportContext.Provider value={viewport}>
      <HeroBackdrop
        initial={profile.nickname.slice(0, 1)}
        photo={profile.profileImageUrl}
        heroHeight={heroHeight}
        scrollY={scrollY}
      />
      <Animated.ScrollView
        contentContainerStyle={{
          paddingBottom:
            insets.bottom +
            48 +
            (inTab ? size.tabBar + size.tabBarInset * 2 : 0),
        }}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true, listener: onScroll },
        )}
        onMomentumScrollEnd={tellViewport}
        onScrollEndDrag={tellViewport}
        scrollEventThrottle={16}
      >
        <View style={[styles.hero, { height: heroHeight }]}>
          {/* S15P31E105-797 (T13): pressing another runner's photo enlarges it; without a photo it stays plain. */}
          {zoomable ? (
            <Pressable
              accessibilityRole="imagebutton"
              accessibilityLabel="프로필 사진 크게 보기"
              onPress={() => setZoomed(true)}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <View style={[styles.topBar, { top: insets.top + 8 }]}>
            {inTab ? (
              <View />
            ) : (
              <BackButton tone="dark" onPress={() => navigation.goBack()} />
            )}
            {profile.isMe ? (
              <GlassIconButton
                icon="settings"
                tone="dark"
                accessibilityLabel="설정"
                onPress={() => navigateTo(navigation, 'Settings')}
              />
            ) : null}
          </View>
          <View style={styles.name}>
            <AppText style={styles.handle} numberOfLines={1}>
              {profile.handle}
            </AppText>
            {profile.level ? (
              <AppText style={styles.level}>
                {levelLabels[profile.level]}
              </AppText>
            ) : null}
          </View>
        </View>
        <View style={styles.body}>
          {profile.isMe ? (
            <MainButton
              label="프로필 수정"
              icon="pencil"
              onPress={() => navigateTo(navigation, 'ProfileEdit')}
            />
          ) : (
            <MainButton
              label={followLabel}
              icon={profile.followStatus === 'NONE' ? 'plus' : 'check'}
              busy={busy}
              onPress={onFollow}
            />
          )}
          <View style={styles.counts}>
            <Count
              value={countText(profile.followerCount)}
              label="팔로워"
              onPress={openList('followers')}
            />
            <Count
              value={countText(profile.followingCount)}
              label="팔로잉"
              onPress={openList('following')}
            />
            <Count
              value={locked ? '–' : String(profile.monthly.runCount)}
              unit={locked ? undefined : '회'}
              label="이번 달 러닝"
            />
          </View>
          {profile.isMe ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                requestText ? `팔로우 요청 ${requestText}` : '팔로우 요청'
              }
              onPress={() => setRequestsOpen(true)}
              style={({ pressed }) => [
                styles.card,
                pressed && styles.cardPressed,
              ]}
            >
              <AppText style={styles.cardTitle}>팔로우 요청</AppText>
              <View style={styles.flex} />
              {requestText ? (
                <AppText style={styles.cardValue}>{requestText}</AppText>
              ) : null}
              <Icon
                name="forward"
                color={look.inkMuted}
                size={14}
                strokeWidth={2.2}
              />
            </Pressable>
          ) : null}
          {locked ? (
            <View style={styles.locked}>
              <Icon name="lock" color={look.inkSub} size={22} />
              <AppText style={styles.lockedText}>
                비공개 계정이에요. 팔로우 요청이 승인되면 러닝 기록이 보여요.
              </AppText>
            </View>
          ) : (
            <>
              <View style={styles.card}>
                <AppText style={styles.cardTitle}>
                  {profile.isMe ? '이번 달 러닝' : '이번 달 공유한 러닝'}
                </AppText>
                <View style={styles.flex} />
                <AppText style={styles.cardValue}>
                  {`${formatKm(profile.monthly.totalDistanceM, 1)}km · 평균 ${
                    profile.monthly.averagePaceSecPerKm
                      ? formatPace(profile.monthly.averagePaceSecPerKm)
                      : '– –'
                  }`}
                </AppText>
              </View>
              {profile.isMe ? (
                <MyProfileLists tileWidth={tileWidth} onNearEnd={onNearEnd} />
              ) : (
                <SharedRunsList
                  userId={profile.userId}
                  tileWidth={tileWidth}
                  onNearEnd={onNearEnd}
                />
              )}
            </>
          )}
        </View>
      </Animated.ScrollView>
      {profile.isMe ? (
        <FollowRequestSheet
          visible={requestsOpen}
          onClose={() => setRequestsOpen(false)}
          onDecided={onRequestsChanged}
        />
      ) : null}
      <PhotoZoom
        photo={zoomed ? zoomable : null}
        onClose={() => setZoomed(false)}
      />
    </CardViewportContext.Provider>
  );
}

// 7.4 러너 프로필 (userId) and 7.4b 내 프로필 (userId null) on the dark screen.
function ProfileView({
  userId,
  inTab = false,
}: {
  userId: string | null;
  inTab?: boolean;
}) {
  const toast = useToast();
  const { runners } = useRepositories();
  const resource = useResource(
    useCallback(
      (repositories: Repositories) => repositories.runners.getProfile(userId),
      [userId],
    ),
  );
  const { reload } = resource;
  useFocusEffect(useCallback(() => reload(), [reload]));
  const [profile, setProfile] = useState<RunnerProfile | null>(null);
  const loaded = resource.status === 'ready' ? resource.data : null;
  useEffect(() => {
    if (loaded) {
      setProfile(loaded);
    }
  }, [loaded]);
  const [busy, setBusy] = useState(false);
  const follow = async (current: RunnerProfile) => {
    setBusy(true);
    try {
      setProfile(
        await runners.setFollowing(
          current.userId,
          current.followStatus === 'NONE',
        ),
      );
    } catch (error) {
      toast(
        error instanceof DataError && error.code === 'USER_NOT_FOUND'
          ? '탈퇴했거나 찾을 수 없는 러너예요'
          : '처리하지 못했어요. 잠시 후 다시 시도해 주세요',
      );
      // The follow may have gone through before the failure, so show what the server holds.
      reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <ThemeProvider tone="light">
      <View style={styles.root}>
        {/* Light icons over the picture; dark ones on the plain mist while it loads. */}
        <StatusBar barStyle={profile ? 'light-content' : 'dark-content'} />
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Backdrop />
        </View>
        {resource.status === 'error' && !profile ? (
          <EmptyState
            icon="alert"
            title="프로필을 불러오지 못했어요"
            actionLabel="다시 시도"
            onAction={reload}
          />
        ) : !profile ? (
          <ActivityIndicator style={styles.loading} color={look.ink} />
        ) : (
          <Profile
            profile={profile}
            busy={busy}
            onFollow={() => follow(profile)}
            onRequestsChanged={reload}
            inTab={inTab}
          />
        )}
      </View>
    </ThemeProvider>
  );
}

export function RunnerProfileScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'RunnerProfile'>>();
  return <ProfileView userId={route.params?.userId ?? 'user-seoyeon'} />;
}

export function MyProfileScreen() {
  return <ProfileView userId={null} />;
}

// 7.4b as the fifth tab (runway-tabbar 프로필): the same screen under the tab bar.
export function MyProfileTabScreen() {
  return <ProfileView userId={null} inTab />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: 120 },
  busy: { opacity: 0.45 },
  // A rounded-down measure must not leave a light line at the right or the foot.
  fillBleed: { right: -1, bottom: -1 },
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  // The background picture and its blurred copy behind the top of the screen.
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  blurCopy: { position: 'absolute', top: 0, left: -60 },
  // Scrolling the page up over the picture covers it with the mist, so the navy text stays readable.
  darken: { backgroundColor: look.mist[0] },
  // Past every edge, so the blur does not thin out and let the sharp photo show at the sides.
  photoBlur: {
    position: 'absolute',
    top: -60,
    right: -60,
    bottom: -60,
    left: -60,
  },
  letter: { position: 'absolute', left: 0 },
  hero: { justifyContent: 'flex-end' },
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  name: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  // White over the picture's foot; a soft shadow keeps it readable once the page scrolls onto the mist.
  handle: {
    fontFamily: fontFamily.bold,
    fontSize: 32,
    lineHeight: 40,
    letterSpacing: -0.5,
    color: look.white,
    textShadowColor: 'rgba(2,5,14,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  level: {
    marginTop: 2,
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.85)',
    textShadowColor: 'rgba(2,5,14,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  body: { paddingHorizontal: 16, paddingTop: 16 },
  // The wide navy button, 54 high.
  main: {
    height: 54,
    borderRadius: 27,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: look.ink,
  },
  mainText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    color: look.white,
  },
  // 팔로워 · 팔로잉 · 이번 달 러닝, each centred in a third.
  counts: { flexDirection: 'row', marginTop: 20 },
  count: { flex: 1, alignItems: 'center' },
  countPressed: { opacity: 0.6 },
  countValue: {
    fontFamily: fontFamily.numberMedium,
    fontSize: 26,
    lineHeight: 32,
    color: look.ink,
  },
  countUnit: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: look.inkSub,
  },
  countLabel: {
    marginTop: 2,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: look.inkSub,
  },
  // The glass card, as the reference's bio box.
  card: {
    marginTop: 16,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: look.lightGlassEdge,
    backgroundColor: look.lightGlass,
  },
  cardPressed: { backgroundColor: 'rgba(255,255,255,0.8)' },
  cardTitle: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: look.ink,
  },
  cardValue: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 19,
    color: look.inkSub,
  },
  locked: { alignItems: 'center', gap: 10, paddingVertical: 32 },
  lockedText: {
    textAlign: 'center',
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 22,
    color: look.inkSub,
  },
  section: {
    marginTop: 28,
    marginBottom: 12,
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    color: look.ink,
  },
  // S15P31E105-732: 기록 · 스크랩 · 저장된 코스 across the profile width.
  tabs: {
    marginTop: 28,
    marginBottom: 12,
    flexDirection: 'row',
    gap: 8,
  },
  tab: {
    flex: 1,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.45)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: look.lightGlassEdge,
  },
  tabOn: {
    backgroundColor: look.ink,
    borderColor: look.ink,
  },
  tabText: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: look.inkSub,
  },
  tabTextOn: {
    fontFamily: fontFamily.bold,
    color: look.white,
  },
  pager: { width: '100%' },
  pagerPage: { flex: 1 },
  moreSpinner: { marginTop: 16 },
  empty: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: look.inkSub,
  },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: tileGap },
  tile: { borderRadius: 16, overflow: 'hidden', justifyContent: 'flex-end' },
  tilePressed: { opacity: 0.8 },
  tileText: { paddingHorizontal: 12, paddingBottom: 12, gap: 2 },
  badge: {
    alignSelf: 'flex-start',
    height: 20,
    paddingHorizontal: 7,
    marginBottom: 4,
    borderRadius: 6,
    justifyContent: 'center',
    backgroundColor: look.white,
  },
  badgeText: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    lineHeight: 14,
    color: communityLook.ink,
  },
  tileTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: look.white,
  },
  tileDetail: {
    fontFamily: fontFamily.regular,
    fontSize: 11.5,
    lineHeight: 15,
    color: 'rgba(255,255,255,0.7)',
  },
  tilePace: {
    marginTop: 2,
    fontFamily: fontFamily.numberRegular,
    fontSize: 20,
    lineHeight: 24,
    color: look.white,
  },
  tilePaceMissed: { color: communityLook.like },
});
