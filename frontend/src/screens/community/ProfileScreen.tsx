import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  type LayoutChangeEvent,
  Pressable,
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
import Svg, {
  Defs,
  LinearGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import {
  AppText,
  EmptyState,
  Icon,
  MistFill,
  type IconName,
  useToast,
} from '../../components';
import {
  useRepositories,
  useResource,
  type Repositories,
  type RunnerProfile,
  type RunRecordSummary,
  type SelfReportedLevel,
} from '../../data';
import {
  formatDotDateWeekday,
  formatDuration,
  formatKm,
  formatPace,
} from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import { fontFamily, ThemeProvider } from '../../theme';
import { CourseGlyph } from '../course/SavedCoursesScreen';
import { communityLook } from './look';
import { mediaFor, Scrim } from './parts';

// 7.4 · 7.4b after the user's reference (담당자 요청): the top half is a picture fading into a dark screen, the
// name sits over its foot, then one wide white button, a row of three numbers, a glass card and the runs
// as two-column photo tiles. The picture is the runner's profile photo; without one it is a mist-to-teal
// gradient with the nickname's first letter large on it (담당자 결정). Only what the screen already showed is drawn.
const look = {
  background: '#091019',
  // The picture: pale mist at the top, through steel and teal, into the screen's dark.
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
  sub: 'rgba(255,255,255,0.6)',
  muted: 'rgba(255,255,255,0.45)',
  glass: 'rgba(255,255,255,0.07)',
  glassEdge: 'rgba(255,255,255,0.12)',
  roundButton: 'rgba(9,16,25,0.35)',
};

const levelLabels: Record<SelfReportedLevel, string> = {
  BEGINNER: '초급',
  INTERMEDIATE: '중급',
  ADVANCED: '고급',
};

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
  photo,
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
    outputRange: [0, 0.5],
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
      <FadeFill
        id="profileFrostTint"
        colors={[
          look.background,
          look.background,
          look.background,
          look.background,
        ]}
        offsets={[0, 0.2, 0.62, 1]}
        opacities={[0, 0.28, 0.5, 1]}
        style={{ top: heroHeight - panelLead }}
      />
      <Animated.View
        style={[styles.fill, styles.darken, { opacity: darker }]}
      />
    </View>
  );
}

// 뒤로 · 설정 over the picture: a small dark see-through circle.
function RoundButton({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.round, pressed && styles.pressed]}
    >
      <Icon name={icon} color={look.white} size={18} strokeWidth={2.2} />
    </Pressable>
  );
}

// One of the three numbers under the button.
function Count({
  value,
  unit,
  label,
}: {
  value: string;
  unit?: string;
  label: string;
}) {
  return (
    <View style={styles.count}>
      <AppText style={styles.countValue}>
        {value}
        {unit ? <AppText style={styles.countUnit}>{unit}</AppText> : null}
      </AppText>
      <AppText style={styles.countLabel}>{label}</AppText>
    </View>
  );
}

// The wide white button: 팔로우 + · 팔로잉 ✓ · 요청됨 ✓ (U22·U23), or 프로필 수정 on my own profile.
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.main, pressed && styles.mainPressed]}
    >
      <AppText style={[styles.mainText, busy && styles.busy]}>{label}</AppText>
      <Icon name={icon} color={communityLook.ink} size={16} strokeWidth={2.4} />
    </Pressable>
  );
}

const tileGap = 12;

// A run as a photo tile (공유한 러닝 결과 · 최근 기록): the run's gradient and outline, its name, day and
// pace in white over the darkened foot; the pace turns coral when slower than the goal.
function RunTile({
  record,
  width,
  onPress,
}: {
  record: RunRecordSummary;
  width: number;
  onPress: () => void;
}) {
  const media = mediaFor(record.id);
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
      <MistFill
        id={`tile${record.id.replace(/[^a-zA-Z0-9]/g, '')}`}
        colors={[...media.colors]}
        offsets={[...media.offsets]}
        style={styles.fillBleed}
      />
      <View style={styles.tileGlyph}>
        <CourseGlyph shape={record.shape} thin />
      </View>
      <Scrim />
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

function Profile({
  profile,
  onFollow,
  busy,
}: {
  profile: RunnerProfile;
  onFollow: () => void;
  busy: boolean;
}) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const locked =
    !profile.isMe && profile.isPrivate && profile.followStatus !== 'FOLLOWING';
  const heroHeight = Math.round(screenHeight * 0.48);
  const tileWidth = Math.floor((screenWidth - 32 - tileGap) / 2);
  // The page's scroll drives the picture's blur behind it.
  const scrollY = useRef(new Animated.Value(0)).current;
  const followLabel =
    profile.followStatus === 'FOLLOWING'
      ? '팔로잉'
      : profile.followStatus === 'PENDING'
      ? '요청됨'
      : '팔로우';
  return (
    <>
      <HeroBackdrop
        initial={profile.nickname.slice(0, 1)}
        photo={profile.profileImageUrl}
        heroHeight={heroHeight}
        scrollY={scrollY}
      />
      <Animated.ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
        scrollEventThrottle={16}
      >
        <View style={[styles.hero, { height: heroHeight }]}>
          <View style={[styles.topBar, { top: insets.top + 8 }]}>
            <RoundButton
              icon="back"
              label="뒤로"
              onPress={() => navigation.goBack()}
            />
            {profile.isMe ? (
              <RoundButton
                icon="settings"
                label="설정"
                onPress={() => navigateTo(navigation, 'Settings')}
              />
            ) : null}
          </View>
          <View style={styles.name}>
            <AppText style={styles.handle} numberOfLines={1}>
              {profile.handle}
            </AppText>
            <AppText style={styles.level}>{levelLabels[profile.level]}</AppText>
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
            <Count value={String(profile.followerCount)} label="팔로워" />
            <Count value={String(profile.followingCount)} label="팔로잉" />
            <Count
              value={locked ? '–' : String(profile.monthly.runCount)}
              unit={locked ? undefined : '회'}
              label="이번 달 러닝"
            />
          </View>
          {profile.isMe ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`팔로우 요청 ${
                profile.followRequestCount ?? 0
              }건`}
              onPress={() => toast('팔로우 요청 목록은 준비 중이에요')}
              style={({ pressed }) => [
                styles.card,
                pressed && styles.cardPressed,
              ]}
            >
              <AppText style={styles.cardTitle}>팔로우 요청</AppText>
              <View style={styles.flex} />
              <AppText style={styles.cardValue}>
                {`${profile.followRequestCount ?? 0}건`}
              </AppText>
              <Icon
                name="forward"
                color={look.muted}
                size={14}
                strokeWidth={2.2}
              />
            </Pressable>
          ) : null}
          {locked ? (
            <View style={styles.locked}>
              <Icon name="lock" color={look.sub} size={22} />
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
              <AppText style={styles.section} accessibilityRole="header">
                {profile.isMe ? '최근 기록' : '공유한 러닝 결과'}
              </AppText>
              {profile.records.length === 0 ? (
                <AppText style={styles.empty}>아직 기록이 없어요</AppText>
              ) : (
                <View style={styles.tiles}>
                  {profile.records.map(({ record, postId }) => (
                    <RunTile
                      key={record.id}
                      record={record}
                      width={tileWidth}
                      onPress={() =>
                        postId
                          ? navigation.navigate('PostDetail', { postId })
                          : navigation.navigate('RecordDetail', {
                              recordId: record.id,
                            })
                      }
                    />
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      </Animated.ScrollView>
    </>
  );
}

// 7.4 러너 프로필 (userId) and 7.4b 내 프로필 (userId null) on the dark screen.
function ProfileView({ userId }: { userId: string | null }) {
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
    } catch {
      toast('처리하지 못했어요. 잠시 후 다시 시도해 주세요');
    } finally {
      setBusy(false);
    }
  };
  return (
    <ThemeProvider tone="dark">
      <View style={styles.root}>
        <StatusBar barStyle="light-content" />
        {resource.status === 'error' && !profile ? (
          <EmptyState
            icon="alert"
            title="프로필을 불러오지 못했어요"
            actionLabel="다시 시도"
            onAction={reload}
          />
        ) : !profile ? (
          <ActivityIndicator style={styles.loading} color={look.white} />
        ) : (
          <Profile
            profile={profile}
            busy={busy}
            onFollow={() => follow(profile)}
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: look.background },
  flex: { flex: 1 },
  loading: { marginTop: 120 },
  pressed: { opacity: 0.6 },
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
  darken: { backgroundColor: look.background },
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
  round: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: look.roundButton,
  },
  name: { alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  handle: {
    fontFamily: fontFamily.bold,
    fontSize: 32,
    lineHeight: 40,
    letterSpacing: -0.5,
    color: look.white,
  },
  level: {
    marginTop: 2,
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: look.muted,
  },
  body: { paddingHorizontal: 16, paddingTop: 16 },
  // The wide white button, 54 high.
  main: {
    height: 54,
    borderRadius: 27,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: look.white,
  },
  mainPressed: { transform: [{ scale: 0.98 }] },
  mainText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    color: communityLook.ink,
  },
  // 팔로워 · 팔로잉 · 이번 달 러닝, each centred in a third.
  counts: { flexDirection: 'row', marginTop: 20 },
  count: { flex: 1, alignItems: 'center' },
  countValue: {
    fontFamily: fontFamily.numberMedium,
    fontSize: 26,
    lineHeight: 32,
    color: look.white,
  },
  countUnit: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: look.sub,
  },
  countLabel: {
    marginTop: 2,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: look.sub,
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
    borderColor: look.glassEdge,
    backgroundColor: look.glass,
  },
  cardPressed: { backgroundColor: 'rgba(255,255,255,0.12)' },
  cardTitle: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: look.white,
  },
  cardValue: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 19,
    color: look.sub,
  },
  locked: { alignItems: 'center', gap: 10, paddingVertical: 32 },
  lockedText: {
    textAlign: 'center',
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 22,
    color: look.sub,
  },
  section: {
    marginTop: 28,
    marginBottom: 12,
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    color: look.white,
  },
  empty: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: look.sub,
  },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: tileGap },
  tile: { borderRadius: 16, overflow: 'hidden', justifyContent: 'flex-end' },
  tilePressed: { opacity: 0.8 },
  tileGlyph: {
    position: 'absolute',
    top: '12%',
    left: '22%',
    width: '56%',
    aspectRatio: 1,
  },
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
