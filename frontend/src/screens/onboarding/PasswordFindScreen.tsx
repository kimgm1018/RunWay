import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Card, Screen } from '../../components';
import { navigateTo } from '../../navigation/navigateTo';
import { spacing } from '../../theme';
import { IconBadge, OnboardingHeader, StepBadge, StepTitle } from './parts';

const steps = ['가입한 전화번호 입력', '인증번호 확인', '새 비밀번호 만들기'];

// 1.2p 비밀번호 찾기: shows the steps before 1.2q starts them.
export function PasswordFindScreen() {
  const navigation = useNavigation();
  return (
    <Screen
      header={<OnboardingHeader onBack={navigation.goBack} />}
      footer={
        <Button
          title="전화번호로 찾기"
          variant="inverse"
          style={styles.flex}
          onPress={() => navigateTo(navigation, 'PasswordPhone')}
        />
      }
    >
      <IconBadge icon="lock" tone="accent" />
      <StepTitle
        title={'비밀번호를\n잊으셨나요?'}
        description="가입할 때 등록한 전화번호로 본인 확인을 하면 새 비밀번호를 만들 수 있어요."
      />
      <Card style={styles.steps}>
        {steps.map((step, index) => (
          <View key={step} style={styles.step}>
            <StepBadge
              index={index + 1}
              state={index === 0 ? 'active' : 'locked'}
            />
            <AppText
              variant="bodyStrong"
              tone={index === 0 ? 'text' : 'textDisabled'}
            >
              {step}
            </AppText>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  steps: { gap: spacing.xl },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
});
