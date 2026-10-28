import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Icon, type IconName } from '../components';
import { palette, radius, size, spacing, typography, useTheme } from '../theme';
import type { MainTabParamList } from './types';

const tabs: Record<keyof MainTabParamList, { label: string; icon: IconName }> =
  {
    HomeTab: { label: '홈', icon: 'home' },
    RunTab: { label: '러닝', icon: 'run' },
    GroupTab: { label: '그룹', icon: 'group' },
    CommunityTab: { label: '커뮤니티', icon: 'community' },
  };

// 2.1 홈 하단: a floating pill with four tabs. The 2.P arc drag is not built; 2.P was out of scope for S15P31E105-146.
export function PillTabBar({ state, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.layer,
        { bottom: Math.max(insets.bottom, size.tabBarInset) },
      ]}
    >
      <View
        accessibilityRole="tablist"
        style={[
          styles.bar,
          { backgroundColor: colors.tabBar, borderColor: colors.tabBarBorder },
        ]}
      >
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const tab = tabs[route.name as keyof MainTabParamList];
          const tint = focused ? palette.white : colors.tabInactive;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: focused }}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name, route.params);
                }
              }}
              style={[
                styles.tab,
                focused && { backgroundColor: colors.tabActive },
              ]}
            >
              <Icon
                name={tab.icon}
                color={focused ? colors.tabIconActive : tint}
                size={22}
              />
              <AppText
                style={[
                  focused ? typography.labelStrong : typography.label,
                  { color: tint },
                ]}
              >
                {tab.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: size.tabBarInset,
    right: size.tabBarInset,
  },
  bar: {
    height: size.tabBar,
    flexDirection: 'row',
    gap: spacing.xxs,
    padding: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    shadowColor: palette.black,
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: radius.pill,
  },
});
