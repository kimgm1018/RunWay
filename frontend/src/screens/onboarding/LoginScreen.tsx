import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button, Screen, TextField } from '../../components';
import { DataError, errorCode, useRepositories } from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { useSession } from '../../session/SessionProvider';
import { spacing } from '../../theme';
import { ErrorNotice, HeroBackground, Logo, TextLink } from './parts';

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
    default:
      return {
        title: '로그인하지 못했어요.',
        detail: '네트워크 연결을 확인하고 다시 시도해 주세요.',
      };
  }
}

// 1.2 로그인, with the 오류·처리 중 states.
export function LoginScreen() {
  const navigation = useNavigation();
  const { auth } = useRepositories();
  const { signIn } = useSession();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const submit = async () => {
    setLoading(true);
    try {
      const session = await auth.login({ loginId: loginId.trim(), password });
      setLoading(false);
      if (session.onboardingCompleted) {
        signIn();
      } else {
        // The account exists but 1.6 러닝 프로필 was never saved.
        navigateTo(navigation, 'ProfileRunning');
      }
    } catch (error) {
      setLoading(false);
      setFailure(describe(error));
    }
  };

  return (
    <Screen
      scroll
      background={<HeroBackground />}
      contentStyle={styles.content}
    >
      <View style={styles.spacer} />
      <View style={styles.logo}>
        <Logo width={180} />
      </View>
      {failure ? (
        <ErrorNotice title={failure.title} detail={failure.detail} />
      ) : null}
      <TextField
        placeholder="아이디"
        accessibilityLabel="아이디"
        value={loginId}
        onChangeText={setLoginId}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="username"
        status={failure ? 'error' : 'default'}
        returnKeyType="next"
      />
      <TextField
        placeholder="비밀번호"
        accessibilityLabel="비밀번호"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="password"
        status={failure ? 'error' : 'default'}
        returnKeyType="done"
        onSubmitEditing={() => loginId && password && !loading && submit()}
      />
      <TextLink
        title="비밀번호를 잊으셨나요?"
        onPress={() => navigateTo(navigation, 'PasswordFind')}
        style={styles.forgot}
      />
      <Button
        title={loading ? '로그인 중' : '로그인'}
        variant="inverse"
        loading={loading}
        disabled={!loginId.trim() || !password}
        onPress={submit}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xxxl },
  spacer: { flex: 1, minHeight: spacing.xxxl },
  logo: { alignItems: 'center', marginBottom: spacing.xxl },
  forgot: { alignSelf: 'flex-end', marginTop: -spacing.xs },
});
