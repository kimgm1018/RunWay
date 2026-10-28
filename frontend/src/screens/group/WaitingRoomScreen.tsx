import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {
  CommonActions,
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
  type CoursePlan,
  type GroupRunDetail,
  type Repositories,
  type WaitingRoom,
} from '../../data';
import { formatDuration, formatPace } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import {
  palette,
  radius,
  size,
  spacing,
  typography,
  useTheme,
} from '../../theme';
import { MockMap } from '../run/MockMap';
import { ServiceMark, useMusicSource } from '../run/parts';
import { useRunActions, type RunConfig } from '../run/RunSession';
import { Initial } from './parts';

const countdownSeconds = 3;

// The run goal the leader starts with: the course and the shared pace of the waiting room (6.5).
export function groupRunConfig(
  run: GroupRunDetail,
  goalPaceSecPerKm: number,
): RunConfig {
  const plan: CoursePlan | null =
    run.route && run.courseId && run.targetDistanceM
      ? {
          courseId: run.courseId,
          name: run.courseName ?? run.title,
          distanceM: run.targetDistanceM,
          route: run.route,
          segmentPacesSecPerKm: [],
          strategy: '',
          targetPaceSecPerKm: goalPaceSecPerKm,
          expectedDurationSec: Math.round(
            (run.targetDistanceM / 1000) * goalPaceSecPerKm,
          ),
          caution: null,
          rival: null,
        }
      : null;
  return {
    mode: 'GROUP',
    plan,
    groupRunId: run.id,
    goalDistanceM: run.targetDistanceM,
    goalPaceSecPerKm,
  };
}

const loadRoom = (repositories: Repositories, groupRunId: string) =>
  Promise.all([
    repositories.groupRuns.get(groupRunId),
    repositories.groupRuns.getWaitingRoom(groupRunId),
  ]);

// mm:ss until the scheduled start, counting down in real time from the app clock.
function useCountdown(target: string | null, now: Date) {
  const [left, setLeft] = useState<number | null>(null);
  const startedAt = useRef(Date.now());
  useEffect(() => {
    if (!target) {
      return;
    }
    const base = Math.max(
      0,
      Math.round((Date.parse(target) - now.getTime()) / 1000),
    );
    const update = () =>
      setLeft(
        Math.max(0, base - Math.round((Date.now() - startedAt.current) / 1000)),
      );
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [now, target]);
  if (left === null) {
    return '';
  }
  return `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(
    left % 60,
  ).padStart(2, '0')}`;
}

function PaceCard({ room }: { room: WaitingRoom }) {
  const { colors } = useTheme();
  const [slow, fast] = [room.comfortRange[1], room.comfortRange[0]];
  const share = (slow - room.goalPaceSecPerKm) / Math.max(slow - fast, 1);
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={styles.rowBetween}>
        <AppText variant="bodyStrong">공동 페이스</AppText>
        <AppText variant="label" tone="textTertiary">
          AI 제안 · 참가자 기록 기준
        </AppText>
      </View>
      <AppText style={styles.pace}>
        {formatPace(room.goalPaceSecPerKm)}
        <AppText variant="caption" tone="textSecondary">
          {`  /km · 예상 ${formatDuration(room.expectedDurationSec)}`}
        </AppText>
      </AppText>
      <View style={[styles.range, { backgroundColor: colors.border }]}>
        <View
          style={[styles.rangeFill, { backgroundColor: colors.accentSoft }]}
        />
        <View
          style={[
            styles.rangeMarker,
            {
              left: `${share * 100}%`,
              backgroundColor: colors.accent,
              borderColor: colors.background,
            },
          ]}
        />
      </View>
      <View style={styles.rowBetween}>
        <AppText variant="label" tone="textTertiary">
          {formatPace(fast)}
        </AppText>
        <AppText variant="label" tone="textTertiary">
          참가자 편한 범위
        </AppText>
        <AppText variant="label" tone="textTertiary">
          {formatPace(slow)}
        </AppText>
      </View>
    </View>
  );
}

// 6.5 출발 준비: waiting room, my readiness and the shared pace on one screen. Only the leader starts;
// members who pressed 준비 완료 start their own record 3 seconds later.
export function WaitingRoomScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'WaitingRoom'>>();
  const groupRunId = route.params?.groupRunId ?? 'gr-today';
  const { colors, name } = useTheme();
  const { groupRuns, clock } = useRepositories();
  const { start } = useRunActions();
  const source = useMusicSource();
  const data = useResource(
    useCallback(
      (repositories: Repositories) => loadRoom(repositories, groupRunId),
      [groupRunId],
    ),
  );
  const [room, setRoom] = useState<WaitingRoom | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const run = data.status === 'ready' ? data.data[0] : null;
  const [now] = useState(() => clock.now());
  const timeLeft = useCountdown(run?.scheduledAt ?? null, now);

  const loadedRoom = data.status === 'ready' ? data.data[1] : null;
  useEffect(() => {
    if (loadedRoom) {
      setRoom(loadedRoom);
    }
  }, [loadedRoom]);

  // The leader's start reaches every member; ready ones count down 3·2·1 and start.
  useEffect(
    () => groupRuns.watchStart(groupRunId, () => setCount(countdownSeconds)),
    [groupRunId, groupRuns],
  );
  const latest = useRef({ run, room, start, navigation });
  latest.current = { run, room, start, navigation };
  useEffect(() => {
    if (count === null) {
      return;
    }
    if (count === 0) {
      const {
        run: current,
        room: currentRoom,
        start: begin,
        navigation: nav,
      } = latest.current;
      if (current && currentRoom) {
        begin(groupRunConfig(current, currentRoom.goalPaceSecPerKm));
        nav.dispatch(
          CommonActions.reset({
            index: 1,
            routes: [{ name: 'MainTabs' }, { name: 'GroupRunProgress' }],
          }),
        );
      }
      return;
    }
    const timer = setTimeout(() => setCount(count - 1), 1000);
    return () => clearTimeout(timer);
  }, [count]);

  if (!run || !room) {
    return (
      <SafeAreaView
        style={[styles.root, { backgroundColor: colors.background }]}
      >
        <View style={styles.header}>
          <IconButton
            icon="back"
            accessibilityLabel="뒤로"
            onPress={() => navigation.goBack()}
          />
        </View>
        {data.status === 'error' ? (
          <EmptyState
            icon="alert"
            title="대기방을 불러오지 못했어요"
            actionLabel="다시 시도"
            onAction={data.reload}
          />
        ) : (
          <ActivityIndicator style={styles.loading} />
        )}
      </SafeAreaView>
    );
  }

  const me = room.participants.find(member => member.isMe);
  const isReady = me?.readyStatus === 'READY';
  const readyCount = room.participants.filter(
    member => member.readyStatus === 'READY',
  ).length;
  const toggleReady = async () =>
    setRoom(await groupRuns.setReady(groupRunId, !isReady));

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={styles.map} pointerEvents="none">
        <MockMap
          night={name === 'dark'}
          route={run.route ?? undefined}
          position={run.route ? undefined : run.meetingPosition}
          routeArea={{ top: 250, bottom: 420 }}
          positionY={330}
        />
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Defs>
            <LinearGradient id="roomFade" x1="0" y1="0" x2="0" y2="1">
              <Stop
                offset="0"
                stopColor={colors.background}
                stopOpacity={0.3}
              />
              <Stop offset="1" stopColor={colors.background} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#roomFade)" />
        </Svg>
      </View>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <IconButton
            icon="back"
            accessibilityLabel="뒤로"
            onPress={() => navigation.goBack()}
          />
          <AppText
            variant="heading"
            accessibilityRole="header"
            style={styles.flex}
          >
            출발 준비
          </AppText>
          <AppText
            variant="metric"
            tone="accentText"
            accessibilityLabel="출발까지"
          >
            {timeLeft}
          </AppText>
        </View>
      </SafeAreaView>
      <ScrollView contentContainerStyle={styles.content}>
        <PaceCard room={room} />
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.rowBetween}>
            <AppText variant="bodyStrong">
              {`참가 신청 ${room.appliedCount}명 · 대기방 ${room.participants.length}명`}
            </AppText>
            <AppText variant="label" tone="textTertiary">
              {`${readyCount}명 준비 완료`}
            </AppText>
          </View>
          {room.participants.map((member, index) => (
            <View key={member.userId}>
              {index > 0 ? (
                <View
                  style={[styles.divider, { backgroundColor: colors.border }]}
                />
              ) : null}
              <View style={styles.member}>
                <Initial name={member.nickname} index={index} />
                <View style={styles.flex}>
                  <View style={styles.nameLine}>
                    <AppText variant="bodyStrong">{member.nickname}</AppText>
                    {member.isHost ? (
                      <Icon name="crown" color={palette.coral} size={13} />
                    ) : null}
                    {member.isMe ? (
                      <View
                        style={[
                          styles.meBadge,
                          { backgroundColor: colors.accent },
                        ]}
                      >
                        <AppText
                          variant="labelStrong"
                          style={{ color: colors.onAccent }}
                        >
                          나
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                  {member.isMe && member.readinessScore !== null ? (
                    <AppText variant="label" tone="textTertiary">
                      {`준비도 ${member.readinessScore}`}
                    </AppText>
                  ) : null}
                </View>
                <AppText
                  variant="captionStrong"
                  tone={
                    member.readyStatus === 'READY'
                      ? 'accentText'
                      : 'textTertiary'
                  }
                >
                  {member.readyStatus === 'READY' ? '준비 완료' : '대기 중'}
                </AppText>
              </View>
            </View>
          ))}
        </View>
        <AppText variant="caption" tone="textTertiary" style={styles.note}>
          그룹장이 출발하면 준비 완료한 멤버의 기록이 3초 뒤 함께 시작돼요
        </AppText>
      </ScrollView>
      <SafeAreaView
        edges={['bottom']}
        style={[styles.footer, { backgroundColor: colors.background }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isReady ? '준비 취소' : '준비 완료'}
          onPress={toggleReady}
          style={({ pressed }) => [
            styles.ready,
            isReady
              ? {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: colors.borderStrong,
                }
              : { backgroundColor: colors.accent, borderColor: colors.accent },
            pressed && styles.pressed,
          ]}
        >
          <AppText
            variant="button"
            style={{ color: isReady ? colors.text : colors.onAccent }}
          >
            {isReady ? '준비 취소' : '준비 완료'}
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="음악"
          onPress={() => navigateTo(navigation, 'MusicCard')}
          style={({ pressed }) => [
            styles.music,
            { backgroundColor: colors.surfaceMuted },
            pressed && styles.pressed,
          ]}
        >
          {source && source !== 'NONE' ? (
            <ServiceMark service={source} size={30} />
          ) : (
            <Icon name="music" color={colors.text} size={20} />
          )}
        </Pressable>
      </SafeAreaView>
      <Modal visible={count !== null} transparent animationType="fade">
        <View style={[styles.overlay, { backgroundColor: colors.scrim }]}>
          <AppText variant="heading" tone="accentText">
            그룹장이 출발했어요
          </AppText>
          <AppText style={styles.count}>{count ?? ''}</AppText>
          <AppText variant="body" tone="textSecondary">
            내 기록이 함께 시작돼요
          </AppText>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: spacing.xxxl },
  map: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 260,
    overflow: 'hidden',
  },
  header: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.screen,
  },
  content: {
    padding: spacing.screen,
    paddingTop: spacing.xxxl * 2,
    gap: spacing.xl,
    paddingBottom: spacing.xxxl * 4,
  },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.xxl,
    gap: spacing.lg,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pace: { ...typography.metricHero, fontSize: 52, lineHeight: 58 },
  range: { height: 8, borderRadius: 4, justifyContent: 'center' },
  rangeFill: {
    position: 'absolute',
    left: '25%',
    right: '25%',
    top: 0,
    bottom: 0,
    borderRadius: 4,
  },
  rangeMarker: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    marginLeft: -8,
    borderWidth: 2,
  },
  divider: { height: StyleSheet.hairlineWidth },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.md,
  },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  meBadge: { paddingHorizontal: spacing.sm, borderRadius: radius.pill },
  note: { textAlign: 'center' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xl,
  },
  ready: {
    flex: 1,
    height: size.buttonLarge,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  music: {
    width: size.buttonLarge,
    height: size.buttonLarge,
    borderRadius: size.buttonLarge / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  count: { ...typography.metricHero, fontSize: 120, lineHeight: 130 },
});
