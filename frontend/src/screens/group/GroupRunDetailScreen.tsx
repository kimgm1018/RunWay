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
import { AppText, EmptyState, Icon, IconButton } from '../../components';
import {
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
import { radius, size, spacing, useTheme } from '../../theme';
import { MockMap } from '../run/MockMap';
import {
  canEnterRoom,
  dDay,
  formatSchedule,
  goalLine,
  InfoLine,
  Initial,
  roomOpensMs,
  Tag,
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
  return (
    <View
      style={[
        styles.stat,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <AppText variant="label" tone="textTertiary">
        {label}
      </AppText>
      <AppText variant="metric">
        {value}
        {unit ? (
          <AppText variant="label" tone="textTertiary">
            {` ${unit}`}
          </AppText>
        ) : null}
      </AppText>
    </View>
  );
}

function FitLine({ run }: { run: GroupRunDetail }) {
  const { colors } = useTheme();
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
    <View
      style={[
        styles.card,
        styles.fit,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <AppText variant="captionStrong" tone="accentText">
        {verdict}
      </AppText>
      <AppText variant="caption" tone="textSecondary">
        {`최근 5km 평균 ${formatPace(run.myFit.recentPaceSecPerKm)} · 준비도 ${
          run.myFit.readinessScore
        }`}
      </AppText>
    </View>
  );
}

// 6.4 그룹런 상세, and 6.4e 취소 완료 when the run was cancelled.
export function GroupRunDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'GroupRunDetail'>>();
  const groupRunId = route.params?.groupRunId;
  const { colors, name } = useTheme();
  const { groupRuns, clock } = useRepositories();
  const { changed } = useGroupRunDraft();
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
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.map}>
          <MockMap
            night={name === 'dark'}
            muted={cancelled}
            route={run.route ?? undefined}
            position={run.route ? undefined : run.meetingPosition}
            routeArea={{ top: 230, bottom: 470 }}
            positionY={420}
          />
          <Svg
            style={StyleSheet.absoluteFill}
            width="100%"
            height="100%"
            pointerEvents="none"
          >
            <Defs>
              <LinearGradient id="detailFade" x1="0" y1="0" x2="0" y2="1">
                <Stop
                  offset="0"
                  stopColor={colors.background}
                  stopOpacity={0.5}
                />
                <Stop
                  offset="0.3"
                  stopColor={colors.background}
                  stopOpacity={0}
                />
                <Stop
                  offset="0.7"
                  stopColor={colors.background}
                  stopOpacity={0.2}
                />
                <Stop
                  offset="1"
                  stopColor={colors.background}
                  stopOpacity={1}
                />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#detailFade)" />
          </Svg>
        </View>
        <View style={styles.body}>
          <View style={styles.tags}>
            {cancelled ? (
              <>
                <Tag label="취소됨" tone="danger" />
                {reason ? (
                  <Tag label={`사유 · ${reason.label}`} tone="muted" />
                ) : null}
              </>
            ) : (
              <>
                <Tag label={`참가 ${run.participantCount}명`} tone="accent" />
                <Tag label={dDay(run.scheduledAt, now)} tone="muted" />
              </>
            )}
          </View>
          <AppText variant="captionStrong" tone="accentText">
            {run.crewName}
          </AppText>
          <AppText
            variant="display"
            style={cancelled && [styles.struck, { color: colors.textTertiary }]}
          >
            {run.title}
          </AppText>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
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
          </View>
          {cancelled ? (
            <>
              {run.cancellation?.message ? (
                <View
                  style={[
                    styles.card,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View style={styles.messageHead}>
                    <Initial name={run.cancellation.byNickname} />
                    <AppText variant="bodyStrong" style={styles.flex}>
                      {`${run.cancellation.byNickname} · ${run.cancellation.byRole}`}
                    </AppText>
                  </View>
                  <AppText variant="body">{run.cancellation.message}</AppText>
                </View>
              ) : null}
              <View style={styles.notice}>
                <Icon name="bell" color={colors.textTertiary} size={14} />
                <AppText variant="caption" tone="textTertiary">
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
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.rowBetween}>
                  <AppText variant="bodyStrong">참가자</AppText>
                  <AppText variant="label" tone="textTertiary">
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
              </View>
              <FitLine run={run} />
              {run.isHost ? (
                <View
                  style={[
                    styles.card,
                    styles.hostRow,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
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
                </View>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>
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
      <SafeAreaView
        edges={['bottom']}
        style={[styles.footer, { backgroundColor: colors.background }]}
      >
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
                tone="textTertiary"
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
    </View>
  );
}

export function FooterButton({
  title,
  onPress,
  primary = false,
  danger = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const fill = danger
    ? {
        backgroundColor: colors.danger,
        borderColor: colors.danger,
        color: colors.onDanger,
      }
    : primary
    ? {
        backgroundColor: colors.accent,
        borderColor: colors.accent,
        color: colors.onAccent,
      }
    : {
        backgroundColor: colors.surfaceMuted,
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
  map: { height: 320, overflow: 'hidden' },
  header: { position: 'absolute', top: 0, left: 0, right: 0 },
  headerRow: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.screen,
  },
  body: {
    paddingHorizontal: spacing.screen,
    gap: spacing.md,
    marginTop: -spacing.xxxl,
  },
  tags: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
  struck: { textDecorationLine: 'line-through' },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.xxl,
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  divider: { height: StyleSheet.hairlineWidth },
  stats: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  stat: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.xl,
    gap: spacing.xxs,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  overlap: { marginRight: -spacing.md, borderWidth: 2 },
  count: { marginLeft: spacing.xxl },
  fit: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.xl,
  },
  messageHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  buttonRow: { flexDirection: 'row', gap: spacing.md },
  opens: { textAlign: 'center' },
  footerButton: {
    flex: 1,
    minHeight: size.buttonLarge,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: { opacity: 0.6 },
});
