import {
  applyLevelPreset,
  levelPreset,
  switchPaceInput,
  type PaceForm,
} from '../src/screens/onboarding/runningPresets';
import {
  parseClock,
  parseDistanceKm,
} from '../src/screens/onboarding/validation';

const empty: PaceForm = {
  input: 'duration',
  distance: '',
  clock: '',
  auto: false,
};

test('each level has a recommended distance, finish time and pace', () => {
  expect(levelPreset('BEGINNER')).toEqual({
    distance: '3',
    duration: '20:00',
    pace: '6:40',
  });
  expect(levelPreset('INTERMEDIATE')).toEqual({
    distance: '5',
    duration: '30:00',
    pace: '6:00',
  });
  expect(levelPreset('ADVANCED')).toEqual({
    distance: '10',
    duration: '55:00',
    pace: '5:30',
  });
  // The finish time and the pace tab describe the same run.
  for (const level of ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const) {
    const preset = levelPreset(level);
    const perKm =
      parseClock(preset.duration)! / parseDistanceKm(preset.distance)!;
    expect(Math.round(perKm)).toBe(parseClock(preset.pace));
  }
});

test('picking a level fills an empty form', () => {
  expect(applyLevelPreset(empty, 'INTERMEDIATE')).toEqual({
    input: 'duration',
    distance: '5',
    clock: '30:00',
    auto: true,
  });
  expect(applyLevelPreset({ ...empty, input: 'pace' }, 'BEGINNER')).toEqual({
    input: 'pace',
    distance: '',
    clock: '6:40',
    auto: true,
  });
});

test('changing the level replaces values the level filled in', () => {
  const filled = applyLevelPreset(empty, 'BEGINNER');
  expect(applyLevelPreset(filled, 'ADVANCED')).toEqual({
    input: 'duration',
    distance: '10',
    clock: '55:00',
    auto: true,
  });
});

test('picking a level always resets typed or loaded values to its recommendation', () => {
  const typed: PaceForm = {
    input: 'duration',
    distance: '7',
    clock: '',
    auto: false,
  };
  expect(applyLevelPreset(typed, 'ADVANCED')).toEqual({
    input: 'duration',
    distance: '10',
    clock: '55:00',
    auto: true,
  });
  const saved: PaceForm = {
    input: 'pace',
    distance: '',
    clock: '5:10',
    auto: false,
  };
  expect(applyLevelPreset(saved, 'BEGINNER')).toEqual({
    input: 'pace',
    distance: '',
    clock: '6:40',
    auto: true,
  });
});

test('switching the pace tab refills auto values and clears typed ones', () => {
  const auto = applyLevelPreset(empty, 'INTERMEDIATE');
  expect(switchPaceInput(auto, 'pace', 'INTERMEDIATE')).toEqual({
    input: 'pace',
    distance: '5',
    clock: '6:00',
    auto: true,
  });
  const typed: PaceForm = {
    input: 'duration',
    distance: '7',
    clock: '40:00',
    auto: false,
  };
  expect(switchPaceInput(typed, 'pace', 'INTERMEDIATE')).toEqual({
    input: 'pace',
    distance: '7',
    clock: '',
    auto: false,
  });
  // No level yet: the tab just switches with an empty time.
  expect(switchPaceInput(empty, 'pace', null)).toEqual({
    ...empty,
    input: 'pace',
  });
});
