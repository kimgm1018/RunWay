import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
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
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import {
  AppText,
  Backdrop,
  Card,
  EmptyState,
  Icon,
  IconButton,
  useToast,
} from '../../components';
import {
  errorCode,
  useRepositories,
  useResource,
  type GroupRunCancelReason,
  type GroupRunDetail,
  type Repositories,
} from '../../data';
import {
  formatClockTime,
  formatDotDateWeekday,
  formatDuration,
  formatKm,
  formatPace,
} from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import {
  fontFamily,
  k1,
  size,
  spacing,
  ThemeProvider,
  useTheme,
} from '../../theme';
import { MockMap } from '../run/MockMap';
import {
  BottomFade,
  canEnterRoom,
  dDay,
  formatSchedule,
  goalLine,
  InfoLine,
  Initial,
  roomOpensMs,
  useGroupRunDraft,
} from './parts';

export const cancelReasons: { value: GroupRunCancelReason; label: string }[] = [
  { value: 'WEATHER', label: '날씨' },
  { value: 'PERSONAL', label: '개인 사정' },
  { value: 'LACK_OF_PARTICIPANTS', label: '인원 부족' },
  { value: 'LOCATION_ISSUE', label: '장소 문제' },
  { value: 'OTHER', label: '기타' },
];

// The next group run, for links that open 6.4 without an id.
async function loadDetail(repositories: Repositories, groupRunId?: string) {
  const id =
    groupRunId ??
    (await repositories.groupRuns.listMine()).crews[0]?.groupRuns[0]?.id;
  return repositories.groupRuns.get(id);
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  const { colors } = useTheme();
  // A see-through tile of the background color, label on top and the value at the bottom.
  return (
    <View style={[styles.stat, { backgroundColor: colors.glass }]}>
      <AppText variant="label" tone="textSecondary">
        {label}
      </AppText>
      <AppText style={styles.statValue}>
        {value}
        {unit ? (
          <AppText variant="label" tone="textSecondary">
            {` ${unit}`}
          </AppText>
        ) : null}
      </AppText>
    </View>
  );
}

function FitLine({ run }: { run: GroupRunDetail }) {
  if (!run.myFit) {
    return null;
  }
  const gap = run.myFit.recentPaceSecPerKm - run.goalPaceSecPerKm;
  const verdict =
    Math.abs(gap) <= 15
      ? '내 페이스와 잘 맞아요'
      : gap < 0
      ? '내 페이스보다 느긋해요'
      : '내 페이스보다 빨라요';
  return (
    <Card style={[styles.card, styles.fit]}>
      <AppText variant="captionStrong">{verdict}</AppText>
      <AppText variant="caption" tone="textSecondary">
        {`최근 5km 평균 ${formatPace(run.myFit.recentPaceSecPerKm)} · 준비도 ${
          run.myFit.readinessScore
        }`}
      </AppText>
    </Card>
  );
}

// Chips floating at the bottom of the map (DESIGN.md 2-10 상세 위 지도): 참가 n명 is a white chip,
// D-n and the reason a black 55% chip, 취소됨 coral text on coral 14%.
function MapChip({
  label,
  tone,
}: {
  label: string;
  tone: 'light' | 'dark' | 'danger';
}) {
  return (
    <View
      style={[
        styles.chip,
        tone === 'light'
          ? styles.chipLight
          : tone === 'danger'
          ? styles.chipDanger
          : styles.chipDark,
      ]}
    >
      <AppText
        variant="labelStrong"
        style={
          tone === 'light'
            ? styles.chipLightText
            : tone === 'danger'
            ? styles.chipDangerText
            : styles.chipDarkText
        }
      >
        {label}
      </AppText>
    </View>
  );
}

// The top 400: the K1 dark map with a white course loop, darkening under the status bar and
// melting into the K1 background at the bottom, with the chips and crew name on it.
function MapHead({
  run,
  cancelled,
  chips,
}: {
  run: GroupRunDetail;
  cancelled: boolean;
  chips: React.ReactNode;
}) {
  return (
    <View style={styles.map}>
      <MockMap
        k1Style
        night
        muted={cancelled}
        route={run.route ?? undefined}
        position={run.route ? undefined : run.meetingPosition}
        routeArea={{ top: 250, bottom: 420 }}
        positionY={330}
      />
      <Svg
        style={StyleSheet.absoluteFill}
        width="100%"
        height="100%"
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="detailFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={k1.night} stopOpacity={0.6} />
            <Stop offset="0.2" stopColor={k1.night} stopOpacity={0} />
            <Stop offset="0.7" stopColor="#C3D1DD" stopOpacity={0} />
            <Stop offset="1" stopColor="#C3D1DD" stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#detailFade)" />
      </Svg>
      <View style={styles.mapLabels}>
        <View style={styles.tags}>{chips}</View>
        <AppText variant="captionStrong" tone="textSecondary">
          {run.crewName}
        </AppText>
      </View>
    </View>
  );
}

// 6.4 그룹런 상세, and 6.4e 취소 완료 when the run was cancelled.
export function GroupRunDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'GroupRunDetail'>>();
  const groupRunId = route.params?.groupRunId;
  const { colors } = useTheme();
  const { groupRuns, clock } = useRepositories();
  const { changed } = useGroupRunDraft();
  const toast = useToast();
  const detail = useResource(
    useCallback(
      (repositories: Repositories) => loadDetail(repositories, groupRunId),
      [groupRunId],
    ),
  );
  const { reload } = detail;
  // Coming back from 6.4c shows the cancelled state.
  useFocusEffect(useCallback(() => reload(), [reload]));
  const [run, setRun] = useState<GroupRunDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const loaded = detail.status === 'ready' ? detail.data : null;
  useEffect(() => {
    if (loaded) {
      setRun(loaded);
    }
  }, [loaded]);

  if (!run) {
    return (
      <SafeAreaView
        style={[styles.root, { backgroundColor: colors.background }]}
      >
        <View style={styles.headerRow}>
          <IconButton
            icon="back"
            accessibilityLabel="뒤로"
            onPress={() => navigation.goBack()}
          />
        </View>
        {detail.status === 'error' ? (
          <EmptyState
            icon="alert"
            title="그룹런을 불러오지 못했어요"
            actionLabel="다시 시도"
            onAction={detail.reload}
          />
        ) : (
          <ActivityIndicator style={styles.loading} />
        )}
      </SafeAreaView>
    );
  }

  const now = clock.now();
  const cancelled = run.status === 'CANCELLED';
  const enterable = canEnterRoom(run, now);
  const reason = cancelReasons.find(
    item => item.value === run.cancellation?.reason,
  );
  const expectedSec = run.targetDistanceM
    ? Math.round((run.targetDistanceM / 1000) * run.goalPaceSecPerKm)
    : run.targetDurationSec;

  const toggleJoin = async () => {
    setBusy(true);
    try {
      if (run.joined) {
        await groupRuns.leave(run.id);
      } else {
        await groupRuns.join(run.id);
      }
      setRun(await groupRuns.get(run.id));
      changed();
    } catch (error) {
      toast(
        errorCode(error) === 'FULL_OR_ALREADY_JOINED'
          ? '이미 참가했거나 자리가 없는 그룹런이에요'
          : run.joined
          ? '참가를 취소하지 못했어요. 잠시 후 다시 시도해 주세요'
          : '참가하지 못했어요. 잠시 후 다시 시도해 주세요',
      );
    } finally {
      setBusy(false);
    }
  };

  const chips = cancelled ? (
    <>
      <MapChip label="취소됨" tone="danger" />
      {reason ? <MapChip label={`사유 · ${reason.label}`} tone="dark" /> : null}
    </>
  ) : (
    <>
      <MapChip label={`참가 ${run.participantCount}명`} tone="light" />
      <MapChip label={dDay(run.scheduledAt, now)} tone="dark" />
    </>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <ThemeProvider tone="dark">
          <MapHead run={run} cancelled={cancelled} chips={chips} />
        </ThemeProvider>
        <View style={styles.body}>
          <AppText
            style={[
              styles.title,
              cancelled && [styles.struck, { color: colors.textTertiary }],
            ]}
          >
            {run.title}
          </AppText>
          <Card style={styles.card}>
            <InfoLine
              icon="clock"
              label="날짜·시간"
              value={formatSchedule(run.scheduledAt)}
            />
            <View
              style={[styles.divider, { backgroundColor: colors.border }]}
            />
            <InfoLine
              icon="mapPin"
              label="만나는 곳"
              value={
                cancelled
                  ? run.meetingPlaceName
                  : `${run.meetingPlaceName}\n${run.meetingAddress}`
              }
            />
            {!cancelled ? (
              <>
                <View
                  style={[styles.divider, { backgroundColor: colors.border }]}
                />
                <InfoLine
                  icon="route"
                  label="코스"
                  value={goalLine(run, false)}
                />
              </>
            ) : null}
          </Card>
          {cancelled ? (
            <>
              {run.cancellation?.message ? (
                <Card style={styles.card}>
                  <View style={styles.messageHead}>
                    <Initial name={run.cancellation.byNickname} />
                    <AppText variant="bodyStrong" style={styles.flex}>
                      {`${run.cancellation.byNickname} · ${run.cancellation.byRole}`}
                    </AppText>
                  </View>
                  <AppText variant="body">{run.cancellation.message}</AppText>
                </Card>
              ) : null}
              <View style={styles.notice}>
                <Icon name="bell" color={colors.textSecondary} size={14} />
                <AppText variant="caption" tone="textSecondary">
                  {`크루 멤버 ${run.crewMemberCount}명에게 취소 알림을 보냈어요`}
                </AppText>
              </View>
            </>
          ) : (
            <>
              <View style={styles.stats}>
                <Stat
                  label="거리"
                  value={
                    run.targetDistanceM
                      ? formatKm(run.targetDistanceM, 1)
                      : '– –'
                  }
                  unit={run.targetDistanceM ? 'km' : undefined}
                />
                <Stat
                  label="예상 공동 페이스"
                  value={formatPace(run.goalPaceSecPerKm)}
                />
                <Stat
                  label="예상 시간"
                  value={expectedSec ? formatDuration(expectedSec) : '– –'}
                />
              </View>
              <Card style={styles.card}>
                <View style={styles.rowBetween}>
                  <AppText variant="bodyStrong">참가자</AppText>
                  <AppText variant="label" tone="textSecondary">
                    {`크루 멤버 ${run.crewMemberCount}명 중`}
                  </AppText>
                </View>
                <View style={styles.avatars}>
                  {run.participants.slice(0, 5).map((member, index) => (
                    <Initial
                      key={member.userId}
                      name={member.nickname}
                      index={index}
                      style={[
                        styles.overlap,
                        { borderColor: colors.surfaceRaised },
                      ]}
                    />
                  ))}
                  <AppText
                    variant="caption"
                    tone="textSecondary"
                    style={styles.count}
                  >
                    {`${run.participantCount}명 참가`}
                  </AppText>
                </View>
              </Card>
              <FitLine run={run} />
              {run.isHost ? (
                <Card style={[styles.card, styles.hostRow]}>
                  <Initial name="나" index={0} size={28} />
                  <AppText
                    variant="caption"
                    tone="textSecondary"
                    style={styles.flex}
                  >
                    내가 만든 그룹런
                  </AppText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="그룹런 수정"
                    onPress={() =>
                      navigation.navigate('GroupRunCreate', {
                        groupRunId: run.id,
                      })
                    }
                    hitSlop={8}
                  >
                    <AppText variant="captionStrong">수정</AppText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="그룹런 취소"
                    onPress={() =>
                      navigation.navigate('GroupRunCancel', {
                        groupRunId: run.id,
                      })
                    }
                    hitSlop={8}
                  >
                    <AppText variant="captionStrong" tone="danger">
                      그룹런 취소
                    </AppText>
                  </Pressable>
                </Card>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>
      <ThemeProvider tone="dark">
        <SafeAreaView
          edges={['top']}
          style={styles.header}
          pointerEvents="box-none"
        >
          <View style={styles.headerRow}>
            <IconButton
              icon="back"
              accessibilityLabel="뒤로"
              onPress={() => navigation.goBack()}
            />
            <View style={styles.flex} />
            {!cancelled ? (
              <IconButton
                icon="share"
                accessibilityLabel="공유"
                onPress={() => navigateTo(navigation, 'PostWrite')}
              />
            ) : null}
          </View>
        </SafeAreaView>
        {/* The buttons sit on the black lower part of the K1 background. */}
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <BottomFade />
          {cancelled ? (
            <View style={styles.buttonRow}>
              <FooterButton
                title="다시 만들기"
                onPress={() =>
                  navigation.navigate('GroupRunCreate', { crewId: run.crewId })
                }
              />
              <FooterButton
                title="내 크루로"
                primary
                onPress={() => navigateTo(navigation, 'MyCrews')}
              />
            </View>
          ) : enterable ? (
            <FooterButton
              title={run.isHost ? '대기방 입장 · 그룹장' : '대기방 입장'}
              primary
              onPress={() =>
                navigation.navigate('WaitingRoom', { groupRunId: run.id })
              }
            />
          ) : (
            <>
              {run.joined ? (
                <AppText
                  variant="caption"
                  tone="textSecondary"
                  style={styles.opens}
                >
                  {`대기방은 ${formatDotDateWeekday(
                    new Date(Date.parse(run.scheduledAt) - roomOpensMs),
                  )} ${formatClockTime(
                    new Date(Date.parse(run.scheduledAt) - roomOpensMs),
                  )}에 열려요`}
                </AppText>
              ) : null}
              {run.isHost ? (
                // The creator leads the run, so they cannot leave it; the room opens 30 minutes before.
                <FooterButton
                  title="대기방 입장 · 그룹장"
                  primary
                  disabled
                  onPress={() => undefined}
                />
              ) : (
                <FooterButton
                  title={run.joined ? '참가 취소' : '참가하기'}
                  primary={!run.joined}
                  disabled={busy}
                  onPress={toggleJoin}
                />
              )}
            </>
          )}
        </SafeAreaView>
      </ThemeProvider>
    </View>
  );
}

// Buttons at the bottom of the group screens (DESIGN.md 2-10). They read the tone they sit in:
// primary is the solid accent pill, danger the coral fill (6.4d 취소하기), dangerOutline the coral
// outline (6.4c), and the rest are outlined.
export function FooterButton({
  title,
  onPress,
  primary = false,
  danger = false,
  dangerOutline = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
  dangerOutline?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const fill = danger
    ? {
        backgroundColor: k1.coral,
        borderColor: k1.coral,
        color: colors.onDanger,
      }
    : dangerOutline
    ? {
        backgroundColor: 'transparent',
        borderColor: k1.coral,
        color: k1.coral,
      }
    : primary
    ? {
        backgroundColor: colors.accent,
        borderColor: colors.accent,
        color: colors.onAccent,
      }
    : {
        backgroundColor: 'transparent',
        borderColor: colors.borderStrong,
        color: colors.text,
      };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.footerButton,
        {
          backgroundColor: fill.backgroundColor,
          borderColor: fill.borderColor,
        },
        (pressed || disabled) && styles.dim,
      ]}
    >
      <AppText variant="button" style={{ color: fill.color }}>
        {title}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: spacing.xxxl },
  scroll: { paddingBottom: 170 },
  map: { height: 400, overflow: 'hidden' },
  mapLabels: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    bottom: 64,
    gap: spacing.md,
  },
  header: { position: 'absolute', top: 0, left: 0, right: 0 },
  headerRow: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.screen,
  },
  body: {
    paddingHorizontal: 14,
    gap: spacing.md,
    marginTop: -56,
  },
  title: {
    fontFamily: fontFamily.medium,
    fontSize: 26,
    lineHeight: 34,
    letterSpacing: -0.5,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
  },
  tags: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: 999,
  },
  chipLight: { backgroundColor: k1.ice },
  chipLightText: { color: k1.night },
  chipDark: { backgroundColor: 'rgba(2,5,14,0.55)' },
  chipDarkText: { color: k1.ice },
  chipDanger: { backgroundColor: 'rgba(226,135,111,0.14)' },
  chipDangerText: { color: k1.coral },
  struck: { textDecorationLine: 'line-through' },
  card: { gap: spacing.lg },
  divider: { height: StyleSheet.hairlineWidth },
  stats: { flexDirection: 'row', gap: spacing.md },
  stat: {
    flex: 1,
    height: 92,
    borderRadius: 22,
    padding: spacing.xl,
    justifyContent: 'space-between',
  },
  statValue: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 21,
    lineHeight: 26,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  overlap: { marginRight: -spacing.md, borderWidth: 2 },
  count: { marginLeft: spacing.xxl },
  fit: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  hostRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  messageHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  buttonRow: { flexDirection: 'row', gap: spacing.md },
  opens: { textAlign: 'center' },
  footerButton: {
    flex: 1,
    minHeight: 54,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: { opacity: 0.6 },
});
