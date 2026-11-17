import React, { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { Screen, TextField } from '../../components';
import {
  errorCode,
  useRepositories,
  type DataErrorCode,
  type LoginIdAvailability,
} from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import {
  FieldChip,
  GoButton,
  KeyboardBackdrop,
  OnboardingFooter,
  OnboardingHeader,
  onboardingScreen,
  RunnerArt,
  signUpSteps,
  StepTitle,
  useKeyboardOpen,
} from './parts';
import { useSignUpDraft } from './SignUpDraft';
import { PhoneCodeStep } from './PhoneCodeStep';
import { usePhoneVerification } from './usePhoneVerification';
import { useCleanText } from './useCleanText';
import {
  cleanLoginId,
  cleanPassword,
  formatPhoneNumber,
  isValidLoginId,
  confirmGuide,
  isValidPassword,
  loginIdCharsNotice,
  loginIdRule,
  passwordCharsNotice,
  passwordGuide,
  passwordRule,
  phoneNumberError,
} from './validation';

// Waits for typing to pause before asking U16 whether the ID is free (users.md suggests about 500ms).
const checkDelayMs = 500;

function useLoginIdCheck(loginId: string) {
  const { auth } = useRepositories();
  const [result, setResult] = useState<LoginIdAvailability | null>(null);
  const [failure, setFailure] = useState<DataErrorCode | null>(null);
  const valid = isValidLoginId(loginId);
  useEffect(() => {
    setFailure(null);
    if (!valid) {
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      auth.checkLoginId(loginId).then(
        availability => active && setResult(availability),
        error => active && setFailure(errorCode(error)),
      );
    }, checkDelayMs);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [auth, loginId, valid]);
  // A late answer for an earlier input is ignored (U16 echoes loginId for this).
  const current = result?.loginId === loginId ? result : null;
  // The server's format check (400) agrees with isValidLoginId, so it reads as the same format error.
  return {
    valid: valid && failure !== 'VALIDATION_ERROR',
    result: current,
    failed: failure !== null && failure !== 'VALIDATION_ERROR',
  };
}

// 1.3 회원가입
export function SignUpScreen() {
  const navigation = useNavigation();
  const { draft, update } = useSignUpDraft();
  // 쓸 수 없는 문자는 입력 즉시 지우고 그 이유를 칸 아래에 알린다(S15P31E105-773).
  const [loginId, setLoginId, idDropped] = useCleanText(
    draft.loginId,
    cleanLoginId,
  );
  const [password, setPassword, passwordDropped] = useCleanText(
    draft.password,
    cleanPassword,
  );
  const [confirm, setConfirm, confirmDropped] = useCleanText(
    draft.password,
    cleanPassword,
  );
  const idCheck = useLoginIdCheck(loginId);
  const phone = usePhoneVerification('SIGN_UP');
  // 휴대폰 번호 칸을 한 번 벗어나면 자릿수 부족도 알린다.
  const [phoneDone, setPhoneDone] = useState(false);

  // 아무것도 입력하지 않았으면 안 글씨(규칙)만 보이고 아래 안내는 없다(S15P31E105-646).
  const idState = idDropped
    ? { status: 'error' as const, helper: loginIdCharsNotice }
    : !loginId
    ? { status: 'default' as const, helper: undefined }
    : !idCheck.valid
    ? { status: 'error' as const, helper: `${loginIdRule}로 입력해 주세요` }
    : idCheck.failed
    ? {
        status: 'error' as const,
        helper: '아이디를 확인하지 못했어요. 잠시 후 다시 입력해 주세요',
      }
    : !idCheck.result
    ? // 확인 중에는 문구 없이 기다린다. 결과(사용 가능·이미 사용 중)만 알린다(S15P31E105-646).
      { status: 'default' as const, helper: undefined }
    : idCheck.result.available
    ? {
        status: 'success' as const,
        helper: '사용할 수 있는 아이디예요',
      }
    : { status: 'error' as const, helper: '이미 사용 중인 아이디예요' };

  const passwordState = passwordDropped
    ? { status: 'error' as const, helper: passwordCharsNotice }
    : passwordGuide(password, loginId);
  const confirmState = confirmDropped
    ? { status: 'error' as const, helper: passwordCharsNotice }
    : confirmGuide(password, confirm);

  const verified = phone.phase === 'verified';
  // 인증을 마친 뒤에도 체크와 '인증 완료'를 보여 준다(S15P31E105-646).
  const codeVisible =
    phone.phase === 'sent' ||
    phone.phase === 'verifying' ||
    phone.phase === 'verified';
  const phoneChip = verified ? (
    <FieldChip title="인증 완료" tone="accent" />
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
  // 기본 안내 문구는 두지 않는다(S15P31E105-646 담당자 결정). 인증 완료와 오류만 알린다.
  // 서버가 받지 않는 번호(010 + 8자리가 아님)는 인증 요청 전에 칸 아래에 이유를 보인다(S15P31E105-781).
  const phoneFormatError = phoneNumberError(phone.phoneNumber, phoneDone);
  const phoneHelper = verified
    ? { status: 'success' as const, helper: '본인 인증됐어요' }
    : phone.error?.field === 'phone'
    ? { status: 'error' as const, helper: phone.error.message }
    : phoneFormatError
    ? { status: 'error' as const, helper: phoneFormatError }
    : { status: 'default' as const, helper: undefined };

  const ready =
    // 지운 문자 안내가 떠 있어도 남은 아이디가 확인됐으면 넘어갈 수 있다(S15P31E105-773 리뷰 B-4).
    idCheck.valid &&
    !idCheck.failed &&
    idCheck.result?.available === true &&
    isValidPassword(password, loginId) &&
    confirm === password &&
    verified;
  // Like 1.2 로그인: with the keyboard up the runner steps aside, so the fields sit near the top (S15P31E105-902).
  const keyboardOpen = useKeyboardOpen();

  return (
    <Screen
      {...onboardingScreen}
      background={
        keyboardOpen ? <KeyboardBackdrop /> : onboardingScreen.background
      }
      header={
        <OnboardingHeader
          onBack={navigation.goBack}
          progress={{ current: 1, total: signUpSteps }}
        />
      }
      footer={
        <OnboardingFooter>
          <GoButton
            title="다음"
            disabled={!ready}
            onPress={() => {
              update({
                loginId,
                password,
                phoneNumber: phone.phoneNumber,
                phoneVerificationToken: phone.token,
              });
              navigateTo(navigation, 'Consent');
            }}
          />
        </OnboardingFooter>
      }
    >
      {keyboardOpen ? null : <RunnerArt />}
      <StepTitle title="계정을 " muted="만들어요" />
      <TextField
        labelInside
        icon="person"
        label="아이디"
        placeholder={loginIdRule}
        value={loginId}
        onChangeText={setLoginId}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={16}
        textContentType="username"
        status={idState.status}
        helper={idState.helper}
      />
      <TextField
        labelInside
        icon="padlock"
        label="비밀번호"
        placeholder={passwordRule}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="newPassword"
        status={passwordState.status}
        helper={passwordState.helper}
      />
      <TextField
        labelInside
        icon="shieldCheck"
        label="비밀번호 확인"
        placeholder="한 번 더 입력해 주세요"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        textContentType="newPassword"
        status={confirmState.status}
        helper={confirmState.helper}
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
        status={phoneHelper.status}
        helper={phoneHelper.helper}
        accessory={phoneChip}
      />
      {/* 인증번호 입력(S15P31E105-646): 6칸 타일, 확인 중 점·성공 체크·실패 흔들림, 다시 받기 안내. */}
      {codeVisible ? <PhoneCodeStep phone={phone} /> : null}
    </Screen>
  );
}
