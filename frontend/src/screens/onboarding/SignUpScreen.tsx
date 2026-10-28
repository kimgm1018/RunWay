import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Screen, TextField } from '../../components';
import { useRepositories, type LoginIdAvailability } from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { radius, spacing, useTheme } from '../../theme';
import { FieldChip, OnboardingHeader, StepTitle } from './parts';
import { useSignUpDraft } from './SignUpDraft';
import { formatRemaining, usePhoneVerification } from './usePhoneVerification';
import {
  formatPhoneNumber,
  isValidLoginId,
  isValidPassword,
  loginIdRule,
  passwordChecks,
} from './validation';

const passwordLabels = { length: '8자 이상', letter: '영문', digit: '숫자' };

// Waits for typing to pause before asking U16 whether the ID is free.
const checkDelayMs = 400;

function useLoginIdCheck(loginId: string) {
  const { auth } = useRepositories();
  const [result, setResult] = useState<LoginIdAvailability | null>(null);
  const [failed, setFailed] = useState(false);
  const valid = isValidLoginId(loginId);
  useEffect(() => {
    setFailed(false);
    if (!valid) {
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      auth.checkLoginId(loginId).then(
        availability => active && setResult(availability),
        () => active && setFailed(true),
      );
    }, checkDelayMs);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [auth, loginId, valid]);
  // A late answer for an earlier input is ignored (U16 echoes loginId for this).
  const current = result?.loginId === loginId ? result : null;
  return { valid, result: current, failed };
}

// 1.3 회원가입
export function SignUpScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { draft, update } = useSignUpDraft();
  const [loginId, setLoginId] = useState(draft.loginId);
  const [password, setPassword] = useState(draft.password);
  const [confirm, setConfirm] = useState(draft.password);
  const idCheck = useLoginIdCheck(loginId);
  const phone = usePhoneVerification('SIGN_UP');
  const checks = passwordChecks(password);

  const idState = !loginId
    ? { status: 'default' as const, helper: loginIdRule }
    : !idCheck.valid
    ? { status: 'error' as const, helper: `${loginIdRule}로 입력해 주세요` }
    : idCheck.failed
    ? {
        status: 'error' as const,
        helper: '아이디를 확인하지 못했어요. 잠시 후 다시 입력해 주세요',
      }
    : !idCheck.result
    ? { status: 'default' as const, helper: '사용할 수 있는지 확인하는 중이에요' }
    : idCheck.result.available
    ? {
        status: 'success' as const,
        helper: `사용할 수 있는 아이디예요 · ${loginIdRule}`,
      }
    : { status: 'error' as const, helper: '이미 사용 중인 아이디예요' };

  const confirmState = !confirm
    ? { status: 'default' as const, helper: undefined }
    : confirm === password
    ? { status: 'success' as const, helper: '비밀번호가 일치해요' }
    : { status: 'error' as const, helper: '비밀번호가 일치하지 않아요' };

  const verified = phone.phase === 'verified';
  const codeVisible = phone.phase === 'sent' || phone.phase === 'verifying';
  const phoneChip = verified ? (
    <FieldChip title="인증 완료" />
  ) : phone.phase === 'idle' ? (
    <FieldChip
      title="인증번호 받기"
      tone="accent"
      disabled={!phone.phoneValid}
      onPress={phone.request}
    />
  ) : (
    <FieldChip
      title={phone.phase === 'requesting' ? '보내는 중' : '다시 받기'}
      disabled={phone.phase === 'requesting'}
      onPress={phone.request}
    />
  );
  const phoneHelper = verified
    ? {
        status: 'success' as const,
        helper: '본인 인증됐어요 · 비밀번호를 잊었을 때 이 번호로 찾아요',
      }
    : phone.error?.field === 'phone'
    ? { status: 'error' as const, helper: phone.error.message }
    : {
        status: 'default' as const,
        helper: '본인 인증에 쓰고, 비밀번호를 잊었을 때 이 번호로 찾아요',
      };

  const ready =
    idState.status === 'success' &&
    isValidPassword(password) &&
    confirm === password &&
    verified;

  return (
    <Screen
      header={<OnboardingHeader onBack={navigation.goBack} />}
      footer={
        <Button
          title="다음"
          variant="inverse"
          disabled={!ready}
          style={styles.flex}
          onPress={() => {
            update({
              loginId,
              password,
              phoneNumber: phone.phoneNumber,
            });
            navigateTo(navigation, 'Consent');
          }}
        />
      }
    >
      <StepTitle title="계정을 만들어요" />
      <TextField
        label="아이디"
        value={loginId}
        onChangeText={setLoginId}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={16}
        textContentType="username"
        status={idState.status}
        helper={idState.helper}
      />
      <View style={styles.group}>
        <TextField
          label="비밀번호"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="newPassword"
          status={password && isValidPassword(password) ? 'success' : 'default'}
        />
        <View style={styles.checks}>
          {(Object.keys(passwordLabels) as (keyof typeof checks)[]).map(key => (
            <View
              key={key}
              accessibilityLabel={`${passwordLabels[key]} ${
                checks[key] ? '충족' : '미충족'
              }`}
              style={[
                styles.check,
                {
                  borderColor: checks[key] ? colors.accent : colors.borderStrong,
                },
              ]}
            >
              <AppText
                variant="label"
                tone={checks[key] ? 'accentText' : 'textTertiary'}
              >
                {checks[key] ? '✓ ' : ''}
                {passwordLabels[key]}
              </AppText>
            </View>
          ))}
        </View>
      </View>
      <TextField
        label="비밀번호 확인"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        textContentType="newPassword"
        status={confirmState.status}
        helper={confirmState.helper}
      />
      <TextField
        label="전화번호"
        value={formatPhoneNumber(phone.phoneNumber)}
        onChangeText={phone.setPhoneNumber}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        placeholder="010-0000-0000"
        status={phoneHelper.status}
        helper={phoneHelper.helper}
        accessory={phoneChip}
      />
      {codeVisible ? (
        <TextField
          label="인증번호"
          value={phone.code}
          onChangeText={phone.setCode}
          editable={phone.codeEditable}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          placeholder="6자리 숫자"
          status={phone.error?.field === 'code' ? 'error' : 'default'}
          helper={
            phone.error?.field === 'code'
              ? phone.error.message
              : '문자로 받은 인증번호 6자리를 입력해 주세요'
          }
          accessory={
            <AppText
              variant="metricSmall"
              tone={phone.expired ? 'danger' : 'accentText'}
              style={styles.timer}
            >
              {formatRemaining(phone.remainingSec)}
            </AppText>
          }
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: spacing.md },
  checks: { flexDirection: 'row', gap: spacing.sm },
  check: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  timer: { paddingHorizontal: spacing.lg },
});
