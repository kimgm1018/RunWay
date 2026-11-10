import React from 'react';
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

export { SignUpDraftProvider } from './SignUpDraft';

// 1.x screens use the light tone on top and OnboardingFooter's dark tone for the black lower part (DESIGN.md 2-5).
export const onboardingScreens: Record<AuthRouteName, React.ComponentType> = {
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
