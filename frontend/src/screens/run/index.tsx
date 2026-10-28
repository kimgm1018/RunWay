import React from 'react';
import { useRepositories } from '../../data';
import { isNight } from '../../format';
import type { RouteName } from '../../navigation/routes';
import { ThemeProvider, type ThemePreference } from '../../theme';
import { CourseRunScreen } from './CourseRunScreen';
import { FreeRunScreen } from './FreeRunScreen';
import { MusicCardScreen } from './MusicCardScreen';
import { MusicSourceScreen } from './MusicSourceScreen';
import { RunModeScreen } from './RunModeScreen';
import { RunPauseScreen } from './RunPauseScreen';
import { RunProgressScreen } from './RunProgressScreen';
import { RunResultScreen } from './RunResultScreen';

export function themed(
  Screen: React.ComponentType,
  name: string,
  pick: (night: boolean) => ThemePreference,
) {
  function Themed() {
    const { clock } = useRepositories();
    return (
      <ThemeProvider initialPreference={pick(isNight(clock.now()))}>
        <Screen />
      </ThemeProvider>
    );
  }
  Themed.displayName = name;
  return Themed;
}

// The map screens are light by day (2.0·2.0F) and dark after sunset (2.0N), whatever the screen mode.
export const dayNight = (night: boolean): ThemePreference =>
  night ? 'dark' : 'light';
// The music card, 4.3 일시정지 and 4.5 결과 are dark in every prototype screen.
export const dark = (): ThemePreference => 'dark';

export const runScreens: Partial<Record<RouteName, React.ComponentType>> = {
  RunMode: RunModeScreen,
  FreeRun: themed(FreeRunScreen, 'FreeRunScreen', dayNight),
  CourseRun: themed(CourseRunScreen, 'CourseRunScreen', dayNight),
  MusicCard: themed(MusicCardScreen, 'MusicCardScreen', dark),
  MusicSource: themed(MusicSourceScreen, 'MusicSourceScreen', dark),
  RunProgress: themed(RunProgressScreen, 'RunProgressScreen', dayNight),
  RunPause: themed(RunPauseScreen, 'RunPauseScreen', dark),
  RunResult: themed(RunResultScreen, 'RunResultScreen', dark),
};
