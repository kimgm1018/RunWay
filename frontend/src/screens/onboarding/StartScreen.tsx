import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Screen } from '../../components';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, spacing } from '../../theme';
import {
  GoButton,
  Logo,
  OnboardingFooter,
  PageDots,
  TextLink,
} from './parts';

// 1.1 시작 (DESIGN.md 2-5): the wordmark and RUN YOUR WAY on the K1 background. They replace the prototype's
// tagline and feature chips. The start button, page dots and login link sit on the black lower part in the dark tone.
export function StartScreen() {
  const navigation = useNavigation();
  return (
    <Screen
      scroll={false}
      footer={
        <OnboardingFooter>
          <GoButton
            title="시작하기"
            onPress={() => navigateTo(navigation, 'SignUp')}
          />
          <PageDots count={3} current={0} />
          <View style={styles.loginRow}>
            <AppText variant="caption" tone="textSecondary">
              이미 계정이 있어요 ·
            </AppText>
            <TextLink
              title="로그인"
              strong
              onPress={() => navigateTo(navigation, 'Login')}
            />
          </View>
        </OnboardingFooter>
      }
    >
      <View style={styles.above} />
      <View style={styles.brand}>
        <Logo width={280} />
        <AppText tone="textSecondary" style={styles.tagline}>
          RUN YOUR WAY
        </AppText>
      </View>
      <View style={styles.below} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The wordmark sits a little below the middle, as in the K1 draft.
  above: { flex: 1.25 },
  below: { flex: 1 },
  brand: { alignItems: 'center', gap: 22 },
  tagline: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: 5,
  },
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
