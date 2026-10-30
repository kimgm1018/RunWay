import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, BottomSheet, Button, Screen } from '../../components';
import { navigateTo } from '../../navigation/navigateTo';
import { spacing, useTheme } from '../../theme';
import {
  CheckCircle,
  GoButton,
  OnboardingFooter,
  OnboardingHeader,
  StepTitle,
} from './parts';
import { useSignUpDraft } from './SignUpDraft';

type ConsentKey = 'terms' | 'personal' | 'location' | 'health';

// The four W04 consent types. Health data is optional: refusing it only hides readiness.
const consents: {
  key: ConsentKey;
  required: boolean;
  title: string;
  detail?: string;
}[] = [
  { key: 'terms', required: true, title: '서비스 이용약관' },
  {
    key: 'personal',
    required: true,
    title: '개인정보 수집·이용',
    detail: '아이디·닉네임·성별·생년월일·전화번호 · 계정 관리',
  },
  {
    key: 'location',
    required: true,
    title: '위치 정보 수집·이용',
    detail: '현재 위치·러닝 경로 · 코스 추천, 기록',
  },
  {
    key: 'health',
    required: false,
    title: '건강 데이터 이용',
    detail: '수면·심박·활동량 · 준비도, 페이스 전략',
  },
];

// 1.4 개인정보·데이터 이용 동의. 전체 동의 is the first row of one light card (DESIGN.md 2-5).
export function ConsentScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
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
      header={<OnboardingHeader onBack={navigation.goBack} />}
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
      <StepTitle
        title={'데이터 이용에\n'}
        muted="동의해 주세요"
        description="위치와 건강 데이터는 코스 추천, 준비도 분석, 페이스 전략에만 써요. 선택 항목은 설정에서 언제든 바꿀 수 있어요."
      />
      <View
        style={[
          styles.list,
          {
            backgroundColor: colors.inputBackground,
            borderColor: colors.inputEdge,
          },
        ]}
      >
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel="전체 동의"
          accessibilityState={{ checked: all }}
          onPress={toggleAll}
          style={styles.all}
        >
          <CheckCircle checked={all} />
          <AppText variant="bodyMedium">전체 동의</AppText>
        </Pressable>
        {consents.map(item => {
          const label = `[${item.required ? '필수' : '선택'}] ${item.title}`;
          return (
            <View
              key={item.key}
              style={[styles.row, { borderTopColor: colors.border }]}
            >
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={label}
                accessibilityState={{ checked: agreed[item.key] }}
                onPress={() =>
                  setAgreed(current => ({
                    ...current,
                    [item.key]: !current[item.key],
                  }))
                }
                style={styles.rowMain}
              >
                <CheckCircle checked={agreed[item.key]} />
                <View style={styles.flex}>
                  <AppText>{label}</AppText>
                  {item.detail ? (
                    <AppText variant="caption" tone="textTertiary">
                      {item.detail}
                    </AppText>
                  ) : null}
                </View>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.title} 보기`}
                hitSlop={8}
                onPress={() => setViewing(item)}
              >
                <AppText variant="caption" tone="textTertiary">
                  보기 ›
                </AppText>
              </Pressable>
            </View>
          );
        })}
      </View>
      <BottomSheet
        visible={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing?.title}
        description={viewing?.detail}
      >
        <AppText variant="caption" tone="textTertiary">
          약관 전문은 정책이 확정되면 이곳에 연결해요.
        </AppText>
        <Button
          title="확인"
          variant="secondary"
          size="medium"
          onPress={() => setViewing(null)}
        />
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: {
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.xs,
  },
  all: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.xl,
    borderTopWidth: 1,
  },
  rowMain: { flex: 1, flexDirection: 'row', gap: spacing.xl },
});
