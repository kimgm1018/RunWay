import React, { useMemo } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Polyline,
  Rect,
  Stop,
} from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import { AppText, Icon } from '../../components';
import { useRepositories, type Post } from '../../data';
import { formatDuration, formatKm, formatPace } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily } from '../../theme';
import { communityLook } from './look';
import {
  Avatar,
  placeLine,
  postedAt,
  recordLabel,
  stamp,
  usePostChanges,
} from './parts';

// 7.1 피드 한 장 (S15P31E105-561, 담당자 시안): one post fills the screen and the feed pages up and down. The run
// lies on a dark map with its route in neon; the author sits at the top, the actions down the right and the run's
// words at the bottom left. Every piece of the old feed stays (담당자 요청: 지금 정보 유지).
export const feedLook = {
  ground: '#14171C',
  street: '#20242B',
  road: '#2B3039',
  park: '#1B2621',
  water: '#18212D',
  // 코스 선 (담당자 지정): #4DFFD2, RGB 77·255·210.
  route: '#4DFFD2',
  white: '#FFFFFF',
  sub: 'rgba(255,255,255,0.68)',
  faint: 'rgba(255,255,255,0.5)',
};

// A number sequence from the post id, so a post keeps the same map on every visit.
function seeded(seed: string) {
  let value = [...seed].reduce(
    (sum, char) => (sum * 31 + char.charCodeAt(0)) % 2147483647,
    7,
  );
  return () => {
    value = (value * 16807) % 2147483647;
    return value / 2147483647;
  };
}

// A dark street map drawn from the seed: a turned grid of streets, a few wide roads, a park and a river. The posts
// carry no map position, only the route's shape, so the map is a backdrop rather than the real place.
// `scale` thins every line for the small 7.5 탐색 cards.
export function MapBackdrop({
  seed,
  width,
  height,
  scale = 1,
}: {
  seed: string;
  width: number;
  height: number;
  scale?: number;
}) {
  const shapes = useMemo(() => {
    const next = seeded(seed);
    const angle = Math.round(next() * 60 - 30);
    const span = Math.max(width, height) * 1.6;
    const step = (22 + Math.round(next() * 8)) * scale;
    const streets: number[] = [];
    for (let at = -span / 2; at <= span / 2; at += step) {
      streets.push(at);
    }
    // Lanes that stop part way, so the blocks are not one even grid.
    const lanes = Array.from({ length: 40 }, () => {
      const x = next() * width;
      const y = next() * height;
      const turn = next() * Math.PI;
      const reach = (40 + next() * 120) * scale;
      return {
        x1: x,
        y1: y,
        x2: x + Math.cos(turn) * reach,
        y2: y + Math.sin(turn) * reach,
      };
    });
    const roads = Array.from({ length: 5 }, () => ({
      x1: next() * width,
      y1: -20,
      x2: next() * width,
      y2: height + 20,
    })).concat(
      Array.from({ length: 2 }, () => ({
        x1: -20,
        y1: next() * height,
        x2: width + 20,
        y2: next() * height,
      })),
    );
    const parks = Array.from({ length: 2 }, () => ({
      x: next() * width * 0.8,
      y: next() * height * 0.8,
      w: (60 + next() * 90) * scale,
      h: (50 + next() * 80) * scale,
    }));
    const riverY = height * (0.25 + next() * 0.5);
    const bend = (next() - 0.5) * height * 0.4;
    const river = `M -40 ${riverY} C ${width * 0.3} ${riverY + bend} ${
      width * 0.7
    } ${riverY - bend} ${width + 40} ${riverY + bend / 2}`;
    return { angle, span, streets, lanes, roads, parks, river };
  }, [seed, width, height, scale]);
  const cx = width / 2;
  const cy = height / 2;
  return (
    <Svg
      width={width}
      height={height}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      <Rect width={width} height={height} fill={feedLook.ground} />
      {shapes.parks.map((park, index) => (
        <Rect
          key={`park${index}`}
          x={park.x}
          y={park.y}
          width={park.w}
          height={park.h}
          rx={8}
          fill={feedLook.park}
        />
      ))}
      <Path
        d={shapes.river}
        stroke={feedLook.water}
        strokeWidth={46 * scale}
        fill="none"
        strokeLinecap="round"
      />
      <G rotation={shapes.angle} origin={`${cx}, ${cy}`}>
        {shapes.streets.map(at => (
          <React.Fragment key={at}>
            <Line
              x1={cx + at}
              y1={cy - shapes.span / 2}
              x2={cx + at}
              y2={cy + shapes.span / 2}
              stroke={feedLook.street}
              strokeWidth={2.5 * scale}
            />
            <Line
              x1={cx - shapes.span / 2}
              y1={cy + at}
              x2={cx + shapes.span / 2}
              y2={cy + at}
              stroke={feedLook.street}
              strokeWidth={2.5 * scale}
            />
          </React.Fragment>
        ))}
      </G>
      {shapes.lanes.map((lane, index) => (
        <Line
          key={`lane${index}`}
          {...lane}
          stroke={feedLook.street}
          strokeWidth={2.5 * scale}
          strokeLinecap="round"
        />
      ))}
      {shapes.roads.map((road, index) => (
        <Line
          key={`road${index}`}
          {...road}
          stroke={feedLook.road}
          strokeWidth={9 * scale}
          strokeLinecap="round"
        />
      ))}
    </Svg>
  );
}

// The route from the record's 0–1 shape, fitted into the middle of the page with a soft glow and a start dot.
export function RouteLine({
  shape,
  width,
  height,
  scale = 1,
}: {
  shape: [number, number][];
  width: number;
  height: number;
  scale?: number;
}) {
  if (shape.length < 2) {
    return null;
  }
  const box = Math.min(width * 0.78, height * 0.42);
  const left = (width - box) / 2;
  const top = height * 0.2;
  const points = shape.map(([x, y]) => [left + x * box, top + y * box]);
  const line = points.map(([x, y]) => `${x},${y}`).join(' ');
  const [startX, startY] = points[0];
  return (
    <Svg
      width={width}
      height={height}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      <Polyline
        points={line}
        fill="none"
        stroke={feedLook.route}
        strokeOpacity={0.22}
        strokeWidth={14 * scale}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Polyline
        points={line}
        fill="none"
        stroke={feedLook.route}
        strokeWidth={5 * scale}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle
        cx={startX}
        cy={startY}
        r={7 * scale}
        fill={feedLook.ground}
        stroke={feedLook.white}
        strokeWidth={3 * scale}
      />
    </Svg>
  );
}

// Dark bands under the top and the foot, so the white words stay readable over any part of the map.
function Shade({ width, height }: { width: number; height: number }) {
  return (
    <Svg
      width={width}
      height={height}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      <Defs>
        <LinearGradient id="feedTop" x1="0" y1="0" x2="0" y2="1">
          <Stop offset={0} stopColor="#000000" stopOpacity={0.55} />
          <Stop offset={1} stopColor="#000000" stopOpacity={0} />
        </LinearGradient>
        <LinearGradient id="feedFoot" x1="0" y1="0" x2="0" y2="1">
          <Stop offset={0} stopColor="#000000" stopOpacity={0} />
          <Stop offset={1} stopColor="#000000" stopOpacity={0.7} />
        </LinearGradient>
      </Defs>
      <Rect width={width} height={180} fill="url(#feedTop)" />
      <Rect
        y={height * 0.5}
        width={width}
        height={height * 0.5}
        fill="url(#feedFoot)"
      />
    </Svg>
  );
}

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
    <View>
      <AppText style={styles.statValue}>
        {value}
        {unit ? <AppText style={styles.statUnit}>{` ${unit}`}</AppText> : null}
      </AppText>
      <AppText style={styles.statLabel}>{label}</AppText>
    </View>
  );
}

// One white icon with its count under it, as the right column of the 시안.
function SideAction({
  icon,
  label,
  count,
  selected,
  color = feedLook.white,
  solid = false,
  onPress,
}: {
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  count?: number | null;
  selected?: boolean;
  color?: string;
  solid?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.side, pressed && styles.pressed]}
    >
      <Icon name={icon} color={color} solid={solid} size={28} />
      {count === null || count === undefined ? null : (
        <AppText style={styles.sideCount}>{count}</AppText>
      )}
    </Pressable>
  );
}

export function FeedPage({
  post,
  width,
  height,
  top,
  bottom,
  onChange,
  onMenu,
  onComments,
}: {
  post: Post;
  width: number;
  height: number;
  // Room for the header over the page and the tab bar under it.
  top: number;
  bottom: number;
  onChange: (post: Post) => void;
  onMenu: () => void;
  // 댓글 and 댓글 N개 모두 보기 open the 댓글 sheet over the feed (담당자 요청).
  onComments: () => void;
}) {
  const navigation = useNavigation();
  const { clock } = useRepositories();
  const { like, bookmark } = usePostChanges(onChange);
  const record = post.record;
  const openAuthor = () =>
    post.isMine
      ? navigateTo(navigation, 'MyProfile')
      : navigation.navigate('RunnerProfile', { userId: post.author.userId });
  const share = () =>
    Share.share({
      message: `${post.author.handle}님의 러닝 · ${recordLabel(
        record,
        post.courseShared,
      )} · 평균 페이스 ${formatPace(record.averagePaceSecPerKm)}/km`,
    }).catch(() => undefined);
  const place = placeLine(record);
  const extra = [
    stamp(record.startedAt),
    record.averageHeartRate ? `평균 심박 ${record.averageHeartRate} bpm` : null,
    record.cadence ? `케이던스 ${record.cadence} spm` : null,
  ].filter(Boolean);
  return (
    <View style={[styles.page, { width, height }]}>
      <MapBackdrop seed={post.id} width={width} height={height} />
      {post.courseShared ? (
        <RouteLine shape={record.shape} width={width} height={height} />
      ) : null}
      <Shade width={width} height={height} />
      {/* The page itself opens 7.2 (담당자 요청); the buttons over it keep their own actions. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${post.author.handle}의 게시물 열기`}
        onPress={() => navigation.navigate('PostDetail', { postId: post.id })}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.authorRow, { top }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${post.author.handle} 프로필`}
          onPress={openAuthor}
          style={({ pressed }) => [styles.author, pressed && styles.pressed]}
        >
          <Avatar
            nickname={post.author.nickname}
            userId={post.author.userId}
            mine={post.isMine}
            size={40}
          />
          <View style={styles.flex}>
            <AppText style={styles.handle} numberOfLines={1}>
              {post.author.handle}
            </AppText>
            <AppText style={styles.meta} numberOfLines={1}>
              {[postedAt(post.createdAt, clock.now()), place]
                .filter(Boolean)
                .join(' · ')}
            </AppText>
          </View>
        </Pressable>
        {post.isMine ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="게시물 메뉴"
            onPress={onMenu}
            hitSlop={8}
            style={({ pressed }) => [styles.menu, pressed && styles.pressed]}
          >
            <Icon name="menu" color={feedLook.white} size={22} />
          </Pressable>
        ) : null}
      </View>
      {post.courseShared ? (
        // The mock routes are examples, so the page says so (기존 화면과 같음).
        <AppText style={[styles.example, { top: top + 56 }]}>예시 경로</AppText>
      ) : null}
      <View style={[styles.sideColumn, { bottom: bottom + 8 }]}>
        <SideAction
          icon="heart"
          label={post.liked ? '좋아요 취소' : '좋아요'}
          selected={post.liked}
          color={post.liked ? communityLook.like : feedLook.white}
          solid={post.liked}
          count={post.likeCount}
          onPress={() => like(post)}
        />
        <SideAction
          icon="community"
          label="댓글"
          count={post.commentCount}
          onPress={onComments}
        />
        <SideAction icon="send" label="공유" onPress={share} />
        <SideAction
          icon="bookmark"
          label={post.bookmarked ? '저장 취소' : '저장'}
          selected={post.bookmarked}
          solid={post.bookmarked}
          onPress={() => bookmark(post)}
        />
      </View>
      <View style={[styles.words, { bottom: bottom + 8 }]}>
        <View style={styles.stats}>
          <Stat value={formatKm(record.distanceM)} unit="km" label="거리" />
          <Stat value={formatDuration(record.durationSec)} label="시간" />
          <Stat
            value={formatPace(record.averagePaceSecPerKm)}
            unit="/km"
            label="평균 페이스"
          />
        </View>
        <AppText style={styles.extra} numberOfLines={2}>
          {extra.join(' · ')}
        </AppText>
        <View style={styles.titleRow}>
          <Icon name="runner" color={feedLook.route} size={18} />
          <AppText style={styles.title} numberOfLines={1}>
            {recordLabel(record, post.courseShared)}
          </AppText>
        </View>
        {post.body ? (
          <AppText style={styles.body} numberOfLines={2}>
            {post.body}
          </AppText>
        ) : null}
        {post.commentCount ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`댓글 ${post.commentCount}개 모두 보기`}
            onPress={onComments}
            style={({ pressed }) => [
              styles.comments,
              pressed && styles.pressed,
            ]}
          >
            <AppText style={styles.meta}>
              {`댓글 ${post.commentCount}개 모두 보기`}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { overflow: 'hidden', backgroundColor: feedLook.ground },
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  authorRow: {
    position: 'absolute',
    left: 16,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  author: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  handle: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: feedLook.white,
  },
  meta: {
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 17,
    color: feedLook.sub,
  },
  menu: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  example: {
    position: 'absolute',
    left: 16,
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 15,
    color: feedLook.faint,
  },
  // 시안: the actions in a column at the right foot, each icon over its count.
  sideColumn: {
    position: 'absolute',
    right: 10,
    alignItems: 'center',
    gap: 16,
  },
  side: { alignItems: 'center', minWidth: 44 },
  sideCount: {
    marginTop: 2,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: feedLook.white,
  },
  // 시안: the run's numbers big at the bottom left, the title with a runner beside it, then the words.
  words: { position: 'absolute', left: 16, right: 76 },
  stats: { flexDirection: 'row', gap: 20 },
  statValue: {
    fontFamily: fontFamily.bold,
    letterSpacing: -0.6,
    fontSize: 26,
    lineHeight: 30,
    color: feedLook.white,
  },
  statUnit: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: feedLook.white,
  },
  statLabel: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: feedLook.sub,
  },
  extra: {
    marginTop: 8,
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: feedLook.sub,
  },
  titleRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    flexShrink: 1,
    fontFamily: fontFamily.medium,
    fontSize: 17,
    lineHeight: 22,
    color: feedLook.white,
  },
  body: {
    marginTop: 6,
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
    color: feedLook.white,
  },
  comments: { alignSelf: 'flex-start', marginTop: 4 },
});
