import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Rect } from 'react-native-svg';
import { AppText, Screen } from '../../components';
import { useRepositories, type SelfReportedLevel } from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily } from '../../theme';
import { StepFooter } from './ProfileBasicScreen';
import {
  ErrorNotice,
  OnboardingHeader,
  onboardingLook,
  onboardingScreen,
  RunnerArt,
  SelectionCard,
  signUpSteps,
  StepTitle,
} from './parts';
import { useSignUpDraft } from './SignUpDraft';
import { applyLevelPreset } from './runningPresets';
import {
  describeRunningSaveError,
  emptyPaceForm,
  PaceCard,
  paceEntryFrom,
  paceFormFrom,
} from './PaceCard';

const levels: { value: SelfReportedLevel; title: string; detail: string }[] = [
  { value: 'BEGINNER', title: '초급', detail: '5km 미만\n주 1회 이하' },
  { value: 'INTERMEDIATE', title: '중급', detail: '5–10km\n주 2–3회' },
  { value: 'ADVANCED', title: '상급', detail: '하프 이상\n주 4회+' },
];

// The handoff's level icon: three rising bars, as many filled as the level.
function LevelBars({ filled }: { filled: number }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      {[
        { x: 4, y: 14, h: 6 },
        { x: 10, y: 10, h: 10 },
        { x: 16, y: 5, h: 15 },
      ].map((bar, index) => (
        <Rect
          key={bar.x}
          x={bar.x}
          y={bar.y}
          width={4}
          height={bar.h}
          rx={1}
          stroke={onboardingLook.ink}
          strokeWidth={1.8}
          fill={index < filled ? onboardingLook.ink : 'none'}
        />
      ))}
    </Svg>
  );
}

// 1.6 초기 설정 — 러닝 수준 (runway-onboarding-handoff 1.6). The pace follows on 1.6b, which saves both (U07).
export function ProfileRunningScreen() {
  const navigation = useNavigation();
  const { profile } = useRepositories();
  const { draft, update } = useSignUpDraft();
  const level = draft.level;
  const form = draft.paceForm ?? emptyPaceForm;

  // A profile saved earlier (U06) fills the level and the pace; both ways of entering the pace stay available.
  useEffect(() => {
    let active = true;
    profile.getRunningProfile().then(
      saved => {
        if (!active || !saved) {
          return;
        }
        // Saved values show as they are; picking a level replaces them with its recommendation.
        update({
          level: saved.selfReportedLevel,
          paceForm: paceFormFrom(saved),
        });
      },
      // Without the saved values the form simply starts empty.
      () => {},
    );
    return () => {
      active = false;
    };
  }, [profile, update]);

  return (
    <Screen
      {...onboardingScreen}
      header={
        <OnboardingHeader
          onBack={navigation.goBack}
          progress={{ current: 5, total: signUpSteps }}
        />
      }
      footer={
        <StepFooter
          title="다음"
          disabled={!level}
          onPress={() => navigateTo(navigation, 'ProfilePace')}
        />
      }
    >
      <RunnerArt />
      <StepTitle title="평소 어떻게 " muted="달리나요?" />
      <View accessibilityRole="radiogroup" style={styles.levels}>
        {levels.map((option, index) => (
          <SelectionCard
            key={option.value}
            selected={level === option.value}
            onPress={() =>
              update({
                level: option.value,
                paceForm: applyLevelPreset(form, option.value),
              })
            }
            accessibilityLabel={`${option.title}, ${option.detail.replace(
              '\n',
              ' ',
            )}`}
            style={styles.level}
          >
            <LevelBars filled={index + 1} />
            <View style={styles.flex}>
              <AppText style={styles.levelTitle}>{option.title}</AppText>
              <AppText style={styles.levelDetail}>
                {option.detail.replace('\n', ' · ')}
              </AppText>
            </View>
          </SelectionCard>
        ))}
      </View>
    </Screen>
  );
}

// 1.6b 초기 설정 — 평소 페이스 (runway-onboarding-handoff 1.6b). Both ways of entering it stay (담당자 결정): 완주 시간
// (distance and time) or the pace itself, now a − / + number.
export function ProfilePaceScreen() {
  const navigation = useNavigation();
  const { profile } = useRepositories();
  const { draft, update } = useSignUpDraft();
  const level = draft.level;
  const form = draft.paceForm ?? emptyPaceForm;
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{
    title: string;
    detail: string;
  } | null>(null);
  const entry = paceEntryFrom(form);

  const save = async () => {
    if (!level || !entry) {
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      // One U07 call saves the level and the pace together.
      await profile.saveRunningProfile({
        selfReportedLevel: level,
        pace: entry,
      });
      setSaving(false);
      navigateTo(navigation, 'WatchChoice');
    } catch (error) {
      setSaving(false);
      setFailure(describeRunningSaveError(error));
    }
  };

  return (
    <Screen
      {...onboardingScreen}
      header={
        <OnboardingHeader
          onBack={navigation.goBack}
          progress={{ current: 6, total: signUpSteps }}
        />
      }
      footer={
        <StepFooter
          title="저장"
          disabled={!level || !entry || saving}
          onPress={save}
        />
      }
    >
      <RunnerArt />
      <StepTitle title="평소 페이스는 " muted="어느 정도예요?" />
      {failure ? (
        <ErrorNotice title={failure.title} detail={failure.detail} />
      ) : null}
      <PaceCard
        form={form}
        onChange={paceForm => update({ paceForm })}
        level={level}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  levels: { gap: 12 },
  level: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  levelTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: onboardingLook.ink,
  },
  levelDetail: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    color: onboardingLook.sub,
  },
});
