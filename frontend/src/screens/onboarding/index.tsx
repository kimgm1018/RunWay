import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { AuthRouteName } from '../../navigation/routes';
import { ConsentScreen } from './ConsentScreen';
import { LoginScreen } from './LoginScreen';
import { PasswordPhoneScreen } from './PasswordPhoneScreen';
import {
  ProfileBasicScreen,
  ProfileBirthdayScreen,
} from './ProfileBasicScreen';
import {
  ProfilePaceScreen,
  ProfileRunningScreen,
} from './ProfileRunningScreen';
import { SignUpScreen } from './SignUpScreen';
import { StartScreen } from './StartScreen';
import { WatchChoiceScreen } from './WatchChoiceScreen';
import { WatchConnectScreen } from './WatchConnectScreen';
import { noteOnboardingTouch } from './look';

export { SignUpDraftProvider } from './SignUpDraft';

// 1.x screens use the light tone on top and OnboardingFooter's dark tone for the black lower part (DESIGN.md 2-5).
const screens: Record<AuthRouteName, React.ComponentType> = {
  Start: StartScreen,
  Login: LoginScreen,
  SignUp: SignUpScreen,
  Consent: ConsentScreen,
  ProfileBasic: ProfileBasicScreen,
  ProfileBirthday: ProfileBirthdayScreen,
  ProfileRunning: ProfileRunningScreen,
  ProfilePace: ProfilePaceScreen,
  WatchChoice: WatchChoiceScreen,
  WatchConnect: WatchConnectScreen,
  PasswordPhone: PasswordPhoneScreen,
};

const fill = StyleSheet.create({ screen: { flex: 1 } }).screen;

// Every touch on a 1.x screen rests the runner art for a moment (S15P31E105-802). Touch events bubble, so one
// View around the screen sees them all without taking them.
function withRunnerRest(Screen: React.ComponentType): React.ComponentType {
  function Resting() {
    return (
      <View style={fill} onTouchStart={noteOnboardingTouch}>
        <Screen />
      </View>
    );
  }
  Resting.displayName = `Resting(${Screen.displayName ?? Screen.name})`;
  return Resting;
}

export const onboardingScreens = Object.fromEntries(
  Object.entries(screens).map(([name, Screen]) => [
    name,
    withRunnerRest(Screen),
  ]),
) as Record<AuthRouteName, React.ComponentType>;
