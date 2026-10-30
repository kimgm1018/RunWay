import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { ProfileEditScreen } from './ProfileEditScreen';
import { SettingsScreen } from './SettingsScreen';
import {
  WithdrawDoneScreen,
  WithdrawPasswordScreen,
  WithdrawScreen,
} from './WithdrawScreens';

// 8.x 설정 · 계정. 8.2 is dark like 7.4b; the rest sit on the K1 background.
export const settingsScreens: Partial<Record<RouteName, React.ComponentType>> =
  {
    Settings: SettingsScreen,
    ProfileEdit: ProfileEditScreen,
    Withdraw: WithdrawScreen,
    WithdrawPassword: WithdrawPasswordScreen,
    WithdrawDone: WithdrawDoneScreen,
  };
