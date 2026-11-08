import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {
  CommonActions,
  useNavigation,
  useFocusEffect,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../../session/SessionProvider';
import {
  AppText,
  EmptyState,
  Icon,
  PressableScale,
  useToast,
} from '../../components';
import {
  useRepositories,
  useResource,
  DataError,
  type CoursePlan,
  type GroupRunDetail,
  type Repositories,
  type WaitingRoom,
} from '../../data';
import { formatPace } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import {
  fontFamily,
  size,
  spacing,
  ThemeProvider,
  typography,
  useTheme,
} from '../../theme';
import { ServiceMark, useMusicSource } from '../run/parts';
import { useRunActions, type RunConfig } from '../run/RunSession';
import {
  GroupBackground,
  GroupCta,
  groupLook,
  Raised,
  SectionLabel,
} from './look';
import { BottomFade, Initial } from './parts';
import { BackButton } from '../../components/BackButton';

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
  const pace = room.recommendedPaceSecPerKm;
  const range = room.comfortRange;
  const share =
    range && pace !== null
      ? Math.max(
          0,
          Math.min(1, (range[1] - pace) / Math.max(range[1] - range[0], 1)),
        )
      : null;
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <SectionLabel tone="light">추천 공동 페이스</SectionLabel>
        <AppText style={styles.noteStrong}>참가자 기록 기준</AppText>
      </View>
      {pace === null ? (
        <AppText style={styles.noteText}>추천 정보 부족</AppText>
      ) : (
        <AppText style={styles.pace}>
          {formatPace(pace)}
          <AppText style={styles.paceUnit}> /km</AppText>
        </AppText>
      )}
      {/* 편한 범위는 실서버가 제공하지 않으므로 임의의 ±20초 범위를 만들지 않는다. */}
      {range && share !== null ? (
        <>
          <View style={styles.range}>
            <View style={styles.rangeFill} />
            <View style={[styles.rangeMarker, { left: `${share * 100}%` }]} />
          </View>
          <View style={styles.rowBetween}>
            <AppText style={styles.rangeEnd}>{formatPace(range[0])}</AppText>
            <AppText style={styles.rangeLabel}>참가자 편한 범위</AppText>
            <AppText style={styles.rangeEnd}>{formatPace(range[1])}</AppText>
          </View>
        </>
      ) : null}
    </View>
  );
}

// After 준비 완료 the button turns into a dark glass 준비 취소 on the navy foot.
function ReadyCancel({ onPress }: { onPress: () => void }) {
  return <GroupCta title="준비 취소" primary={false} onPress={onPress} />;
}

// 6.5 출발 준비: waiting room, my readiness and the shared pace on one screen. Only the leader starts;
// members who pressed 준비 완료 start their own record 3 seconds later.
export function WaitingRoomScreen() {
  const { ensureRunLogin } = useSession();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'WaitingRoom'>>();
  const groupRunId = route.params?.groupRunId ?? 'gr-today';
  const { colors } = useTheme();
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
  const toast = useToast();
  const [starting, setStarting] = useState(false);
  const [startRequested, setStartRequested] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);
  const readyBusy = useRef(false);
  const startBusy = useRef(false);
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

  const observeError = useCallback(
    (error: unknown) =>
      setWatchError(
        error instanceof DataError && error.status === 409
          ? '그룹런이 취소되었거나 종료되었어요. 상세에서 상태를 확인해 주세요.'
          : '대기방 상태를 확인하지 못했어요. 연결되면 다시 조회해요.',
      ),
    [],
  );
  const updateParticipants = useCallback(
    (
      participants: WaitingRoom['participants'],
      recommendedPaceSecPerKm?: number | null,
      comfortRange?: WaitingRoom['comfortRange'],
      counts?: { participantCount: number; readyCount: number },
    ) => {
      const participantCount = counts?.participantCount ?? participants.length;
      const readyCount =
        counts?.readyCount ??
        participants.filter(member => member.readyStatus === 'READY').length;
      setWatchError(null);
      setRoom(current =>
        current
          ? {
              ...current,
              participants,
              // presence 없음: 참가 신청·대기방 인원 모두 G07 participantCount.
              appliedCount: participantCount,
              participantCount,
              readyCount,
              comfortRange:
                comfortRange === undefined
                  ? current.comfortRange
                  : comfortRange,
              recommendedPaceSecPerKm:
                recommendedPaceSecPerKm === undefined
                  ? current.recommendedPaceSecPerKm
                  : recommendedPaceSecPerKm,
            }
          : current,
      );
    },
    [],
  );
  useFocusEffect(
    useCallback(
      () =>
        groupRuns.watchStart(
          groupRunId,
          () => {
            if (ensureRunLogin()) {
              // 실서버는 기기 시작이 이미 확인됐다. 목업에만 기존 카운트다운을 유지한다.
              setCount(/^\d+$/.test(groupRunId) ? 0 : countdownSeconds);
            }
          },
          observeError,
          updateParticipants,
        ),
      [groupRunId, groupRuns, ensureRunLogin, observeError, updateParticipants],
    ),
  );
  const latest = useRef({ run, room, start, navigation });
  latest.current = { run, room, start, navigation };
  useEffect(() => {
    if (count === null) {
      return;
    }
    if (count === 0) {
      if (!run || !room) return;
      setCount(null);
      if (!ensureRunLogin()) {
        return;
      }
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
  }, [count, ensureRunLogin, run, room]);

  if (!run || !room) {
    return (
      <SafeAreaView
        style={[styles.root, { backgroundColor: colors.background }]}
      >
        <View style={styles.header}>
          <BackButton onPress={() => navigation.goBack()} />
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
  const toggleReady = async () => {
    if (readyBusy.current || startRequested || (!isReady && !ensureRunLogin()))
      return;
    readyBusy.current = true;
    try {
      setRoom(await groupRuns.setReady(groupRunId, !isReady));
    } catch {
      toast(
        '준비 상태를 변경하지 못했어요. 대기방 상태를 확인한 뒤 다시 시도해 주세요',
      );
    } finally {
      readyBusy.current = false;
    }
  };
  const requestStart = async () => {
    if (startBusy.current || startRequested || !ensureRunLogin()) return;
    startBusy.current = true;
    setStarting(true);
    try {
      await groupRuns.start(groupRunId);
      setStartRequested(true);
    } catch {
      toast(
        '시작 응답을 확인하지 못했어요. 실제 출발 상태를 확인한 뒤 다시 시도해 주세요',
      );
    } finally {
      startBusy.current = false;
      setStarting(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: groupLook.navy }]}>
      <StatusBar barStyle="dark-content" />
      <GroupBackground id="waitingRoomBackground" kind="common" />
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <BackButton onPress={() => navigation.goBack()} />
          <AppText
            accessibilityRole="header"
            style={[styles.flex, styles.title]}
          >
            출발 준비
          </AppText>
          <AppText style={styles.timeLeft} accessibilityLabel="출발까지">
            {timeLeft}
          </AppText>
        </View>
      </SafeAreaView>
      <ScrollView contentContainerStyle={styles.content}>
        <PaceCard room={room} />
        {watchError ? (
          <AppText accessibilityLiveRegion="polite">{watchError}</AppText>
        ) : null}
        {startRequested ? (
          <AppText accessibilityLiveRegion="polite">
            출발 요청이 승인됐어요. 기기의 실제 시작을 확인하고 있어요.
          </AppText>
        ) : null}
        {run.isHost && !startRequested ? (
          <GroupCta
            title={starting ? '출발 요청 중…' : '그룹런 시작'}
            icon="check"
            onPress={requestStart}
          />
        ) : null}
        {/* 6.5-MemberList: a line-labelled list without dividers. */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <SectionLabel tone="light">
              {`참가 신청 ${room.appliedCount}명 · 대기방 ${room.participantCount}명`}
            </SectionLabel>
            <AppText style={styles.noteText}>
              {`${room.readyCount}명 준비 완료`}
            </AppText>
          </View>
          <View>
            {room.participants.map((member, index) => (
              <View key={member.userId} style={styles.member}>
                <Initial name={member.nickname} index={index} size={36} />
                <View style={styles.flex}>
                  <View style={styles.nameLine}>
                    <AppText style={styles.memberName}>
                      {member.nickname}
                    </AppText>
                    {member.isHost ? (
                      <Icon
                        name="crown"
                        color={groupLook.onLightSub}
                        size={13}
                      />
                    ) : null}
                    {member.isMe ? (
                      <Raised tone="navy" style={styles.meBadge}>
                        <AppText style={styles.meText}>나</AppText>
                      </Raised>
                    ) : null}
                  </View>
                  {member.isMe && member.readinessScore !== null ? (
                    <AppText style={styles.readiness}>
                      {`준비도 ${member.readinessScore}`}
                    </AppText>
                  ) : null}
                </View>
                <AppText
                  style={
                    member.readyStatus === 'READY'
                      ? styles.statusReady
                      : styles.statusWaiting
                  }
                >
                  {member.readyStatus === 'READY' ? '준비 완료' : '대기 중'}
                </AppText>
              </View>
            ))}
          </View>
        </View>
        <AppText style={[styles.noteText, styles.note]}>
          그룹장이 출발을 요청하면 준비된 기기의 실제 시작을 확인해요
        </AppText>
      </ScrollView>
      <ThemeProvider tone="dark">
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <BottomFade />
          <View style={styles.flex}>
            {isReady ? (
              <ReadyCancel onPress={toggleReady} />
            ) : (
              <GroupCta title="준비 완료" icon="check" onPress={toggleReady} />
            )}
          </View>
          {/* 6.5-ReadyBar: the music button is a raised navy circle beside it. */}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="음악"
            onPress={() => navigateTo(navigation, 'MusicCard')}
          >
            <Raised tone="navy" style={styles.music}>
              {source && source !== 'NONE' ? (
                <ServiceMark service={source} size={30} />
              ) : (
                <Icon name="music" color={groupLook.onDark} size={20} />
              )}
            </Raised>
          </PressableScale>
        </SafeAreaView>
      </ThemeProvider>
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
  header: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.screen,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 19,
    lineHeight: 26,
    color: groupLook.onLight,
  },
  timeLeft: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 16,
    color: groupLook.onLight,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: spacing.md,
    gap: 32,
    paddingBottom: spacing.xxxl * 4,
  },
  card: { gap: spacing.lg },
  noteStrong: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 16,
    color: groupLook.onLightSub,
  },
  noteText: {
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 17,
    color: groupLook.onLightSub,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Big numbers stay Barlow Regular at the sheet's 60.
  pace: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 60,
    lineHeight: 66,
    color: groupLook.onLight,
  },
  paceUnit: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    color: groupLook.onLightSub,
  },
  range: {
    height: 8,
    borderRadius: 4,
    justifyContent: 'center',
    backgroundColor: 'rgba(2,5,14,0.08)',
  },
  rangeFill: {
    position: 'absolute',
    left: '25%',
    right: '25%',
    top: 0,
    bottom: 0,
    borderRadius: 4,
    backgroundColor: '#7DA0B2',
  },
  rangeMarker: {
    position: 'absolute',
    width: 3,
    height: 22,
    borderRadius: 1.5,
    marginLeft: -1.5,
    backgroundColor: groupLook.onLight,
  },
  rangeEnd: {
    fontFamily: fontFamily.numberBold,
    fontSize: 12,
    lineHeight: 16,
    color: groupLook.onLightSub2,
  },
  rangeLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 16,
    color: groupLook.onLight,
  },
  // 6.5-MemberList rows.
  member: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  memberName: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: groupLook.onLight,
  },
  meBadge: {
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 9,
    justifyContent: 'center',
  },
  meText: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    lineHeight: 14,
    color: groupLook.onDark,
  },
  readiness: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: groupLook.onLightSub,
  },
  statusReady: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: groupLook.onLight,
  },
  statusWaiting: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 19,
    color: groupLook.onLightSub,
  },
  note: { textAlign: 'center' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: 14,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  music: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  count: { ...typography.metricHero, fontSize: 120, lineHeight: 130 },
});
