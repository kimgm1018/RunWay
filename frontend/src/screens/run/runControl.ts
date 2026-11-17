import { DataError, errorCode, type DataErrorCode } from '../../data/errors';
import { createBatchRelay } from '../../watch/batchRelay';
import { createLiveMetrics, type LiveMetrics } from '../../watch/liveMetrics';
import { createPhoneRecorder, type PhoneRecorder } from '../../watch/phoneRecorder';
import { gpsItem } from '../../watch/phoneBatch';
import { createCoachingAnnouncer, type CoachingVoiceOut } from './coachingAnnouncer';
import { runClockOf, type RunClock } from './runClock';
import type {
  BpmApproval,
  CoachingGuide,
  CommandApproval,
  ControlAction,
  LinkedDevices,
  PhoneLocation,
  RecordComparison,
  Repositories,
  RunningSessionView,
  SessionGoalDraft,
  SessionSnapshot,
  SessionStatus,
  WatchResultSummary,
  WatchSessionEvent,
} from '../../data/types';

// 그룹 출발·종료 중계(S15P31E105-420): 그룹런 참가 세션도 같은 경로를 쓴다. G16이 만든 READY 세션에 joinGroup으로 붙어
// 워치를 준비시키고, 서버가 직접 승인한 명령(G09 START, G12 END)을 S10 스냅샷에서 받아 워치에 전달한 뒤 실제 결과를 보고한다.
// 개인 러닝(자유·코스)의 세션 제어. 서버 승인(REQUEST) → 워치 실행 → 실제 결과 저장(RESULT) 순서로만 상태를 바꾼다.
// 승인 응답이나 워치 수신 확인만으로 시작·일시정지·종료를 확정하지 않는다(sessions.md 세션 제어 공통 계약).

export type ControlProblem =
  | { kind: 'watchRequired' }
  // A watch is paired with this phone but not registered to the account (W01), so the run would quietly be recorded
  // by the phone alone (S15P31E105-784). Said once; starting again goes on with the phone.
  | { kind: 'watchUnregistered' }
  | { kind: 'locationRequired' }
  | { kind: 'watchNotReady'; reasonCode: string | null }
  | { kind: 'rejected'; action: ControlAction; reasonCode: string | null }
  // 실행 미확인. 시작이면 "시작 여부를 확인할 수 없습니다".
  // afterResult: 기기는 결과를 돌려줬지만 서버 저장(S03/S06 RESULT) 응답을 받지 못했다(S15P31E105-889). 기기는 실행했을 수 있어
  // 다른 기기로 다시 시작하지 않고 같은 결과를 다시 보고한다.
  | { kind: 'unconfirmed'; action: ControlAction; afterResult?: boolean }
  // 종료 저장 미확인. NO_RESULT는 2분 안에 워치 종료 결과가 오지 않음, UPLOAD_PENDING은 워치가 종료했지만
  // 마지막 기록 저장 확인이 없음(409). 워치가 저장을 확인하고 같은 결과를 다시 보내면 자동으로 확정된다(S15P31E105-446).
  | { kind: 'saveUnconfirmed'; reason: 'NO_RESULT' | 'UPLOAD_PENDING' }
  // 폰 인계(S08 TAKE_OVER_PHONE, S15P31E105-464). held: 폰이 받은 워치 기록의 저장을 확인하지 못해 인계를 요청하지 않았다.
  // unconfirmed: 인계 응답과 S02 재조회를 모두 받지 못해 인계 여부를 모른다(워치 batch 수신은 계속 막는다).
  // failed: 서버가 인계를 거절했고 워치 기록이 유지된다.
  | { kind: 'takeoverHeld' }
  | { kind: 'takeoverUnconfirmed' }
  | { kind: 'takeoverFailed'; code: DataErrorCode }
  | { kind: 'error'; code: DataErrorCode };

export type RunControlState = {
  sessionId: string | null;
  status: SessionStatus | null;
  stateVersion: number;
  startedAt: string | null;
  endedAt: string | null;
  pending: { action: ControlAction | 'CANCEL' | 'TAKE_OVER'; commandId: string | null } | null;
  problem: ControlProblem | null;
  // 이 제어가 만든 세션이 아니라 이미 있던 본인 세션(앱 재실행·재로그인, S01 409)에 다시 붙었다.
  joined: boolean;
  // S02/S10 기록 비교(S15P31E105-422). 비교 기록을 고르지 않았으면 null.
  comparison: RecordComparison | null;
  // S02/S10의 현재 코칭(추천 페이스·목표 BPM)과 서버가 기록한 적용 BPM(S15P31E105-517 코칭 페이지). 워치 전달과 별개로 화면에 보인다.
  coaching: CoachingGuide | null;
  currentBpm: number | null;
  // 폰이 받은 워치 batch(또는 인계 후 폰 batch)에서 읽은 실측값(S15P31E105-517). 아직 받은 값이 없으면 null.
  live: LiveMetrics | null;
  // WATCH(워치 기록) / PHONE_FALLBACK(폰으로 기록 전환). 서버 값 그대로.
  recordingMode: 'WATCH' | 'PHONE_FALLBACK' | 'PHONE_ONLY' | null;
  // 워치 기록 중 워치 연결이 끊겼거나 워치 기록(batch)이 한동안 오지 않았다. 폰 인계를 안내한다.
  watchLost: boolean;
  // 폰 기록 중 폰 GPS를 받는지. 권한·GPS가 없으면 'off'이고 기록은 시간만 이어간다.
  phoneGps: 'on' | 'off' | null;
  // GPS 위치가 하나도 없을 때(실내 등) 지도에 점만 찍을 대략 위치(S15P31E105-549). 폰의 Wi-Fi·기지국 위치를 포함한
  // 현재 위치 한 번이며, 경로·거리·서버 업로드에는 쓰지 않는다. GPS 위치가 오면 더 쓰지 않는다.
  approxPosition: [number, number] | null;
  // 서버 기준 운동 시간의 기준점(S15P31E105-528). 서버가 운동시간을 주지 않으면 null이고 화면은 폰 시계로 센다.
  clock: RunClock | null;
  // 마지막으로 준비가 끝난(ready) 워치 준비의 remoteGps(S15P31E105-864): 워치 앱이 화면에 없을 때 폰에서 시작해도 워치가
  // GPS를 쓸 수 있는지. false면 시작 화면이 막지 않는 안내를 보인다. 모르면(이전 워치·준비 전) null. 서버에 보내지 않는다.
  watchRemoteGps: boolean | null;
  // 워치가 실제로 시작한 START 결과의 gps(S15P31E105-864). false면 워치가 GPS 없이 기록 중이다. 모르면 null.
  watchGps: boolean | null;
};

// 워치가 RunWay에 심박·활동 권한을 받지 못해 준비·시작하지 못했다(S15P31E105-864 워치↔폰 계약).
export const WATCH_PERMISSION_REQUIRED = 'WATCH_PERMISSION_REQUIRED';

// 시작 화면에서 '폰으로 시작'을 고를 수 있는지(S15P31E105-864). 워치가 등록돼 있지만 시작할 때 쓸 수 없었던 경우다:
// 준비 실패(시간 초과·연결 없음·권한 등 모든 사유)와 권한 부족으로 거절된 START. 미확인 시작은 결과를 모르므로 제외한다.
export function canStartWithPhone(problem: ControlProblem | null): boolean {
  if (!problem) {
    return false;
  }
  return (
    problem.kind === 'watchNotReady' ||
    (problem.kind === 'rejected' &&
      problem.action === 'START' &&
      problem.reasonCode === WATCH_PERMISSION_REQUIRED)
  );
}

// 폰 인계를 안내할지: 워치로 실제 시작한 RUNNING/PAUSED 세션에서 워치 단절·측정 끊김이 보이거나, 워치가 제어 결과를
// 돌려주지 않을 때(종료 저장 미확인 포함) 고를 수 있게 한다(sessions.md 폰으로 기록 제어 인계 호출 조건).
export function canTakeOver(state: RunControlState | null): boolean {
  if (
    !state ||
    state.recordingMode !== 'WATCH' ||
    !state.startedAt ||
    (state.status !== 'RUNNING' && state.status !== 'PAUSED') ||
    // 요청이 진행 중이면 기다린다. 미확인으로 멈춘 요청(문제 표시 중)은 진행 중이 아니다.
    (state.pending !== null && state.problem === null)
  ) {
    return false;
  }
  const problem = state.problem;
  return (
    state.watchLost ||
    problem?.kind === 'saveUnconfirmed' ||
    problem?.kind === 'takeoverHeld' ||
    problem?.kind === 'takeoverUnconfirmed' ||
    problem?.kind === 'takeoverFailed' ||
    (problem?.kind === 'unconfirmed' && problem.action !== 'START')
  );
}

export type RunControl = {
  getState: () => RunControlState;
  subscribe: (listener: (state: RunControlState) => void) => () => void;
  // 세션 생성·워치 준비 후 시작까지.
  start: (goal: SessionGoalDraft) => Promise<void>;
  // 세션 생성·워치 준비만 한다. 시작은 워치의 START_REQUEST나 start로 이어진다.
  // 시작 화면에서 목표가 정해지면 미리 부른다(S15P31E105-533). 같은 목표로 준비된 세션은 그대로 두고, 목표가 바뀌었거나
  // 준비가 오래됐으면 남은 READY 세션을 취소하고 새로 준비한다. 화면에 문제를 표시하지 않는다(시작할 때 다시 확인한다).
  prepare: (goal: SessionGoalDraft) => Promise<void>;
  // 시작을 요청하지 않은 채 시작 화면을 떠나면 미리 만든 READY 세션을 취소하고 워치에도 알린다(S15P31E105-533).
  // 시작 명령이 진행·미확인 중이거나 READY가 아니면 아무것도 하지 않는다.
  releasePrepared: () => Promise<void>;
  // 앱 재실행 뒤 기존 세션에 다시 붙는다. 수신함에 남은 워치 결과가 있으면 서버에 보고한다.
  attach: (sessionId: string) => Promise<void>;
  // 그룹런 대기방 준비 완료(G16)로 서버가 만든 READY 세션에 붙어 워치를 그룹 목표로 준비시킨다(S15P31E105-420).
  // 출발은 그룹장의 G09가 승인하며 여기서 START를 요청하지 않는다.
  joinGroup: (sessionId: string, goal: SessionGoalDraft, groupRunId: string) => Promise<void>;
  // 서버 상태(S02)를 다시 읽어 반영하고 워치에도 알린다. 준비 해제로 서버가 세션을 취소했을 때 쓴다.
  sync: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  finish: () => Promise<void>;
  cancel: () => Promise<void>;
  // 미확인 명령을 같은 commandId로 워치에 다시 보내 보관한 결과를 확인한다. 새 명령을 만들지 않는다.
  recheck: () => Promise<void>;
  // S08 ABORT_UNCONFIRMED_START.
  abortUnconfirmedStart: () => Promise<void>;
  // S08 TAKE_OVER_PHONE: 워치 batch 수신을 멈추고 받은 batch 저장을 확인한 뒤 기록·제어를 폰으로 넘긴다.
  takeOver: () => Promise<void>;
  // 워치 없이 폰으로 시작한다(S15P31E105-864, 개인 러닝만). 준비만 된 워치 세션(READY, 시작 명령 없음)은 취소하고
  // 폰 전용(PHONE_ONLY) 세션을 새로 만들어 시작한다. 폰 위치 권한·현재 위치가 있어야 한다. 이 선택은 제어기가 끝날 때까지 남는다.
  startWithPhone: (goal: SessionGoalDraft) => Promise<void>;
  dispose: () => void;
};

type Deps = {
  session: Repositories['session'];
  watch: Repositories['watchSession'];
  // 종료 뒤 분석이 READY일 때 H02 요약을 워치 결과 화면에 옮긴다(S15P31E105-663). 없으면 상태만 옮긴다.
  records?: Pick<Repositories['records'], 'getResultSummary'>;
  // 폰 인계 뒤 폰 GPS. 없으면 폰 기록은 시간만 이어간다.
  location?: PhoneLocation;
  // 폰 batch ID(UUID v4).
  newId?: () => string;
  // 폰이 실행한 명령의 실제 적용 시각(epoch ms).
  now?: () => number;
  timers?: {
    resultWaitMs?: number;
    endResultWaitMs?: number;
    retryDelaysMs?: number[];
    // COACHING_GUIDE를 보낸 뒤 COACHING_RESULT를 기다리는 시간(9.5 초기 ACK 10초, 최초 포함 3회).
    guideAckMs?: number;
    guideTries?: number;
    // 워치 단절 확인 주기와, 운동 중 워치 batch가 오지 않으면 측정 끊김으로 보는 시간.
    watchCheckMs?: number;
    watchQuietMs?: number;
    // 폰 기록(인계 후) batch 주기·종료 마무리 상한.
    phoneFlushMs?: number;
    phoneFinishWaitMs?: number;
    // 그룹 세션의 S02 조회 주기(S15P31E105-420). S10이 오지 않아도 서버가 승인한 출발·종료를 찾는다.
    groupPollMs?: number;
    // GPS 위치가 없을 때 대략 위치(지도 점)를 다시 묻는 주기(S15P31E105-549).
    approxEveryMs?: number;
    // 개인 러닝 중 S02 조회 주기. S10이 오지 않아도 서버 코칭 명령을 워치에 전달한다(S15P31E105-549).
    serverPollMs?: number;
    // 종료 뒤 분석 상태 조회 주기와 상한(S15P31E105-663). 상한 뒤에는 워치의 STATE_QUERY로만 답한다.
    analysisPollMs?: number;
    analysisMaxMs?: number;
    // S01 재시도 간격(S15P31E105-533). 서버는 AI 계획을 최대 40초 계산하므로 시간 초과(50초) 뒤 한 번만 다시 보낸다.
    createRetryDelaysMs?: number[];
    // 미리 만든 준비 세션을 시작에 다시 쓰는 최대 시간. 넘으면 취소하고 새로 만든다.
    preparedMaxAgeMs?: number;
  };
  // 코칭 음성 안내(S15P31E105-579). 없으면 읽지 않는다.
  voice?: CoachingVoiceOut;
};

type ResultEvent = Extract<WatchSessionEvent, { type: 'COMMAND_RESULT' }>;
type CoachingResultEvent = Extract<WatchSessionEvent, { type: 'COACHING_RESULT' }>;

const noop = () => undefined;

// The server sends a coaching only while it is valid (about 20 s, sessions.md coaching), and coaching comes much less
// often, so the 코칭 tab was empty most of the run. Within the same session the last one stays, as on the watch, and the
// tab marks it 지난 코칭 once expiresAt passes (S15P31E105-782). Another session starts with none.
export function lastCoaching(
  next: CoachingGuide | null | undefined,
  previous: CoachingGuide | null,
  sameSession: boolean,
): CoachingGuide | null {
  return next ?? (sameSession ? previous : null);
}

// 실기기 진단(S15P31E105-549): 제어 단계·명령 번호·오류 코드만 남긴다. 건강값·좌표·토큰은 남기지 않는다.
// 릴리스 번들에서도 logcat ReactNativeJS 태그로 보인다.
const diag = (line: string) => {
  console.info(`[RunWay] ${line}`);
};

const TERMINAL: SessionStatus[] = ['COMPLETED', 'CANCELLED', 'INTERRUPTED'];
// SERVER_END.reason(9.3): 그룹장이 그룹 전체를 끝냈다(G12).
const GROUP_END_REASON = 'GROUP_FORCE_FINISHED';
// 응답 없음(NETWORK_ERROR)·서버 장애(SERVER_ERROR, 5xx). 같은 요청으로만 재시도하며 서버는 같은 요청을 같은 결과로 답한다.
const RETRYABLE: DataErrorCode[] = ['NETWORK_ERROR', 'SERVER_ERROR'];
const RESYNC: DataErrorCode[] = ['STALE_STATE', 'CONTROL_DEVICE_CHANGED', 'INVALID_SESSION_STATE'];

const initialState: RunControlState = {
  sessionId: null,
  status: null,
  stateVersion: 0,
  startedAt: null,
  endedAt: null,
  pending: null,
  problem: null,
  joined: false,
  comparison: null,
  coaching: null,
  currentBpm: null,
  live: null,
  recordingMode: null,
  watchLost: false,
  phoneGps: null,
  approxPosition: null,
  clock: null,
  watchRemoteGps: null,
  watchGps: null,
};

const emptyGoal: SessionGoalDraft = {
  courseId: null,
  comparisonSessionId: null,
  targetDistanceM: null,
  targetDurationSec: null,
  targetPaceSecPerKm: null,
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const noLocation: PhoneLocation = {
  start: async () => false,
  stop: async () => undefined,
  subscribe: () => () => undefined,
  requestPermission: async () => false,
  current: async () => {
    throw new DataError('LOCATION_UNAVAILABLE', '현재 위치를 찾지 못했어요');
  },
};

type RandomSource = { getRandomValues: (array: Uint8Array) => Uint8Array };

// 폰 batch ID(UUID v4). react-native-get-random-values가 앱 시작 때 crypto.getRandomValues를 채운다.
/* eslint-disable no-bitwise */
const randomId = () => {
  const bytes = (globalThis as unknown as { crypto: RandomSource }).crypto.getRandomValues(
    new Uint8Array(16),
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
/* eslint-enable no-bitwise */

export function createRunControl({
  session,
  watch,
  records,
  location = noLocation,
  newId = randomId,
  now = () => Date.now(),
  timers,
  voice,
}: Deps): RunControl {
  const resultWaitMs = timers?.resultWaitMs ?? watch.timing?.resultWaitMs ?? 30_000;
  const endResultWaitMs = timers?.endResultWaitMs ?? watch.timing?.endResultWaitMs ?? 120_000;
  // 최초 포함 최대 3회, 추가 1초·2초 + jitter (watch-mobile-server-integration.md 9.5).
  const retryDelaysMs = timers?.retryDelaysMs ?? [0, 1000, 2000];
  const guideAckMs = timers?.guideAckMs ?? 10_000;
  const guideTries = timers?.guideTries ?? 3;
  const watchCheckMs = timers?.watchCheckMs ?? 10_000;
  const watchQuietMs = timers?.watchQuietMs ?? 30_000;
  const groupPollMs = timers?.groupPollMs ?? 3_000;
  // 개인 러닝 중 S02 조회 주기(S10 보완, S15P31E105-549).
  const serverPollMs = timers?.serverPollMs ?? 5_000;
  // 종료 뒤 분석이 끝날 때까지 S02를 5초마다 최대 3분 조회한다(S15P31E105-663).
  const analysisPollMs = timers?.analysisPollMs ?? 5_000;
  const analysisMaxMs = timers?.analysisMaxMs ?? 180_000;
  // GPS 위치가 없을 때 대략 위치를 다시 묻는 주기.
  const approxEveryMs = timers?.approxEveryMs ?? 15_000;
  const createRetryDelaysMs = timers?.createRetryDelaysMs ?? [0, 1000];
  const preparedMaxAgeMs = timers?.preparedMaxAgeMs ?? 600_000;

  let state = initialState;
  let devices: LinkedDevices | null = null;
  let controlDeviceId: string | null = null;
  let relayDeviceId: string | null = null;
  // 워치에 보낸 승인 명령. 재확인(recheck) 때 같은 명령을 다시 보낸다.
  let inflight: CommandApproval | null = null;
  // 이 세션을 만든 목표. 복구한 세션은 목표를 모르므로 null.
  let lastGoal: SessionGoalDraft | null = null;
  // 이 제어기가 세션을 만든 시각(now). 복구한 세션은 null(오래됨 판단을 하지 않는다).
  let createdAt: number | null = null;
  // 워치 준비와 서버 확인(S08 REPORT_PREPARED)이 끝난 세션·버전. 같은 버전이면 시작할 때 다시 준비하지 않는다.
  let preparedFor: { sessionId: string; stateVersion: number } | null = null;
  // 진행 중인 시작 요청. 시작을 두 번 눌러도 한 번만 실행한다.
  let starting: Promise<void> | null = null;
  // 진행 중인 시작을 기다리는 동안 마지막으로 누른 시작의 목표. 아직 실행 전이면 그 목표로 시작한다.
  let requestedGoal: SessionGoalDraft | null = null;
  // 시작 대기 측정(S15P31E105-533)의 기준 시각. 단계와 경과 ms만 남긴다.
  let flowStart: number | null = null;
  let busy: Promise<void> | null = null;
  // 다른 조작이 진행 중일 때 들어온 워치 요청. 진행 중인 조작이 끝나면 실행한다(마지막 요청만 남긴다).
  // dropped는 더 새 요청에 밀려 실행하지 않게 될 때 호출한다(워치가 응답 없이 기다리지 않게 알린다).
  let queued: { work: () => Promise<void>; dropped?: () => void } | null = null;
  let disposed = false;
  const listeners = new Set<(next: RunControlState) => void>();
  const waiters = new Map<string, (event: ResultEvent | null) => void>();
  // 기다리는 쪽이 없을 때 도착한 결과(앱이 없던 동안 쌓인 수신함, 시간 초과 뒤의 늦은 결과).
  const early = new Map<string, ResultEvent>();
  // 서버에 보고 중이거나 보고한 결과. 같은 결과를 두 번 받아도 한 번만 보고한다.
  const reported = new Set<string>();
  // ── 워치 BPM·서버 코칭 중계(S15P31E105-257). 코칭 값은 화면 상태(coaching·currentBpm)로도 보이지만, 중계 결과로 problem·pending은 바꾸지 않는다.
  // 워치에 보낸 SET_BPM 승인 명령. 시간 초과 뒤 늦게 온 결과도 보고한다.
  let bpmInflight: BpmApproval | null = null;
  // 코칭 음성 안내(S15P31E105-579): 워치가 적용한 코칭(폰 기록이면 새로 받은 코칭)을 읽는다. 결과 이벤트에는 페이스가 없어
  // S10/S02에서 본 코칭을 commandId로 기억해 둔다.
  const announcer = voice ? createCoachingAnnouncer(voice) : null;
  const knownGuides = new Map<string, CoachingGuide>();
  // 워치에 전달 중인 코칭 명령. 같은 명령은 결과를 기다리는 동안 다시 보내지 않고, 재연결 때만 다시 보낸다.
  let guideWait: { commandId: string; timer: ReturnType<typeof setTimeout> | null } | null = null;
  // 서버 저장을 확인한 코칭 결과(commandId → 저장 후 버전). 같은 결과를 다시 받으면 저장 확인만 다시 보낸다.
  const coachingSaved = new Map<string, number>();
  // 세션에 붙기 전에 도착한 코칭 결과(앱 재실행 뒤 수신함).
  const earlyCoaching = new Map<string, CoachingResultEvent>();
  // ── 그룹런 참가 세션(S15P31E105-420). 그룹이면 서버가 직접 승인한 START를 워치에 전달한다.
  let groupRunId: string | null = null;
  // S02 groupEndedAt. 있으면 그룹이 끝났고, 대기 중인 END는 서버의 그룹 종료 명령이다.
  let groupEndedAt: string | null = null;
  // 그룹 종료 END 명령(commandId → 그룹 종료 기준시각). 워치에는 SERVER_END로 보낸다.
  const serverEnds = new Map<string, string>();
  // 그룹 세션의 S02 주기 조회. S10은 중간 프록시 설정에 따라 도착하지 않을 수 있어(실기기 E2E) 같은 스냅샷 처리로 보완한다.
  let groupTimer: ReturnType<typeof setInterval> | null = null;
  let groupPolling = false;
  let stopEvents: (() => void) | null = null;
  let eventsFor: string | null = null;
  // ── 폰 인계 후 폰 기록(S15P31E105-464).
  let recorder: PhoneRecorder | null = null;
  // 기록기의 세션·폰 기기 ID. 둘 중 하나가 바뀌면 새 기록기를 만든다.
  let recorderFor: string | null = null;
  // 폰 위치를 5초 batch를 기다리지 않고 바로 화면에 반영하는 구독(S15P31E105-549). 표시 전용이며 업로드는 기록기 batch만 한다.
  let fixView: (() => void) | null = null;
  const stopFixView = () => {
    fixView?.();
    fixView = null;
  };
  // 인계 뒤 러닝 서비스 위치 유형·GPS를 다시 켠 세션.
  let phoneServiceFor: string | null = null;
  // 폰이 실행한 제어 명령(commandId → 실제 적용 시각·종료 저장 확인). 같은 명령을 다시 실행하지 않는다.
  const phoneDone = new Map<string, { appliedAt: string; uploadComplete: boolean }>();
  // ── GPS 위치가 없을 때의 대략 위치 조회 주기.
  let approxTimer: ReturnType<typeof setInterval> | null = null;
  let approxBusy = false;
  // 대략 위치 조회에서 위치 권한이 거절됐는지. 거절되면 이 화면에서는 다시 묻지 않는다.
  let approxDenied = false;
  // ── 워치 단절 감시. 마지막으로 워치 batch를 받은(또는 감시를 시작한) 시각.
  let lastWatchDataAt = Date.now();
  let watchTimer: ReturnType<typeof setInterval> | null = null;

  const clearGuide = () => {
    if (guideWait?.timer) {
      clearTimeout(guideWait.timer);
    }
    guideWait = null;
  };

  // 진행 중인 세션 동안만 S10을 구독한다.
  const syncEvents = () => {
    const want =
      !disposed && state.sessionId && state.status && !TERMINAL.includes(state.status)
        ? state.sessionId
        : null;
    if (want === eventsFor) {
      return;
    }
    stopEvents?.();
    stopEvents = null;
    eventsFor = null;
    clearGuide();
    if (want && session.subscribeEvents) {
      eventsFor = want;
      stopEvents = session.subscribeEvents(want, { onSnapshot: snapshot => onSnapshot(snapshot) });
    }
  };

  const phoneMode = () => state.recordingMode === 'PHONE_FALLBACK' || state.recordingMode === 'PHONE_ONLY';

  // ── 화면용 실측값. W07로 올리는 원문은 그대로 두고, 같은 본문을 한 번 더 읽는다(S15P31E105-517).
  let liveFor: string | null = null;
  let live = createLiveMetrics();
  const ingestLive = (sessionId: string, body: string, from: LiveMetrics['source']) => {
    if (disposed || sessionId !== state.sessionId) {
      return;
    }
    if (liveFor !== sessionId) {
      live = createLiveMetrics();
      liveFor = sessionId;
    }
    const next = live.ingest(body, from, Date.now(), phoneMode() ? 'PHONE' : 'WATCH');
    if (next) {
      setState({ live: next });
    }
  };
  const active = () => state.status === 'RUNNING' || state.status === 'PAUSED';

  // 이 폰(relay PHONE)의 기기 ID. 인계 후에는 제어기기도 이 폰이다.
  const phoneDeviceId = () =>
    (phoneMode() ? controlDeviceId ?? relayDeviceId : relayDeviceId) ?? devices?.phoneDeviceId ?? null;

  // 폰 GPS를 다시 켜고 결과를 화면 상태에 남긴다. 권한을 나중에 받았을 때도 부른다.
  let gpsStartPending: Promise<boolean> | null = null;
  const startGps = (target: PhoneRecorder): Promise<boolean> => {
    if (gpsStartPending) {
      return gpsStartPending;
    }
    const started = target.start().catch(() => false);
    gpsStartPending = started;
    started.then(on => {
      if (gpsStartPending === started) {
        gpsStartPending = null;
      }
      if (recorder === target) {
        setState({ phoneGps: on ? 'on' : 'off' });
      }
    });
    return started;
  };

  // 진행 중 세션 동안 폰 GPS 기록을 서버 상태에 맞춘다(S15P31E105-549, 통합 설계 2장 GPS 출처 선택).
  // WATCH 모드에서도 폰은 자기 deviceId로 GPS batch를 올리고, 서버·화면이 구간별로 워치 위치를 우선한다.
  // 준비(READY) 중에는 GPS만 켜 두고 기록하지 않으며, 실제 운동(RUNNING) 동안의 위치만 batch에 넣는다.
  // 인계 뒤에도 생산 기기는 같은 폰이므로 같은 기록기를 이어 쓴다.
  const syncPhone = () => {
    const deviceId = phoneDeviceId();
    const ongoing = !disposed && state.sessionId && state.status && !TERMINAL.includes(state.status);
    const want = ongoing && deviceId ? `${state.sessionId}|${deviceId}` : null;
    if (recorder && recorderFor !== want) {
      recorder.dispose();
      recorder = null;
      recorderFor = null;
      stopFixView();
    }
    if (!want || !deviceId) {
      return;
    }
    const sessionId = state.sessionId as string;
    if (!recorder) {
      const next = createPhoneRecorder({
        sessionId,
        deviceId,
        location,
        upload: body => {
          ingestLive(sessionId, body, 'PHONE');
          return session.uploadBatch(body);
        },
        newId,
        flushMs: timers?.phoneFlushMs,
        finishWaitMs: timers?.phoneFinishWaitMs,
      });
      recorder = next;
      recorderFor = want;
      fixView = location.subscribe(fix => {
        // 실제 운동 중의 위치만 보인다(기록기와 같은 기준). batch로 다시 와도 같은 측정 시각·좌표는 한 번만 들어간다.
        const item = state.status === 'RUNNING' ? gpsItem(fix) : null;
        if (item) {
          ingestLive(sessionId, JSON.stringify({ items: [item] }), 'PHONE');
        }
      });
      startGps(next);
    }
    if (phoneMode() && phoneServiceFor !== sessionId) {
      // 인계 직후: 화면이 꺼져도 폰 GPS를 받도록 러닝 서비스 위치 유형을 다시 켜고, 인계 때 받은 권한으로 GPS를 다시 켠다.
      // 이 시각 이후의 폰 위치만 화면 거리에 더한다(인계 전 위치는 워치 기록 중 보완용).
      phoneServiceFor = sessionId;
      if (liveFor !== sessionId) {
        live = createLiveMetrics();
        liveFor = sessionId;
      }
      live.setPhoneSince(Date.now());
      watch.setRunActive(true, sessionId, { location: true }).catch(noop);
      startGps(recorder);
    }
    // 승인받은 폰 명령을 실행·보고하는 동안에는 그 실행 결과가 서버 상태보다 앞선다.
    if ((phoneMode() && inflight) || recorder.finished()) {
      return;
    }
    if (state.status === 'RUNNING') {
      recorder.resume();
    } else {
      recorder.pause();
    }
  };

  // 워치 기록 중 진행 세션에서 워치 연결과 batch 도착을 주기적으로 확인한다.
  const checkWatch = async () => {
    if (disposed || phoneMode() || !active() || !state.startedAt) {
      return;
    }
    const connected = watch.isWatchConnected
      ? await watch.isWatchConnected().catch(() => true)
      : true;
    const quiet = state.status === 'RUNNING' && Date.now() - lastWatchDataAt > watchQuietMs;
    const lost = !connected || quiet;
    if (lost !== state.watchLost && !disposed && !phoneMode()) {
      setState({ watchLost: lost });
    }
  };

  const syncWatchCheck = () => {
    const want = !disposed && !!state.sessionId && state.recordingMode === 'WATCH' && active();
    if (want && watchTimer === null) {
      lastWatchDataAt = Date.now();
      watchTimer = setInterval(() => {
        checkWatch().catch(noop);
      }, watchCheckMs);
      (watchTimer as unknown as { unref?: () => void }).unref?.();
    } else if (!want && watchTimer !== null) {
      clearInterval(watchTimer);
      watchTimer = null;
    }
  };

  // 진행 중인데 GPS 위치(워치·폰, 정확도 무관)가 아직 하나도 없으면 대략 현재 위치를 주기적으로 받아 점만 표시한다.
  const fetchApprox = () => {
    if (approxBusy || disposed) {
      return;
    }
    approxBusy = true;
    location
      .current()
      .then(
        fix => {
          if (!disposed && !state.live?.here && active()) {
            setState({ approxPosition: [fix.longitude, fix.latitude] });
          }
        },
        error => {
          // 위치 권한이 없으면 이 세션에서는 다시 묻지 않는다(15초마다 권한 창이 뜨지 않게).
          if (errorCode(error) === 'LOCATION_PERMISSION_DENIED') {
            approxDenied = true;
            syncApprox();
          }
        },
      )
      .finally(() => {
        approxBusy = false;
      });
  };

  function syncApprox() {
    const want = !disposed && !approxDenied && !!state.sessionId && active() && !state.live?.here;
    if (want && approxTimer === null) {
      fetchApprox();
      approxTimer = setInterval(fetchApprox, approxEveryMs);
      (approxTimer as unknown as { unref?: () => void }).unref?.();
    } else if (!want && approxTimer !== null) {
      clearInterval(approxTimer);
      approxTimer = null;
    }
  }

  const mark = (stage: string) => {
    if (flowStart !== null) {
      diag(`timing ${stage} +${now() - flowStart}ms`);
    }
  };

  const setState = (change: Partial<RunControlState>) => {
    state = { ...state, ...change };
    if (state.recordingMode !== 'WATCH' && state.watchLost) {
      state = { ...state, watchLost: false };
    }
    listeners.forEach(listener => listener(state));
    announcer?.setRunning(!disposed && state.status === 'RUNNING');
    syncEvents();
    syncPhone();
    syncWatchCheck();
    syncGroupPoll();
    syncApprox();
  };

  // S02를 주기적으로 읽어 S10 스냅샷과 같이 처리한다. 다른 조작 중에는 건너뛴다.
  // 그룹 참가 세션은 끝나기 전까지 groupPollMs(3초)마다 읽는다(S15P31E105-420).
  // 개인 러닝도 운동 중(RUNNING/PAUSED)에는 serverPollMs(5초)마다 읽는다(S15P31E105-549 실기기 확인): 실기기에서 S10이 폰에
  // 도착하지 않아 서버가 만든 AI 코칭 명령이 워치로 전달되지 못했고, 그 명령이 같은 버전 자리를 차지해 일시정지·종료가
  // 409 COMMAND_CONFLICT로 막혔다. S02 조회로 같은 스냅샷 처리를 하면 코칭이 전달되고 자리가 풀린다.
  let pollEvery: number | null = null;
  function syncGroupPoll() {
    const ongoing = !disposed && !!state.sessionId && !!state.status && !TERMINAL.includes(state.status);
    const every =
      ongoing && groupRunId !== null ? groupPollMs : ongoing && active() ? serverPollMs : null;
    if (every === pollEvery) {
      return;
    }
    if (groupTimer !== null) {
      clearInterval(groupTimer);
      groupTimer = null;
    }
    pollEvery = every;
    if (every !== null) {
      groupTimer = setInterval(() => {
        pollGroup().catch(noop);
      }, every);
      (groupTimer as unknown as { unref?: () => void }).unref?.();
    }
  }

  async function pollGroup() {
    const sessionId = state.sessionId;
    if (disposed || busy || groupPolling || !sessionId) {
      return;
    }
    groupPolling = true;
    try {
      const view = await session.get(sessionId);
      onSnapshot({ event: 'POLL', session: view, reconnected: false });
    } finally {
      groupPolling = false;
    }
  }

  // 서버 상태를 한 번에 반영한다. extra로 진행 표시를 함께 바꿔 "운동 중인데 시작 확인 중" 같은 중간 상태를 내보내지 않는다.
  const applyView = (view: RunningSessionView, extra: Partial<RunControlState> = {}) => {
    const cmd = (c: RunningSessionView['pendingCommand']) =>
      c ? `${c.action}:${c.commandId}:${c.result}:v${c.expectedVersion}` : '-';
    diag(
      `view ${view.state} v${view.stateVersion} pending=${cmd(view.pendingCommand)} last=${cmd(view.lastCommand)} coaching=${view.coaching ? 'yes' : 'no'}`,
    );
    controlDeviceId = view.controlDeviceId;
    relayDeviceId = view.relayDeviceId;
    groupEndedAt = view.groupEndedAt ?? null;
    if (view.state === 'COMPLETED') {
      trackAnalysis(view.sessionId);
    }
    setState({
      // 다른 세션에 붙으면 이전 세션의 실측값을 남기지 않는다.
      ...(view.sessionId !== state.sessionId ? { live: null, approxPosition: null } : {}),
      sessionId: view.sessionId,
      status: view.state,
      stateVersion: view.stateVersion,
      startedAt: view.startedAt,
      endedAt: view.endedAt,
      comparison: view.comparison ?? null,
      coaching: lastCoaching(view.coaching, state.coaching, view.sessionId === state.sessionId),
      currentBpm: view.currentBpm ?? null,
      recordingMode: view.recordingMode,
      clock: runClockOf(view, Date.now()),
      ...extra,
    });
  };

  // 같은 요청으로만 재시도한다. 409 등 내용·권한 오류는 재시도하지 않는다.
  function call<T>(work: () => Promise<T>): Promise<T> {
    return callWith(retryDelaysMs, work);
  }

  async function callWith<T>(delays: number[], work: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (const delay of delays) {
      if (delay > 0) {
        await sleep(delay + Math.floor(Math.random() * Math.min(500, delay)));
      }
      try {
        return await work();
      } catch (error) {
        lastError = error;
        if (!RETRYABLE.includes(errorCode(error))) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  // 한 번에 하나의 조작만 진행한다. 진행 중에 들어온 같은 조작은 진행 중인 것을 기다린다(중복 요청 방지).
  const run = (work: () => Promise<void>) => {
    if (busy) {
      return busy;
    }
    busy = work()
      .catch(error => {
        setState({ problem: { kind: 'error', code: errorCode(error) } });
      })
      .finally(() => {
        busy = null;
        if (disposed) {
          queued = null;
          return;
        }
        // 진행 중인 동안 늦게 도착해 보관만 한 결과를 먼저 보고한다. 대기 요청은 그 뒤에 실행한다.
        const late = takeLateResult();
        if (late) {
          run(late);
          return;
        }
        const next = queued;
        queued = null;
        if (next) {
          run(next.work);
        }
      });
    return busy;
  };

  // 시간 초과 뒤 다른 조작이 진행 중일 때 도착해 early에만 넣어 둔 승인 명령·SET_BPM 결과.
  // 보고하지 않으면 서버에 미확정 명령이 남아 이후 요청이 409가 되고 워치는 저장 대기에 묶인다.
  function takeLateResult(): (() => Promise<void>) | null {
    const command = inflight;
    const commandEvent = command ? early.get(command.commandId) : undefined;
    if (command && commandEvent && commandEvent.sessionId === state.sessionId) {
      early.delete(command.commandId);
      return () => report(command.action, commandEvent);
    }
    const bpm = bpmInflight;
    const bpmEvent = bpm ? early.get(bpm.commandId) : undefined;
    if (bpm && bpmEvent && bpmEvent.sessionId === state.sessionId) {
      early.delete(bpm.commandId);
      return () => reportBpm(bpmEvent);
    }
    return null;
  }

  // 진행 중인 조작이 모두 끝난 뒤 실행한다. 버리지 않는다(사용자의 시작·화면 준비·준비 취소용).
  const runAfter = async (work: () => Promise<void>): Promise<void> => {
    while (busy) {
      await busy;
    }
    if (disposed) {
      return;
    }
    return run(work);
  };

  const runOrQueue = (work: () => Promise<void>, dropped?: () => void) => {
    if (busy) {
      queued?.dropped?.();
      queued = { work, dropped };
      return;
    }
    run(work);
  };

  // BPM·코칭 결과 응답의 최신 상태. 더 오래된 버전으로 되돌리지 않는다.
  const applyLatest = (view: RunningSessionView) => {
    if (view.sessionId === state.sessionId && view.stateVersion >= state.stateVersion) {
      applyView(view);
    }
  };

  const refresh = async () => {
    if (state.sessionId) {
      applyView(await call(() => session.get(state.sessionId as string)));
    }
  };

  // 폐기된 제어기는 러닝 서비스를 건드리지 않는다. 다음 제어기가 켠 서비스를 늦게 끝난 조작이 끄지 않게 한다(S15P31E105-814).
  const stopService = async () => {
    if (!disposed) {
      await watch.setRunActive(false).catch(() => undefined);
    }
  };

  const settleActive = async () => {
    if (state.status && TERMINAL.includes(state.status)) {
      await stopService();
      // 끝난 운동은 인계 때 막아 둔 워치 batch 수신을 다시 연다(늦게 온 batch는 서버가 거절한다).
      if (state.sessionId) {
        await watch.unblockBatches?.(state.sessionId).catch(noop);
      }
    }
  };

  const waitFor = (commandId: string, timeoutMs: number) =>
    new Promise<ResultEvent | null>(resolve => {
      const ready = early.get(commandId);
      if (ready) {
        early.delete(commandId);
        resolve(ready);
        return;
      }
      const timer = setTimeout(() => {
        waiters.delete(commandId);
        resolve(null);
      }, timeoutMs);
      waiters.set(commandId, event => {
        clearTimeout(timer);
        waiters.delete(commandId);
        resolve(event);
      });
    });

  async function report(action: ControlAction, event: ResultEvent) {
    if (reported.has(event.commandId) || !state.sessionId) {
      return;
    }
    reported.add(event.commandId);
    const sessionId = state.sessionId;
    // WATCH 모드 종료: 워치 batch뿐 아니라 이 폰이 만든 GPS batch까지 저장 확인한 뒤 uploadComplete를 보낸다(9.3 COMMAND_RESULT).
    const phoneSaved =
      action === 'END' && event.result === 'APPLIED' && !phoneMode() && recorder
        ? await recorder.finish()
        : true;
    try {
      const saved = await call(() =>
        session.reportResult(sessionId, action, {
          commandId: event.commandId,
          // 실행기기는 승인받은 제어기기다(워치 기록 모드).
          deviceId: controlDeviceId ?? devices?.watchDeviceId ?? '',
          result: event.result,
          appliedAt: event.appliedAt,
          reasonCode: event.reasonCode,
          ...(action === 'END'
            ? {
                uploadComplete:
                  event.uploadComplete === true && event.pendingBatchCount === 0 && phoneSaved,
              }
            : {}),
        }),
      );
      diag(`${action} ${event.commandId} reported ${saved.result} v${saved.session.stateVersion}`);
      mark(`${action} result saved ${saved.result}`);
      // 폰이 실행한 명령(인계 후)은 워치에 저장 확인을 보내지 않는다.
      // 서버가 확정한 상태는 워치 전달을 기다리지 않고 화면에 먼저 반영한다(S15P31E105-533). 전달은 이 조작 안에서 끝까지
      // 기다려 다음 조작이 저장 확인보다 앞서 워치에 가지 않게 한다. 실패하면 워치가 재전송·STATE_QUERY로 복구한다.
      const receipt = phoneMode()
        ? Promise.resolve()
        : watch
            .sendReceived(sessionId, {
              commandId: event.commandId,
              persisted: true,
              stateVersion: saved.session.stateVersion,
            })
            .catch(() => undefined);
      if (saved.result === 'UNKNOWN') {
        reported.delete(event.commandId);
        applyView(saved.session, { problem: { kind: 'unconfirmed', action } });
        await receipt;
        return;
      }
      inflight = null;
      applyView(saved.session, {
        pending: null,
        problem:
          saved.result === 'REJECTED'
            ? { kind: 'rejected', action, reasonCode: event.reasonCode }
            : null,
        // 워치가 실제로 시작한 START의 GPS 사용 여부(S15P31E105-864). 폰↔워치 전용이며 서버에는 보내지 않는다.
        ...(action === 'START' && event.result === 'APPLIED' && !phoneMode()
          ? { watchGps: event.gps ?? null }
          : {}),
      });
      mark(`${action} screen ${saved.session.state}`);
      await receipt;
      mark(`${action} receipt sent`);
      await settleActive();
    } catch (error) {
      reported.delete(event.commandId);
      const code = errorCode(error);
      diag(`${action} ${event.commandId} report failed ${code}`);
      if (code === 'UPLOAD_PENDING') {
        setState({ problem: { kind: 'saveUnconfirmed', reason: 'UPLOAD_PENDING' } });
        return;
      }
      // 저장 여부를 모른다(응답 없음·서버 장애). 워치는 실행했을 수 있으므로 실패로 단정하지 않고 재확인을 기다린다.
      if (RETRYABLE.includes(code)) {
        setState({ problem: { kind: 'unconfirmed', action, afterResult: true } });
        return;
      }
      if (RESYNC.includes(code)) {
        await refresh().catch(() => undefined);
      }
      setState({ problem: { kind: 'error', code } });
    }
  }

  // 승인 명령을 워치에 보내고 실제 결과를 기다린다. 결과가 없으면 미확인으로 남기고 서버에 아무것도 보고하지 않는다.
  // 그룹 종료 END는 SERVER_END로 보낸다(9.3). 워치는 어느 쪽이든 같은 commandId를 한 번만 실행한다.
  async function deliver(approval: CommandApproval) {
    inflight = approval;
    const sessionId = state.sessionId as string;
    const waiting = waitFor(
      approval.commandId,
      approval.action === 'END' ? endResultWaitMs : resultWaitMs,
    );
    const endedAt = serverEnds.get(approval.commandId);
    const sending =
      endedAt !== undefined && watch.sendServerEnd
        ? watch.sendServerEnd(sessionId, {
            commandId: approval.commandId,
            expectedVersion: approval.expectedVersion,
            endedAt,
            reason: GROUP_END_REASON,
          })
        : watch.sendCommand(sessionId, approval);
    await sending.catch(error => diag(`${approval.action} ${approval.commandId} send failed ${errorCode(error)}`));
    const event = await waiting;
    diag(`${approval.action} ${approval.commandId} watch result ${event ? event.result : 'TIMEOUT'}`);
    mark(`${approval.action} watch result`);
    if (!event) {
      setState({
        problem:
          approval.action === 'END'
            ? { kind: 'saveUnconfirmed', reason: 'NO_RESULT' }
            : { kind: 'unconfirmed', action: approval.action },
      });
      return;
    }
    await report(approval.action, event);
  }

  // 인계 후 폰 제어(sessions.md 인계 후 폰 제어): 승인받은 명령을 폰이 직접 실행하고 실제 결과를 RESULT로 보고한다.
  // 같은 commandId는 다시 실행하지 않는다. 종료는 GPS·타이머를 멈추고 폰 batch 전체의 저장을 확인한 뒤 보고한다.
  async function executePhone(approval: CommandApproval) {
    inflight = approval;
    // 폰으로 기록하는 그룹 출발(S15P31E105-889)은 위치 권한이 있어야 실행한다. 없으면 시작을 보고하지 않고 알린다(개인 폰 시작의
    // locationRequired와 같다). 명령은 맡아 둔 채라 권한을 허용한 뒤 다시 확인(recheck)하면 같은 명령을 실행한다.
    if (
      approval.action === 'START' &&
      groupRunId !== null &&
      state.recordingMode === 'PHONE_ONLY' &&
      !phoneDone.has(approval.commandId) &&
      !(await location.requestPermission().catch(() => false))
    ) {
      setState({ pending: null, problem: { kind: 'locationRequired' } });
      return;
    }
    const sessionId = state.sessionId as string;
    syncPhone();
    const current = recorder;
    let done = phoneDone.get(approval.commandId);
    if (!done) {
      if (approval.action === 'PAUSE') {
        current?.pause();
      } else if (approval.action === 'RESUME') {
        current?.resume();
      }
      const appliedAt = new Date(now()).toISOString();
      done = {
        appliedAt,
        uploadComplete: approval.action === 'END' ? (await current?.finish()) ?? true : false,
      };
      phoneDone.set(approval.commandId, done);
    } else if (approval.action === 'END' && !done.uploadComplete) {
      // 다시 확인: 남은 폰 batch 저장만 다시 확인한다. 종료 시각은 처음 멈춘 시각 그대로 보고한다.
      done.uploadComplete = (await current?.finish()) ?? true;
    }
    await report(approval.action, {
      type: 'COMMAND_RESULT',
      sessionId,
      commandId: approval.commandId,
      result: 'APPLIED',
      appliedAt: done.appliedAt,
      reasonCode: null,
      uploadComplete: approval.action === 'END' ? done.uploadComplete : null,
      pendingBatchCount: approval.action === 'END' ? 0 : null,
    });
  }

  // P07 RESULT(SET_BPM). 실행기기는 제어 워치다.
  async function reportBpm(event: ResultEvent) {
    const reportResult = session.reportBpmResult;
    if (reported.has(event.commandId) || !state.sessionId || !reportResult) {
      return;
    }
    reported.add(event.commandId);
    const sessionId = state.sessionId;
    try {
      const saved = await call(() =>
        reportResult(sessionId, {
          commandId: event.commandId,
          deviceId: controlDeviceId ?? devices?.watchDeviceId ?? '',
          result: event.result,
          appliedAt: event.appliedAt,
          reasonCode: event.reasonCode,
        }),
      );
      await watch
        .sendReceived(sessionId, {
          commandId: event.commandId,
          persisted: true,
          stateVersion: saved.session.stateVersion,
        })
        .catch(noop);
      if (saved.result === 'UNKNOWN') {
        reported.delete(event.commandId);
      } else if (bpmInflight?.commandId === event.commandId) {
        bpmInflight = null;
      }
      applyLatest(saved.session);
    } catch (error) {
      reported.delete(event.commandId);
      if (RESYNC.includes(errorCode(error))) {
        await refresh().catch(noop);
      }
    }
  }

  async function deliverBpm(approval: BpmApproval) {
    bpmInflight = approval;
    const sessionId = state.sessionId as string;
    const waiting = waitFor(approval.commandId, resultWaitMs);
    await watch.sendBpmCommand(sessionId, approval).catch(noop);
    const event = await waiting;
    // 결과가 없으면 미확인으로 남긴다. 늦게 온 결과는 onEvent에서 보고한다.
    if (event) {
      await reportBpm(event);
    }
  }

  // 워치 BPM +/-: P07 REQUEST → COMMAND_REQUEST(APPLY) → COMMAND_RESULT → P07 RESULT → COMMAND_RECEIVED(persisted=true).
  async function setBpm(expectedVersion: number, targetBpm: number) {
    if (!state.sessionId) {
      return;
    }
    const sessionId = state.sessionId;
    const refuse = (code: string, retryable: boolean) =>
      watch.sendError(sessionId, { code, retryable, failedType: 'COMMAND_REQUEST' }).catch(noop);
    const requestBpm = session.requestBpm;
    if (!requestBpm) {
      await refuse('COACHING_UNAVAILABLE', false);
      return;
    }
    let approval: BpmApproval;
    try {
      approval = await call(() =>
        requestBpm(sessionId, {
          deviceId: controlDeviceId ?? devices?.watchDeviceId ?? '',
          expectedVersion,
          targetBpm,
        }),
      );
    } catch (error) {
      const code = errorCode(error);
      if (RESYNC.includes(code)) {
        await refresh().catch(noop);
      }
      // 409 COMMAND_PENDING·STALE_STATE·COACHING_UNAVAILABLE 등은 워치에 ERROR로 알린다(9.3).
      await refuse(code, RETRYABLE.includes(code));
      return;
    }
    if (approval.result === 'PENDING' || approval.result === 'UNKNOWN') {
      // UNKNOWN(응답 유실 뒤 재요청)도 같은 명령을 다시 보내 워치가 보관한 결과를 받는다.
      await deliverBpm(approval);
      return;
    }
    // 이미 확정된 같은 요청의 재전송: 서버 저장 확인만 다시 알린다.
    const view = await call(() => session.get(sessionId)).catch(() => null);
    if (view) {
      applyLatest(view);
      await watch
        .sendReceived(sessionId, {
          commandId: approval.commandId,
          persisted: true,
          stateVersion: view.stateVersion,
        })
        .catch(noop);
    }
  }

  // COACHING_RESULT → P07 RESULT(deviceId=워치) → COMMAND_RECEIVED(persisted=true). 같은 결과는 한 번만 저장한다.
  async function reportCoaching(event: CoachingResultEvent) {
    const sessionId = state.sessionId;
    const reportResult = session.reportBpmResult;
    if (!sessionId || event.sessionId !== sessionId || !reportResult) {
      return;
    }
    const savedVersion = coachingSaved.get(event.commandId);
    if (savedVersion !== undefined) {
      await watch
        .sendReceived(sessionId, {
          commandId: event.commandId,
          persisted: true,
          stateVersion: savedVersion,
        })
        .catch(noop);
      return;
    }
    if (reported.has(event.commandId)) {
      return;
    }
    reported.add(event.commandId);
    try {
      const saved = await call(() =>
        reportResult(sessionId, {
          commandId: event.commandId,
          deviceId: controlDeviceId ?? devices?.watchDeviceId ?? '',
          result: event.result,
          appliedAt: event.appliedAt,
          reasonCode: event.reasonCode,
        }),
      );
      await watch
        .sendReceived(sessionId, {
          commandId: event.commandId,
          persisted: true,
          stateVersion: saved.session.stateVersion,
        })
        .catch(noop);
      if (saved.result === 'UNKNOWN') {
        // 미확인은 슬롯을 닫지 않는다. 재연결 때 같은 가이드를 다시 보내 결과를 확인한다.
        reported.delete(event.commandId);
      } else {
        coachingSaved.set(event.commandId, saved.session.stateVersion);
        if (guideWait?.commandId === event.commandId) {
          clearGuide();
        }
      }
      applyLatest(saved.session);
    } catch (error) {
      reported.delete(event.commandId);
      const code = errorCode(error);
      // 저장하지 못한 결과는 다음 S10 스냅샷에서 같은 가이드를 다시 보내 워치가 보관한 결과로 다시 저장한다.
      // 그대로 두면 재연결 전까지 보내지 않아 워치는 저장 대기(AWAITING_SAVE), 서버는 미확정 명령으로 묶인다.
      if (RETRYABLE.includes(code) && guideWait?.commandId === event.commandId) {
        clearGuide();
      }
      if (RESYNC.includes(code)) {
        await refresh().catch(noop);
      }
    }
  }

  const flushEarlyCoaching = () => {
    earlyCoaching.forEach((event, commandId) => {
      earlyCoaching.delete(commandId);
      if (event.sessionId === state.sessionId) {
        reportCoaching(event).catch(noop);
      }
    });
  };

  // COACHING_GUIDE를 보내고 결과를 10초씩 기다리며 최초 포함 최대 3회 보낸다(9.5). 상한 뒤에는 재연결 때 다시 보낸다.
  function deliverGuide(sessionId: string, guide: CoachingGuide) {
    clearGuide();
    const waiting: { commandId: string; timer: ReturnType<typeof setTimeout> | null } = {
      commandId: guide.commandId,
      timer: null,
    };
    guideWait = waiting;
    const attempt = (tries: number) => {
      watch.sendCoachingGuide(sessionId, guide).catch(noop);
      waiting.timer = setTimeout(() => {
        waiting.timer = null;
        if (guideWait === waiting && !disposed && tries < guideTries) {
          attempt(tries + 1);
        }
      }, guideAckMs);
    };
    attempt(1);
  }

  // 서버가 폰의 요청 없이 승인한 명령(S15P31E105-420): 그룹장의 G09 출발 START와 G12 그룹 종료 END.
  // 결과가 PENDING인 것만 전달한다. UNKNOWN은 워치가 이미 답한 명령이라 재확인(recheck)으로만 다시 보낸다.
  // 그룹이 끝났거나 세션이 READY가 아니면 START를 전달하지 않는다(watch-mobile-server-integration.md 시작 응답 복구).
  function serverCommandOf(view: RunningSessionView): CommandApproval | null {
    const pending = view.pendingCommand;
    if (!pending || pending.result !== 'PENDING') {
      return null;
    }
    const start =
      pending.action === 'START' &&
      groupRunId !== null &&
      view.state === 'READY' &&
      !view.groupEndedAt;
    const end = pending.action === 'END' && !!view.groupEndedAt;
    if (!start && !end) {
      return null;
    }
    if (end) {
      serverEnds.set(pending.commandId, view.groupEndedAt as string);
    }
    return {
      commandId: pending.commandId,
      action: pending.action as ControlAction,
      expectedVersion: pending.expectedVersion,
      result: 'PENDING',
    };
  }

  // 서버가 승인한 명령을 한 번만 맡아 다른 조작이 끝난 뒤 전달한다. 같은 commandId는 결과를 보고할 때까지 다시 맡지 않는다.
  // 폰으로 기록을 넘긴 세션의 그룹 종료는 폰이 직접 실행하고 보고한다(sessions.md SERVER_END).
  function relayServerCommand(view: RunningSessionView) {
    const approval = serverCommandOf(view);
    if (
      !approval ||
      inflight?.commandId === approval.commandId ||
      reported.has(approval.commandId)
    ) {
      return;
    }
    inflight = approval;
    const work = async () => {
      if (inflight?.commandId !== approval.commandId) {
        return;
      }
      // 기다리는 동안 다른 세션으로 바뀌었으면 맡은 명령을 놓는다. 남겨 두면 이후 명령이 모두 막힌다.
      if (state.sessionId !== view.sessionId) {
        inflight = null;
        return;
      }
      setState({ pending: { action: approval.action, commandId: approval.commandId }, problem: null });
      if (phoneMode()) {
        await executePhone(approval);
        return;
      }
      await deliver(approval);
    };
    const go = () => {
      if (disposed) {
        return;
      }
      if (busy) {
        busy.then(go, go);
        return;
      }
      run(work);
    };
    go();
  }

  // S10 스냅샷마다 워치에 STATE_RESULT(scope=SERVER)를 보내고(D-8), 승인된 코칭 명령을 COACHING_GUIDE로 전달한다.
  // 미확정 명령(pendingCommand.coachingGuide)이 있으면 만료됐어도 결과 확인용으로 먼저 보낸다(만료된 코칭의 결과 확인).
  // 서버가 직접 승인한 그룹 출발·종료 명령은 워치에 전달한다(S15P31E105-420).
  function onSnapshot({ session: view, reconnected }: SessionSnapshot) {
    if (disposed || view.sessionId !== state.sessionId) {
      return;
    }
    const sessionId = view.sessionId;
    if (view.stateVersion >= state.stateVersion) {
      groupEndedAt = view.groupEndedAt ?? null;
    }
    // 그룹 참가 세션은 그룹장이 바꾼 상태(출발 전 취소 등)를 폰 조작 없이도 반영한다. 진행 중인 조작이 있으면 그 결과가 맞춘다.
    if (groupRunId !== null && !busy && !inflight && view.stateVersion > state.stateVersion) {
      applyView(view);
      settleActive().catch(noop);
    }
    // 기록 비교는 batch 저장마다 같은 버전으로 온다(sessions.md S10). 더 오래된 버전으로는 되돌리지 않는다.
    if (view.stateVersion >= state.stateVersion) {
      setState({
        comparison: view.comparison ?? null,
        coaching: lastCoaching(view.coaching, state.coaching, view.sessionId === state.sessionId),
        currentBpm: view.currentBpm ?? null,
        clock: runClockOf(view, Date.now()),
      });
    }
    watch.sendServerState(sessionId, view, null).catch(noop);
    relayServerCommand(view);
    for (const seen of [view.pendingCommand?.coachingGuide, view.coaching]) {
      if (seen) {
        knownGuides.set(seen.commandId, seen);
      }
    }
    if (view.recordingMode === 'PHONE_ONLY') {
      return;
    }
    if (view.recordingMode === 'PHONE_FALLBACK') {
      // 폰으로 기록 중이면 워치 적용이 없으므로 새로 받은 코칭을 안내한다(S15P31E105-579).
      if (view.coaching) {
        announcer?.applied(view.coaching);
      }
      return;
    }
    const guide = view.pendingCommand?.coachingGuide ?? view.coaching ?? null;
    if (!guide || coachingSaved.has(guide.commandId) || reported.has(guide.commandId)) {
      return;
    }
    if (guideWait?.commandId === guide.commandId && !reconnected) {
      return;
    }
    deliverGuide(sessionId, guide);
  }

  // 분석이 READY일 때만 H02 요약을 읽는다. 읽지 못하면 null이며 값을 만들어 채우지 않는다(S15P31E105-663).
  async function summaryFor(view: RunningSessionView): Promise<WatchResultSummary | null> {
    if (view.analysisStatus !== 'READY' || !records) {
      return null;
    }
    try {
      return await records.getResultSummary(view.sessionId);
    } catch {
      return null;
    }
  }

  // 종료(COMPLETED)된 세션의 분석 상태를 워치 결과 화면에 알린다(S15P31E105-663, 통합 설계 STATE_RESULT.analysis).
  // S02를 일정 간격으로 조회해 상태가 바뀔 때마다 한 번 보내고 READY·FAILED·LEGACY에서 멈춘다. 상한을 넘기면 멈추고,
  // 이후는 워치가 다시 물을 때(STATE_QUERY) 답한다. 분석 계산은 서버가 하며 여기서는 옮기기만 한다.
  let analysisFor: string | null = null;
  let analysisTimer: ReturnType<typeof setTimeout> | null = null;
  const stopAnalysis = () => {
    if (analysisTimer !== null) {
      clearTimeout(analysisTimer);
      analysisTimer = null;
    }
    analysisFor = null;
  };
  const trackAnalysis = (sessionId: string) => {
    if (analysisFor === sessionId) {
      return;
    }
    stopAnalysis();
    analysisFor = sessionId;
    const startedAt = now();
    let sent: string | null = null;
    let summaryTries = 0;
    const tick = async () => {
      analysisTimer = null;
      if (disposed || analysisFor !== sessionId || state.sessionId !== sessionId) {
        return;
      }
      let finished = false;
      try {
        const view = await call(() => session.get(sessionId));
        if (disposed || analysisFor !== sessionId) {
          return;
        }
        const status = view.analysisStatus;
        const summary = await summaryFor(view);
        // READY인데 요약을 못 읽었으면 몇 번 더 읽어 본 뒤에 보낸다.
        const wait = status === 'READY' && !summary && ++summaryTries < 3;
        if (!wait && status !== sent) {
          sent = status;
          await watch.sendServerState(sessionId, view, null, summary).catch(noop);
        }
        finished = !wait && ['READY', 'FAILED', 'LEGACY'].includes(status);
      } catch {
        // 다음 조회에서 다시 시도한다.
      }
      if (finished || disposed || analysisFor !== sessionId) {
        return;
      }
      if (now() - startedAt >= analysisMaxMs) {
        analysisFor = null;
        return;
      }
      analysisTimer = setTimeout(tick, analysisPollMs);
    };
    analysisTimer = setTimeout(tick, 0);
  };

  // 워치 STATE_QUERY(scope=SERVER): S02를 조회해 서버 시각·BPM·명령과 함께 답한다. clientSendAt은 그대로 돌려준다.
  async function answerState(sessionId: string, clientSendAt: string | null) {
    try {
      const view = await call(() => session.get(sessionId));
      const summary = await summaryFor(view);
      // 요약이 없으면 기존 호출 모양 그대로 보낸다(S15P31E105-663).
      await (summary
        ? watch.sendServerState(sessionId, view, clientSendAt, summary)
        : watch.sendServerState(sessionId, view, clientSendAt));
    } catch (error) {
      const code = errorCode(error);
      await watch
        .sendError(sessionId, {
          code,
          retryable: RETRYABLE.includes(code),
          failedType: 'STATE_QUERY',
        })
        .catch(noop);
    }
  }

  async function control(action: ControlAction) {
    if (!state.sessionId) {
      return;
    }
    const sessionId = state.sessionId;
    // START는 시작 흐름(startFlow)이 정한 기준 시각을 이어 쓴다. 다른 조작은 요청 시각부터 잰다.
    if (action !== 'START' || flowStart === null) {
      flowStart = now();
    }
    setState({ pending: { action, commandId: null }, problem: null });
    diag(`${action} request v${state.stateVersion} mode=${state.recordingMode}`);
    let approval: CommandApproval;
    try {
      approval = await call(() =>
        session.requestControl(sessionId, action, {
          deviceId: controlDeviceId ?? '',
          expectedVersion: state.stateVersion,
        }),
      );
    } catch (error) {
      const code = errorCode(error);
      diag(`${action} request failed ${code}`);
      if (RESYNC.includes(code)) {
        await refresh().catch(() => undefined);
      }
      if (code === 'COMMAND_CONFLICT') {
        // 같은 버전 자리에 서버가 만든 명령(AI 코칭)이 남아 있다. 바로 S02를 읽어 그 명령을 워치에 전달해 자리를 풀게 한다.
        await call(() => session.get(sessionId))
          .then(view => onSnapshot({ event: 'POLL', session: view, reconnected: true }))
          .catch(noop);
      }
      setState({ pending: null, problem: { kind: 'error', code } });
      return;
    }
    diag(`${action} approved ${approval.commandId} ${approval.result}`);
    mark(`${action} approved`);
    setState({ pending: { action, commandId: approval.commandId } });
    if (phoneMode() && (approval.result === 'PENDING' || approval.result === 'UNKNOWN')) {
      // UNKNOWN(응답 유실 뒤 재요청)도 폰이 실행하지 않았다면 지금 실행하고, 실행했다면 보관한 결과로 보고한다.
      await executePhone(approval);
      return;
    }
    if (approval.result === 'PENDING') {
      await deliver(approval);
      return;
    }
    if (approval.result === 'UNKNOWN') {
      // 응답 유실 뒤 재요청: 같은 명령이 미확인으로 남아 있다. 새로 실행하지 않고 재확인을 기다린다.
      inflight = approval;
      setState({ problem: { kind: 'unconfirmed', action } });
      return;
    }
    // 이미 확정된 슬롯의 재전송: 서버 상태로 맞춘다.
    inflight = null;
    applyView(await call(() => session.get(sessionId)), {
      pending: null,
      problem: approval.result === 'REJECTED' ? { kind: 'rejected', action, reasonCode: null } : null,
    });
  }

  // 워치에 현재 버전의 목표를 준비시키고, 준비 결과(실패 포함)를 서버에 그대로 전달한다(S08 REPORT_PREPARED).
  async function prepareWatch(goal: SessionGoalDraft): Promise<boolean> {
    const sessionId = state.sessionId as string;
    const stateVersion = state.stateVersion;
    preparedFor = null;
    mark('watch prepare sent');
    // 워치는 이 기기 ID를 측정 batch의 생산 기기로 쓴다(S15P31E105-311).
    const prepared = await watch.prepare(sessionId, {
      stateVersion,
      deviceId: controlDeviceId ?? devices?.watchDeviceId ?? '',
      goal,
      groupRunId,
    });
    const ready = prepared.ready && prepared.stateVersion === stateVersion;
    mark(`watch prepared ${ready ? 'ready' : prepared.reasonCode ?? 'VERSION_MISMATCH'}`);
    await call(() =>
      session.reportPrepared(sessionId, {
        deviceId: controlDeviceId ?? devices?.watchDeviceId ?? '',
        expectedVersion: stateVersion,
        ready,
        reasonCode: ready ? null : prepared.reasonCode ?? 'VERSION_MISMATCH',
      }),
    );
    mark('prepared reported');
    if (!ready) {
      setState({
        problem: { kind: 'watchNotReady', reasonCode: prepared.reasonCode },
        watchRemoteGps: null,
      });
    } else if (state.sessionId === sessionId && state.stateVersion === stateVersion) {
      preparedFor = { sessionId, stateVersion };
      setState({ watchRemoteGps: prepared.remoteGps ?? null });
    }
    return ready;
  }

  // 새 세션을 만든다. 응답 유실·앱 재시작으로 이미 활성 세션이 있으면 그 세션에 다시 붙는다(S01 409 details.sessionId).
  // Whether the watchUnregistered notice was shown in this screen's life: the next start goes on with the phone.
  let unregisteredNoticed = false;
  // 사용자가 '폰으로 시작'을 골랐다(S15P31E105-864). 이 제어기의 이후 세션은 등록된 워치가 있어도 폰 전용으로 만든다.
  let phoneChosen = false;
  async function createSession(goal: SessionGoalDraft, asked = false): Promise<boolean> {
    devices = phoneChosen ? null : await watch.getLinkedDevices();
    mark('devices');
    let phoneId: string;
    // The early preparation does not make a phone session for a paired watch: the user's own start says why first.
    if (
      !devices &&
      !phoneChosen &&
      !unregisteredNoticed &&
      (await watch.isWatchConnected?.().catch(() => false))
    ) {
      if (asked) {
        unregisteredNoticed = true;
        setState({ problem: { kind: 'watchUnregistered' } });
      }
      return false;
    }
    if (!devices) {
      // Phone-only personal runs require a usable fix before creating a server session.
      const granted = await location.requestPermission().catch(() => false);
      const fix = granted ? await location.current().catch(() => null) : null;
      if (!fix) {
        setState({ problem: { kind: 'locationRequired' } });
        return false;
      }
      phoneId = await watch.getPhoneDeviceId?.() ?? '';
      if (!phoneId) {
        setState({ problem: { kind: 'error', code: 'DEVICE_FORBIDDEN' } });
        return false;
      }
    } else {
      phoneId = devices.phoneDeviceId;
    }
    setState({ problem: null });
    mark('create sent');
    try {
      // 응답이 없으면 서버의 AI 계획 상한(40초)이 지난 뒤에만 한 번 다시 보낸다. 서버는 그 사이 만든 세션을 409로 알려 준다.
      const created = await callWith(createRetryDelaysMs, () =>
        session.create({
          controlDeviceId: devices?.watchDeviceId ?? phoneId,
          relayDeviceId: phoneId,
          goal,
        }),
      );
      applyView(created, { joined: false });
      lastGoal = goal;
      createdAt = now();
      mark('created');
    } catch (error) {
      const activeId =
        error instanceof DataError && error.code === 'ACTIVE_SESSION_EXISTS'
          ? error.details?.sessionId
          : undefined;
      if (activeId === undefined || activeId === null) {
        throw error;
      }
      // 기존 세션의 목표는 덮어쓰지 않는다(S01 생성 응답 유실 복구).
      await attachTo(String(activeId));
      lastGoal = null;
      createdAt = null;
    }
    // 준비 화면에서 경로용 위치 권한을 묻고 러닝 서비스에 위치 유형을 켠다. 거절해도 러닝은 이어가며 경로만 남지 않는다.
    // 폰 화면이 앞에 있을 때 켜 두어야 워치에서 시작해도 화면이 꺼진 채 폰 GPS를 받는다(백그라운드 위치 서비스 시작 제한).
    const granted = await location.requestPermission().catch(() => false);
    if (disposed) {
      // 폐기 뒤 끝난 준비는 dispose가 세션을 취소한다. 러닝 서비스를 다시 켜지 않는다(S15P31E105-814).
      return false;
    }
    await watch
      .setRunActive(true, state.sessionId ?? undefined, { location: true })
      .catch(() => undefined);
    if (granted && recorder) {
      startGps(recorder);
    }
    return true;
  }

  async function attachTo(sessionId: string) {
    const view = await call(() => session.get(sessionId));
    applyView(view, { joined: true });
    flushEarlyCoaching();
    // 재실행 후에도 러닝 중에는 서비스가 다시 떠 있어야 화면이 꺼져도 워치 메시지를 중계한다(AC-C4).
    const ended = state.status !== null && TERMINAL.includes(state.status);
    if (!disposed) {
      await watch
        .setRunActive(!ended, ended ? undefined : sessionId, {
          location: !ended,
        })
        .catch(() => undefined);
    }
    if (ended) {
      await watch.unblockBatches?.(sessionId).catch(noop);
    }
    const pending = view.pendingCommand;
    if (pending?.action === 'SET_BPM' && typeof pending.targetBpm === 'number') {
      bpmInflight = {
        commandId: pending.commandId,
        action: 'SET_BPM',
        expectedVersion: pending.expectedVersion,
        targetBpm: pending.targetBpm,
        coachingId: null,
        result: pending.result,
      };
      const event = early.get(pending.commandId);
      if (event) {
        early.delete(pending.commandId);
        await reportBpm(event);
      }
      return;
    }
    if (!pending || !['START', 'PAUSE', 'RESUME', 'END'].includes(pending.action)) {
      return;
    }
    const action = pending.action as ControlAction;
    const approval: CommandApproval = {
      commandId: pending.commandId,
      action,
      expectedVersion: pending.expectedVersion,
      result: pending.result,
    };
    inflight = approval;
    setState({ pending: { action, commandId: pending.commandId } });
    const event = early.get(pending.commandId);
    if (event) {
      early.delete(pending.commandId);
      await report(action, event);
    } else if (serverCommandOf(view)?.commandId === pending.commandId && view.recordingMode === 'WATCH') {
      // 서버가 승인한 그룹 출발·종료가 아직 유효하다. 같은 명령을 다시 보내 워치가 보관한 결과(또는 첫 실행 결과)를 받는다.
      await deliver(approval);
    } else if (serverCommandOf(view)?.commandId === pending.commandId && view.recordingMode === 'PHONE_ONLY') {
      // 폰으로 기록하는 그룹 참가(S15P31E105-889): 서버가 승인한 출발·종료를 폰이 직접 실행하고 보고한다.
      await executePhone(approval);
    } else {
      setState({ problem: { kind: 'unconfirmed', action } });
    }
  }

  // G16 READY 세션에 붙는다. 워치가 없으면 준비하지 않고 알린다. 이미 출발 명령이 있으면 attachTo가 전달한다.
  // 폰으로 기록하는 세션(PHONE_ONLY, S15P31E105-889)은 워치를 찾거나 준비하지 않는다. 출발은 폰이 직접 실행한다.
  async function joinGroupFlow(sessionId: string, goal: SessionGoalDraft, group: string) {
    groupRunId = group;
    devices = await watch.getLinkedDevices();
    await attachTo(sessionId);
    lastGoal = goal;
    // 대기방에서 준비 완료한 그룹 러닝도 경로용 위치 권한을 묻는다(S15P31E105-549). 거절해도 러닝은 이어간다.
    if ((await location.requestPermission().catch(() => false)) && !disposed) {
      await watch.setRunActive(true, sessionId, { location: true }).catch(noop);
      if (recorder) {
        startGps(recorder);
      }
    }
    if (state.sessionId !== sessionId || state.status !== 'READY' || inflight || phoneMode()) {
      return;
    }
    if (!devices) {
      setState({ problem: { kind: 'watchRequired' } });
      return;
    }
    await prepareWatch(goal);
  }

  // watchAsked: 워치가 CANCEL을 요청했다. 실패를 워치에 ERROR로 알리는 것은 그때만이다(준비 정리용 취소는 알리지 않는다).
  async function doCancel(notifyWatch: boolean, watchAsked = notifyWatch) {
    if (!state.sessionId) {
      return;
    }
    const sessionId = state.sessionId;
    setState({ pending: { action: 'CANCEL', commandId: null }, problem: null });
    try {
      await call(() => session.cancel(sessionId));
      const view = await call(() => session.get(sessionId));
      applyView(view, { pending: null });
      await settleActive();
      if (notifyWatch) {
        await watch.sendServerState(sessionId, view).catch(() => undefined);
      }
    } catch (error) {
      const code = errorCode(error);
      setState({ pending: null, problem: { kind: 'error', code } });
      // 워치 CANCEL을 처리하지 못하면 상태가 아니라 ERROR로 알린다(9.3, 미확정 START면 COMMAND_PENDING).
      if (watchAsked) {
        await watch
          .sendError(sessionId, { code, retryable: false, failedType: 'COMMAND_REQUEST' })
          .catch(() => undefined);
      }
    }
  }

  // S08 TAKE_OVER_PHONE(sessions.md 폰의 데이터 저장·요청 순서). 1) 워치 batch 수신을 멈추고 받은 batch를 고정한다.
  // 2) 고정한 batch 전체의 COMMITTED를 확인하고, 미확인이 있으면 인계를 보류한다. 3) 인계를 요청한다. 응답이 없으면
  // S02로 기록 모드를 확인할 때까지 수신을 계속 막는다. WATCH 유지가 확인된 거절에서만 수신을 다시 연다.
  async function takeOverFlow() {
    const sessionId = state.sessionId;
    const takeOverPhone = session.takeOverPhone;
    const block = watch.blockBatches;
    const phoneId = relayDeviceId ?? devices?.phoneDeviceId ?? null;
    if (
      !sessionId ||
      !takeOverPhone ||
      !block ||
      state.recordingMode !== 'WATCH' ||
      !active() ||
      !state.startedAt
    ) {
      return;
    }
    if (!phoneId) {
      setState({ problem: { kind: 'takeoverFailed', code: 'DEVICE_FORBIDDEN' } });
      return;
    }
    const reopen = () => watch.unblockBatches?.(sessionId).catch(noop);
    setState({ pending: { action: 'TAKE_OVER', commandId: null }, problem: null });
    // 경로 기록용 위치 권한을 먼저 묻는다. 거절해도 인계는 이어가며 시간만 기록한다.
    await location.requestPermission().catch(() => false);
    let frozen: Extract<WatchSessionEvent, { type: 'BATCH_DATA' }>[];
    try {
      frozen = await block(sessionId);
    } catch {
      await reopen();
      setState({ pending: null, problem: { kind: 'takeoverFailed', code: 'UNKNOWN' } });
      return;
    }
    const outcomes = await Promise.all(frozen.map(batch => batches.settle(batch)));
    // 서버가 다시 보내도 소용없다고 거절한 batch(FAILED)는 저장 대기가 아니다. 응답 없는 batch만 인계를 막는다.
    if (outcomes.some(outcome => outcome === 'UNCONFIRMED')) {
      await reopen();
      setState({ pending: null, problem: { kind: 'takeoverHeld' } });
      return;
    }
    let view: RunningSessionView;
    try {
      view = await call(() =>
        takeOverPhone(sessionId, { deviceId: phoneId, expectedVersion: state.stateVersion }),
      );
    } catch (error) {
      const code = errorCode(error);
      // 인계 성공을 추정하지 않는다. 현재 기록 모드를 S02로 확인한다.
      const current = await call(() => session.get(sessionId)).catch(() => null);
      if (!current) {
        setState({ pending: null, problem: { kind: 'takeoverUnconfirmed' } });
        return;
      }
      if (current.recordingMode !== 'PHONE_FALLBACK') {
        await reopen();
        applyView(current, {
          pending: null,
          problem:
            code === 'UPLOAD_PENDING' ? { kind: 'takeoverHeld' } : { kind: 'takeoverFailed', code },
        });
        return;
      }
      view = current;
    }
    if (view.recordingMode !== 'PHONE_FALLBACK') {
      await reopen();
      applyView(view, { pending: null, problem: { kind: 'takeoverFailed', code: 'UNKNOWN' } });
      return;
    }
    // 이전 워치 명령(PENDING/UNKNOWN)은 서버가 UNKNOWN(WATCH_DISCONNECTED)으로 남긴다. 폰은 다시 실행하지 않는다.
    inflight = null;
    bpmInflight = null;
    clearGuide();
    applyView(view, { pending: null, problem: null, watchLost: false });
    // 워치가 연결돼 있으면 폰 기록 전환을 알려 측정·박자를 멈추게 한다.
    watch.sendServerState(sessionId, view, null).catch(noop);
  }

  const currentStatus = (): SessionStatus | null => state.status;

  const sameGoal = (a: SessionGoalDraft, b: SessionGoalDraft) =>
    a.courseId === b.courseId &&
    a.comparisonSessionId === b.comparisonSessionId &&
    a.targetDistanceM === b.targetDistanceM &&
    a.targetDurationSec === b.targetDurationSec &&
    a.targetPaceSecPerKm === b.targetPaceSecPerKm;

  // 미리 만든 준비 세션이 오래됐다. 그 사이 바뀌었을 수 있는 동의·코스 상태로 계획을 다시 받는다(S15P31E105-533).
  const stalePrepared = () => createdAt !== null && now() - createdAt > preparedMaxAgeMs;

  // 목표가 바뀌었거나 오래된 READY 세션을 취소한다. 시작 명령이 남아 있으면 건드리지 않는다.
  // 다시 붙은 개인 세션(앱 재실행 복원·S01 409)은 목표를 모른다. 화면의 목표가 있으면 그 목표로 새로 만든다.
  const dropOutdated = async (
    goal: SessionGoalDraft | null,
  ): Promise<'kept' | 'dropped' | 'failed'> => {
    const changed = !!goal && (lastGoal ? !sameGoal(goal, lastGoal) : groupRunId === null);
    if (!state.sessionId || inflight || state.status !== 'READY' || !(changed || stalePrepared())) {
      return 'kept';
    }
    diag(`prepared session dropped ${changed ? 'goal changed' : 'stale'}`);
    // 워치가 취소된 세션을 준비 상태로 기억하지 않게 서버 상태를 알린다.
    await doCancel(true, false);
    // doCancel이 state를 바꾸므로 좁혀진 타입이 아닌 현재 값을 다시 읽는다.
    if (currentStatus() !== 'CANCELLED') {
      return 'failed';
    }
    setState({ ...initialState });
    preparedFor = null;
    createdAt = null;
    return 'dropped';
  };

  const watchConnected = async () =>
    watch.isWatchConnected ? watch.isWatchConnected().catch(() => false) : true;

  const startFlow = async (asked: SessionGoalDraft | null) => {
    const goal = asked && requestedGoal ? requestedGoal : asked;
    requestedGoal = null;
    // 시작을 누른 사이 준비 취소(화면 이탈)가 먼저 끝났다. 사용자의 시작이면 버리지 않고 새 세션으로 시작한다.
    if (goal && state.status === 'CANCELLED' && !inflight) {
      setState({ ...initialState });
      preparedFor = null;
      createdAt = null;
      lastGoal = null;
    }
    if (state.status && state.status !== 'READY') {
      return;
    }
    flowStart = now();
    mark('start');
    // 워치에서 시작했으면(goal 없음) 이 세션을 만든 목표로 다시 만든다.
    const target = goal ?? lastGoal;
    // 실패한 시작 뒤 다른 목표로 다시 시작하거나 준비가 오래됐으면 남은 준비 세션을 취소하고 새로 만든다.
    if ((await dropOutdated(goal)) === 'failed') {
      return;
    }
    if (!state.sessionId) {
      if (!target || !(await createSession(target, true))) {
        return;
      }
      if (state.status !== 'READY') {
        return;
      }
    }
    // 확인되지 않은 시작이 남아 있으면 새 시작을 만들지 않고 재확인을 기다린다.
    if (inflight) {
      if (!state.problem) {
        setState({ problem: { kind: 'unconfirmed', action: inflight.action } });
      }
      return;
    }
    // 거절·미준비 뒤에는 버전이 바뀌었을 수 있으므로 같은 버전으로 준비가 확인된 경우에만 다시 준비하지 않는다.
    // 워치 연결이 끊겼으면 워치가 준비를 잃었을 수 있어 다시 준비한다.
    const goalNow = target ?? emptyGoal;
    if (phoneMode()) {
      const granted = await location.requestPermission().catch(() => false);
      if (!granted || !(await location.current().catch(() => null)) || !recorder || !(await startGps(recorder))) {
        setState({ problem: { kind: 'locationRequired' } });
        return;
      }
    }
    const reuse =
      phoneMode() ||
      preparedFor?.sessionId === state.sessionId &&
      preparedFor.stateVersion === state.stateVersion &&
      (await watchConnected());
    mark(reuse ? 'prepare reused' : 'prepare needed');
    if (!reuse && !(await prepareWatch(goalNow))) {
      return;
    }
    await control('START');
    // 준비를 다시 쓴 시작을 워치가 준비 없음·버전 불일치로 거절했다. 한 번만 다시 준비해 새 버전으로 시작한다.
    const problem = state.problem as ControlProblem | null;
    if (
      reuse &&
      problem?.kind === 'rejected' &&
      problem.action === 'START' &&
      (problem.reasonCode === 'NOT_PREPARED' || problem.reasonCode === 'VERSION_MISMATCH') &&
      currentStatus() === 'READY' &&
      !inflight
    ) {
      diag(`START retry after ${problem.reasonCode}`);
      if (await prepareWatch(goalNow)) {
        await control('START');
      }
    }
  };

  // '폰으로 시작'(S15P31E105-864). 워치가 등록돼 있지만 시작할 때 쓸 수 없었다(준비 실패·권한 부족 거절). 준비만 된 워치 세션은
  // 취소하고(시작 명령이 없을 때만) 폰 전용 세션을 새로 만들어 시작한다. 시작 결과가 미확인이면 워치가 시작했을 수 있어 건드리지 않는다.
  const phoneStartFlow = async (goal: SessionGoalDraft) => {
    if (groupRunId !== null) {
      return;
    }
    if (inflight) {
      if (!state.problem) {
        setState({ problem: { kind: 'unconfirmed', action: inflight.action } });
      }
      return;
    }
    phoneChosen = true;
    if (state.sessionId && state.status === 'READY' && !phoneMode()) {
      diag('watch session dropped for phone start');
      // 워치가 취소된 세션을 준비 상태로 기억하지 않게 서버 상태를 알린다(연결이 없으면 보내지 못해도 된다).
      await doCancel(true, false);
      if (currentStatus() !== 'CANCELLED') {
        // 취소하지 못했다(그 사이 워치에서 시작됐을 수 있다). 서버 상태를 다시 읽어 맞춘다.
        await refresh().catch(noop);
        return;
      }
      setState({ ...initialState });
      preparedFor = null;
      createdAt = null;
      lastGoal = null;
    }
    await startFlow(goal);
  };

  // 시작 화면의 미리 준비(S15P31E105-533). 실패는 화면에 표시하지 않는다. 시작할 때 같은 단계를 다시 거쳐 알린다.
  const prepareFlow = async (goal: SessionGoalDraft) => {
    // 앞 화면의 준비 취소가 먼저 끝났으면 새로 준비한다.
    if (state.status === 'CANCELLED' && !inflight) {
      setState({ ...initialState });
      preparedFor = null;
      createdAt = null;
      lastGoal = null;
    }
    if ((state.status && state.status !== 'READY') || inflight) {
      return;
    }
    // 앱 재실행으로 다시 붙은 세션은 목표를 모르고 그룹 세션일 수도 있다. 화면에 들어온 것만으로 취소하거나 화면 목표로
    // 워치를 준비하지 않는다. 사용자가 시작을 누를 때 그 목표로 새로 만든다.
    if (state.sessionId && !lastGoal) {
      return;
    }
    flowStart = now();
    mark('prepare');
    try {
      if ((await dropOutdated(goal)) === 'failed') {
        return;
      }
      if (!state.sessionId && !(await createSession(goal))) {
        return;
      }
      if (
        state.status !== 'READY' ||
        inflight ||
        (preparedFor?.sessionId === state.sessionId &&
          preparedFor.stateVersion === state.stateVersion)
      ) {
        return;
      }
      if (!phoneMode()) {
        await prepareWatch(goal);
      }
    } catch (error) {
      diag(`prepare failed ${errorCode(error)}`);
    } finally {
      if (!state.pending && state.problem) {
        setState({ problem: null });
      }
    }
  };

  // 워치 측정 batch는 세션 제어 순서와 별개로 바로 W07에 올린다(제어 메시지를 batch 뒤에 묶지 않는다, 6장).
  const batches = createBatchRelay({ upload: session.uploadBatch, watch });

  const onEvent = (event: WatchSessionEvent) => {
    if (disposed) {
      return;
    }
    if (event.type === 'LIVE_METRICS') {
      // 워치 화면 표시값(S15P31E105-549): 화면 숫자만 맞추고 기록·업로드에는 쓰지 않는다. 인계 뒤에는 무시한다.
      if (event.sessionId === state.sessionId && !phoneMode()) {
        lastWatchDataAt = Date.now();
        if (liveFor !== event.sessionId) {
          live = createLiveMetrics();
          liveFor = event.sessionId;
        }
        const next = live.show(
          {
            measuredAt: event.measuredAt,
            heartRate: event.heartRateBpm,
            cadence: event.cadenceSpm,
            distanceM: event.distanceM,
            paceSecPerKm: event.paceSecPerKm,
          },
          Date.now(),
        );
        if (next) {
          setState({ live: next });
        }
      }
      return;
    }
    if (event.type === 'BATCH_DATA') {
      if (event.sessionId === state.sessionId) {
        lastWatchDataAt = Date.now();
        if (state.watchLost) {
          checkWatch().catch(noop);
        }
        // 인계 뒤에 늦게 온 워치 batch는 화면 값을 바꾸지 않는다(폰이 기록 중이다).
        if (!phoneMode()) {
          ingestLive(event.sessionId, event.body, 'WATCH');
        }
      }
      batches.handle(event);
      return;
    }
    // 폰으로 기록을 넘긴 세션에서는 이전 워치의 결과·요청을 실행하거나 보고하지 않는다(서버도 CONTROL_DEVICE_CHANGED).
    if (phoneMode() && event.sessionId === state.sessionId) {
      if (event.type === 'COMMAND_REQUEST' || event.type === 'START_REQUEST') {
        watch
          .sendError(event.sessionId, {
            code: 'CONTROL_DEVICE_CHANGED',
            retryable: false,
            failedType: event.type,
          })
          .catch(noop);
        return;
      }
      if (event.type === 'COMMAND_RESULT' || event.type === 'COACHING_RESULT') {
        return;
      }
    }
    if (event.type === 'COMMAND_RESULT') {
      const waiter = waiters.get(event.commandId);
      if (waiter) {
        waiter(event);
        return;
      }
      if (reported.has(event.commandId)) {
        return;
      }
      early.set(event.commandId, event);
      // 시간 초과로 미확인이 된 뒤 늦게 온 결과는 바로 보고한다.
      if (
        !busy &&
        inflight?.commandId === event.commandId &&
        state.sessionId === event.sessionId
      ) {
        const action = inflight.action;
        early.delete(event.commandId);
        run(() => report(action, event));
      } else if (
        !busy &&
        bpmInflight?.commandId === event.commandId &&
        state.sessionId === event.sessionId
      ) {
        early.delete(event.commandId);
        run(() => reportBpm(event));
      }
      return;
    }
    if (event.type === 'COACHING_RESULT') {
      if (guideWait?.commandId === event.commandId && guideWait.timer) {
        clearTimeout(guideWait.timer);
        guideWait.timer = null;
      }
      // 워치가 실제로 적용한 코칭만 읽는다(S15P31E105-579). 같은 결과가 다시 와도 announcer가 한 번만 다룬다.
      const applied = knownGuides.get(event.commandId);
      if (event.result === 'APPLIED' && event.sessionId === state.sessionId && applied) {
        announcer?.applied(applied);
      }
      if (!state.sessionId) {
        earlyCoaching.set(event.commandId, event);
        return;
      }
      reportCoaching(event).catch(noop);
      return;
    }
    if (event.sessionId !== state.sessionId) {
      return;
    }
    if (event.type === 'STATE_QUERY') {
      if (event.scope === 'SERVER') {
        answerState(event.sessionId, event.clientSendAt).catch(noop);
      }
      return;
    }
    if (event.type === 'START_REQUEST') {
      runOrQueue(() => startFlow(null));
      return;
    }
    if (event.action === 'SET_BPM') {
      const { expectedVersion, targetBpm } = event;
      const sessionId = event.sessionId;
      // 밀려난 BPM 요청은 서버에 보내지 않았다. 워치가 대기를 풀고 최신 상태로 다시 요청하게 한다(9.5 ERROR, 재시도 가능).
      runOrQueue(
        () => setBpm(expectedVersion, targetBpm),
        () =>
          watch
            .sendError(sessionId, { code: 'COMMAND_PENDING', retryable: true, failedType: 'COMMAND_REQUEST' })
            .catch(noop),
      );
      return;
    }
    if (event.action === 'CANCEL') {
      runOrQueue(() => doCancel(true));
      return;
    }
    const action = event.action;
    runOrQueue(() => control(action));
  };

  const unsubscribe = watch.subscribe(onEvent);

  return {
    getState: () => state,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // 미리 준비·준비 취소가 진행 중이면 끝난 뒤 이어서 시작한다(run은 진행 중인 조작이 있으면 새 조작을 버린다).
    // 진행 중인 시작이 있으면 그것을 기다린다(두 번 눌러도 START 하나).
    start: goal => {
      requestedGoal = goal;
      if (starting) {
        return starting;
      }
      const work = runAfter(() => startFlow(goal));
      starting = work;
      work.finally(() => {
        if (starting === work) {
          starting = null;
        }
      });
      return work;
    },
    // 다른 조작(예: 앞 화면 준비 취소)이 진행 중이면 끝난 뒤 준비한다.
    prepare: goal => runAfter(() => prepareFlow(goal)),
    // S01 응답 전(세션 없음)이어도 진행 중인 준비가 끝난 뒤 판단한다.
    releasePrepared: () =>
      runAfter(async () => {
        if (state.status !== 'READY' || inflight || state.pending) {
          return;
        }
        // 이 제어기가 미리 만든 세션만 취소한다. 앱 재실행·S01 409로 다시 붙은 세션(그룹일 수 있음)은 취소하지 않는다.
        if (createdAt !== null) {
          diag('prepared session released');
          await doCancel(true, false);
          preparedFor = null;
          createdAt = null;
          if (state.status === 'READY') {
            // 취소하지 못했다(이미 만료·취소 등). 그 사이 워치에서 시작됐을 수 있어 서버 상태를 다시 확인한다.
            await refresh().catch(noop);
            await settleActive();
          }
        }
        // 시작하지 않고 준비 화면을 떠났다. '러닝 중' 알림과 wake lock을 남기지 않는다(S15P31E105-814).
        // 취소한 세션은 settleActive가 이미 껐다. 다시 붙은 세션은 사용자가 시작할 때 새로 만들거나 S01 409로 다시 붙는다.
        if (state.status === 'READY') {
          await stopService();
        }
      }),
    attach: sessionId => run(() => attachTo(sessionId)),
    joinGroup: (sessionId, goal, group) => run(() => joinGroupFlow(sessionId, goal, group)),
    sync: () =>
      run(async () => {
        if (!state.sessionId) {
          return;
        }
        const sessionId = state.sessionId;
        const view = await call(() => session.get(sessionId));
        applyView(view);
        await watch.sendServerState(sessionId, view, null).catch(noop);
        await settleActive();
      }),
    pause: () => run(() => control('PAUSE')),
    resume: () => run(() => control('RESUME')),
    finish: () =>
      run(async () => {
        // 그룹이 이미 끝났으면 서버가 만든 그룹 종료 END를 기다린다. 새 END를 요청하면 COMMAND_PENDING이 된다.
        if (groupEndedAt && state.sessionId) {
          const sessionId = state.sessionId;
          const view = await call(() => session.get(sessionId));
          applyView(view);
          relayServerCommand(view);
          return;
        }
        await control('END');
      }),
    cancel: () => run(() => doCancel(false)),
    recheck: () =>
      run(async () => {
        if (!inflight) {
          return;
        }
        setState({ problem: null });
        if (phoneMode()) {
          await executePhone(inflight);
          return;
        }
        await deliver(inflight);
      }),
    takeOver: () => run(takeOverFlow),
    startWithPhone: goal => {
      requestedGoal = goal;
      if (starting) {
        return starting;
      }
      const work = runAfter(() => phoneStartFlow(goal));
      starting = work;
      work.finally(() => {
        if (starting === work) {
          starting = null;
        }
      });
      return work;
    },
    abortUnconfirmedStart: () =>
      run(async () => {
        if (!state.sessionId) {
          return;
        }
        const sessionId = state.sessionId;
        const view = await call(() =>
          session.abortUnconfirmedStart(sessionId, {
            deviceId: relayDeviceId ?? devices?.phoneDeviceId ?? '',
            expectedVersion: state.stateVersion,
          }),
        );
        inflight = null;
        applyView(view, { pending: null, problem: null });
        await settleActive();
      }),
    dispose: () => {
      // 시작하지 않은 준비(그룹 대기방 이탈·로그아웃·그룹 전환 등)나 끝난 운동이면 러닝 서비스를 끈다(S15P31E105-814).
      // 진행 중인 운동과 상태를 모르는 제어기(조회 실패 등)는 그대로 두어 다음 제어기가 이어받는다.
      if (state.status === 'READY' || (state.status !== null && TERMINAL.includes(state.status))) {
        watch.setRunActive(false).catch(noop);
      }
      disposed = true;
      // 이 제어기가 미리 만든 READY 세션은 폐기(그룹 전환·로그아웃 등) 뒤에도 남기지 않는다. 진행 중인 준비(S01 대기 포함)가
      // 끝난 뒤 취소한다. 워치는 다음 제어기가 맡으므로 알리지 않는다.
      if (busy || createdAt !== null) {
        (async () => {
          while (busy) {
            await busy;
          }
          const sessionId = state.sessionId;
          if (sessionId && createdAt !== null && state.status === 'READY' && !inflight && !state.pending) {
            diag('prepared session released on dispose');
            await call(() => session.cancel(sessionId)).catch(noop);
          }
        })().catch(noop);
      }
      stopAnalysis();
      announcer?.reset();
      knownGuides.clear();
      recorder?.dispose();
      recorder = null;
      recorderFor = null;
      stopFixView();
      phoneServiceFor = null;
      if (approxTimer !== null) {
        clearInterval(approxTimer);
        approxTimer = null;
      }
      if (watchTimer !== null) {
        clearInterval(watchTimer);
        watchTimer = null;
      }
      if (groupTimer !== null) {
        clearInterval(groupTimer);
        groupTimer = null;
      }
      stopEvents?.();
      stopEvents = null;
      eventsFor = null;
      clearGuide();
      unsubscribe();
      waiters.forEach(resolve => resolve(null));
      waiters.clear();
      listeners.clear();
    },
  };
}

