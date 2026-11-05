import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Icon, type IconName, Screen } from '../../components';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily } from '../../theme';
import {
  GoButton,
  OnboardingFooter,
  OnboardingHeader,
  onboardingLook,
  onboardingScreen,
  RunnerArt,
  StepTitle,
} from './parts';

const steps: { title: string; icon: IconName }[] = [
  { title: '가입한 전화번호 입력', icon: 'handset' },
  { title: '인증번호 확인', icon: 'message' },
  { title: '새 비밀번호 만들기', icon: 'key' },
];

// 1.2p 비밀번호 찾기: shows the steps before 1.2q starts them, as glass cards with their number at the end
// (runway-onboarding-handoff).
export function PasswordFindScreen() {
  const navigation = useNavigation();
  return (
    <Screen
      {...onboardingScreen}
      header={<OnboardingHeader onBack={navigation.goBack} />}
      footer={
        <OnboardingFooter>
          <GoButton
            title="전화번호로 찾기"
            onPress={() => navigateTo(navigation, 'PasswordPhone')}
          />
        </OnboardingFooter>
      }
    >
      <RunnerArt />
      <StepTitle
        title={'비밀번호를 '}
        muted="잊으셨나요?"
        description="가입할 때 등록한 전화번호로 본인 확인을 하면 새 비밀번호를 만들 수 있어요."
      />
      {steps.map((step, index) => (
        <View key={step.title} style={styles.step}>
          <Icon name={step.icon} color={onboardingLook.ink} size={20} />
          <AppText style={styles.stepTitle}>{step.title}</AppText>
          <AppText style={styles.stepNumber}>{`0${index + 1}`}</AppText>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  step: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: onboardingLook.glassRim,
    backgroundColor: onboardingLook.glass,
    boxShadow: onboardingLook.glassShadow,
  },
  stepTitle: {
    flex: 1,
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: onboardingLook.ink,
  },
  stepNumber: {
    fontFamily: fontFamily.numberMedium,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1,
    color: onboardingLook.label,
  },
});
