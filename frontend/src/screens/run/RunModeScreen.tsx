import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Icon, Logo, Screen, type IconName } from '../../components';
import { navigateTo } from '../../navigation/navigateTo';
import type { RouteName } from '../../navigation/routes';
import { radius, size, spacing, useTheme } from '../../theme';

const modes: {
  route: RouteName;
  icon: IconName;
  title: string;
  description: string;
}[] = [
  {
    route: 'FreeRun',
    icon: 'compass',
    title: '자유 러닝',
    description: '코스 없이 원하는 길로 달려요. 거리·시간·페이스만 기록해요.',
  },
  {
    // 코스 러닝 goes through 3.1 코스 추천 before 2.0.
    route: 'TodayRun',
    icon: 'route',
    title: '코스 러닝',
    description:
      '조건에 맞는 코스를 추천받아 따라 달려요. 길 안내와 페이스 코칭을 받아요.',
  },
];

// 2.0M 러닝 방식 선택: the first screen of the 러닝 tab.
export function RunModeScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  return (
    <Screen
      withTabBar
      header={
        <View style={styles.header}>
          <Logo width={80} />
        </View>
      }
    >
      <View style={styles.title}>
        <AppText variant="display" accessibilityRole="header">
          {'오늘은 어떻게\n달릴까요?'}
        </AppText>
        <AppText variant="caption" tone="textSecondary">
          카드를 누르면 바로 다음 화면으로 넘어가요.
        </AppText>
      </View>
      {modes.map(mode => (
        <Pressable
          key={mode.route}
          accessibilityRole="button"
          accessibilityLabel={mode.title}
          onPress={() => navigateTo(navigation, mode.route)}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
            pressed && styles.pressed,
          ]}
        >
          <View
            style={[
              styles.icon,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.borderStrong,
              },
            ]}
          >
            <Icon name={mode.icon} color={colors.accentText} size={20} />
          </View>
          <View style={styles.text}>
            <AppText variant="heading">{mode.title}</AppText>
            <AppText variant="caption" tone="textSecondary">
              {mode.description}
            </AppText>
          </View>
          <Icon name="forward" color={colors.textTertiary} size={18} />
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    height: size.header,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { gap: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    padding: spacing.xxl,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  pressed: { opacity: 0.8 },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: spacing.xs },
});
