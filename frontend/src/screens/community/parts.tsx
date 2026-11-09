import React, { useId, useState } from 'react';
import {
  Pressable,
  Share,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { AppText, Icon, Logo, MistFill } from '../../components';
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
import { fontFamily, k1, spacing, ThemeProvider } from '../../theme';
import { CourseGlyph, drawableShape } from '../course/SavedCoursesScreen';
import { CommunitySheet, communityLook, SheetButton } from './look';

// Svg gradient ids are global on Android, so every gradient gets its own.
const useSvgId = (prefix: string) =>
  `${prefix}${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

// A number from a string id, so a person or a post keeps the same colours on every screen.
const pick = (id: string, count: number) =>
  [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % count;

// The run photos' gradient for a post or record id, so a run keeps one look everywhere (7.1 · 7.2 · 7.4 tiles).
export const mediaFor = (seed: string) =>
  communityLook.media[pick(seed, communityLook.media.length)];

// The handoff's avatar fills, top to bottom; mine is the deep teal one (7.2 댓글 입력 · 7.3).
const avatarFills = [
  ['#8DACBA', '#5D8194'],
  ['#A4BDC9', '#5D8194'],
  ['#7DA0B2', '#3A5A6C'],
  ['#3A5A6C', '#182E3D'],
];
const mineFill = ['#3A5A6C', '#182E3D', '#091019'];
// 7.4's big avatar of someone else: pale mist with dark letters.
const heroFill = ['#C4D4DC', '#8DACBA', '#5D8194'];

// The first letter of the nickname on a mist circle, with no ring: the service has no stories (담당자 결정).
// `hero` is the big 7.4 · 7.4b one.
export function Avatar({
  nickname,
  userId,
  mine = false,
  size = 40,
  hero = false,
}: {
  nickname: string;
  userId: string;
  mine?: boolean;
  size?: number;
  hero?: boolean;
}) {
  const fillId = useSvgId('avatar');
  const light = hero && !mine;
  const fill = mine
    ? mineFill
    : light
    ? heroFill
    : avatarFills[pick(userId, avatarFills.length)];
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
        hero && styles.avatarHero,
      ]}
    >
      <MistFill id={fillId} colors={fill} style={styles.fillBleed} />
      <AppText
        style={[
          styles.avatarText,
          light && styles.avatarTextDark,
          {
            fontSize: Math.round(size * 0.38),
            lineHeight: Math.round(size * 0.5),
          },
        ]}
      >
        {nickname.slice(0, 1)}
      </AppText>
    </View>
  );
}

// 2026.10.19 07:12
export function stamp(iso: string) {
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
    const likeCount =
      post.likeCount === null ? null : post.likeCount + (liked ? 1 : -1);
    onChange({ ...post, liked, likeCount });
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

// 민락수변공원 under the author's name, without the run type (담당자 요청). A server post has no place yet, so
// the line is left out.
export const placeLine = (record: PostRecord) => record.place || null;

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

// 시간 · 거리 · 평균 심박 · 케이던스 on the photo.
function RecordStats({ record }: { record: PostRecord }) {
  return (
    <View style={styles.stats}>
      <Stat value={formatDuration(record.durationSec)} label="시간" />
      <Stat value={formatKm(record.distanceM)} unit="km" label="거리" />
      <Stat
        value={record.averageHeartRate ? String(record.averageHeartRate) : '–'}
        unit={record.averageHeartRate ? 'bpm' : undefined}
        label="평균 심박"
      />
      <Stat
        value={record.cadence ? String(record.cadence) : '–'}
        unit={record.cadence ? 'spm' : undefined}
        label="케이던스"
      />
    </View>
  );
}

// --media-scrim: the photo darkens toward its foot. Alpha goes through stopOpacity, which Android keeps.
export function Scrim() {
  const id = useSvgId('scrim');
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  const measure = (event: LayoutChangeEvent) =>
    setBox(event.nativeEvent.layout);
  return (
    <View style={styles.scrim} onLayout={measure} pointerEvents="none">
      {box ? (
        <Svg width={box.width} height={box.height}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#060606" stopOpacity={0} />
              <Stop offset="1" stopColor="#060606" stopOpacity={0.55} />
            </LinearGradient>
          </Defs>
          <Rect width={box.width} height={box.height} fill={`url(#${id})`} />
        </Svg>
      ) : null}
    </View>
  );
}

// A shared run as a full-width 4:5 picture (7.1 · 7.2 · 7.3 · 7.3e, 담당자 요청: 카드 대신 사진처럼): one of
// the handoff's three gradients picked by `seed`, the course outline in white, and the run's words in white
// over the darkened foot (담당자 결정: 지금 정보 유지).
export function RunPhoto({
  record,
  courseShared,
  seed,
}: {
  record: PostRecord;
  courseShared: boolean;
  // The post's id, or the record's before it is posted, so a run keeps its gradient on every screen.
  seed: string;
}) {
  const id = useSvgId('media');
  const tone = pick(seed, communityLook.media.length);
  const media = communityLook.media[tone];
  return (
    <ThemeProvider tone="dark">
      <View style={styles.media}>
        {/* 1 wider than the photo, so a rounded-down measure leaves no white line at the right edge. */}
        <MistFill
          id={id}
          colors={[...media.colors]}
          offsets={[...media.offsets]}
          style={styles.mediaFill}
        />
        {/* A post summary carries no route; an unknown one shows neither the outline nor its note (S15P31E105-567). */}
        {courseShared && drawableShape(record.shape).length > 0 ? (
          <>
            {/* --media-free starts near white, so its note is in teal there. */}
            <AppText
              style={[styles.mediaNote, tone === 0 && styles.mediaNoteOnLight]}
            >
              예시 경로
            </AppText>
            <View style={styles.mediaGlyph}>
              {/* --media-free is light where the outline sits, so it is drawn in ink there. */}
              <CourseGlyph
                shape={record.shape}
                km={record.distanceM / 1000}
                tone={tone === 0 ? 'ink' : 'white'}
              />
            </View>
          </>
        ) : null}
        <Scrim />
        <View style={styles.mediaText}>
          <AppText style={styles.mediaLabel} numberOfLines={1}>
            {recordLabel(record, courseShared)}
          </AppText>
          <AppText style={styles.mediaHeadline}>
            {`평균 ${formatPace(record.averagePaceSecPerKm)}/km`}
          </AppText>
          <RecordStats record={record} />
          <View style={styles.recordBottom}>
            <AppText style={styles.mediaStamp}>
              {stamp(record.startedAt)}
            </AppText>
            <View style={styles.mark}>
              <Logo width={64} />
            </View>
          </View>
        </View>
      </View>
    </ThemeProvider>
  );
}

// ♥ 38 · 💬 15 · 공유, with the bookmark at the right end: bare navy icons, no pills (7.1 · 7.2).
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
  const share = () =>
    Share.share({
      message: `${post.author.handle}님의 러닝 · ${recordLabel(
        post.record,
        post.courseShared,
      )} · 평균 페이스 ${formatPace(post.record.averagePaceSecPerKm)}/km`,
    }).catch(() => undefined);
  const ink = communityLook.ink;
  return (
    <View style={styles.actions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={post.liked ? '좋아요 취소' : '좋아요'}
        accessibilityState={{ selected: post.liked }}
        onPress={onLike}
        hitSlop={6}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Icon
          name="heart"
          color={post.liked ? communityLook.like : ink}
          solid={post.liked}
          size={24}
        />
        {post.likeCount === null ? null : (
          <AppText style={styles.count}>{post.likeCount}</AppText>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="댓글"
        onPress={onComment}
        hitSlop={6}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Icon name="community" color={ink} size={24} />
        {post.commentCount === null ? null : (
          <AppText style={styles.count}>{post.commentCount}</AppText>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="공유"
        onPress={share}
        hitSlop={6}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Icon name="send" color={ink} size={24} />
      </Pressable>
      <View style={styles.flex} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={post.bookmarked ? '저장 취소' : '저장'}
        accessibilityState={{ selected: post.bookmarked }}
        onPress={onBookmark}
        hitSlop={6}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Icon name="bookmark" color={ink} solid={post.bookmarked} size={24} />
      </Pressable>
    </View>
  );
}

const menuCopy = {
  post: {
    edit: '게시물 수정',
    confirm: '게시물을 삭제할까요?',
    note: '삭제한 게시물과 댓글은 되돌릴 수 없어요.',
  },
  comment: {
    edit: '댓글 수정',
    confirm: '댓글을 삭제할까요?',
    note: '삭제한 댓글은 되돌릴 수 없어요.',
  },
};

// 7.2b 게시물 메뉴 (수정 · 삭제) and 7.2c 삭제 확인 on my own posts. The sheet is the light one.
// 7.2 opens the same sheet on my own comments (S15P31E105-389).
export function PostMenu({
  visible,
  onClose,
  onEdit,
  onDelete,
  subject = 'post',
}: {
  visible: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  subject?: 'post' | 'comment';
}) {
  const copy = menuCopy[subject];
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
    <CommunitySheet
      visible={visible}
      onClose={close}
      title={confirming ? copy.confirm : undefined}
      description={confirming ? copy.note : undefined}
    >
      {confirming ? (
        <View style={styles.sheetButtons}>
          <SheetButton title="취소" onPress={close} />
          <SheetButton title="삭제" danger disabled={busy} onPress={remove} />
        </View>
      ) : (
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.edit}
            onPress={() => {
              close();
              onEdit();
            }}
            style={({ pressed }) => [
              styles.menuRow,
              styles.menuRowDivider,
              pressed && styles.pressed,
            ]}
          >
            <Icon name="pencil" color={communityLook.ink} size={20} />
            <AppText style={styles.menuText}>{copy.edit}</AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="삭제"
            onPress={() => setConfirming(true)}
            style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
          >
            <Icon name="trash" color={k1.coral} size={20} />
            <AppText style={[styles.menuText, styles.menuDanger]}>삭제</AppText>
          </Pressable>
          <View style={styles.sheetButtons}>
            <SheetButton title="닫기" onPress={close} />
          </View>
        </View>
      )}
    </CommunitySheet>
  );
}

const whiteMuted = 'rgba(255,255,255,0.55)';
const photoWhite = '#F9F9F9';
const photoSub = 'rgba(249,249,249,0.85)';
const photoMuted = 'rgba(249,249,249,0.7)';

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarHero: { boxShadow: '0 8px 20px rgba(2,5,14,0.16)' },
  avatarText: { fontFamily: fontFamily.bold, color: communityLook.onDark },
  avatarTextDark: { color: '#091019' },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 10,
  },
  stat: { alignItems: 'center' },
  statValue: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 17,
    lineHeight: 22,
    color: photoWhite,
  },
  statUnit: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 12,
    color: whiteMuted,
  },
  statLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 18,
    color: whiteMuted,
  },
  recordBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  // The wordmark is drawn in the text color; on the card it is white 80%.
  mark: { opacity: 0.8 },
  // 7.1 photo: the full width at 4:5.
  media: {
    width: '100%',
    aspectRatio: 4 / 5,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  mediaFill: { right: -1 },
  // A rounded-down measure must not leave the circle a flat edge.
  fillBleed: { right: -1, bottom: -1 },
  mediaNoteOnLight: { color: '#3A5A6C' },
  mediaNote: {
    position: 'absolute',
    top: 16,
    right: 18,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: photoMuted,
  },
  mediaGlyph: {
    position: 'absolute',
    top: '14%',
    left: '25%',
    width: '50%',
    aspectRatio: 1,
  },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  mediaText: {
    paddingHorizontal: 22,
    paddingBottom: 22,
    gap: 6,
  },
  mediaLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: -0.2,
    color: photoSub,
  },
  mediaHeadline: {
    fontFamily: fontFamily.bold,
    fontSize: 25,
    lineHeight: 33,
    letterSpacing: -0.6,
    color: photoWhite,
  },
  mediaStamp: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: photoMuted,
  },
  // The action line: 44 high, navy outline icons 12 apart.
  actions: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 2,
  },
  count: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: communityLook.ink,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    height: 56,
    paddingHorizontal: 4,
  },
  menuRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2EAEE',
  },
  menuText: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    lineHeight: 21,
    color: communityLook.ink,
  },
  menuDanger: { color: k1.coralText },
  sheetButtons: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
});
