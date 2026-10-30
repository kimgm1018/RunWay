import React, { useState } from 'react';
import {
  Pressable,
  Share,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { AppText, BottomSheet, Icon, Logo } from '../../components';
import { useRepositories, type Post, type PostRecord } from '../../data';
import {
  formatClockTime,
  formatDuration,
  formatKm,
  formatMonthDay,
  formatPace,
  formatRelative,
  isSameDay,
} from '../../format';
import {
  fontFamily,
  k1,
  radius,
  spacing,
  ThemeProvider,
  useTheme,
} from '../../theme';
import { CourseGlyph } from '../course/SavedCoursesScreen';
import { FooterButton } from '../group/GroupRunDetailScreen';

const avatarTones = ['#7F95AE', k1.mid, '#A5B6C8', '#5E7690'];

// The first letter of the nickname on a steel circle; mine is the dark navy one (7.2b).
export function Avatar({
  nickname,
  userId,
  mine = false,
  size = 40,
}: {
  nickname: string;
  userId: string;
  mine?: boolean;
  size?: number;
}) {
  const tone =
    avatarTones[
      [...userId].reduce((sum, char) => sum + char.charCodeAt(0), 0) %
        avatarTones.length
    ];
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: mine ? k1.deep : tone,
        },
      ]}
    >
      <AppText
        variant="bodyStrong"
        style={{ color: k1.ice, fontSize: size * 0.38 }}
      >
        {nickname.slice(0, 1)}
      </AppText>
    </View>
  );
}

// 2026.10.19 07:12
function stamp(iso: string) {
  const day = new Date(Date.parse(iso) + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '.');
  return `${day} ${formatClockTime(iso)}`;
}

// 3분 전 on the day it was posted, 10월 19일 after.
export const postedAt = (iso: string, now: Date) =>
  isSameDay(iso, now) ? formatRelative(iso, now) : formatMonthDay(iso);

// Likes and bookmarks show at once and roll back if the server refuses.
export function usePostChanges(onChange: (post: Post) => void) {
  const { community } = useRepositories();
  const like = async (post: Post) => {
    const liked = !post.liked;
    onChange({ ...post, liked, likeCount: post.likeCount + (liked ? 1 : -1) });
    try {
      await community.setLiked(post.id, liked);
    } catch {
      onChange(post);
    }
  };
  const bookmark = async (post: Post) => {
    onChange({ ...post, bookmarked: !post.bookmarked });
    try {
      await community.setBookmarked(post.id, !post.bookmarked);
    } catch {
      onChange(post);
    }
  };
  return { like, bookmark };
}

// 민락수변공원 출발 5.0km · 완주. Without the course shared, only the distance shows (COM-003).
export function recordLabel(record: PostRecord, courseShared: boolean) {
  const finished = record.goalAchieved ? ' · 완주' : '';
  return courseShared
    ? `${record.title} ${formatKm(record.distanceM, 1)}km${finished}`
    : `${formatKm(record.distanceM, 1)}km 러닝${finished}`;
}

// 민락수변공원 · 코스 러닝
export const placeLine = (record: PostRecord) =>
  `${record.place} · ${record.courseRun ? '코스 러닝' : '자유 러닝'}`;

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
      <AppText variant="label" tone="textSecondary">
        {label}
      </AppText>
    </View>
  );
}

// The shared run as a black card brightening to steel at the lower right (7.1–7.3): the course
// outline, the average pace and the run's numbers, signed with the RUNWAY wordmark.
export function RecordCard({
  record,
  courseShared,
}: {
  record: PostRecord;
  courseShared: boolean;
}) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  const measure = (event: LayoutChangeEvent) =>
    setBox(event.nativeEvent.layout);
  return (
    <ThemeProvider tone="dark">
      <View style={styles.record}>
        <View style={StyleSheet.absoluteFill} onLayout={measure}>
          {box ? (
            <Svg width={box.width} height={box.height}>
              <Defs>
                <LinearGradient id="record" x1="0.15" y1="0" x2="0.95" y2="1">
                  <Stop offset="0" stopColor={k1.black} />
                  <Stop offset="0.45" stopColor={k1.night} />
                  <Stop offset="0.78" stopColor={k1.deep} />
                  <Stop offset="1" stopColor={k1.mid} />
                </LinearGradient>
              </Defs>
              <Rect width={box.width} height={box.height} fill="url(#record)" />
            </Svg>
          ) : null}
        </View>
        <View style={styles.recordTop}>
          <View style={styles.dot} />
          <AppText
            variant="captionStrong"
            style={styles.flex}
            numberOfLines={1}
          >
            {recordLabel(record, courseShared)}
          </AppText>
          {courseShared ? (
            <AppText variant="label" tone="textSecondary">
              예시 경로
            </AppText>
          ) : null}
        </View>
        {courseShared ? (
          <View style={styles.glyph}>
            <CourseGlyph shape={record.shape} />
          </View>
        ) : null}
        <View style={styles.paceBlock}>
          <AppText variant="caption" tone="textSecondary">
            평균 페이스
          </AppText>
          <AppText style={styles.pace}>
            {formatPace(record.averagePaceSecPerKm)}
            <AppText style={styles.paceUnit}> /km</AppText>
          </AppText>
        </View>
        <View style={styles.stats}>
          <Stat value={formatDuration(record.durationSec)} label="시간" />
          <Stat value={formatKm(record.distanceM)} unit="km" label="거리" />
          <Stat
            value={
              record.averageHeartRate ? String(record.averageHeartRate) : '–'
            }
            unit={record.averageHeartRate ? 'bpm' : undefined}
            label="평균 심박"
          />
          <Stat
            value={record.cadence ? String(record.cadence) : '–'}
            unit={record.cadence ? 'spm' : undefined}
            label="케이던스"
          />
        </View>
        <View style={styles.recordBottom}>
          <AppText variant="label" tone="textSecondary">
            {stamp(record.startedAt)}
          </AppText>
          <View style={styles.mark}>
            <Logo width={84} />
          </View>
        </View>
      </View>
    </ThemeProvider>
  );
}

// ♥ 38 · 💬 15 · 공유, with the bookmark at the right end (7.1·7.2).
export function PostActions({
  post,
  onLike,
  onComment,
  onBookmark,
}: {
  post: Post;
  onLike: () => void;
  onComment: () => void;
  onBookmark: () => void;
}) {
  const { colors } = useTheme();
  const share = () =>
    Share.share({
      message: `${post.author.handle}님의 러닝 · ${recordLabel(
        post.record,
        post.courseShared,
      )} · 평균 페이스 ${formatPace(post.record.averagePaceSecPerKm)}/km`,
    }).catch(() => undefined);
  return (
    <View style={styles.actions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={post.liked ? '좋아요 취소' : '좋아요'}
        accessibilityState={{ selected: post.liked }}
        onPress={onLike}
        hitSlop={8}
        style={styles.action}
      >
        <Icon
          name="heart"
          color={post.liked ? k1.coral : colors.text}
          solid={post.liked}
          size={22}
        />
        <AppText style={styles.count}>{post.likeCount}</AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="댓글"
        onPress={onComment}
        hitSlop={8}
        style={styles.action}
      >
        <Icon name="community" color={colors.text} size={22} />
        <AppText style={styles.count}>{post.commentCount}</AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="공유"
        onPress={share}
        hitSlop={8}
      >
        <Icon name="send" color={colors.text} size={22} />
      </Pressable>
      <View style={styles.flex} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={post.bookmarked ? '저장 취소' : '저장'}
        accessibilityState={{ selected: post.bookmarked }}
        onPress={onBookmark}
        hitSlop={8}
      >
        <Icon
          name="bookmark"
          color={colors.text}
          solid={post.bookmarked}
          size={22}
        />
      </Pressable>
    </View>
  );
}

// 7.2b 게시물 메뉴 (수정 · 삭제) and 7.2c 삭제 확인 on my own posts. The sheet is the light one.
export function PostMenu({
  visible,
  onClose,
  onEdit,
  onDelete,
}: {
  visible: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  const { colors } = useTheme();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setConfirming(false);
    onClose();
  };
  const remove = async () => {
    setBusy(true);
    try {
      await onDelete();
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title={confirming ? '게시물을 삭제할까요?' : undefined}
      description={
        confirming ? '삭제한 게시물과 댓글은 되돌릴 수 없어요.' : undefined
      }
    >
      {confirming ? (
        <View style={styles.sheetButtons}>
          <FooterButton title="취소" onPress={close} />
          <FooterButton title="삭제" danger disabled={busy} onPress={remove} />
        </View>
      ) : (
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="게시물 수정"
            onPress={() => {
              close();
              onEdit();
            }}
            style={[styles.menuRow, { borderColor: colors.border }]}
          >
            <Icon name="pencil" color={colors.text} size={20} />
            <AppText variant="body">게시물 수정</AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="삭제"
            onPress={() => setConfirming(true)}
            style={styles.menuRow}
          >
            <Icon name="trash" color={k1.coral} size={20} />
            <AppText variant="body" style={{ color: k1.coralText }}>
              삭제
            </AppText>
          </Pressable>
          <View style={styles.sheetButtons}>
            <FooterButton title="닫기" onPress={close} />
          </View>
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  record: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  recordTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: k1.ice },
  glyph: { alignSelf: 'center', width: 130, height: 110 },
  paceBlock: { alignItems: 'center', marginTop: spacing.xs },
  pace: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 48,
    lineHeight: 54,
    color: k1.ice,
  },
  paceUnit: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 13,
    color: 'rgba(232,238,244,0.6)',
  },
  stats: { flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center', gap: 2 },
  statValue: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 20,
    lineHeight: 24,
    color: k1.ice,
  },
  statUnit: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 11,
    color: 'rgba(232,238,244,0.6)',
  },
  recordBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // The wordmark is drawn in the text color; on the card it is a faint ice.
  mark: { opacity: 0.55 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.md,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  count: { fontFamily: fontFamily.numberRegular, fontSize: 15 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  sheetButtons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
});
