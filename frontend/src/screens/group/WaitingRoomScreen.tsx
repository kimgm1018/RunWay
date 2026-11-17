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
import Svg, { Text as SvgText } from 'react-native-svg';
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
  isStaleGroupRun,
  type CoursePlan,
  type GroupRunDetail,
  type GroupRecordingDevice,
  type Repositories,
  type WaitingRoom,
} from '../../data';
import { formatPace } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import { fontFamily, size, spacing, ThemeProvider } from '../../theme';
import { ServiceMark, useMusicSource } from '../run/parts';
import {
  useRunActions,
  useRunControlState,
  type RunConfig,
} from '../run/RunSession';
import { groupTone, NightBackground, NumText } from './look';
import { MissingTarget } from './MissingTarget';
import { BottomFade, Initial } from './parts';
import { BackButton } from '../../components/BackButton';
import {
  ColorBar,
  Figure,
  memberColors,
  stand,
  StandButton,
  StandHeader,
  StandTag,
  standType,
} from './stand';
import { GroupStartStrategy } from './GroupPaceCard';
import {
  defaultRecordingDevice,
  groupStartIssue,
  joinErrorMessage,
  readyErrorMessage,
  recordingDeviceOfMode,
} from './recordingDevice';
import { KmPaceToggle, visibleKmPaces } from '../run/KmPacePills';
import { RunMap } from '../../components/RunMap';
import { CourseMapZoom } from './CourseMapZoom';

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

// 추천 공동 페이스 (그룹런 시안, S15P31E105-673): the clock, the title and its basis on the left with the shared pace
// big under them, then past a line the run's own target pace and, when the server gives it, the members'
// comfortable range.
// 참가자 편한 범위: one pace when both ends read the same.
export function rangeText(range: [number, number]) {
  const fast = formatPace(range[0]);
  const slow = formatPace(range[1]);
  return fast === slow ? fast : `${fast} – ${slow}`;
}

function PaceCard({ room, run }: { room: WaitingRoom; run: GroupRunDetail }) {
  const pace = room.recommendedPaceSecPerKm;
  const range = room.comfortRange;
  // S15P31E105-739: the start plan's km paces, on a press as on the detail card; not while recalculating.
  const km = run.pace && !run.pace.calculating ? run.pace.kmPaces : [];
  return (
    <View>
      <View style={styles.paceRow}>
        <View style={styles.paceMain}>
          <View style={styles.paceHead}>
            <Icon name="clock" color={stand.mint} size={16} />
            <AppText style={standType.label}>추천 공동 페이스</AppText>
          </View>
          <AppText style={styles.noteText}>참가자 기록 기준</AppText>
          {pace === null ? (
            <AppText style={[styles.noteText, styles.paceMissing]}>
              추천 정보 부족
            </AppText>
          ) : (
            <Figure value={formatPace(pace)} unit="/km" size={50} />
          )}
        </View>
        <View style={styles.paceSide}>
          <View>
            <AppText style={standType.smallLabel}>목표 페이스</AppText>
            <NumText
              style={styles.paceLine}
              text={`${formatPace(run.goalPaceSecPerKm)} /km`}
            />
          </View>
          {/* 편한 범위는 실서버가 제공하지 않으므로 임의의 ±20초 범위를 만들지 않는다. */}
          {range ? (
            <View>
              <AppText style={standType.smallLabel}>참가자 편한 범위</AppText>
              <NumText style={styles.paceLine} text={rangeText(range)} />
            </View>
          ) : null}
        </View>
      </View>
      {km.length ? (
        <KmPaceToggle
          paces={km}
          distanceM={run.pace?.kmDistanceM ?? 0}
          color={stand.mint}
          map={
            // The course with each km's pace on it, as on the solo course start (S15P31E105-748): a small view
            // only, no bubble or meeting pin so the 1 km pill stays clear. A run without a course shows the pills.
            run.route?.length ? (
              <CourseMapZoom
                route={run.route}
                paces={km}
                distanceM={run.pace?.kmDistanceM ?? 0}
                strategy={run.pace?.startStrategy}
                style={styles.kmMap}
              >
                <RunMap
                  route={run.route}
                  paceLabels={visibleKmPaces(km, run.pace?.kmDistanceM ?? 0).map(formatPace)}
                  pacePlanDistanceM={run.pace?.kmDistanceM}
                  fitTo={run.route}
                  interactive={false}
                  poles={false}
                  compact
                  mintLine="thin"
                  style={StyleSheet.absoluteFill}
                />
              </CourseMapZoom>
            ) : (
              <GroupStartStrategy strategy={run.pace?.startStrategy} />
            )
          }
        />
      ) : null}
    </View>
  );
}

// 기록 기기 선택(S15P31E105-889): 워치 또는 폰. 고른 쪽이 민트로 채워진다.
function DeviceChoice({
  value,
  disabled,
  onChange,
}: {
  value: GroupRecordingDevice;
  disabled: boolean;
  onChange: (next: GroupRecordingDevice) => void;
}) {
  const options: { key: GroupRecordingDevice; label: string }[] = [
    { key: 'WATCH', label: '워치로 기록' },
    { key: 'PHONE', label: '폰으로 기록' },
  ];
  return (
    <View style={styles.deviceRow} accessibilityRole="radiogroup">
      {options.map(option => {
        const selected = option.key === value;
        return (
          <PressableScale
            key={option.key}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={option.label}
            disabled={disabled}
            style={styles.flex}
            onPress={() => onChange(option.key)}
          >
            <View
              style={[styles.deviceOption, selected && styles.deviceSelected]}
            >
              <AppText
                style={[styles.deviceText, selected && styles.deviceTextOn]}
              >
                {option.label}
              </AppText>
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}

// After 준비 완료 the button turns into an outlined 준비 취소.
function ReadyCancel({ onPress }: { onPress: () => void }) {
  return <StandButton title="준비 취소" tone="outline" onPress={onPress} />;
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
  const { start, joinGroup, leaveGroup, recheck } = useRunActions();
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
  // 준비 완료(G16) 실패 사유. 다음 성공까지 남긴다(S15P31E105-889 ②).
  const [readyError, setReadyError] = useState<string | null>(null);
  // 기록 기기(S15P31E105-889). 처음에는 워치 등록·연결로 정하고(미연결이면 폰), 사용자가 바꿀 수 있다.
  const [device, setDevice] = useState<GroupRecordingDevice | null>(null);
  const deviceTouched = useRef(false);
  const [joining, setJoining] = useState(false);
  // 그룹 상태(S15P31E105-889). 처음엔 상세(G03) 값, 이후 대기방 조회마다 갱신해 출발(RUNNING)을 알아챈다.
  const [polledStatus, setPolledStatus] = useState<string | null>(null);
  const joinBusy = useRef(false);
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
  // 이미 준비된 세션이 있으면 그 세션의 기록 모드가 선택을 이긴다(다시 들어온 대기방).
  const sessionDevice =
    control?.sessionId === mySessionId && mySessionId
      ? recordingDeviceOfMode(control?.recordingMode)
      : null;
  const resolveDevice = useCallback(async () => {
    const linked = await watchSession.getLinkedDevices().catch(() => null);
    const connected = watchSession.isWatchConnected
      ? await watchSession.isWatchConnected().catch(() => false)
      : null;
    return defaultRecordingDevice(!!linked, connected);
  }, [watchSession]);
  useEffect(() => {
    let alive = true;
    resolveDevice().then(found => {
      if (alive && !deviceTouched.current) {
        setDevice(found);
      }
    });
    return () => {
      alive = false;
    };
  }, [resolveDevice]);
  const watchProblem =
    sessionDevice !== 'PHONE' && control?.sessionId === mySessionId && mySessionId
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
          setPolledStatus,
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
  // Everyone's colour in the run's order, so 6.4 and 6.5 agree.
  const colors = memberColors([...run.participants, ...room.participants]);
  const isReady = me?.readyStatus === 'READY';
  const groupStatus = polledStatus ?? run.status;
  const chosen: GroupRecordingDevice =
    (isReady ? sessionDevice : null) ?? device ?? 'WATCH';
  // 출발 뒤 내 기록이 시작되지 않은 상태(S15P31E105-889 2단계). 워치가 START에 답하지 않았거나 거절했으면 폰으로 시작하고,
  // 이미 출발한 그룹런에 들어왔으면(내 세션 없음·READY) 지금 합류한다. 둘 다 G18(PHONE)으로 같은 그룹 세션에 합류한다.
  // 늦은 합류는 폰으로만 한다: 새 워치 세션은 워치 준비(SESSION_PREPARE) 없이 START를 받아 거절되기 때문이다.
  // 기기가 결과를 냈는데 저장만 확인하지 못했거나(retry) 위치 권한이 없으면(location) 같은 명령을 다시 확인만 한다.
  const mine =
    control?.sessionId === mySessionId && mySessionId ? control : null;
  const issue = groupStartIssue(
    mine?.status,
    mine?.problem,
    mine?.recordingMode,
  );
  const switchToPhone = issue === 'watchFailed' || issue === 'rejected';
  const retryOnly = issue === 'retry' || issue === 'location';
  const myStarted =
    mine?.status === 'RUNNING' || mine?.status === 'PAUSED';
  const myStarting = mine?.pending?.action === 'START' && !mine.problem;
  const lateJoin =
    (groupStatus === 'RUNNING' || issue !== null) &&
    !myStarted &&
    !myStarting &&
    !!groupRuns.joinNow;
  const joinMessage =
    issue === 'watchFailed'
      ? '워치로 출발하지 못했어요. 다시 시도하거나 폰으로 시작하면 같은 그룹런에 합류해요.'
      : issue === 'rejected'
      ? '기기가 출발을 거절했어요. 폰으로 시작하면 같은 그룹런에 합류해요.'
      : issue === 'retry'
      ? '출발 결과를 저장하지 못했어요. 다시 시도해 주세요.'
      : issue === 'location'
      ? '폰으로 기록하려면 위치 권한이 필요해요. 권한을 허용한 뒤 다시 시도해 주세요.'
      : '그룹런이 이미 출발했어요. 지금 합류하면 폰으로 내 기록이 바로 시작돼요.';
  const joinNow = async (target: GroupRecordingDevice) => {
    if (joinBusy.current || !groupRuns.joinNow || !ensureRunLogin()) {
      return;
    }
    joinBusy.current = true;
    setJoining(true);
    try {
      if (!(await ensureDevice(target))) {
        return;
      }
      const joined = await groupRuns.joinNow(groupRunId, target);
      deviceTouched.current = true;
      setDevice(target);
      setReadyError(null);
      // 서버가 새 세션을 만들었을 수 있다. 내 세션 ID가 바뀌면 위 효과가 새 세션에 붙고, 승인된 START를 기기가 실행한다.
      if (joined.sessionId) {
        setRoom(current =>
          current ? { ...current, mySessionId: joined.sessionId } : current,
        );
      }
    } catch (error) {
      const message = joinErrorMessage(error);
      setReadyError(message);
      toast(message);
    } finally {
      joinBusy.current = false;
      setJoining(false);
    }
  };
  // 준비할 기기가 서버에 등록돼 있게 한다. G16은 연결된 기기로 세션을 만든다(없으면 DEVICE_NOT_FOUND).
  // 워치는 연결 워치를 확인하면서 아직 없는 폰 기기를 등록하고(S15P31E105-420), 폰은 폰 기기만 등록한다(S15P31E105-889).
  // 목업 그룹런은 기기가 필요 없다.
  const ensureDevice = async (target: GroupRecordingDevice) => {
    if (!/^\d+$/.test(groupRunId)) {
      return true;
    }
    if (target === 'PHONE') {
      await watchSession.getPhoneDeviceId?.();
      return true;
    }
    const linked = await watchSession.getLinkedDevices();
    if (!linked) {
      const message =
        '워치가 등록되어 있지 않아요. 기록 기기를 폰으로 바꾸거나 설정 › 워치 연결에서 워치를 연결해 주세요.';
      setReadyError(message);
      toast(message);
      return false;
    }
    return true;
  };
  const markReady = async (target: GroupRecordingDevice) => {
    if (!(await ensureDevice(target))) {
      return;
    }
    const next = await groupRuns.setReady(groupRunId, true, target);
    setRoom(next);
    setReadyError(null);
  };
  // A start long past that nobody began takes no new 준비 완료; one already pressed can still be taken back
  // (S15P31E105-891).
  const pastRun = isStaleGroupRun(run, now.getTime());
  const toggleReady = async () => {
    if (
      readyBusy.current ||
      startRequested ||
      (!isReady && (pastRun || !ensureRunLogin()))
    )
      return;
    readyBusy.current = true;
    try {
      if (isReady) {
        const next = await groupRuns.setReady(groupRunId, false);
        setRoom(next);
        setReadyError(null);
        // 준비 해제: 서버가 취소한 세션 상태를 워치에 알리고 놓는다.
        leaveGroup();
      } else {
        // 기본 기기를 아직 정하지 못했으면(화면을 막 열었을 때) 지금 정해서 준비한다.
        const target =
          device ?? (/^\d+$/.test(groupRunId) ? await resolveDevice() : chosen);
        setDevice(target);
        await markReady(target);
      }
    } catch (error) {
      const message = readyErrorMessage(error);
      setReadyError(message);
      toast(message);
    } finally {
      readyBusy.current = false;
    }
  };
  // 기록 기기를 바꾼다. 이미 준비했으면 준비를 풀고 새 기기로 다시 준비한다(서버는 준비된 세션의 기기를 바꾸지 않는다).
  const changeDevice = async (next: GroupRecordingDevice) => {
    if (readyBusy.current || startRequested) {
      return;
    }
    deviceTouched.current = true;
    setDevice(next);
    // 출발한 그룹런에서는 준비(G16)를 바꾸지 않는다. 고른 기기로 지금 합류(G18)한다.
    if (!isReady || next === chosen || lateJoin) {
      setReadyError(null);
      return;
    }
    if (!ensureRunLogin()) {
      return;
    }
    readyBusy.current = true;
    try {
      const released = await groupRuns.setReady(groupRunId, false);
      setRoom(released);
      leaveGroup();
      await markReady(next);
    } catch (error) {
      const message = readyErrorMessage(error);
      setReadyError(message);
      toast(message);
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
        <SafeAreaView edges={['top']} style={styles.top}>
          <StandHeader title="출발 준비" onBack={() => navigation.goBack()} />
          {/* 출발까지 in mint on the left, the time left large on the right, over a heavier line. */}
          {timeLeft ? (
            <View style={styles.countdownRow}>
              <AppText style={[standType.label, styles.flex]}>출발까지</AppText>
              <AppText style={styles.countdown}>{timeLeft}</AppText>
            </View>
          ) : null}
        </SafeAreaView>
        <ScrollView contentContainerStyle={styles.content}>
          <PaceCard room={room} run={run} />
          {/* The watch and start notices as the 시안's card (runway-group-screen-designs 10-4): a red pink warning for
            the watch, a clock while the start is being confirmed. */}
          {watchProblem ? (
            <View style={styles.notice}>
              <Icon name="alert" color={stand.danger} size={20} />
              <AppText
                accessibilityLiveRegion="polite"
                style={styles.noticeText}
              >
                {watchProblem}
              </AppText>
            </View>
          ) : null}
          {lateJoin ? (
            <View style={styles.notice}>
              <Icon name="alert" color={stand.danger} size={20} />
              <View style={styles.flex}>
                <AppText
                  accessibilityLiveRegion="polite"
                  style={styles.noticeText}
                >
                  {joinMessage}
                </AppText>
                {issue === 'watchFailed' ? (
                  <StandButton
                    title="다시 시도"
                    tone="outline"
                    style={styles.retry}
                    disabled={joining}
                    onPress={recheck}
                  />
                ) : null}
              </View>
            </View>
          ) : null}
          {readyError ? (
            <View style={styles.notice}>
              <Icon name="alert" color={stand.danger} size={20} />
              <AppText
                accessibilityLiveRegion="polite"
                style={styles.noticeText}
              >
                {readyError}
              </AppText>
            </View>
          ) : null}
          {watchError ? (
            <View style={styles.notice}>
              <Icon name="alert" color={stand.danger} size={20} />
              <AppText
                accessibilityLiveRegion="polite"
                style={styles.noticeText}
              >
                {watchError}
              </AppText>
            </View>
          ) : null}
          {startRequested ? (
            <View style={styles.notice}>
              <Icon name="clock" color={stand.mint} size={20} />
              <AppText
                accessibilityLiveRegion="polite"
                style={styles.noticeText}
              >
                출발 요청이 승인됐어요. 기기의 실제 시작을 확인하고 있어요.
              </AppText>
            </View>
          ) : null}
          {/* 6.5-MemberList (그룹런 시안): the counts with the ready count in mint on the right over a heavier line, then
            a row a member: their colour dot and bar, the name, and 준비 완료 in mint or 대기 중 in grey. My row is lit in
            mint. */}
          <View style={styles.membersHead}>
            <Icon name="users" color={stand.text} size={17} />
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
            {room.participants.map(member => {
              const color = colors.get(member.userId) ?? stand.sub;
              return (
                <View
                  key={member.userId}
                  style={[styles.member, member.isMe && styles.memberMe]}
                >
                  <View style={styles.dotCell}>
                    <Initial
                      name={member.nickname}
                      color={color}
                      size={32}
                      photo={member.profileImageUrl}
                    />
                  </View>
                  <ColorBar color={color} style={styles.memberBar} />
                  <View style={styles.flex}>
                    <View style={styles.nameLine}>
                      <AppText style={standType.name}>
                        {member.nickname}
                      </AppText>
                      {member.isHost ? (
                        <Icon name="crown" color={stand.sub} size={14} />
                      ) : null}
                      {member.isMe ? (
                        <StandTag label="나" style={styles.me} />
                      ) : null}
                    </View>
                    {member.isMe && member.readinessScore !== null ? (
                      <NumText
                        style={styles.readiness}
                        text={`준비도 ${member.readinessScore}`}
                      />
                    ) : null}
                  </View>
                  {member.readyStatus === 'READY' ? (
                    <View style={styles.ready}>
                      <Icon name="check" color={stand.mint} size={14} />
                      <AppText style={styles.statusReady}>준비 완료</AppText>
                    </View>
                  ) : (
                    <AppText style={styles.statusWaiting}>대기 중</AppText>
                  )}
                </View>
              );
            })}
          </View>
          {/* 기록 기기(S15P31E105-889): 워치가 끊겨도 폰으로 함께 뛸 수 있다. 출발 요청 뒤에는 바꾸지 않는다. */}
          <View style={styles.deviceHead}>
            <AppText style={styles.membersTitle}>기록 기기</AppText>
          </View>
          <DeviceChoice
            value={chosen}
            disabled={startRequested}
            onChange={changeDevice}
          />
          {chosen === 'PHONE' ? (
            <AppText style={styles.deviceNote}>
              워치 없이 폰 GPS로 기록해요. 순위·간격·페이스 안내는 그대로 받아요.
            </AppText>
          ) : null}
          {/* The leader's 그룹런 시작 under the members, the note under it. */}
          {run.isHost && !startRequested && !lateJoin ? (
            <StandButton
              title={starting ? '출발 요청 중…' : '그룹런 시작'}
              icon="check"
              style={styles.start}
              onPress={requestStart}
            />
          ) : null}
          <View style={styles.noteRow}>
            <Icon name="alert" color={stand.sub} size={14} />
            <AppText style={styles.noteText}>
              그룹장이 출발을 요청하면 준비된 기기의 실제 시작을 확인해요
            </AppText>
          </View>
        </ScrollView>
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <BottomFade />
          <View style={styles.flex}>
            {lateJoin ? (
              <StandButton
                title={
                  joining
                    ? '합류 중…'
                    : retryOnly
                    ? '다시 시도'
                    : switchToPhone
                    ? '폰으로 시작'
                    : '지금 합류'
                }
                icon="check"
                disabled={joining}
                onPress={() => (retryOnly ? recheck() : joinNow('PHONE'))}
              />
            ) : isReady ? (
              <ReadyCancel onPress={toggleReady} />
            ) : pastRun ? (
              <StandButton
                title="지난 그룹런이에요"
                disabled
                onPress={() => undefined}
              />
            ) : (
              <StandButton
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
                <Icon name="music" color={stand.text} size={20} />
              )}
            </View>
          </PressableScale>
        </SafeAreaView>
        {/* 출발 확인 (그룹런 시안): the page dimmed, the title and the count as a big mint outlined figure. */}
        <Modal visible={count !== null} transparent animationType="fade">
          <View style={styles.overlay}>
            <AppText style={styles.overlayTitle}>그룹장이 출발했어요</AppText>
            <Svg
              width={240}
              height={250}
              accessibilityLabel={count === null ? undefined : `${count}`}
            >
              <SvgText
                x={120}
                y={212}
                textAnchor="middle"
                fontFamily={fontFamily.resultBlack}
                fontSize={230}
                fill="none"
                stroke={stand.mint}
                strokeWidth={3}
              >
                {count === null ? '' : String(count)}
              </SvgText>
            </Svg>
            <AppText style={styles.overlaySub}>내 기록이 함께 시작돼요</AppText>
          </View>
        </Modal>
      </View>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  kmMap: {
    height: 180,
    marginTop: 8,
    borderRadius: 14,
    overflow: 'hidden',
  },
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
  top: { paddingHorizontal: 19 },
  // 출발까지 and the time left over a heavier line (그룹런 시안).
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    height: 52,
    marginTop: 6,
    borderBottomWidth: 1,
    borderBottomColor: stand.rule,
  },
  countdown: {
    fontFamily: fontFamily.resultBlack,
    fontSize: 38,
    lineHeight: 50,
    letterSpacing: -1,
    color: stand.text,
  },
  content: {
    paddingTop: 14,
    paddingHorizontal: 19,
    paddingBottom: spacing.xxxl * 4,
  },
  // The shared pace on the left, the target and the range past a line on the right.
  paceRow: { flexDirection: 'row', alignItems: 'stretch' },
  paceMain: { width: 204 },
  paceHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  paceMissing: { marginTop: 14 },
  paceSide: {
    flex: 1,
    justifyContent: 'center',
    gap: 10,
    marginTop: 2,
    marginBottom: 6,
    paddingLeft: 12,
    borderLeftWidth: 1,
    borderLeftColor: stand.rule,
  },
  paceLine: {
    fontFamily: fontFamily.numberBold,
    fontSize: 16,
    lineHeight: 22,
    color: stand.text,
  },
  noteText: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    color: stand.sub,
  },
  membersHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: stand.rule,
  },
  membersTitle: {
    fontFamily: fontFamily.black,
    fontSize: 15,
    lineHeight: 20,
    color: stand.text,
  },
  readyCount: {
    fontFamily: fontFamily.black,
    fontSize: 13,
    lineHeight: 18,
    color: stand.mint,
  },
  // 6.5-MemberList rows: 54 high between thin lines.
  member: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: stand.line,
  },
  // My row lit in mint, reaching 10 past the page's sides.
  memberMe: {
    marginHorizontal: -10,
    paddingHorizontal: 10,
    backgroundColor: stand.meFill,
    borderBottomColor: stand.meLine,
  },
  dotCell: { width: 52 },
  memberBar: { marginLeft: 6, marginRight: 12 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  me: { alignSelf: 'center', height: 18, paddingHorizontal: 7 },
  readiness: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: stand.sub,
  },
  ready: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusReady: {
    fontFamily: fontFamily.black,
    fontSize: 14,
    lineHeight: 19,
    color: stand.mint,
  },
  statusWaiting: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 19,
    color: stand.muted,
  },
  start: { marginTop: 18 },
  retry: { marginTop: 10 },
  deviceHead: {
    marginTop: 18,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: stand.rule,
  },
  deviceRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  deviceOption: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: stand.glassLine,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: stand.glass,
  },
  deviceSelected: { borderColor: stand.mint, backgroundColor: stand.meFill },
  deviceText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 19,
    color: stand.sub,
  },
  deviceTextOn: { fontFamily: fontFamily.black, color: stand.mint },
  deviceNote: {
    marginTop: 8,
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    color: stand.sub,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 19,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  // A 50 glass circle beside the main button with the music service's mark.
  music: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: stand.glassLine,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: stand.glass,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    padding: 14,
    borderRadius: 10,
    backgroundColor: stand.field,
  },
  noticeText: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 20,
    color: stand.text,
  },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(2,5,14,0.92)',
  },
  overlayTitle: {
    fontFamily: fontFamily.black,
    fontSize: 24,
    lineHeight: 32,
    color: stand.text,
  },
  overlaySub: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
    color: stand.sub,
  },
});
