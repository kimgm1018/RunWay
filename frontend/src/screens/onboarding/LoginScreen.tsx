import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Screen, TextField } from '../../components';
import { DataError, errorCode, useRepositories } from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { useSession } from '../../session/SessionProvider';
import { spacing } from '../../theme';
import {
  GoButton,
  InlineError,
  OnboardingFooter,
  OnboardingHeader,
  onboardingScreen,
  RunnerArt,
  StepTitle,
  TextLink,
} from './parts';

type Failure = { title: string; detail?: string };

function describe(error: unknown): Failure {
  switch (errorCode(error)) {
    case 'INVALID_CREDENTIALS': {
      const count = error instanceof DataError ? error.failedCount : null;
      return {
        title: '아이디 또는 비밀번호가 맞지 않아요.',
        detail: `5회 실패 시 10분간 제한돼요${count ? ` (${count}/5)` : ''}`,
      };
    }
    case 'LOGIN_LOCKED':
      return {
        title: '로그인을 5회 실패해 10분간 제한돼요.',
        detail: '잠시 후 다시 시도하거나 비밀번호를 찾아 주세요.',
      };
    // U01 400: the server checks the format before the password, and it does not count as a failure.
    case 'VALIDATION_ERROR':
      return {
        title: '아이디 또는 비밀번호가 맞지 않아요.',
        detail: '아이디는 영문·숫자 4~16자, 비밀번호는 공백 없이 8~20자예요.',
      };
    case 'NETWORK_ERROR':
      return {
        title: '로그인하지 못했어요.',
        detail: '네트워크 연결을 확인하고 다시 시도해 주세요.',
      };
    // U01 503: the auth store could not be reached, which is not a wrong password.
    case 'SERVER_ERROR':
      return {
        title: '로그인하지 못했어요.',
        detail: '서버에 잠시 문제가 있어요. 잠시 후 다시 시도해 주세요.',
      };
    default:
      return {
        title: '로그인하지 못했어요.',
        detail: '잠시 후 다시 시도해 주세요.',
      };
  }
}

// 1.2 로그인, with the 오류·처리 중 states. The error sits under the fields in coral (DESIGN.md 2-5).
export function LoginScreen() {
  const navigation = useNavigation();
  const { auth } = useRepositories();
  const { signIn, holdTokens } = useSession();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const submit = async () => {
    setLoading(true);
    try {
      const session = await auth.login({ loginId: loginId.trim(), password });
      setLoading(false);
      const tokens = {
        userId: session.user.id,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        refreshExpiresAt: session.refreshExpiresAt,
      };
      if (session.onboardingCompleted) {
        signIn(tokens);
      } else {
        // The account exists but 1.6 러닝 프로필 was never saved. Finishing onboarding signs in with these tokens.
        holdTokens(tokens);
        navigateTo(navigation, 'ProfileRunning');
      }
    } catch (error) {
      setLoading(false);
      setFailure(describe(error));
    }
  };

  return (
    <Screen
      {...onboardingScreen}
      header={<OnboardingHeader onBack={navigation.goBack} />}
      footer={
        <OnboardingFooter>
          <GoButton
            title={loading ? '로그인 중' : '로그인'}
            disabled={loading || !loginId.trim() || !password}
            onPress={submit}
          />
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
        </OnboardingFooter>
      }
    >
      {/* runway-onboarding-handoff 1.2: the runner and a title in place of the big wordmark. */}
      <RunnerArt />
      <StepTitle
        title="다시 달려볼까요?"
        description="아이디로 로그인하고 오늘의 러닝을 이어가요."
      />
      <View style={styles.fields}>
        <TextField
          labelInside
          icon="person"
          label="아이디"
          placeholder="아이디를 입력해 주세요"
          value={loginId}
          onChangeText={setLoginId}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="username"
          status={failure ? 'error' : 'default'}
          returnKeyType="next"
        />
        <TextField
          labelInside
          icon="padlock"
          label="비밀번호"
          placeholder="비밀번호를 입력해 주세요"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
          status={failure ? 'error' : 'default'}
          returnKeyType="done"
          onSubmitEditing={() => loginId && password && !loading && submit()}
        />
        {failure ? (
          <InlineError>
            {failure.title}
            {failure.detail ? ` ${failure.detail}` : ''}
          </InlineError>
        ) : null}
      </View>
      <TextLink
        title="비밀번호를 잊으셨나요?"
        onPress={() => navigateTo(navigation, 'PasswordFind')}
        style={styles.forgot}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fields: { gap: 12 },
  forgot: { alignSelf: 'flex-end' },
  signUp: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
