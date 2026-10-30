import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Icon, type IconName } from '../components';
import { k1, radius, size, typography, useTheme } from '../theme';
import type { MainTabParamList } from './types';

const tabs: Record<keyof MainTabParamList, { label: string; icon: IconName }> =
  {
    HomeTab: { label: '홈', icon: 'home' },
    RunTab: { label: '러닝', icon: 'run' },
    GroupTab: { label: '그룹', icon: 'group' },
    CommunityTab: { label: '커뮤니티', icon: 'community' },
  };

// Screens whose map fills the screen get the black pill instead (DESIGN.md 2-6 하단 탭바).
const mapScreens = ['FreeRun', 'CourseRun'];

const darkColors = {
  tabBar: k1.night,
  tabBarBorder: 'rgba(232,238,244,0.08)',
  tabActive: k1.ice,
  tabIconActive: k1.night,
  tabInactive: 'rgba(232,238,244,0.55)',
};

// 2.1 홈 하단: a floating light pill with four tabs (DESIGN.md 2-3). The selected tab fills only its icon circle.
// The 2.P arc drag is not built; 2.P was out of scope for S15P31E105-146.
export function PillTabBar({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const shown = getFocusedRouteNameFromRoute(state.routes[state.index]);
  const colors =
    shown && mapScreens.includes(shown) ? darkColors : theme.colors;
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
              style={styles.tab}
            >
              <View style={styles.circle}>
                {/* A fresh view for the fill: Android keeps square corners when a view gains a background later. */}
                {focused ? (
                  <View
                    style={[
                      styles.circleFill,
                      { backgroundColor: colors.tabActive },
                    ]}
                  />
                ) : null}
                <Icon
                  name={tab.icon}
                  color={focused ? colors.tabIconActive : colors.tabInactive}
                  size={20}
                />
              </View>
              <AppText
                style={[
                  focused ? typography.labelStrong : typography.label,
                  { color: focused ? colors.tabActive : colors.tabInactive },
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
    justifyContent: 'space-around',
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    shadowColor: k1.night,
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  tab: {
    width: 66,
    alignItems: 'center',
    gap: 3,
  },
  circle: {
    width: size.tabCircle,
    height: size.tabCircle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleFill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: size.tabCircle / 2,
  },
});
