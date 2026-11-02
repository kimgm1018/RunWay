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

export type RunConfig = {
  mode: 'FREE' | 'COURSE' | 'GROUP';
  plan: CoursePlan | null;
  // 6.6 그룹런: the group run this record belongs to.
  groupRunId?: string;
  // Goals are fixed once the run starts (4.3: 목표는 일시정지 중에도 바뀌지 않음).
  goalDistanceM: number | null;
  goalPaceSecPerKm: number | null;
};

export type RunSummary = {
  durationSec: number;
  distanceM: number;
  averagePaceSecPerKm: number | null;
  averageHeartRate: number | null;
  averageCadence: number | null;
};

// 4.5 위쪽 표시: 기록 저장 중 → 기록 저장됨 · 동기화 완료, or a failure with 다시 저장.
export type SaveState = 'saving' | 'saved' | 'failed';

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
};

const firstSample: RunSample = {
  elapsedSec: 0,
  distanceM: 0,
  paceSecPerKm: null,
  heartRate: null,
  cadence: null,
  position: null,
};

// Actions stay the same object for the whole session, so screens that only start a run (2.0's
// 러닝 시작) do not re-render on every reading.
const RunActionsContext = createContext<RunActions | null>(null);
const RunStateContext = createContext<RunState | null>(null);
// 개인 러닝의 서버·워치 확정 상태(요청 중·거절·미확인). 그룹 모드와 시작 전에는 null.
const RunControlContext = createContext<RunControlState | null>(null);
// 앱 재실행으로 진행 중인 개인 러닝에 다시 붙었을 때 열 화면. 한 번 열면 비운다.
type ResumeTarget = 'RunProgress' | 'RunPause';
const RunResumeContext = createContext<{
  target: ResumeTarget | null;
  consume: () => void;
}>({ target: null, consume: () => undefined });

const TERMINAL = ['COMPLETED', 'CANCELLED', 'INTERRUPTED'];

function goalOf(config: RunConfig): SessionGoalDraft {
  return {
    courseId: config.plan?.courseId ?? null,
    comparisonSessionId: null,
    targetDistanceM: config.goalDistanceM,
    targetDurationSec: null,
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
  const { run: tracker, clock, session, watchSession } = useRepositories();
  const [run, setRun] = useState<RunState | null>(null);
  const stopTracking = useRef<(() => void) | null>(null);
  const readings = useRef({
    heartRates: [] as number[],
    cadences: [] as number[],
  });

  const track = useCallback(
    (from: RunSample, route: [number, number][] | null) => {
      stopTracking.current?.();
      stopTracking.current = tracker.startTracking(
        from,
        route,
        (sample, guidance) => {
          if (sample.heartRate !== null) {
            readings.current.heartRates.push(sample.heartRate);
          }
          if (sample.cadence !== null) {
            readings.current.cadences.push(sample.cadence);
          }
          setRun(current =>
            current && current.status === 'running'
              ? {
                  ...current,
                  sample,
                  guidance,
                  trail: sample.position
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
    async (state: RunState, summary: RunSummary) => {
      setRun(current =>
        current ? { ...current, saveState: 'saving' } : current,
      );
      try {
        const { recordId } = await tracker.saveRecord({
          mode: state.config.mode,
          courseId: state.config.plan?.courseId ?? null,
          groupRunId: state.config.groupRunId ?? null,
          startedAt: state.startedAt,
          ...summary,
          route: state.trail.length > 1 ? state.trail : null,
          goalDistanceM: state.config.goalDistanceM,
          goalPaceSecPerKm: state.config.goalPaceSecPerKm,
        });
        setRun(current =>
          current ? { ...current, saveState: 'saved', recordId } : current,
        );
      } catch {
        setRun(current =>
          current ? { ...current, saveState: 'failed' } : current,
        );
      }
    },
    [tracker],
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
        save(finished, summary);
      },
    }),
    [clock, save, track],
  );

  const [control, setControl] = useState<RunControlState | null>(null);
  const controlRef = useRef<RunControl | null>(null);
  const stopListening = useRef<(() => void) | null>(null);
  const pendingConfig = useRef<RunConfig | null>(null);
  const [resumeTarget, setResumeTarget] = useState<ResumeTarget | null>(null);

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
    const current = latest.current;
    if (control.status === 'RUNNING') {
      if (!current || current.status === 'finished') {
        if (pendingConfig.current) {
          local.start(pendingConfig.current, control.startedAt);
        }
      } else if (current.status === 'paused') {
        local.resume();
      }
    } else if (control.status === 'PAUSED') {
      if (current?.status === 'running') {
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
    const next = createRunControl({ session, watch: watchSession });
    controlRef.current = next;
    stopListening.current = next.subscribe(setControl);
    setControl(next.getState());
    return next;
  }, [session, watchSession]);

  // 앱 재실행: 러닝 서비스가 기억한 활성 세션에 다시 붙어 수신함에 남은 워치 결과를 서버에 보고한다.
  // 화면 기록은 설정을 알 수 없으므로 자유 러닝으로 이어간다.
  useEffect(() => {
    let active = true;
    watchSession
      .getActiveSessionId()
      .then(sessionId => {
        if (!active || !sessionId || controlRef.current) {
          return;
        }
        pendingConfig.current = {
          mode: 'FREE',
          plan: null,
          goalDistanceM: null,
          goalPaceSecPerKm: null,
        };
        const attached = newControl();
        return attached.attach(sessionId).then(() => {
          const status = attached.getState().status;
          if (active && controlRef.current === attached) {
            setResumeTarget(
              status === 'RUNNING' ? 'RunProgress' : status === 'PAUSED' ? 'RunPause' : null,
            );
          }
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [newControl, watchSession]);

  const actions = useMemo<RunActions>(() => {
    const personal = () =>
      latest.current?.config.mode === 'GROUP' ? null : controlRef.current;
    return {
      start: config => {
        if (config.mode === 'GROUP') {
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
          save(run, run.summary);
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
    };
  }, [local, newControl, save]);

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
