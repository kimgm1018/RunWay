import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Screen, type IconName } from '../../components';
import { navigateTo } from '../../navigation/navigateTo';
import { spacing } from '../../theme';
import { IconBadge, OnboardingHeader, SelectionCard, StepTitle } from './parts';
import { useFinishOnboarding } from './SignUpDraft';

type Choice = 'watch' | 'phone';

const choices: {
  value: Choice;
  icon: IconName;
  title: string;
  detail: string;
}[] = [
  {
    value: 'watch',
    icon: 'watch',
    title: '네, 워치와 함께 쓸게요',
    detail: '다음 단계에서 워치를 연결해요',
  },
  {
    value: 'phone',
    icon: 'phone',
    title: '아니요, 휴대폰만 쓸게요',
    detail: '준비도 없이 기록해요 · 나중에 설정에서 연결할 수 있어요',
  },
];

// 1.6w 워치 사용 여부: 네 → 1.7 워치 연결, 휴대폰만 → 2.1 홈.
export function WatchChoiceScreen() {
  const navigation = useNavigation();
  const finish = useFinishOnboarding();
  const [choice, setChoice] = useState<Choice | null>(null);
  return (
    <Screen
      header={<OnboardingHeader onBack={navigation.goBack} />}
      footer={
        <Button
          title="다음"
          variant="inverse"
          disabled={!choice}
          style={styles.flex}
          onPress={() =>
            choice === 'watch' ? navigateTo(navigation, 'WatchConnect') : finish()
          }
        />
      }
    >
      <StepTitle
        title={'갤럭시 워치를\n함께 쓰나요?'}
        description="워치를 연결하면 심박·수면 기록으로 준비도와 러닝 코칭이 더 정확해져요."
      />
      <View accessibilityRole="radiogroup" style={styles.choices}>
        {choices.map(option => (
          <SelectionCard
            key={option.value}
            selected={choice === option.value}
            onPress={() => setChoice(option.value)}
            accessibilityLabel={option.title}
            style={styles.choice}
          >
            <IconBadge
              icon={option.icon}
              tone={choice === option.value ? 'accent' : 'muted'}
            />
            <View style={styles.flex}>
              <AppText
                variant="bodyStrong"
                tone={choice === option.value ? 'accentText' : 'text'}
              >
                {option.title}
              </AppText>
              <AppText variant="caption" tone="textTertiary">
                {option.detail}
              </AppText>
            </View>
          </SelectionCard>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  choices: { gap: spacing.xl },
  choice: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
});
