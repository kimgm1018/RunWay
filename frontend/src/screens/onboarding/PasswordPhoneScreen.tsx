import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Icon, Screen, TextField, useToast } from '../../components';
import { useRepositories } from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { spacing, useTheme } from '../../theme';
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
import { formatRemaining, usePhoneVerification } from './usePhoneVerification';
import { formatPhoneNumber, isValidPassword } from './validation';

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
  const { colors } = useTheme();
  const { auth } = useRepositories();
  const toast = useToast();
  const phone = usePhoneVerification('PASSWORD_RESET');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const verified = phone.phase === 'verified';
  const sent = phone.phase !== 'idle' && phone.phase !== 'requesting';
  const phoneError = phone.error?.field === 'phone' ? phone.error : null;
  const codeError = phone.error?.field === 'code' ? phone.error : null;
  const passwordOk = isValidPassword(password) && confirm === password;
  const passwordHelper =
    confirm && confirm !== password
      ? { status: 'error' as const, text: '비밀번호가 일치하지 않아요' }
      : passwordOk
      ? {
          status: 'success' as const,
          text: '8자 이상 · 영문·숫자 포함 · 비밀번호가 일치해요',
        }
      : { status: 'default' as const, text: '8자 이상 · 영문·숫자 포함' };

  const submit = async () => {
    if (!phone.token) {
      return;
    }
    setSaving(true);
    setFailed(false);
    try {
      await auth.resetPassword({
        verificationToken: phone.token,
        newPassword: password,
      });
      setSaving(false);
      toast('비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요');
      navigateTo(navigation, 'Login');
    } catch {
      setSaving(false);
      setFailed(true);
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
      <StepTitle title="전화번호로 찾기" />
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
          onChangeText={phone.setPhoneNumber}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          placeholder="010-0000-0000"
          editable={!verified}
          status={phoneError ? 'error' : 'default'}
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
        ) : null}
      </View>

      <View style={styles.step}>
        <StepLabel
          index={2}
          title="인증번호 입력"
          state={verified ? 'done' : sent ? 'active' : 'locked'}
        />
        {sent ? (
          <>
            <TextField
              labelInside
              icon="message"
              label="인증번호"
              value={phone.code}
              onChangeText={phone.setCode}
              editable={phone.codeEditable}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              placeholder="6자리 숫자"
              status={codeError ? 'error' : verified ? 'success' : 'default'}
              accessory={
                verified ? null : (
                  <AppText
                    variant="metricSmall"
                    tone={phone.expired || codeError ? 'danger' : 'text'}
                    style={styles.timer}
                  >
                    {formatRemaining(phone.remainingSec)}
                  </AppText>
                )
              }
            />
            {codeError ? <InlineError>{codeError.message}</InlineError> : null}
            {verified ? (
              <View style={styles.verified}>
                <Icon name="check" color={colors.accentText} size={14} />
                <AppText variant="caption" tone="accentText">
                  인증됐어요
                </AppText>
              </View>
            ) : null}
          </>
        ) : null}
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
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="newPassword"
              status={isValidPassword(password) ? 'success' : 'default'}
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
              status={passwordHelper.status}
              helper={passwordHelper.text}
            />
            {failed ? (
              <InlineError>
                비밀번호를 바꾸지 못했어요. 인증번호를 다시 받아 주세요.
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
  verified: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  timer: { paddingHorizontal: spacing.xs },
});
