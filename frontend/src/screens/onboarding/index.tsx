import React from 'react';
import type { AuthRouteName } from '../../navigation/routes';
import { ThemeProvider } from '../../theme';
import { ConsentScreen } from './ConsentScreen';
import { LoginScreen } from './LoginScreen';
import { PasswordFindScreen } from './PasswordFindScreen';
import { PasswordPhoneScreen } from './PasswordPhoneScreen';
import { ProfileBasicScreen } from './ProfileBasicScreen';
import { ProfileRunningScreen } from './ProfileRunningScreen';
import { SignUpScreen } from './SignUpScreen';
import { StartScreen } from './StartScreen';
import { WatchChoiceScreen } from './WatchChoiceScreen';
import { WatchConnectScreen } from './WatchConnectScreen';

export { SignUpDraftProvider } from './SignUpDraft';

// Every 1.x screen in the prototype is dark, and its white buttons need a dark background.
function alwaysDark(Screen: React.ComponentType, name: string) {
  function Dark() {
    return (
      <ThemeProvider initialPreference="dark">
        <Screen />
      </ThemeProvider>
    );
  }
  Dark.displayName = name;
  return Dark;
}

export const onboardingScreens: Record<AuthRouteName, React.ComponentType> = {
  Start: alwaysDark(StartScreen, 'StartScreen'),
  Login: alwaysDark(LoginScreen, 'LoginScreen'),
  SignUp: alwaysDark(SignUpScreen, 'SignUpScreen'),
  Consent: alwaysDark(ConsentScreen, 'ConsentScreen'),
  ProfileBasic: alwaysDark(ProfileBasicScreen, 'ProfileBasicScreen'),
  ProfileRunning: alwaysDark(ProfileRunningScreen, 'ProfileRunningScreen'),
  WatchChoice: alwaysDark(WatchChoiceScreen, 'WatchChoiceScreen'),
  WatchConnect: alwaysDark(WatchConnectScreen, 'WatchConnectScreen'),
  PasswordFind: alwaysDark(PasswordFindScreen, 'PasswordFindScreen'),
  PasswordPhone: alwaysDark(PasswordPhoneScreen, 'PasswordPhoneScreen'),
};
