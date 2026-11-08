import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Icon, Screen, type IconName } from '../../components';
import { errorCode, useRepositories } from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily } from '../../theme';
import {
  ErrorNotice,
  GoButton,
  IconBadge,
  OnboardingFooter,
  OnboardingHeader,
  onboardingLook,
  onboardingScreen,
  RunnerArt,
  SelectionCard,
  signUpSteps,
  StepTitle,
} from './parts';
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
    icon: 'smartwatch',
    title: '네, 워치와 함께 쓸게요',
    detail: '다음 단계에서 워치를 연결해요',
  },
  {
    value: 'phone',
    icon: 'handset',
    title: '아니요, 휴대폰만 쓸게요',
    detail: '준비도 없이 기록해요 · 나중에 설정에서 연결할 수 있어요',
  },
];

// 1.6w 워치 사용 여부: 네 → 1.7 워치 연결, 휴대폰만 → 2.1 홈.
export function WatchChoiceScreen() {
  const navigation = useNavigation();
  const { watch } = useRepositories();
  const finish = useFinishOnboarding();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [linking, setLinking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // 네 links the watch to my account (W01) first, so 1.7 opens on a registered watch.
  const linkWatch = async () => {
    setLinking(true);
    setFailed(null);
    try {
      await watch.reconnect();
      setLinking(false);
      navigateTo(navigation, 'WatchConnect');
    } catch (error) {
      setLinking(false);
      setFailed(
        errorCode(error) === 'NETWORK_ERROR'
          ? '네트워크 연결을 확인하고 다시 시도해 주세요.'
          : '잠시 후 다시 시도해 주세요.',
      );
    }
  };
  return (
    <Screen
      {...onboardingScreen}
      header={
        <OnboardingHeader
          onBack={navigation.goBack}
          progress={{ current: signUpSteps, total: signUpSteps }}
        />
      }
      footer={
        <OnboardingFooter>
          <GoButton
            title="다음"
            disabled={!choice || linking}
            onPress={() => (choice === 'watch' ? linkWatch() : finish())}
          />
        </OnboardingFooter>
      }
    >
      <RunnerArt />
      <StepTitle
        title={'갤럭시 워치를 '}
        muted="함께 쓰나요?"
        description="워치를 연결하면 심박·수면 기록으로 준비도와 러닝 코칭이 더 정확해져요."
      />
      {failed ? (
        <ErrorNotice title="워치를 등록하지 못했어요." detail={failed} />
      ) : null}
      <View accessibilityRole="radiogroup" style={styles.choices}>
        {choices.map(option => (
          <SelectionCard
            key={option.value}
            selected={choice === option.value}
            onPress={() => setChoice(option.value)}
            accessibilityLabel={option.title}
            style={styles.choice}
          >
            <IconBadge icon={option.icon} />
            <View style={styles.flex}>
              <AppText style={styles.title}>{option.title}</AppText>
              <AppText style={styles.detail}>{option.detail}</AppText>
            </View>
            {/* The picked card ends in an ink check (runway-onboarding-handoff 1.6w). */}
            {choice === option.value ? (
              <View style={styles.check}>
                <Icon name="check" color="#FFFFFF" size={12} strokeWidth={3} />
              </View>
            ) : null}
          </SelectionCard>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  choices: { gap: 12 },
  choice: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: onboardingLook.ink,
  },
  detail: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    color: onboardingLook.sub,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: onboardingLook.ink,
  },
});
