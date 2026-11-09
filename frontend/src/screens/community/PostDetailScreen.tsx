import React, { useCallback, useEffect, useState } from 'react';
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
import {
  useRepositories,
  useResource,
  type PostDetail,
  type Repositories,
} from '../../data';
import {
  formatClockTime,
  formatDuration,
  formatKm,
  formatPace,
} from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import { fontFamily, ThemeProvider } from '../../theme';
import { CommentSheet } from './comments';
import { feedLook, MapBackdrop, RouteLine } from './FeedPage';
import { communityLook } from './look';
import { RouteReplay } from './RouteReplay';
import { RunMap } from '../../components/RunMap';
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
      <AppText style={styles.statValue}>
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

// 7.2 게시물 상세 (S15P31E105-561, 담당자 레퍼런스): the run's map fills the screen behind a white sheet that pulls up
// over it: the numbers first, then the run's title and time, the post's words, 좋아요, the 댓글 card and 달성.
// A comment bar stays at the foot; comments open in the same sheet as 7.1's. The post carries no splits, pace
// curve, elevation, calories or steps, so those parts of the reference are left out rather than made up.
export function PostDetailScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const route = useRoute<RouteProp<RootStackParamList, 'PostDetail'>>();
  const postId = route.params?.postId ?? 'post-seoyun-1019';
  const toast = useToast();
  const { community, clock } = useRepositories();
  const detail = useResource(
    useCallback(
      (repositories: Repositories) => loadPost(repositories, postId),
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
  const { like, bookmark } = usePostChanges(next =>
    setPost(current => (current ? { ...current, ...next } : current)),
  );
  const [menu, setMenu] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [replay, setReplay] = useState(false);

  const openAuthor = (current: PostDetail) =>
    current.isMine
      ? navigateTo(navigation, 'MyProfile')
      : navigation.navigate('RunnerProfile', {
          userId: current.author.userId,
        });
  const share = (current: PostDetail) =>
    Share.share({
      message: `${current.author.handle}님의 러닝 · ${recordLabel(
        current.record,
        current.courseShared,
      )} · 평균 페이스 ${formatPace(current.record.averagePaceSecPerKm)}/km`,
    }).catch(() => undefined);

  const mapHeight = Math.round(height * mapShare);
  const commentCount = post ? post.commentCount ?? post.comments.length : 0;
  const latest = post?.comments[post.comments.length - 1] ?? null;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      {post && post.courseShared && post.record.route ? (
        // The shared course on the real map (담당자 요청), fitted between the header and the sheet.
        <RunMap
          route={post.record.route}
          interactive={false}
          area={{ top: 0.14, bottom: mapShare - 0.04 }}
          style={StyleSheet.absoluteFill}
        />
      ) : post ? (
        // No real points (the server list, or a post without its course): the run's shape on the drawn map.
        <>
          <MapBackdrop seed={post.id} width={width} height={height} />
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
            <EmptyState
              icon="alert"
              title="게시물을 불러오지 못했어요"
              actionLabel="다시 시도"
              onAction={reload}
            />
          </View>
        </ThemeProvider>
      ) : !post ? (
        <ActivityIndicator
          style={{ marginTop: insets.top + 96 }}
          color={feedLook.white}
        />
      ) : (
        <>
          <ScrollView style={styles.flex} showsVerticalScrollIndicator={false}>
            {/* The map above the sheet plays the course back when the run shares it (담당자 레퍼런스). */}
            <Pressable
              accessibilityRole={post.courseShared ? 'button' : undefined}
              accessibilityLabel={post.courseShared ? '코스 재생' : undefined}
              disabled={!post.courseShared}
              onPress={() => setReplay(true)}
              style={{ height: mapHeight }}
            >
              {post.courseShared ? (
                <View style={styles.play}>
                  <Icon name="play" color="#FFFFFF" size={22} solid />
                </View>
              ) : null}
            </Pressable>
            <View style={[styles.sheet, { minHeight: height - mapHeight }]}>
              <View style={styles.handle} />
              <View style={styles.stats}>
                <Stat
                  value={formatKm(post.record.distanceM)}
                  unit="km"
                  label="거리"
                />
                <Stat
                  value={formatPace(post.record.averagePaceSecPerKm)}
                  unit="/km"
                  label="평균 페이스"
                />
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
                <Stat
                  value={
                    post.record.cadence ? String(post.record.cadence) : '–'
                  }
                  unit={post.record.cadence ? 'spm' : undefined}
                  label="케이던스"
                />
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
                  {latest
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
            </View>
          </ScrollView>

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
        onCountChange={(_, count) =>
          setPost(current =>
            current && current.commentCount !== null
              ? { ...current, commentCount: count }
              : current,
          )
        }
      />
      <PostMenu
        visible={menu}
        onClose={() => setMenu(false)}
        onEdit={() => navigation.navigate('PostEdit', { postId })}
        onDelete={async () => {
          try {
            await community.remove(postId);
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
    right: 18,
    bottom: 18,
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
    // Room for the comment bar at the foot.
    paddingBottom: 96,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: look.line,
    marginBottom: 14,
  },
  stats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 },
  stat: { width: '33.3%' },
  statValue: {
    fontFamily: fontFamily.bold,
    letterSpacing: -0.6,
    fontSize: 28,
    lineHeight: 32,
    color: look.ink,
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
