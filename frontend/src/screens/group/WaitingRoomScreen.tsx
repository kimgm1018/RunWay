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
} from '../../theme';
import { ServiceMark, useMusicSource } from '../run/parts';
import {
  useRunActions,
  useRunControlState,
  type RunConfig,
} from '../run/RunSession';
import {
  GroupCta,
  groupLook,
  NightBackground,
  NumText,
  Raised,
  groupTone,
} from './look';
import { MissingTarget } from './MissingTarget';
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

// 추천 공동 페이스 (runway-group-screen-designs 06, S15P31E105-594): a clock with the title and its basis under it,
// the shared pace big in the middle, then under a line the run's own target pace and, when the server gives it,
// the members' comfortable range, both centred.
function PaceCard({ room, run }: { room: WaitingRoom; run: GroupRunDetail }) {
  const pace = room.recommendedPaceSecPerKm;
  const range = room.comfortRange;
  return (
    <Raised tone="night" style={styles.card}>
      <View style={styles.paceHead}>
        <Icon name="clock" color={groupTone.text} size={22} />
        <View>
          <AppText style={styles.cardTitle}>추천 공동 페이스</AppText>
          <AppText style={styles.noteText}>참가자 기록 기준</AppText>
        </View>
      </View>
      {pace === null ? (
        <AppText style={[styles.noteText, styles.center]}>
          추천 정보 부족
        </AppText>
      ) : (
        <AppText style={[styles.pace, styles.center]}>
          {formatPace(pace)}
          <AppText style={styles.paceUnit}>/km</AppText>
        </AppText>
      )}
      <View style={styles.paceFoot}>
        <NumText
          style={[styles.paceLine, styles.center]}
          text={`목표 페이스 ${formatPace(run.goalPaceSecPerKm)} /km`}
        />
        {/* 편한 범위는 실서버가 제공하지 않으므로 임의의 ±20초 범위를 만들지 않는다. */}
        {range ? (
          <NumText
            style={[styles.noteText, styles.center]}
            text={`참가자 편한 범위 ${formatPace(range[0])} – ${formatPace(
              range[1],
            )}`}
          />
        ) : null}
      </View>
    </Raised>
  );
}

// After 준비 완료 the button turns into a soft white 준비 취소 (GroupCta navy's secondary, S15P31E105-563).
function ReadyCancel({ onPress }: { onPress: () => void }) {
  return <GroupCta navy title="준비 취소" primary={false} onPress={onPress} />;
}

// 6.5 출발 준비: waiting room, my readiness and the shared pace on one screen. Only the leader starts;
// members who pressed 준비 완료 start their own record 3 seconds later.
export function WaitingRoomScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'WaitingRoom'>>();
  const groupRunId = route.params?.groupRunId;
  // Without an id the screen has nothing to show; no mock id stands in (S15P31E105-635).
  if (!groupRunId) {
    return <MissingTarget title="그룹런을 찾을 수 없어요" />;
  }
  return <WaitingRoomContent groupRunId={groupRunId} />;
}

function WaitingRoomContent({ groupRunId }: { groupRunId: string }) {
  const { ensureRunLogin } = useSession();
  const navigation = useNavigation();
  const { groupRuns, clock, watchSession } = useRepositories();
  const { start, joinGroup, leaveGroup } = useRunActions();
  const control = useRunControlState();
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

  // 준비 완료로 서버가 만든 내 세션에 붙어 워치를 그룹 목표로 준비시킨다(S15P31E105-420). 출발은 그룹장의 G09가 승인하고
  // 워치가 실제로 시작해야 확정된다. 다시 들어온 대기방도 같은 세션에 다시 붙는다.
  const mySessionId = room?.mySessionId ?? null;
  const goalPace = room?.goalPaceSecPerKm ?? null;
  useEffect(() => {
    if (run && mySessionId && goalPace !== null) {
      joinGroup(groupRunConfig(run, goalPace), mySessionId);
    }
  }, [goalPace, joinGroup, mySessionId, run]);
  const watchProblem =
    control?.sessionId === mySessionId && mySessionId
      ? control?.problem?.kind === 'watchRequired'
        ? '워치가 연결되어 있지 않아요. 워치를 연결해야 함께 출발할 수 있어요.'
        : control?.problem?.kind === 'watchNotReady'
        ? '워치가 출발 준비를 하지 못했어요. 워치 앱을 열고 다시 준비해 주세요.'
        : null
      : null;

  const observeError = useCallback(
    (error: unknown) =>
      setWatchError(
        error instanceof DataError && error.status === 409 && error.message
          ? error.message
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
      <SafeAreaView style={[styles.root, { backgroundColor: groupTone.page }]}>
        <View style={styles.header}>
          <BackButton tone="dark" onPress={() => navigation.goBack()} />
        </View>
        {data.status === 'error' ? (
          <EmptyState
            icon="alert"
            title="대기방을 불러오지 못했어요"
            actionLabel="다시 시도"
            onAction={data.reload}
          />
        ) : (
          <ActivityIndicator color={groupTone.sub} style={styles.loading} />
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
      // G16은 서버에 연결된 워치·폰 기기로 세션을 만든다(없으면 DEVICE_NOT_FOUND). 준비 전에 연결 워치를 확인하고,
      // 아직 없는 폰 기기는 이 확인에서 등록한다(S15P31E105-420). 목업 그룹런은 기기가 필요 없다.
      if (!isReady && /^\d+$/.test(groupRunId)) {
        const linked = await watchSession.getLinkedDevices();
        if (!linked) {
          toast(
            '워치를 연결해야 준비할 수 있어요. 설정 › 워치 연결에서 연결해 주세요',
          );
          return;
        }
      }
      const next = await groupRuns.setReady(groupRunId, !isReady);
      setRoom(next);
      if (isReady) {
        // 준비 해제: 서버가 취소한 세션 상태를 워치에 알리고 놓는다.
        leaveGroup();
      }
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
    <ThemeProvider tone="dark">
      <View style={styles.root}>
        <StatusBar barStyle="light-content" />
        {/* The app's mist behind white cards (S15P31E105-594 담당자 결정). */}
        <NightBackground />
        <SafeAreaView edges={['top']}>
          {/* 출발 준비 in the middle, then 출발까지 large under it (runway-group-screen-designs 06). */}
          <View style={styles.header}>
            <BackButton tone="dark" onPress={() => navigation.goBack()} />
            <View style={styles.headerMiddle}>
              <AppText accessibilityRole="header" style={styles.title}>
                출발 준비
              </AppText>
            </View>
            <View style={styles.headerSpace} />
          </View>
          {timeLeft ? (
            <AppText style={styles.countdownLabel}>
              {'출발까지 '}
              <AppText style={styles.countdown}>{timeLeft}</AppText>
            </AppText>
          ) : null}
        </SafeAreaView>
        <ScrollView contentContainerStyle={styles.content}>
          <PaceCard room={room} run={run} />
          {/* The watch and start notices as the 시안's card (runway-group-screen-designs 10-4): a red pink warning for
            the watch, a clock while the start is being confirmed. */}
          {watchProblem ? (
            <Raised tone="night" style={styles.notice}>
              <Icon name="alert" color={groupTone.danger} size={20} />
              <AppText
                accessibilityLiveRegion="polite"
                style={styles.noticeText}
              >
                {watchProblem}
              </AppText>
            </Raised>
          ) : null}
          {watchError ? (
            <Raised tone="night" style={styles.notice}>
              <Icon name="alert" color={groupTone.danger} size={20} />
              <AppText
                accessibilityLiveRegion="polite"
                style={styles.noticeText}
              >
                {watchError}
              </AppText>
            </Raised>
          ) : null}
          {startRequested ? (
            <Raised tone="night" style={styles.notice}>
              <Icon name="clock" color={groupTone.accent} size={20} />
              <AppText
                accessibilityLiveRegion="polite"
                style={styles.noticeText}
              >
                출발 요청이 승인됐어요. 기기의 실제 시작을 확인하고 있어요.
              </AppText>
            </Raised>
          ) : null}
          {/* 6.5-MemberList (runway-group-screen-designs 06): one card, the counts on top with the ready count on the
            right, then a row a member with lines between. */}
          <Raised tone="night" style={styles.card}>
            <View style={styles.membersHead}>
              <Icon name="users" color={groupTone.text} size={18} />
              <NumText
                style={[styles.membersTitle, styles.flex]}
                text={`참가 신청 ${room.appliedCount}명 · 대기방 ${room.participantCount}명`}
              />
              <NumText
                style={styles.readyCount}
                text={`${room.readyCount}명 준비 완료`}
              />
            </View>
            <View>
              {room.participants.map((member, index) => (
                <View
                  key={member.userId}
                  style={[styles.member, index > 0 && styles.memberLine]}
                >
                  <Initial name={member.nickname} index={index} size={36} />
                  <View style={styles.flex}>
                    <View style={styles.nameLine}>
                      <AppText style={styles.memberName}>
                        {member.nickname}
                      </AppText>
                      {member.isHost ? (
                        <Icon name="crown" color={groupTone.sub} size={13} />
                      ) : null}
                      {member.isMe ? (
                        <View style={styles.meBadge}>
                          <AppText style={styles.meText}>나</AppText>
                        </View>
                      ) : null}
                    </View>
                    {member.isMe && member.readinessScore !== null ? (
                      <NumText
                        style={styles.readiness}
                        text={`준비도 ${member.readinessScore}`}
                      />
                    ) : null}
                  </View>
                  {/* Ready in the 시안's mint outline, waiting in a grey one. */}
                  {member.readyStatus === 'READY' ? (
                    <View style={[styles.chip, styles.chipReady]}>
                      <AppText style={styles.statusReady}>준비 완료</AppText>
                    </View>
                  ) : (
                    <View style={[styles.chip, styles.chipWaiting]}>
                      <AppText style={styles.statusWaiting}>대기 중</AppText>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </Raised>
          {/* The leader's 그룹런 시작 under the members, the note under it (runway-group-screen-designs 06). */}
          {run.isHost && !startRequested ? (
            <GroupCta
              navy
              title={starting ? '출발 요청 중…' : '그룹런 시작'}
              icon="check"
              onPress={requestStart}
            />
          ) : null}
          <View style={styles.noteRow}>
            <Icon name="alert" color={groupTone.sub} size={14} />
            <AppText style={styles.noteText}>
              그룹장이 출발을 요청하면 준비된 기기의 실제 시작을 확인해요
            </AppText>
          </View>
        </ScrollView>
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <BottomFade />
          <View style={styles.flex}>
            {isReady ? (
              <ReadyCancel onPress={toggleReady} />
            ) : (
              <GroupCta
                navy
                title="준비 완료"
                icon="check"
                onPress={toggleReady}
              />
            )}
          </View>
          {/* 6.5-ReadyBar: the music button is a flat navy circle beside it (S15P31E105-563). */}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="음악"
            onPress={() => navigateTo(navigation, 'MusicCard')}
          >
            <View style={styles.music}>
              {source && source !== 'NONE' ? (
                <ServiceMark service={source} size={30} />
              ) : (
                <Icon name="music" color={groupLook.onDark} size={20} />
              )}
            </View>
          </PressableScale>
        </SafeAreaView>
        {/* 출발 확인 (runway-group-screen-designs 10-3): the navy page, the title, the count in a mint ring. */}
        <Modal visible={count !== null} transparent animationType="fade">
          <View style={styles.overlay}>
            <AppText style={styles.overlayTitle}>그룹장이 출발했어요</AppText>
            <View style={styles.countRing}>
              <AppText style={styles.count}>{count ?? ''}</AppText>
            </View>
            <AppText style={styles.overlaySub}>내 기록이 함께 시작돼요</AppText>
          </View>
        </Modal>
      </View>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: spacing.xxxl },
  header: {
    minHeight: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.screen,
    paddingVertical: 6,
  },
  headerMiddle: { flex: 1, alignItems: 'center' },
  headerSpace: { width: 44 },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 19,
    lineHeight: 26,
    color: groupTone.text,
  },
  countdownLabel: {
    textAlign: 'center',
    paddingBottom: 4,
    fontFamily: fontFamily.bold,
    fontSize: 20,
    lineHeight: 46,
    color: groupTone.text,
  },
  // The time left large in Rajdhani, like the pace.
  countdown: {
    fontFamily: fontFamily.rajdhaniBold,
    fontSize: 40,
    color: groupTone.text,
  },
  content: {
    paddingTop: spacing.md,
    paddingHorizontal: 16,
    paddingBottom: spacing.xxxl * 4,
    gap: 12,
  },
  card: { borderRadius: 20, padding: 18, gap: 12 },
  cardTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 23,
    color: groupTone.text,
  },
  paceHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  center: { textAlign: 'center' },
  paceFoot: {
    gap: 4,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: groupTone.line,
  },
  paceLine: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 21,
    color: groupTone.text,
  },
  noteText: {
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 17,
    color: groupTone.sub,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // The shared pace large in Rajdhani (S15P31E105-594 담당자 결정).
  pace: {
    fontFamily: fontFamily.rajdhaniBold,
    fontSize: 64,
    lineHeight: 70,
    color: groupTone.text,
  },
  paceUnit: {
    fontFamily: fontFamily.rajdhaniSemiBold,
    fontSize: 28,
    color: groupTone.text,
  },
  membersHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  membersTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.text,
  },
  readyCount: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: groupTone.text,
  },
  // 6.5-MemberList rows.
  member: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  memberLine: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: groupTone.line,
  },
  chip: {
    height: 30,
    minWidth: 76,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipReady: { borderWidth: 1.5, borderColor: groupTone.accent },
  chipWaiting: { borderWidth: 1, borderColor: groupTone.muted },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  memberName: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.text,
  },
  // 나 as a small mint chip (민트는 작은 것에만, 담당자 요청).
  meBadge: {
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 9,
    justifyContent: 'center',
    backgroundColor: groupLook.mint,
  },
  meText: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    lineHeight: 14,
    color: groupLook.onMint,
  },
  readiness: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: groupTone.sub,
  },
  statusReady: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: groupTone.accent,
  },
  statusWaiting: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 17,
    color: groupTone.sub,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
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
    backgroundColor: groupTone.quiet,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 18,
  },
  noticeText: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 14.5,
    lineHeight: 21,
    color: groupTone.text,
  },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    backgroundColor: 'rgba(2,5,14,0.94)',
  },
  overlayTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 24,
    lineHeight: 32,
    color: groupTone.text,
  },
  overlaySub: {
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 21,
    color: groupTone.sub,
  },
  countRing: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 5,
    borderColor: groupTone.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    ...typography.metricHero,
    fontFamily: fontFamily.rajdhaniBold,
    fontSize: 110,
    lineHeight: 120,
    color: groupTone.text,
  },
});
