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
} from '../../data';

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
  const { run: tracker, clock } = useRepositories();
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

  const actions = useMemo<RunActions>(
    () => ({
      start: config => {
        readings.current = { heartRates: [], cadences: [] };
        const next: RunState = {
          config,
          startedAt: clock.now().toISOString(),
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
      retrySave: () => {
        const run = latest.current;
        if (run?.summary) {
          save(run, run.summary);
        }
      },
    }),
    [clock, save, track],
  );

  return (
    <RunActionsContext.Provider value={actions}>
      <RunStateContext.Provider value={run}>
        {children}
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
