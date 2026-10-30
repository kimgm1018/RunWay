import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import {
  AppText,
  EmptyState,
  Icon,
  type IconName,
  useToast,
} from '../../components';
import {
  useRepositories,
  useResource,
  type Repositories,
  type RunnerProfile,
  type SelfReportedLevel,
} from '../../data';
import { formatKm, formatPace } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import {
  fontFamily,
  k1,
  radius,
  spacing,
  ThemeProvider,
  useTheme,
} from '../../theme';
import { RecordRow } from '../records/RecordsScreen';
import { Avatar } from './parts';

const levelLabels: Record<SelfReportedLevel, string> = {
  BEGINNER: '초급',
  INTERMEDIATE: '중급',
  ADVANCED: '고급',
};

// No profile photos (the sheets' photo): a steel glow behind the avatar on the dark screen.
function HeroGlow() {
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  const measure = (event: LayoutChangeEvent) =>
    setBox(event.nativeEvent.layout);
  return (
    <View style={StyleSheet.absoluteFill} onLayout={measure}>
      {box ? (
        <Svg width={box.width} height={box.height}>
          <Defs>
            <RadialGradient id="glow" cx="0.5" cy="0.28" r="0.75">
              <Stop offset="0" stopColor={k1.mid} stopOpacity={0.75} />
              <Stop offset="0.45" stopColor={k1.deep} stopOpacity={0.7} />
              <Stop offset="1" stopColor={k1.black} stopOpacity={1} />
            </RadialGradient>
          </Defs>
          <Rect width={box.width} height={box.height} fill="url(#glow)" />
        </Svg>
      ) : null}
    </View>
  );
}

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
      style={styles.round}
    >
      <Icon name={icon} color={k1.ice} size={18} />
    </Pressable>
  );
}

function Count({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.count}>
      <AppText style={styles.countValue}>{value}</AppText>
      <AppText variant="caption" tone="textSecondary">
        {label}
      </AppText>
    </View>
  );
}

function StatBox({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.statBox,
        { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
      ]}
    >
      <AppText variant="caption" tone="textSecondary">
        {label}
      </AppText>
      <AppText style={styles.statValue}>
        {value}
        {unit ? (
          <AppText variant="caption" tone="textSecondary">{` ${unit}`}</AppText>
        ) : null}
      </AppText>
    </View>
  );
}

// 팔로우 + on someone else's profile; 팔로잉 ✓ or 요청됨 once followed (U22·U23).
function FollowButton({
  profile,
  busy,
  onPress,
}: {
  profile: RunnerProfile;
  busy: boolean;
  onPress: () => void;
}) {
  const label =
    profile.followStatus === 'FOLLOWING'
      ? '팔로잉'
      : profile.followStatus === 'PENDING'
      ? '요청됨'
      : '팔로우';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.follow, pressed && styles.pressed]}
    >
      <AppText style={styles.followText}>{label}</AppText>
      <View style={styles.followMark}>
        <Icon
          name={profile.followStatus === 'NONE' ? 'plus' : 'check'}
          color={k1.night}
          size={18}
        />
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
  const { colors } = useTheme();
  const locked =
    !profile.isMe && profile.isPrivate && profile.followStatus !== 'FOLLOWING';
  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxxl }}
    >
      <View style={[styles.hero, { paddingTop: insets.top + spacing.md }]}>
        <HeroGlow />
        <View style={styles.topBar}>
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
        <View style={styles.level}>
          <AppText variant="captionStrong" style={{ color: k1.night }}>
            {levelLabels[profile.level]}
          </AppText>
        </View>
        <View style={styles.ring}>
          <Avatar
            nickname={profile.nickname}
            userId={profile.userId}
            mine={profile.isMe}
            size={104}
          />
        </View>
        <AppText style={styles.handle}>{profile.handle}</AppText>
        <View style={styles.counts}>
          <Count value={profile.followerCount} label="팔로워" />
          <Count value={profile.followingCount} label="팔로잉" />
        </View>
      </View>
      <View style={styles.body}>
        {profile.isMe ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`팔로우 요청 ${
                profile.followRequestCount ?? 0
              }건`}
              onPress={() => toast('팔로우 요청 목록은 준비 중이에요')}
              style={[styles.requests, { borderColor: colors.border }]}
            >
              <View style={styles.visibility}>
                <AppText variant="captionStrong" style={{ color: k1.night }}>
                  {profile.isPrivate ? '비공개 계정' : '공개 계정'}
                </AppText>
              </View>
              <AppText variant="bodyStrong" style={styles.flex}>
                팔로우 요청
              </AppText>
              <AppText variant="body" tone="textSecondary">
                {`${profile.followRequestCount ?? 0}건 ›`}
              </AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="프로필 수정"
              onPress={() => navigateTo(navigation, 'ProfileEdit')}
              style={[styles.edit, { borderColor: colors.borderStrong }]}
            >
              <Icon name="pencil" color={k1.ice} size={16} />
              <AppText variant="bodyStrong">프로필 수정</AppText>
            </Pressable>
          </>
        ) : (
          <FollowButton profile={profile} busy={busy} onPress={onFollow} />
        )}
        {locked ? (
          <View style={styles.locked}>
            <Icon name="lock" color={colors.textSecondary} size={22} />
            <AppText variant="body" tone="textSecondary" style={styles.center}>
              비공개 계정이에요. 팔로우 요청이 승인되면 러닝 기록이 보여요.
            </AppText>
          </View>
        ) : (
          <>
            <AppText variant="body" tone="textSecondary" style={styles.center}>
              {profile.isMe ? '이번 달 러닝' : '이번 달 공유한 러닝'}
            </AppText>
            <View style={styles.stats}>
              <StatBox
                label="러닝"
                value={String(profile.monthly.runCount)}
                unit="회"
              />
              <StatBox
                label="거리"
                value={formatKm(profile.monthly.totalDistanceM, 1)}
                unit="km"
              />
              <StatBox
                label="평균"
                value={
                  profile.monthly.averagePaceSecPerKm
                    ? formatPace(profile.monthly.averagePaceSecPerKm)
                    : '– –'
                }
              />
            </View>
            <View style={[styles.list, { borderColor: colors.border }]}>
              <AppText variant="heading">
                {profile.isMe ? '최근 기록' : '공유한 러닝 결과'}
              </AppText>
              {profile.records.length === 0 ? (
                <AppText variant="caption" tone="textSecondary">
                  아직 기록이 없어요
                </AppText>
              ) : (
                profile.records.map(({ record, postId }) => (
                  <RecordRow
                    key={record.id}
                    record={record}
                    onPress={() =>
                      postId
                        ? navigation.navigate('PostDetail', { postId })
                        : navigation.navigate('RecordDetail', {
                            recordId: record.id,
                          })
                    }
                  />
                ))
              )}
            </View>
          </>
        )}
      </View>
    </ScrollView>
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
          <ActivityIndicator style={styles.loading} color={k1.ice} />
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
  root: { flex: 1, backgroundColor: k1.black },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  loading: { marginTop: 120 },
  pressed: { opacity: 0.8 },
  hero: {
    alignItems: 'center',
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xxl,
  },
  topBar: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xxxl,
  },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(2,5,14,0.55)',
  },
  level: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: k1.ice,
    marginBottom: -spacing.sm,
    zIndex: 1,
  },
  ring: {
    padding: 4,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: k1.ice,
  },
  handle: {
    marginTop: spacing.lg,
    fontFamily: fontFamily.bold,
    fontSize: 28,
    lineHeight: 36,
  },
  counts: {
    flexDirection: 'row',
    gap: spacing.xxxl * 1.5,
    marginTop: spacing.sm,
  },
  count: { alignItems: 'center' },
  countValue: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 34,
    lineHeight: 40,
  },
  body: { paddingHorizontal: spacing.screen, gap: spacing.lg },
  follow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 60,
    paddingLeft: spacing.xxxl,
    paddingRight: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(128,150,175,0.45)',
  },
  followText: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 17,
    lineHeight: 24,
  },
  followMark: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: k1.ice,
  },
  requests: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    height: 52,
    paddingHorizontal: spacing.md,
    paddingRight: spacing.xxl,
    borderRadius: radius.pill,
    borderWidth: 1,
    backgroundColor: 'rgba(232,238,244,0.08)',
  },
  visibility: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: k1.ice,
  },
  edit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    height: 52,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  locked: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxxl,
  },
  stats: { flexDirection: 'row', gap: spacing.md },
  statBox: {
    flex: 1,
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  statValue: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 24,
    lineHeight: 28,
  },
  list: {
    gap: spacing.sm,
    padding: spacing.xxl,
    borderRadius: radius.card,
    borderWidth: 1,
    backgroundColor: 'rgba(2,5,14,0.6)',
  },
});
