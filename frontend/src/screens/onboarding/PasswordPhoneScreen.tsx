import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Screen, TextField, useToast } from '../../components';
import { errorCode, useRepositories } from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { spacing } from '../../theme';
import {
  FieldChip,
  GoButton,
  InlineError,
  OnboardingFooter,
  OnboardingHeader,
  onboardingScreen,
  RunnerArt,
  StepBadge,
  StepTitle,
  TextLink,
} from './parts';
import { PhoneCodeStep } from './PhoneCodeStep';
import { usePhoneVerification } from './usePhoneVerification';
import { useCleanText } from './useCleanText';
import {
  cleanPassword,
  confirmGuide,
  formatPhoneNumber,
  isValidPassword,
  passwordCharsNotice,
  passwordGuide,
  passwordRule,
  passwordSameAsIdRule,
  phoneNumberError,
} from './validation';

// U30 failures that used up the proof or leave it in doubt: verify the number again (users.md U30). A 5xx such as
// 503 SERVICE_UNAVAILABLE reaches the app as SERVER_ERROR.
const reverify = new Set([
  'VERIFICATION_EXPIRED',
  'PHONE_NOT_REGISTERED',
  'PHONE_ACCOUNT_AMBIGUOUS',
  'SERVER_ERROR',
]);

function StepLabel({
  index,
  title,
  state,
}: {
  index: number;
  title: string;
  state: 'active' | 'done' | 'locked';
}) {
  return (
    <View style={styles.stepLabel}>
      <StepBadge index={index} state={state} />
      <AppText
        variant="bodyMedium"
        tone={state === 'locked' ? 'textTertiary' : 'text'}
      >
        {title}
      </AppText>
    </View>
  );
}

// 1.2q 전화번호로 비밀번호 찾기, with 1.2r 가입되지 않은 번호 and 1.2s 인증번호 오류.
// Phone → code → new password fill in from top to bottom on one screen.
export function PasswordPhoneScreen() {
  const navigation = useNavigation();
  const { auth } = useRepositories();
  const toast = useToast();
  const phone = usePhoneVerification('PASSWORD_RESET');
  // 쓸 수 없는 문자는 입력 즉시 지우고 이유를 알린다(S15P31E105-773).
  const [password, setPassword, passwordDropped] = useCleanText(
    '',
    cleanPassword,
  );
  const [confirm, setConfirm, confirmDropped] = useCleanText(
    '',
    cleanPassword,
  );
  const [saving, setSaving] = useState(false);
  // 'policy': the server turned the password down and the proof still holds; 'retry': the answer was lost.
  const [failed, setFailed] = useState<'policy' | 'retry' | null>(null);

  const verified = phone.phase === 'verified';
  const sent = phone.phase !== 'idle' && phone.phase !== 'requesting';
  const phoneError = phone.error?.field === 'phone' ? phone.error : null;
  // 서버가 받지 않는 번호(010 + 8자리가 아님)는 인증 요청 전에 칸 아래에 이유를 보인다(S15P31E105-781).
  const [phoneDone, setPhoneDone] = useState(false);
  const phoneFormatError = verified
    ? null
    : phoneNumberError(phone.phoneNumber, phoneDone);
  const passwordOk = isValidPassword(password) && confirm === password;
  // 회원가입과 같은 안내(S15P31E105-627). 서버가 정책 위반(422)으로 돌려보내면 증명은 그대로 두고 규칙을 알린다.
  // 길이·문자는 앱이 먼저 막으므로 남는 원인은 그 번호 회원의 아이디와 같은 비밀번호다(users.md U30, S15P31E105-773).
  const passwordState = passwordDropped
    ? { status: 'error' as const, helper: passwordCharsNotice }
    : failed === 'policy'
    ? { status: 'error' as const, helper: passwordSameAsIdRule }
    : passwordGuide(password);
  const confirmState = confirmDropped
    ? { status: 'error' as const, helper: passwordCharsNotice }
    : confirmGuide(password, confirm);

  const changePassword = (text: string) => {
    setPassword(text);
    if (failed === 'policy') {
      setFailed(null);
    }
  };

  const submit = async () => {
    if (!phone.token) {
      return;
    }
    setSaving(true);
    setFailed(null);
    try {
      await auth.resetPassword({
        verificationToken: phone.token,
        newPassword: password,
      });
      setSaving(false);
      toast('비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요');
      navigateTo(navigation, 'Login');
    } catch (caught) {
      setSaving(false);
      const failure = errorCode(caught);
      if (failure === 'INVALID_PASSWORD_POLICY') {
        // The proof was not used (users.md U30), so only the password needs to change.
        setFailed('policy');
      } else if (reverify.has(failure)) {
        phone.restart(caught);
      } else {
        setFailed('retry');
      }
    }
  };

  return (
    <Screen
      {...onboardingScreen}
      header={
        <OnboardingHeader
          onBack={navigation.goBack}
          progress={{ current: verified ? 3 : sent ? 2 : 1, total: 3 }}
        />
      }
      footer={
        <OnboardingFooter>
          <GoButton
            title="변경하고 로그인하기"
            disabled={!verified || !passwordOk || saving}
            onPress={submit}
          />
        </OnboardingFooter>
      }
    >
      <RunnerArt />
      <StepTitle title={'비밀번호를 '} muted="잊으셨나요?" />
      <View style={styles.step}>
        <StepLabel
          index={1}
          title="전화번호 확인"
          state={verified ? 'done' : 'active'}
        />
        <TextField
          labelInside
          icon="handset"
          label="전화번호"
          value={formatPhoneNumber(phone.phoneNumber)}
          onChangeText={text => {
            phone.setPhoneNumber(text);
            setPhoneDone(false);
          }}
          onBlur={() => setPhoneDone(true)}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          placeholder="010-0000-0000"
          editable={!verified}
          status={phoneError || phoneFormatError ? 'error' : 'default'}
          accessory={
            sent ? (
              <FieldChip
                title="다시 받기"
                disabled={verified}
                onPress={phone.request}
              />
            ) : (
              <FieldChip
                title={
                  phone.phase === 'requesting' ? '보내는 중' : '인증번호 받기'
                }
                tone="accent"
                disabled={!phone.phoneValid || phone.phase === 'requesting'}
                onPress={phone.request}
              />
            )
          }
        />
        {phoneError ? (
          <>
            <InlineError>{phoneError.message}</InlineError>
            {phoneError.code === 'PHONE_NOT_REGISTERED' ? (
              <View style={styles.signUp}>
                <AppText variant="caption" tone="textSecondary">
                  처음이신가요? ·
                </AppText>
                <TextLink
                  title="회원가입"
                  strong
                  onPress={() => navigateTo(navigation, 'SignUp')}
                />
              </View>
            ) : null}
          </>
        ) : phoneFormatError ? (
          <InlineError>{phoneFormatError}</InlineError>
        ) : null}
      </View>

      <View style={styles.step}>
        <StepLabel
          index={2}
          title="인증번호 입력"
          state={verified ? 'done' : sent ? 'active' : 'locked'}
        />
        {/* 인증번호 입력(S15P31E105-646): 6칸 타일, 성공 체크·실패 흔들림, 다시 받기 안내. */}
        {sent ? <PhoneCodeStep phone={phone} /> : null}
      </View>

      <View style={styles.step}>
        <StepLabel
          index={3}
          title="새 비밀번호"
          state={verified ? 'active' : 'locked'}
        />
        {verified ? (
          <>
            <TextField
              labelInside
              icon="padlock"
              label="새 비밀번호"
              placeholder={passwordRule}
              value={password}
              onChangeText={changePassword}
              secureTextEntry
              textContentType="newPassword"
              status={passwordState.status}
              helper={passwordState.helper}
            />
            <TextField
              labelInside
              icon="shieldCheck"
              label="비밀번호 확인"
              accessibilityLabel="새 비밀번호 확인"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              textContentType="newPassword"
              placeholder="한 번 더 입력해 주세요"
              status={confirmState.status}
              helper={confirmState.helper}
            />
            {failed === 'retry' ? (
              <InlineError>
                비밀번호를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.
              </InlineError>
            ) : null}
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  step: { gap: spacing.md },
  stepLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  signUp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm,
  },
});
