import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Screen } from '../../components';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily } from '../../theme';
import {
  CheckCircle,
  GoButton,
  OnboardingFooter,
  OnboardingHeader,
  onboardingLook,
  onboardingScreen,
  RunnerArt,
  signUpSteps,
  StepTitle,
} from './parts';
import { useSignUpDraft } from './SignUpDraft';
import { ConsentTermsModal } from './ConsentTermsModal';
import { consentDocuments as consents, type ConsentKey } from './consentTerms';

// 1.4 개인정보·데이터 이용 동의 (runway-onboarding-handoff): each agreement is its own glass card that turns
// white with an ink rim once checked; 전체 동의 comes first.
export function ConsentScreen() {
  const navigation = useNavigation();
  const { draft, update } = useSignUpDraft();
  const [agreed, setAgreed] = useState<Record<ConsentKey, boolean>>({
    terms: false,
    personal: false,
    location: false,
    health: draft.healthDataAccess === 'AGREEE',
  });
  const [viewing, setViewing] = useState<(typeof consents)[number] | null>(
    null,
  );
  const all = consents.every(item => agreed[item.key]);
  const requiredDone = consents.every(
    item => !item.required || agreed[item.key],
  );
  const toggleAll = () =>
    setAgreed({ terms: !all, personal: !all, location: !all, health: !all });

  return (
    <Screen
      {...onboardingScreen}
      header={
        <OnboardingHeader
          onBack={navigation.goBack}
          progress={{ current: 2, total: signUpSteps }}
        />
      }
      footer={
        <OnboardingFooter>
          <GoButton
            title="동의하고 가입하기"
            disabled={!requiredDone}
            onPress={() => {
              update({
                healthDataAccess: agreed.health ? 'AGREEE' : 'DISAGREE',
              });
              navigateTo(navigation, 'ProfileBasic');
            }}
          />
        </OnboardingFooter>
      }
    >
      <RunnerArt />
      <StepTitle
        title={'데이터 이용에 '}
        muted="동의해 주세요"
        description="위치와 건강 데이터는 코스 추천, 준비도 분석, 페이스 전략에만 써요. 선택 항목은 설정에서 언제든 바꿀 수 있어요."
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="전체 동의"
        accessibilityState={{ checked: all }}
        onPress={toggleAll}
        style={({ pressed }) => [
          styles.card,
          all && styles.cardChecked,
          pressed && styles.pressed,
        ]}
      >
        <CheckCircle checked={all} />
        <AppText style={styles.allText}>전체 동의</AppText>
      </Pressable>
      {consents.map(item => {
        const label = `[${item.required ? '필수' : '선택'}] ${item.title}`;
        const checked = agreed[item.key];
        return (
          <View
            key={item.key}
            style={[styles.card, checked && styles.cardChecked]}
          >
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={label}
              accessibilityState={{ checked }}
              onPress={() =>
                setAgreed(current => ({
                  ...current,
                  [item.key]: !current[item.key],
                }))
              }
              style={({ pressed }) => [
                styles.rowMain,
                pressed && styles.pressed,
              ]}
            >
              <CheckCircle checked={checked} />
              <View style={styles.flex}>
                <AppText style={styles.rowTitle}>{label}</AppText>
                {item.detail ? (
                  <AppText style={styles.rowDetail}>{item.detail}</AppText>
                ) : null}
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.title} 보기`}
              hitSlop={8}
              onPress={() => setViewing(item)}
            >
              <AppText style={styles.view}>보기 ›</AppText>
            </Pressable>
          </View>
        );
      })}
      {viewing ? (
        <ConsentTermsModal
          document={viewing}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  card: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: onboardingLook.glassRim,
    backgroundColor: onboardingLook.glass,
    boxShadow: onboardingLook.glassShadow,
  },
  cardChecked: {
    backgroundColor: onboardingLook.picked,
    borderColor: onboardingLook.ink,
    borderWidth: 1.5,
  },
  allText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    color: onboardingLook.ink,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14 },
  rowTitle: {
    fontFamily: fontFamily.medium,
    fontSize: 14.5,
    lineHeight: 20,
    color: onboardingLook.ink,
  },
  rowDetail: {
    fontFamily: fontFamily.regular,
    fontSize: 11.5,
    lineHeight: 16,
    color: onboardingLook.sub,
  },
  view: {
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
    color: onboardingLook.label,
  },
});
