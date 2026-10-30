import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Screen } from '../../components';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, spacing, useTheme } from '../../theme';
import {
  GoButton,
  IconBadge,
  OnboardingFooter,
  OnboardingHeader,
  StepTitle,
} from './parts';

const steps = ['가입한 전화번호 입력', '인증번호 확인', '새 비밀번호 만들기'];

// 1.2p 비밀번호 찾기: shows the steps before 1.2q starts them, as rows between thin lines.
export function PasswordFindScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  return (
    <Screen
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
      <View style={styles.lock}>
        <IconBadge icon="lock" diameter={56} />
      </View>
      <StepTitle
        title={'비밀번호를\n'}
        muted="잊으셨나요?"
        description="가입할 때 등록한 전화번호로 본인 확인을 하면 새 비밀번호를 만들 수 있어요."
      />
      <View style={[styles.steps, { borderColor: colors.border }]}>
        {steps.map((step, index) => {
          const tone = index === 0 ? 'text' : 'textTertiary';
          return (
            <View
              key={step}
              style={[styles.step, { borderColor: colors.border }]}
            >
              <AppText tone={tone} style={styles.stepNumber}>
                {`0${index + 1}`}
              </AppText>
              <AppText tone={tone}>{step}</AppText>
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lock: { alignItems: 'center', marginTop: spacing.xxxl },
  steps: { borderTopWidth: 1, marginTop: spacing.xxl },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 15,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
  },
  stepNumber: {
    width: 28,
    fontFamily: fontFamily.numberRegular,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1.5,
  },
});
