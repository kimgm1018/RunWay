import React from 'react';
import { useRepositories } from '../../data';
import { isNight } from '../../format';
import type { RouteName } from '../../navigation/routes';
import { ThemeProvider, type ThemeName } from '../../theme';
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
  pick: (night: boolean) => ThemeName,
) {
  function Themed() {
    const { clock } = useRepositories();
    return (
      <ThemeProvider tone={pick(isNight(clock.now()))}>
        <Screen />
      </ThemeProvider>
    );
  }
  Themed.displayName = name;
  return Themed;
}

// The map screens are light by day (2.0·2.0F) and dark after sunset (2.0N).
export const dayNight = (night: boolean): ThemeName =>
  night ? 'dark' : 'light';
// 4.3 일시정지 and 4.5 결과 are dark in every prototype screen. 2.7·2.8 draw their own K1 card on the light tone.
export const dark = (): ThemeName => 'dark';

export const runScreens: Partial<Record<RouteName, React.ComponentType>> = {
  RunMode: RunModeScreen,
  FreeRun: themed(FreeRunScreen, 'FreeRunScreen', dayNight),
  CourseRun: themed(CourseRunScreen, 'CourseRunScreen', dayNight),
  MusicCard: MusicCardScreen,
  MusicSource: MusicSourceScreen,
  // 4.2: the light runway-running-handoff screen by day, the K1 dark map after sunset (S15P31E105-392).
  RunProgress: themed(RunProgressScreen, 'RunProgressScreen', dayNight),
  // 4.3 sits on the K1 background like 1.x (DESIGN.md 2-7).
  RunPause: RunPauseScreen,
  // 4.5 sits on the K1 background; its buttons read the dark tone on the black part.
  RunResult: RunResultScreen,
};
