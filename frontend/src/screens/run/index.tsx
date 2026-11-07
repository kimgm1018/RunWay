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
// 4.5 결과 is dark in every prototype screen. 2.7·2.8 draw their own K1 card on the light tone.
export const dark = (): ThemeName => 'dark';

export const runScreens: Partial<Record<RouteName, React.ComponentType>> = {
  RunMode: RunModeScreen,
  FreeRun: themed(FreeRunScreen, 'FreeRunScreen', dayNight),
  CourseRun: themed(CourseRunScreen, 'CourseRunScreen', dayNight),
  MusicCard: MusicCardScreen,
  MusicSource: MusicSourceScreen,
  // 4.2 (with 4.3 일시정지 folded in) is one dark frame day and night (S15P31E105-517).
  RunProgress: themed(RunProgressScreen, 'RunProgressScreen', dark),
  // 4.5 sits on the K1 background; its buttons read the dark tone on the black part.
  RunResult: RunResultScreen,
};
