import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, EmptyState, Icon, useToast } from '../../components';
import { errorCode } from '../../data/errors';
import {
  countComments,
  useRepositories,
  useResource,
  type PostComment,
  type PostDetail,
  type Repositories,
} from '../../data';
import {
  formatClockTime,
  formatDuration,
  formatKm,
  formatRecordPace,
} from '../../format';
import { postChanged, postsChanged } from '../../data/postsChanged';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import { fontFamily, ThemeProvider } from '../../theme';
import { CommentSheet } from './comments';
import {
  feedLook,
  MapBackdrop,
  RouteLine,
  Shade,
  useMapCover,
} from './FeedPage';
import { communityLook } from './look';
import { PostRouteOverview, RouteReplay } from './RouteReplay';
import type { LngLat } from '../../geo';
import {
  Avatar,
  placeLine,
  PostMenu,
  postedAt,
  recordLabel,
  stamp,
  usePostChanges,
} from './parts';

const loadPost = (repositories: Repositories, postId: string) =>
  repositories.community.get(postId);

const look = {
  ink: '#02050E',
  sub: '#6B7280',
  card: '#F2F3F6',
  line: 'rgba(2,5,14,0.08)',
  // 진한 네이비 (담당자 요청: 민트 대신).
  accent: '#02050E',
};

// How much of the map shows above the sheet before it is pulled up.
const mapShare = 0.56;

function Stat({
  value,
  unit,
  label,
}: {
  value: string;
  unit?: string;
  label: string;
}) {
  return (
    <View style={styles.stat}>
      <AppText
        style={styles.statValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
        {unit ? <AppText style={styles.statUnit}>{` ${unit}`}</AppText> : null}
      </AppText>
      <AppText style={styles.statLabel}>{label}</AppText>
    </View>
  );
}

// 06:30 – 07:00 on the run's day.
function timeRange(post: PostDetail) {
  const start = post.record.startedAt;
  const end = new Date(
    Date.parse(start) + post.record.durationSec * 1000,
  ).toISOString();
  return `${formatClockTime(start)} – ${formatClockTime(end)} · ${stamp(
    start,
  ).slice(0, 10)}`;
}

// 616: another runner's shared course, saved as mine (C07). A free run shares a private course, so it opens only
// while the post stays shared; COURSE_NOT_FOUND then means it is gone or no longer visible to me.
function SaveSharedCourse({ courseId }: { courseId: string }) {
  const { courses } = useRepositories();
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>(
    'idle',
  );
  const [message, setMessage] = useState('');
  const save = async () => {
    if (state === 'saving' || state === 'saved') {
      return;
    }
    setState('saving');
    try {
      await courses.save(courseId);
      setState('saved');
      setMessage('내 코스에 저장했어요.');
    } catch (error) {
      setState('failed');
      setMessage(
        errorCode(error) === 'COURSE_NOT_FOUND'
          ? '공유가 끝났거나 볼 수 없는 코스예요.'
          : '코스를 저장하지 못했어요. 다시 시도해 주세요.',
      );
    }
  };
  const done = state === 'saving' || state === 'saved';
  return (
    <View style={styles.saveCourse}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="내 코스에 저장"
        accessibilityState={{ disabled: done }}
        disabled={done}
        onPress={() => {
          void save();
        }}
        style={({ pressed }) => [
          styles.saveCourseButton,
          pressed && styles.pressed,
        ]}
      >
        <AppText style={styles.saveCourseLabel}>
          {state === 'saving'
            ? '저장 중'
            : state === 'saved'
            ? '내 코스에 저장됨'
            : '내 코스에 저장'}
        </AppText>
      </Pressable>
      {message ? (
        <AppText style={styles.saveCourseMessage}>{message}</AppText>
      ) : null}
    </View>
  );
}

// 7.2 게시물 상세 (S15P31E105-561, 담당자 레퍼런스): the run's map fills the screen behind a white sheet that pulls up
// over it: the numbers first, then the run's title and time, the post's words, 좋아요, the 댓글 card and 달성.
// A comment bar stays at the foot; comments open in the same sheet as 7.1's. The post carries no splits, pace
// curve, elevation, calories or steps, so those parts of the reference are left out rather than made up.
export function PostDetailScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const route = useRoute<RouteProp<RootStackParamList, 'PostDetail'>>();
  // Opened without a post, the page has nothing to show and offers the way back.
  const postId = route.params?.postId ?? '';
  const toast = useToast();
  const { community, clock } = useRepositories();
  const detail = useResource(
    useCallback(
      (repositories: Repositories) =>
        postId
          ? loadPost(repositories, postId)
          : Promise.reject(new Error('게시물 없음')),
      [postId],
    ),
  );
  const { reload } = detail;
  // Coming back from 7.3e shows the edited post.
  useFocusEffect(useCallback(() => reload(), [reload]));
  const [post, setPost] = useState<PostDetail | null>(null);
  const loaded = detail.status === 'ready' ? detail.data : null;
  useEffect(() => {
    if (loaded) {
      setPost(loaded);
    }
  }, [loaded]);
  // The feed under 7.2 shows the same like and bookmark (rolled back with it) without reading again.
  const { like, bookmark } = usePostChanges(next => {
    setPost(current => (current ? { ...current, ...next } : current));
    postChanged(next.id, {
      liked: next.liked,
      likeCount: next.likeCount,
      bookmarked: next.bookmarked,
    });
  });
  // The course's points as 7.1 already read them (getRoute keeps them), so the map is drawn as the page opens
  // rather than after the post, its comments and its course are read again (사용자 요청).
  const [routeAhead, setRouteAhead] = useState<LngLat[] | null>(null);
  const [unmeasuredEdges, setUnmeasuredEdges] = useState<number[]>([]);
  useEffect(() => {
    if (!postId) {
      return;
    }
    let live = true;
    // A post the repository cannot find may throw at once rather than reject; either way the page waits for the post.
    Promise.resolve()
      .then(() => community.getRoute(postId))
      .then(map => {
        if (live && map && map.route.length >= 2) {
          setRouteAhead(map.route);
          setUnmeasuredEdges(map.unmeasuredEdges ?? []);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [community, postId]);
  // Once the post is read it decides: its own points while shared, none when it is not.
  const mapRoute = post
    ? post.courseShared
      ? post.record.route ?? routeAhead
      : null
    : routeAhead;
  const hasMap = !!mapRoute && mapRoute.length >= 2;
  const { uncover, coverView } = useMapCover(hasMap, 'post-map-cover');
  const [menu, setMenu] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [mapAtTop, setMapAtTop] = useState(true);
  // Opening the comment Modal can briefly change the reported window height on Android.
  // Keep the map and its play button at their existing position until the sheet closes.
  const stableHeight = useRef(height);
  if (!commentsOpen) {
    stableHeight.current = height;
  }
  const [replay, setReplay] = useState(false);
  // Opened from a shared link (S15P31E105-704): the course replay starts once, as soon as the post is read and
  // its course is shared.
  const replayAsked = useRef(route.params?.replay === true);
  useEffect(() => {
    if (replayAsked.current && post) {
      replayAsked.current = false;
      if (post.courseShared) {
        setReplay(true);
      }
    }
  }, [post]);
  // The comment bar's real height: the phone's bottom bar adds to it, so the sheet's foot keeps that much room
  // (S15P31E105-619). Until it is laid out, the bar's height over the bottom inset stands in.
  const [barHeight, setBarHeight] = useState(0);
  const footRoom = (barHeight || barBase + insets.bottom) + 24;

  const openAuthor = (current: PostDetail) =>
    current.isMine
      ? navigateTo(navigation, 'MyProfile')
      : navigation.navigate('RunnerProfile', {
          userId: current.author.userId,
        });
  const share = (current: PostDetail) => {
    // A run with no distance has no pace, so the text leaves it out rather than say 0′00″ (S15P31E105-837).
    const sharedPace = formatRecordPace(current.record.averagePaceSecPerKm);
    return Share.share({
      message: `${current.author.handle}님의 러닝 · ${recordLabel(
        current.record,
        current.courseShared,
      )}${sharedPace === null ? '' : ` · 평균 페이스 ${sharedPace}/km`}`,
    }).catch(() => undefined);
  };

  const mapHeight = Math.round(stableHeight.current * mapShare);
  const commentCount = post
    ? post.commentCount ?? countComments(post.comments)
    : 0;
  // 거리 없는 기록은 페이스가 없어 0′00″ 대신 – –로 둔다(S15P31E105-837).
  const pace = post ? formatRecordPace(post.record.averagePaceSecPerKm) : null;
  // The newest comment still there; a deleted root kept for its replies is not one.
  const latest =
    post?.comments.reduce<PostComment | null>(
      (newest, comment) =>
        comment.deleted || !comment.author
          ? newest
          : !newest || comment.createdAt >= newest.createdAt
          ? comment
          : newest,
      null,
    ) ?? null;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      {hasMap && mapRoute ? (
        // The shared course on the real map (담당자 요청), drawn still as the replay draws it (S15P31E105-754).
        <>
          <PostRouteOverview
            post={post}
            route={mapRoute}
            unmeasuredEdges={unmeasuredEdges}
            height={mapHeight + 32}
            // The replay covers this map, so its pin comes off while it plays and is back on close: the
            // native map stops redrawing it under the replay (화면 동일).
            markers={!replay}
            onShown={uncover}
          />
          {/* The replay's bright map: the feed's top fade keeps the white header readable over it. */}
          <Shade width={width} height={mapHeight} foot={false} />
          {coverView}
        </>
      ) : post ? (
        // No real points (the server list, or a post without its course): the run's shape on the drawn map.
        <>
          <MapBackdrop
            seed={post.id}
            width={width}
            height={stableHeight.current}
          />
          {post.courseShared ? (
            <RouteLine
              shape={post.record.shape}
              width={width}
              height={mapHeight + 60}
            />
          ) : null}
        </>
      ) : null}

      {detail.status === 'error' && !post ? (
        <ThemeProvider tone="dark">
          <View style={[styles.flex, { paddingTop: insets.top + 64 }]}>
            {postId ? (
              <EmptyState
                icon="alert"
                title="게시물을 불러오지 못했어요"
                actionLabel="다시 시도"
                onAction={reload}
              />
            ) : (
              <EmptyState
                icon="alert"
                title="게시물을 찾을 수 없어요"
                actionLabel="돌아가기"
                onAction={() => navigation.goBack()}
              />
            )}
          </View>
        </ThemeProvider>
      ) : !post ? (
        <ActivityIndicator
          style={{ marginTop: insets.top + 96 }}
          color={feedLook.white}
        />
      ) : (
        <>
          <ScrollView
            style={styles.flex}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={32}
            nestedScrollEnabled
            onScroll={event => {
              const offset = event.nativeEvent.contentOffset.y;
              setMapAtTop(offset < 8);
            }}
          >
            {/* The map above the sheet plays the course back when the run shares it (담당자 레퍼런스). */}
            <Pressable
              accessibilityRole={post.courseShared ? 'button' : undefined}
              accessibilityLabel={post.courseShared ? '코스 재생' : undefined}
              disabled={!post.courseShared}
              onPress={() => setReplay(true)}
              style={{ height: mapHeight }}
            />
            <ScrollView
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              style={[
                styles.sheet,
                {
                  minHeight: stableHeight.current - mapHeight,
                  maxHeight: stableHeight.current - insets.top - 80,
                },
              ]}
              contentContainerStyle={{ paddingBottom: footRoom }}
            >
              <View style={styles.handle} />
              {/* 2열 그리드로 고정해 홀수로 남는 마지막 항목도 가운데 정렬한다(S15P31E105-789). */}
              <View style={styles.stats}>
                <View style={styles.statsRow}>
                  <Stat
                    value={formatKm(post.record.distanceM)}
                    unit="km"
                    label="거리"
                  />
                  <Stat
                    value={pace ?? '– –'}
                    unit={pace === null ? undefined : '/km'}
                    label="평균 페이스"
                  />
                </View>
                <View style={styles.statsRow}>
                  <Stat
                    value={formatDuration(post.record.durationSec)}
                    label="시간"
                  />
                  <Stat
                    value={
                      post.record.averageHeartRate
                        ? String(post.record.averageHeartRate)
                        : '–'
                    }
                    unit={post.record.averageHeartRate ? 'bpm' : undefined}
                    label="평균 심박"
                  />
                </View>
                <View style={styles.statsRow}>
                  <Stat
                    value={
                      post.record.cadence ? String(post.record.cadence) : '–'
                    }
                    unit={post.record.cadence ? 'spm' : undefined}
                    label="케이던스"
                  />
                </View>
              </View>

              <View style={styles.kind}>
                <Icon name="runner" color={look.accent} size={16} />
                <AppText style={styles.kindText}>
                  {post.record.courseRun ? '코스 러닝' : '러닝'}
                </AppText>
              </View>
              <AppText style={styles.title}>
                {recordLabel(post.record, post.courseShared)}
              </AppText>
              <AppText style={styles.when}>
                {[timeRange(post), placeLine(post.record)]
                  .filter(Boolean)
                  .join(' · ')}
              </AppText>
              {post.body ? (
                <AppText style={styles.body}>{post.body}</AppText>
              ) : null}

              {post.courseShared && post.courseId && !post.isMine ? (
                <SaveSharedCourse courseId={post.courseId} />
              ) : null}

              <View style={styles.likeRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={post.liked ? '좋아요 취소' : '좋아요'}
                  accessibilityState={{ selected: post.liked }}
                  onPress={() => like(post)}
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.likeButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Icon
                    name="heart"
                    color={post.liked ? communityLook.like : look.ink}
                    solid={post.liked}
                    size={20}
                  />
                  <AppText style={styles.likeText}>
                    {post.likeCount === null
                      ? '좋아요'
                      : `좋아요 ${post.likeCount}`}
                  </AppText>
                </Pressable>
                <View style={styles.flex} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="공유"
                  onPress={() => share(post)}
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.iconButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Icon name="send" color={look.ink} size={20} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={post.bookmarked ? '저장 취소' : '저장'}
                  accessibilityState={{ selected: post.bookmarked }}
                  onPress={() => bookmark(post)}
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.iconButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Icon
                    name="bookmark"
                    color={look.ink}
                    solid={post.bookmarked}
                    size={20}
                  />
                </Pressable>
              </View>

              {/* 레퍼런스의 Comments 카드: the newest comment, and the sheet with all of them. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`댓글 ${commentCount}개 열기`}
                onPress={() => setCommentsOpen(true)}
                style={({ pressed }) => [
                  styles.commentCard,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.commentHead}>
                  <AppText style={styles.commentTitle}>
                    {`댓글 ${commentCount}`}
                  </AppText>
                  <Icon name="forward" color={look.sub} size={16} />
                </View>
                <AppText style={styles.commentPreview} numberOfLines={2}>
                  {latest?.author
                    ? `${latest.author.handle}  ${latest.body}`
                    : '아직 댓글이 없어요\n첫 댓글을 남겨 보세요'}
                </AppText>
              </Pressable>

              {post.record.goalAchieved ? (
                <>
                  <AppText style={styles.section}>달성</AppText>
                  <View style={styles.award}>
                    <View style={styles.medal}>
                      <Icon name="crown" color="#FFFFFF" size={18} />
                    </View>
                    <AppText style={styles.awardName}>목표 완주</AppText>
                    <AppText style={styles.awardValue}>
                      {`${formatKm(post.record.distanceM, 1)} km`}
                    </AppText>
                  </View>
                </>
              ) : null}
            </ScrollView>
          </ScrollView>
          {post.courseShared && mapAtTop ? (
            <View
              pointerEvents="none"
              style={[styles.play, { top: mapHeight - 74 }]}
            >
              <Icon name="play" color="#FFFFFF" size={22} solid />
            </View>
          ) : null}

          {/* 레퍼런스 상단: 뒤로, the author and the date, and the menu, over the map. */}
          <View style={[styles.header, { top: insets.top + 6 }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="뒤로"
              onPress={() => navigation.goBack()}
              style={({ pressed }) => [styles.round, pressed && styles.pressed]}
            >
              <Icon name="back" color={feedLook.white} size={20} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${post.author.handle} 프로필`}
              onPress={() => openAuthor(post)}
              style={({ pressed }) => [
                styles.author,
                pressed && styles.pressed,
              ]}
            >
              <Avatar
                nickname={post.author.nickname}
                userId={post.author.userId}
                photo={post.author.profileImageUrl}
                mine={post.isMine}
                size={34}
              />
              <View style={styles.flex}>
                <AppText style={styles.authorName} numberOfLines={1}>
                  {post.author.handle}
                </AppText>
                <AppText style={styles.authorMeta} numberOfLines={1}>
                  {postedAt(post.createdAt, clock.now())}
                </AppText>
              </View>
            </Pressable>
            {post.isMine ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="게시물 메뉴"
                onPress={() => setMenu(true)}
                style={({ pressed }) => [
                  styles.round,
                  pressed && styles.pressed,
                ]}
              >
                <Icon name="moreVertical" color={feedLook.white} size={20} />
              </Pressable>
            ) : null}
          </View>

          {/* 레퍼런스 하단: 좋아요 and a comment field that opens the comments. */}
          <View
            style={[styles.bottomBar, { paddingBottom: insets.bottom + 10 }]}
            onLayout={event =>
              setBarHeight(Math.ceil(event.nativeEvent.layout.height))
            }
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={post.liked ? '좋아요 취소' : '좋아요'}
              accessibilityState={{ selected: post.liked }}
              onPress={() => like(post)}
              hitSlop={6}
              style={({ pressed }) => [
                styles.barLike,
                pressed && styles.pressed,
              ]}
            >
              <Icon
                name="heart"
                color={post.liked ? communityLook.like : look.ink}
                solid={post.liked}
                size={24}
              />
              {post.likeCount === null ? null : (
                <AppText style={styles.barCount}>{post.likeCount}</AppText>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="댓글 쓰기"
              onPress={() => setCommentsOpen(true)}
              style={({ pressed }) => [
                styles.barField,
                pressed && styles.pressed,
              ]}
            >
              <AppText style={styles.barPlaceholder} numberOfLines={1}>
                {`${post.author.handle}님에게 댓글 달기…`}
              </AppText>
            </Pressable>
          </View>
        </>
      )}

      {post?.courseShared ? (
        <RouteReplay
          post={post}
          unmeasuredEdges={unmeasuredEdges}
          visible={replay}
          onClose={() => setReplay(false)}
        />
      ) : null}
      <CommentSheet
        post={commentsOpen ? post : null}
        onClose={() => {
          setCommentsOpen(false);
          // The card shows the newest comment after the sheet changed them.
          reload();
        }}
        onCountChange={(id, count) => {
          setPost(current =>
            current && current.commentCount !== null
              ? { ...current, commentCount: count }
              : current,
          );
          postChanged(id, { commentCount: count });
        }}
      />
      <PostMenu
        visible={menu}
        onClose={() => setMenu(false)}
        onEdit={() => navigation.navigate('PostEdit', { postId })}
        onDelete={async () => {
          try {
            await community.remove(postId);
            postsChanged();
            setMenu(false);
            toast('게시물을 삭제했어요');
            navigation.goBack();
          } catch {
            toast('게시물을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요');
          }
        }}
      />
    </View>
  );
}

// The comment bar without the bottom inset: 10 + the 46 field + 10, and its 1 top line.
const barBase = 67;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: feedLook.ground },
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  header: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  author: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  authorName: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: feedLook.white,
  },
  authorMeta: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: feedLook.sub,
  },
  // 레퍼런스의 재생 버튼: a round deep navy button at the map's bottom right (담당자 요청).
  play: {
    position: 'absolute',
    zIndex: 10,
    elevation: 10,
    right: 18,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 3,
    backgroundColor: look.accent,
  },
  // 레퍼런스의 흰 시트: rounded top, pulled up over the map.
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: look.line,
    marginBottom: 14,
  },
  stats: { gap: 16 },
  statsRow: { flexDirection: 'row', justifyContent: 'center', columnGap: 40 },
  // 320dp에서도 두 칸이 한 줄에 들어가도록 줄어들 수 있게 하고 값은 한 줄로 유지한다(S15P31E105-819).
  stat: { alignItems: 'center', minWidth: 90, flexShrink: 1 },
  statValue: {
    fontFamily: fontFamily.bold,
    letterSpacing: -0.6,
    fontSize: 28,
    lineHeight: 32,
    color: look.ink,
    textAlign: 'center',
  },
  statUnit: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    color: look.ink,
  },
  statLabel: {
    marginTop: 2,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: look.sub,
    textAlign: 'center',
  },
  // 알약 테두리 (담당자 요청): hugs the label, left-aligned.
  kind: {
    marginTop: 26,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 10,
    paddingRight: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: look.accent,
  },
  kindText: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 18,
    color: look.accent,
  },
  title: {
    marginTop: 6,
    fontFamily: fontFamily.bold,
    fontSize: 24,
    lineHeight: 31,
    color: look.ink,
  },
  when: {
    marginTop: 6,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: look.sub,
  },
  body: {
    marginTop: 14,
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 22,
    color: look.ink,
  },
  saveCourse: { marginTop: 14, gap: 6 },
  saveCourseButton: {
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: look.card,
  },
  saveCourseLabel: {
    color: look.ink,
    fontFamily: fontFamily.bold,
    fontSize: 15,
  },
  saveCourseMessage: {
    color: look.sub,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    textAlign: 'center',
  },
  likeRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  likeButton: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  likeText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 20,
    color: look.ink,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentCard: {
    marginTop: 14,
    padding: 18,
    borderRadius: 22,
    backgroundColor: look.card,
  },
  commentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  commentTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 22,
    color: look.ink,
  },
  commentPreview: {
    marginTop: 6,
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
    color: look.sub,
  },
  section: {
    marginTop: 26,
    marginBottom: 8,
    fontFamily: fontFamily.bold,
    fontSize: 20,
    lineHeight: 26,
    color: look.ink,
  },
  award: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  medal: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: look.accent,
  },
  awardName: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: look.ink,
  },
  awardValue: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: look.sub,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: look.line,
  },
  barLike: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barCount: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: look.ink,
  },
  barField: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    paddingHorizontal: 18,
    backgroundColor: look.card,
  },
  barPlaceholder: {
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 20,
    color: look.sub,
  },
});
