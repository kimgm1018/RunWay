import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  errorCode,
  useRepositories,
  type CoursePlan,
  type RunGuidance,
  type RunSample,
  type SessionGoalDraft,
} from '../../data';
import {
  createRunControl,
  type RunControl,
  type RunControlState,
} from './runControl';
import { useSession } from '../../session/SessionProvider';
import { createPaceChangeTracker, watchGroupStatus } from '../../watch/groupStatus';
import type { LiveMetrics } from '../../watch/liveMetrics';

export type RunConfig = {
  mode: 'FREE' | 'COURSE' | 'GROUP';
  plan: CoursePlan | null;
  // 6.6 그룹런: the group run this record belongs to.
  groupRunId?: string;
  // Goals are fixed once the run starts (4.3: 목표는 일시정지 중에도 바뀌지 않음).
  goalDistanceM: number | null;
  goalPaceSecPerKm: number | null;
  // 목표 시간(S01 targetDurationSec, S15P31E105-517 목표 설정). 거리·시간·페이스 중 최대 2개만 보낸다(sessions.md).
  goalDurationSec?: number | null;
  // 2.0 경쟁 모드: my earlier run on this course to compare with (S01 comparisonSessionId, S15P31E105-422).
  // Only a course run can compare; the server checks it is mine, completed and on the same course.
  comparisonSessionId?: string | null;
};

export type RunSummary = {
  durationSec: number;
  distanceM: number;
  averagePaceSecPerKm: number | null;
  averageHeartRate: number | null;
  averageCadence: number | null;
};

// 4.5 위쪽 표시: 기록 저장 중 → 기록 저장됨 · 동기화 완료, or a failure with 다시 저장. unconfirmed: the server finished
// the run but its record could not be read back yet, so it is not called lost (S15P31E105-529).
export type SaveState = 'saving' | 'saved' | 'failed' | 'unconfirmed';

type RunState = {
  config: RunConfig;
  startedAt: string;
  sample: RunSample;
  guidance: RunGuidance | null;
  trail: [number, number][];
  status: 'running' | 'paused' | 'finished';
  summary: RunSummary | null;
  saveState: SaveState | null;
  recordId: string | null;
};

type RunActions = {
  start: (config: RunConfig) => void;
  pause: () => void;
  resume: () => void;
  finish: () => void;
  retrySave: () => void;
  // 개인 러닝 세션 제어(S07 준비 취소, 미확인 명령 재확인, S08 시작 미확인 중단). 그룹 모드에서는 아무것도 하지 않는다.
  cancel: () => void;
  recheck: () => void;
  abortStart: () => void;
  // 워치 단절·측정 끊김 때 기록·제어를 폰으로 넘긴다(S08 TAKE_OVER_PHONE, S15P31E105-464).
  takeOver: () => void;
  // 그룹런 대기방 준비 완료(G16)로 서버가 만든 내 READY 세션에 붙어 워치를 준비시킨다(S15P31E105-420). 같은 세션이면 그대로 둔다.
  // 이후 그룹장의 출발(G09)·그룹 종료(G12)는 이 세션의 서버 명령으로 워치에 전달되고, 내 일시정지·종료도 이 세션으로 제어한다.
  joinGroup: (config: RunConfig, sessionId: string) => void;
  // 준비 해제: 서버가 취소한 세션 상태를 워치에 알리고 붙은 세션을 놓는다.
  leaveGroup: () => void;
};

const firstSample: RunSample = {
  elapsedSec: 0,
  distanceM: 0,
  paceSecPerKm: null,
  heartRate: null,
  cadence: null,
  position: null,
};

// 실측값(워치 batch·폰 GPS)이 있으면 그 값을 화면 기록에 쓴다(S15P31E105-517). 운동 시간은 화면 기록의 일시정지 제외
// 시계를 그대로 쓰고, 실측이 없는 값은 비워 둔다(이전 값이나 목업으로 채우지 않는다).
export function withLive(sample: RunSample, live: LiveMetrics | null): RunSample {
  if (!live) {
    return sample;
  }
  return {
    ...sample,
    distanceM: live.distanceM ?? sample.distanceM,
    paceSecPerKm: live.paceSecPerKm,
    heartRate: live.heartRate,
    cadence: live.cadence,
    position:
      live.route.length > 0 ? live.route[live.route.length - 1] : sample.position,
  };
}

// Actions stay the same object for the whole session, so screens that only start a run (2.0's
// 러닝 시작) do not re-render on every reading.
const RunActionsContext = createContext<RunActions | null>(null);
const RunStateContext = createContext<RunState | null>(null);
// 개인 러닝의 서버·워치 확정 상태(요청 중·거절·미확인). 그룹 모드와 시작 전에는 null.
const RunControlContext = createContext<RunControlState | null>(null);
// 앱 재실행·재로그인으로 진행 중인 개인 러닝에 다시 붙었을 때 열 화면. 한 번 열면 비운다.
// 아직 시작하지 않은 준비 세션(READY)은 시작 화면에서 같은 세션으로 이어 시작한다.
type ResumeTarget = 'RunProgress' | 'FreeRun';
const RunResumeContext = createContext<{
  target: ResumeTarget | null;
  consume: () => void;
}>({ target: null, consume: () => undefined });

const TERMINAL = ['COMPLETED', 'CANCELLED', 'INTERRUPTED'];

// 이 앱이 시작하지 않은(다시 붙은) 운동은 코스·목표를 알 수 없으므로 화면 기록은 자유 러닝으로 이어간다.
const joinedConfig: RunConfig = {
  mode: 'FREE',
  plan: null,
  goalDistanceM: null,
  goalPaceSecPerKm: null,
};

const resumeTargetOf = (status: string | null): ResumeTarget | null =>
  // 일시정지된 러닝도 4.2로 연다. 4.2가 재개 · 종료를 그 자리에서 보인다(S15P31E105-517).
  status === 'RUNNING' || status === 'PAUSED'
    ? 'RunProgress'
    : status === 'READY'
    ? 'FreeRun'
    : null;

// The pace the run aims at: the set pace, or the one a distance and a time together make (페이서).
export function goalPaceOf(config: RunConfig): number | null {
  if (config.goalPaceSecPerKm) {
    return config.goalPaceSecPerKm;
  }
  return config.goalDistanceM && config.goalDurationSec
    ? config.goalDurationSec / (config.goalDistanceM / 1000)
    : null;
}

function goalOf(config: RunConfig): SessionGoalDraft {
  return {
    courseId: config.plan?.courseId ?? null,
    comparisonSessionId: config.plan?.courseId
      ? config.comparisonSessionId ?? null
      : null,
    targetDistanceM: config.goalDistanceM,
    targetDurationSec: config.goalDurationSec ?? null,
    targetPaceSecPerKm: config.goalPaceSecPerKm,
  };
}

function average(values: number[]) {
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
}

// Holds the run from 러닝 시작 (2.0·2.0F) through 4.2 진행, 4.3 일시정지 and 4.5 결과.
export function RunSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    run: tracker,
    clock,
    session,
    watchSession,
    phoneLocation,
    groupRuns,
  } = useRepositories();
  const { signedIn } = useSession();
  const [run, setRun] = useState<RunState | null>(null);
  const stopTracking = useRef<(() => void) | null>(null);
  // 개인 러닝의 서버·워치 제어. 그룹 러닝과 시작 전에는 null.
  const controlRef = useRef<RunControl | null>(null);
  const readings = useRef({
    heartRates: [] as number[],
    cadences: [] as number[],
  });
  // The newest measured values from the run control; the tracker's ticks are drawn under them.
  const liveRef = useRef<LiveMetrics | null>(null);

  const track = useCallback(
    (from: RunSample, route: [number, number][] | null) => {
      stopTracking.current?.();
      stopTracking.current = tracker.startTracking(
        from,
        route,
        (tick, guidance) => {
          const live = liveRef.current;
          const sample = withLive(tick, live);
          // With measured values the readings come in as they arrive (below), not once per tick.
          if (!live && sample.heartRate !== null) {
            readings.current.heartRates.push(sample.heartRate);
          }
          if (!live && sample.cadence !== null) {
            readings.current.cadences.push(sample.cadence);
          }
          setRun(current =>
            current && current.status === 'running'
              ? {
                  ...current,
                  sample,
                  guidance,
                  trail:
                    live && live.route.length > 0
                      ? live.route
                      : sample.position
                      ? [...current.trail, sample.position]
                      : current.trail,
                }
              : current,
          );
        },
      );
    },
    [tracker],
  );

  useEffect(() => () => stopTracking.current?.(), []);

  const save = useCallback(
    async (state: RunState, summary: RunSummary, sessionId: string | null) => {
      setRun(current =>
        current ? { ...current, saveState: 'saving' } : current,
      );
      try {
        const { recordId, server } = await tracker.saveRecord({
          mode: state.config.mode,
          courseId: state.config.plan?.courseId ?? null,
          groupRunId: state.config.groupRunId ?? null,
          startedAt: state.startedAt,
          ...summary,
          route: state.trail.length > 1 ? state.trail : null,
          goalDistanceM: state.config.goalDistanceM,
          goalPaceSecPerKm: state.config.goalPaceSecPerKm,
          sessionId,
        });
        setRun(current =>
          current
            ? {
                ...current,
                saveState: 'saved',
                recordId,
                // The result shows the server's totals where it has them, as 기록 보기 does.
                summary:
                  server && current.summary
                    ? {
                        durationSec:
                          server.durationSec ?? current.summary.durationSec,
                        distanceM: server.distanceM ?? current.summary.distanceM,
                        averagePaceSecPerKm:
                          server.averagePaceSecPerKm ??
                          current.summary.averagePaceSecPerKm,
                        averageHeartRate:
                          server.averageHeartRate ??
                          current.summary.averageHeartRate,
                        averageCadence:
                          server.averageCadence ??
                          current.summary.averageCadence,
                      }
                    : current.summary,
              }
            : current,
        );
      } catch (error) {
        const saveState: SaveState =
          errorCode(error) === 'SAVE_UNCONFIRMED' ? 'unconfirmed' : 'failed';
        setRun(current => (current ? { ...current, saveState } : current));
      }
    },
    [tracker],
  );
  // The server session of the personal run on screen; its record shares the id. null for a group run.
  const sessionIdOf = useCallback(
    (state: RunState) =>
      state.config.mode === 'GROUP'
        ? null
        : controlRef.current?.getState().sessionId ?? null,
    [],
  );

  const latest = useRef(run);
  latest.current = run;

  // 휴대폰 화면 안의 기록(지도·숫자·요약). 개인 러닝은 서버가 확정한 상태에 맞춰서만 이 기록을 시작·정지한다.
  const local = useMemo(
    () => ({
      start: (config: RunConfig, startedAt?: string | null) => {
        readings.current = { heartRates: [], cadences: [] };
        const next: RunState = {
          config,
          startedAt: startedAt ?? clock.now().toISOString(),
          sample: firstSample,
          guidance: null,
          trail: [],
          status: 'running',
          summary: null,
          saveState: null,
          recordId: null,
        };
        setRun(next);
        track(firstSample, config.plan?.route ?? null);
      },
      pause: () => {
        stopTracking.current?.();
        stopTracking.current = null;
        setRun(current =>
          current ? { ...current, status: 'paused' } : current,
        );
      },
      resume: () => {
        const run = latest.current;
        if (!run) {
          return;
        }
        setRun({ ...run, status: 'running' });
        track(run.sample, run.config.plan?.route ?? null);
      },
      finish: () => {
        const run = latest.current;
        if (!run) {
          return;
        }
        stopTracking.current?.();
        stopTracking.current = null;
        const { elapsedSec, distanceM } = run.sample;
        const summary: RunSummary = {
          durationSec: elapsedSec,
          distanceM,
          averagePaceSecPerKm:
            distanceM > 0 ? Math.round(elapsedSec / (distanceM / 1000)) : null,
          averageHeartRate: average(readings.current.heartRates),
          averageCadence: average(readings.current.cadences),
        };
        const finished: RunState = { ...run, status: 'finished', summary };
        setRun(finished);
        save(finished, summary, sessionIdOf(finished));
      },
    }),
    [clock, save, sessionIdOf, track],
  );

  const [control, setControl] = useState<RunControlState | null>(null);
  // 새 실측값이 오면 다음 시계 틱을 기다리지 않고 바로 보인다. 평균 심박·케이던스는 받은 값으로 모은다.
  const live = control?.live ?? null;
  useEffect(() => {
    liveRef.current = live;
    if (!live) {
      return;
    }
    if (live.heartRate !== null) {
      readings.current.heartRates.push(live.heartRate);
    }
    if (live.cadence !== null) {
      readings.current.cadences.push(live.cadence);
    }
    setRun(current =>
      current && current.status === 'running'
        ? {
            ...current,
            sample: withLive(current.sample, live),
            trail: live.route.length > 0 ? live.route : current.trail,
          }
        : current,
    );
  }, [live]);
  const stopListening = useRef<(() => void) | null>(null);
  const pendingConfig = useRef<RunConfig | null>(null);
  const [resumeTarget, setResumeTarget] = useState<ResumeTarget | null>(null);
  // 다시 붙은 세션 중 복원 여부를 이미 판단한 세션 ID. 같은 세션을 두 번 복원하지 않는다.
  const judged = useRef<string | null>(null);
  // 지금 붙은 그룹런 참가 세션(S15P31E105-420). 그룹 러닝이어도 이 값이 없으면(목업·준비 전) 화면 기록만 쓴다.
  const groupRef = useRef<{ groupRunId: string; sessionId: string } | null>(null);
  const [groupLink, setGroupLink] = useState<{ groupRunId: string; sessionId: string } | null>(
    null,
  );
  const linkGroup = useCallback((link: { groupRunId: string; sessionId: string } | null) => {
    groupRef.current = link;
    setGroupLink(link);
  }, []);

  useEffect(
    () => () => {
      stopListening.current?.();
      controlRef.current?.dispose();
    },
    [],
  );

  // 서버가 확정한 상태에 맞춰 화면 기록을 시작·정지·종료한다. 승인·요청 중에는 바꾸지 않는다.
  useEffect(() => {
    if (!control) {
      return;
    }
    // 새 러닝을 시작하려다 이미 진행 중인 본인 세션에 붙었다(S01 409 → S02). 새 러닝 대신 그 운동 화면을 연다.
    // 처음 붙었을 때 READY였다면 지금 시작하는 운동이므로 고른 설정 그대로 이어 시작한다.
    if (control.joined && control.sessionId && judged.current !== control.sessionId) {
      judged.current = control.sessionId;
      if (control.status === 'RUNNING' || control.status === 'PAUSED') {
        pendingConfig.current = joinedConfig;
        setResumeTarget(resumeTargetOf(control.status));
      }
    }
    const current = latest.current;
    const config = pendingConfig.current;
    if (control.status === 'RUNNING') {
      if (!current || current.status === 'finished') {
        if (config) {
          local.start(config, control.startedAt);
        }
      } else if (current.status === 'paused') {
        local.resume();
      }
    } else if (control.status === 'PAUSED') {
      if (current?.status === 'running') {
        local.pause();
      } else if ((!current || current.status === 'finished') && config) {
        // 일시정지 중인 운동에 다시 붙었다. 화면 기록을 세션 시작 시각으로 만들고 바로 멈춘다.
        local.start(config, control.startedAt);
        local.pause();
      }
    } else if (control.status === 'COMPLETED') {
      if (current && current.status !== 'finished') {
        local.finish();
      }
    }
  }, [control, local]);

  const newControl = useCallback(() => {
    stopListening.current?.();
    controlRef.current?.dispose();
    const next = createRunControl({
      session,
      watch: watchSession,
      location: phoneLocation,
    });
    controlRef.current = next;
    stopListening.current = next.subscribe(setControl);
    setControl(next.getState());
    return next;
  }, [phoneLocation, session, watchSession]);

  // 로그아웃·계정 전환: 이전 계정의 러닝 제어와 화면 기록을 남기지 않는다. 워치·러닝 서비스의 운동은 그대로 두어
  // 같은 계정으로 다시 로그인하면 아래 복원으로 이어받는다.
  const reset = useCallback(() => {
    linkGroup(null);
    stopListening.current?.();
    stopListening.current = null;
    controlRef.current?.dispose();
    controlRef.current = null;
    stopTracking.current?.();
    stopTracking.current = null;
    pendingConfig.current = null;
    judged.current = null;
    setControl(null);
    setRun(null);
    setResumeTarget(null);
  }, [linkGroup]);

  const drop = useCallback((target: RunControl) => {
    if (controlRef.current !== target) {
      return;
    }
    stopListening.current?.();
    stopListening.current = null;
    target.dispose();
    controlRef.current = null;
    setControl(null);
  }, []);

  // 앱 재실행·재로그인: 러닝 서비스가 기억한 활성 세션을 S02로 확인해 본인의 READY/RUNNING/PAUSED 세션이면 그 화면으로
  // 돌아가고, 수신함에 남은 워치 결과를 서버에 보고한다. 화면 기록은 설정을 알 수 없으므로 자유 러닝으로 이어간다.
  // 다른 계정(403)·삭제(404)·종료된 세션과 조회 실패는 복원하지 않는다. 이때는 새 러닝 시작의 S01 409로 다시 붙는다.
  useEffect(() => {
    if (!signedIn) {
      reset();
      return;
    }
    let active = true;
    watchSession
      .getActiveSessionId()
      .then(sessionId => {
        if (!active || !sessionId || controlRef.current) {
          return;
        }
        pendingConfig.current = joinedConfig;
        const attached = newControl();
        return attached.attach(sessionId).then(() => {
          if (!active || controlRef.current !== attached) {
            return;
          }
          const state = attached.getState();
          const target =
            state.sessionId === sessionId ? resumeTargetOf(state.status) : null;
          if (!target) {
            drop(attached);
            pendingConfig.current = null;
            // 서버에 없는 세션은 러닝 서비스가 더 기억하지 않게 한다. 종료 세션은 attach가 이미 정리한다.
            if (state.problem?.kind === 'error' && state.problem.code === 'SESSION_NOT_FOUND') {
              watchSession.setRunActive(false).catch(() => undefined);
            }
            return;
          }
          judged.current = sessionId;
          setResumeTarget(target);
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [drop, newControl, reset, signedIn, watchSession]);

  // 그룹 러닝 중 G10 현황을 워치에 GROUP_STATUS로 전달한다(S15P31E105-420). 내 운동이 진행 중인 동안만 보낸다.
  const groupActive =
    !!groupLink &&
    control?.sessionId === groupLink.sessionId &&
    (control.status === 'RUNNING' || control.status === 'PAUSED');
  useEffect(() => {
    const send = watchSession.sendGroupStatus;
    if (!groupActive || !groupLink || !send) {
      return;
    }
    const { groupRunId, sessionId } = groupLink;
    // 이 조회 동안 본 공동 페이스 변경만 알린다(S15P31E105-604). 다시 구독하면 새로 시작해 지난 변경은 울리지 않는다.
    // 전송에 실패한 변경은 다시 보내지 않는다. 다음 현황에서 최신값만 조용히 반영된다.
    const paceChange = createPaceChangeTracker();
    return groupRuns.watchLive(
      groupRunId,
      value => {
        const status = watchGroupStatus(groupRunId, value, paceChange.next(value));
        if (status) {
          send(sessionId, status).catch(() => undefined);
        }
      },
      // 조회 실패는 보내지 않는다. 워치가 받지 못한 시간만큼 마지막 값을 지연으로 표시한다.
      // 공동 페이스 비교 기준도 비워, 실패 뒤 첫 값은 조용히 반영한다(S15P31E105-604).
      () => paceChange.reset(),
    );
  }, [groupActive, groupLink, groupRuns, watchSession]);

  const actions = useMemo<RunActions>(() => {
    // 서버 세션으로 제어하는 러닝이면 그 제어기. 그룹 러닝은 내 참가 세션에 붙어 있을 때만이다.
    const personal = () =>
      latest.current?.config.mode === 'GROUP' && !groupRef.current
        ? null
        : controlRef.current;
    const groupControl = (groupRunId: string | undefined) => {
      const link = groupRef.current;
      const target = controlRef.current;
      return link &&
        target &&
        link.groupRunId === groupRunId &&
        target.getState().sessionId === link.sessionId
        ? target
        : null;
    };
    return {
      start: config => {
        const joined = config.mode === 'GROUP' ? groupControl(config.groupRunId) : null;
        if (joined) {
          // 출발은 서버가 확정한 내 세션 상태로만 시작한다(아래 상태 반영). 이미 시작됐으면 그 시각으로 화면 기록을 연다.
          pendingConfig.current = config;
          const state = joined.getState();
          const current = latest.current;
          if (
            (state.status === 'RUNNING' || state.status === 'PAUSED') &&
            (!current || current.status === 'finished')
          ) {
            local.start(config, state.startedAt);
            if (state.status === 'PAUSED') {
              local.pause();
            }
          } else if (current && current.status !== 'finished' && current.config.groupRunId !== config.groupRunId) {
            // 앱 재실행 복원은 설정을 몰라 자유 러닝으로 이어 갔다. 같은 세션이므로 기록은 두고 그룹 설정으로 바꾼다.
            setRun({ ...current, config });
          }
          return;
        }
        if (config.mode === 'GROUP') {
          linkGroup(null);
          // 지난 개인 러닝의 안내·대기 표시가 그룹 화면에 남지 않게 한다.
          stopListening.current?.();
          controlRef.current?.dispose();
          controlRef.current = null;
          setControl(null);
          local.start(config);
          return;
        }
        pendingConfig.current = config;
        const existing = controlRef.current?.getState();
        const reusable =
          existing &&
          existing.sessionId !== null &&
          !TERMINAL.includes(existing.status ?? '');
        const target = reusable ? controlRef.current! : newControl();
        target.start(goalOf(config));
      },
      pause: () => {
        const target = personal();
        if (target) {
          target.pause();
        } else {
          local.pause();
        }
      },
      resume: () => {
        const target = personal();
        if (target) {
          target.resume();
        } else {
          local.resume();
        }
      },
      finish: () => {
        const target = personal();
        if (target) {
          target.finish();
        } else {
          local.finish();
        }
      },
      retrySave: () => {
        const run = latest.current;
        if (run?.summary) {
          save(run, run.summary, sessionIdOf(run));
        }
      },
      cancel: () => {
        controlRef.current?.cancel();
      },
      recheck: () => {
        controlRef.current?.recheck();
      },
      abortStart: () => {
        controlRef.current?.abortUnconfirmedStart();
      },
      takeOver: () => {
        controlRef.current?.takeOver();
      },
      joinGroup: (config, sessionId) => {
        const groupRunId = config.groupRunId;
        if (!groupRunId) {
          return;
        }
        const existing = controlRef.current?.getState();
        if (
          groupRef.current?.sessionId === sessionId &&
          existing?.sessionId === sessionId &&
          !TERMINAL.includes(existing.status ?? '')
        ) {
          return;
        }
        pendingConfig.current = config;
        // 그룹 세션은 이 앱이 이어 붙는 것이라 재실행 복원 화면을 따로 열지 않는다.
        judged.current = sessionId;
        const target = newControl();
        linkGroup({ groupRunId, sessionId });
        target.joinGroup(sessionId, goalOf(config), groupRunId);
      },
      leaveGroup: () => {
        if (!groupRef.current) {
          return;
        }
        const target = controlRef.current;
        linkGroup(null);
        pendingConfig.current = null;
        if (target) {
          target.sync().finally(() => drop(target));
        }
      },
    };
  }, [drop, linkGroup, local, newControl, save, sessionIdOf]);

  const resume = useMemo(
    () => ({ target: resumeTarget, consume: () => setResumeTarget(null) }),
    [resumeTarget],
  );

  return (
    <RunActionsContext.Provider value={actions}>
      <RunStateContext.Provider value={run}>
        <RunControlContext.Provider value={control}>
          <RunResumeContext.Provider value={resume}>
            {children}
          </RunResumeContext.Provider>
        </RunControlContext.Provider>
      </RunStateContext.Provider>
    </RunActionsContext.Provider>
  );
}

export function useRunActions() {
  const actions = useContext(RunActionsContext);
  if (!actions) {
    throw new Error('useRunActions must be used inside RunSessionProvider');
  }
  return actions;
}

// For screens that show the run; they re-render with every reading.
export function useRunSession() {
  return { run: useContext(RunStateContext), ...useRunActions() };
}

// 개인 러닝의 요청 중·거절·미확인 표시용.
export function useRunControlState() {
  return useContext(RunControlContext);
}

// 재실행 후 진행 중인 러닝 화면을 다시 연다(재실행 복구). MainTabs가 한 번 사용한다.
export function useRunResume() {
  return useContext(RunResumeContext);
}
