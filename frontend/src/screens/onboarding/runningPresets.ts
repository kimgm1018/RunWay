import type { SelfReportedLevel } from '../../data';

export type PaceInput = 'duration' | 'pace';

// auto: the visible values came from the level preset, so they follow the 완주 시간 ↔ 페이스 tab.
export type PaceForm = {
  input: PaceInput;
  distance: string;
  clock: string;
  auto: boolean;
};

// Recommended starting values per level (S15P31E105-366); duration ÷ distance equals the pace.
const presets: Record<
  SelfReportedLevel,
  { distance: string; duration: string; pace: string }
> = {
  BEGINNER: { distance: '3', duration: '20:00', pace: '6:40' },
  INTERMEDIATE: { distance: '5', duration: '30:00', pace: '6:00' },
  ADVANCED: { distance: '10', duration: '55:00', pace: '5:30' },
};

export function levelPreset(level: SelfReportedLevel) {
  return presets[level];
}

function filled(
  form: PaceForm,
  input: PaceInput,
  level: SelfReportedLevel,
): PaceForm {
  const preset = presets[level];
  return input === 'duration'
    ? { input, distance: preset.distance, clock: preset.duration, auto: true }
    : { input, distance: form.distance, clock: preset.pace, auto: true };
}

// Picking a level always resets the form to its recommendation, even over typed or loaded values; it stays editable.
export function applyLevelPreset(form: PaceForm, level: SelfReportedLevel) {
  return filled(form, form.input, level);
}

// 완주 시간 ↔ 페이스: auto values follow the tab; typed time is cleared as before.
export function switchPaceInput(
  form: PaceForm,
  input: PaceInput,
  level: SelfReportedLevel | null,
): PaceForm {
  return level && form.auto
    ? filled(form, input, level)
    : { ...form, input, clock: '' };
}
