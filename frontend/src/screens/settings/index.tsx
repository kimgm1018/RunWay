import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { LocationSettingScreen } from './LocationSettingScreen';
import { ProfileEditScreen } from './ProfileEditScreen';
import { RunningBaselineEditScreen } from './RunningBaselineEditScreen';
import { SettingsScreen } from './SettingsScreen';
import {
  WithdrawDoneScreen,
  WithdrawPasswordScreen,
  WithdrawScreen,
} from './WithdrawScreens';

// 8.x 설정 · 계정 (runway-settings): all on the mist, 8.1b 위치 기록 split from 8.1.
export const settingsScreens: Partial<Record<RouteName, React.ComponentType>> =
  {
    Settings: SettingsScreen,
    LocationSetting: LocationSettingScreen,
    ProfileEdit: ProfileEditScreen,
    RunningBaselineEdit: RunningBaselineEditScreen,
    Withdraw: WithdrawScreen,
    WithdrawPassword: WithdrawPasswordScreen,
    WithdrawDone: WithdrawDoneScreen,
  };
