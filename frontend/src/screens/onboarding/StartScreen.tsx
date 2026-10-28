import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Icon, Screen, type IconName } from '../../components';
import { navigateTo } from '../../navigation/navigateTo';
import { radius, spacing, useTheme } from '../../theme';
import { HeroBackground, Logo, TextLink } from './parts';

const features: IconName[] = ['heart', 'watch', 'route'];

// 1.1 시작
export function StartScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const chip = [styles.chip, { borderColor: colors.borderStrong }];
  return (
    <Screen
      scroll={false}
      background={<HeroBackground />}
      footer={
        <View style={styles.footer}>
          <Button
            title="시작하기"
            variant="inverse"
            onPress={() => navigateTo(navigation, 'SignUp')}
          />
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
        </View>
      }
    >
      <View style={styles.spacer} />
      <Logo width={200} />
      <View style={styles.chips}>
        <View style={chip}>
          <AppText variant="labelStrong">AI 코칭</AppText>
        </View>
        {features.map(icon => (
          <View key={icon} style={chip}>
            <Icon name={icon} color={colors.text} size={13} />
          </View>
        ))}
      </View>
      <AppText variant="bodyStrong" style={styles.tagline}>
        내 몸에 맞는 속도로,{'\n'}어디서든 나만의 길을 달려요.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  spacer: { flex: 1 },
  chips: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  chip: {
    height: 24,
    minWidth: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagline: { textAlign: 'right', marginBottom: spacing.xxxl },
  footer: { flex: 1, gap: spacing.xl },
  loginRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
