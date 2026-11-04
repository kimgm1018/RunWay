import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Screen } from '../../components';
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
import { ConsentTermsModal } from './ConsentTermsModal';
import { consentDocuments as consents, type ConsentKey } from './consentTerms';

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
