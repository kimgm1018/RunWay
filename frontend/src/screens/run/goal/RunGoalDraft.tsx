import React, { createContext, useContext, useMemo, useState } from 'react';
import type { RunGoal } from './runGoal';

// The goal set on the run start map, shared by 2.0F and 2.0 (S15P31E105-683): picking a course on 3.1 keeps the
// goal already set, and dropping the course keeps it too.
type Draft = { goal: RunGoal; setGoal: (goal: RunGoal) => void };

const RunGoalDraftContext = createContext<Draft | null>(null);

export function RunGoalDraftProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [goal, setGoal] = useState<RunGoal>({ kind: 'NONE' });
  const value = useMemo(() => ({ goal, setGoal }), [goal]);
  return (
    <RunGoalDraftContext.Provider value={value}>
      {children}
    </RunGoalDraftContext.Provider>
  );
}

// Outside the provider (a screen rendered on its own) the goal stays the screen's own.
export function useRunGoalDraft(): Draft {
  const shared = useContext(RunGoalDraftContext);
  const [goal, setGoal] = useState<RunGoal>({ kind: 'NONE' });
  return shared ?? { goal, setGoal };
}

// The map's goal on a course, whose distance is fixed: a time stays a time, a pace a pace (also when it came with a
// distance or a time), and 거리 + 시간 becomes the pace they make. A distance alone or no goal leaves the course its own
// default (null).
export function courseGoalOf(goal: RunGoal): RunGoal | null {
  switch (goal.kind) {
    case 'TIME':
    case 'PACE':
      return goal;
    case 'DISTANCE_PACE':
    case 'TIME_PACE':
      return { kind: 'PACE', paceSecPerKm: goal.paceSecPerKm };
    case 'PACER':
      return {
        kind: 'PACE',
        paceSecPerKm: Math.round(goal.durationSec / (goal.distanceM / 1000)),
      };
    default:
      return null;
  }
}
