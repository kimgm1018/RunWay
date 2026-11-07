import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { AppText } from '../components';
import { fontFamily, size } from '../theme';
import type { MainTabParamList } from './types';

type TabKey = keyof MainTabParamList;

const tabs: Record<TabKey, { label: string }> = {
  HomeTab: { label: '홈' },
  RunTab: { label: '러닝' },
  GroupTab: { label: '그룹' },
  CommunityTab: { label: '커뮤니티' },
  ProfileTab: { label: '프로필' },
};

// runway-tabbar (S15P31E105-428): the light bar. The full-screen map screens (2.0·2.0F) hide it (S15P31E105-517).
const light = {
  bar: '#FFFFFF',
  barBorder: 'rgba(2,5,14,0.05)',
  barShadow: '0 12px 32px rgba(9,17,26,0.12), 0 2px 6px rgba(9,17,26,0.05)',
  inactive: '#56646C',
  active: '#FFFFFF',
  // The chosen tab is a black textured tile.
  tile: '#0F1011',
  tileShadow:
    '0 6px 14px rgba(2,5,14,0.28), inset 0 1px 0 rgba(255,255,255,0.12), inset 0 0 0 1px rgba(255,255,255,0.06)',
  texture: true,
};

const texture = require('../../assets/images/tab-active-texture.png');

// The run start screens hide the tab bar: their own start row sits at the foot (S15P31E105-517, 담당자 결정).
const hiddenOn = ['FreeRun', 'CourseRun'];

// The handoff's 21px line icons; the chosen one is drawn a little heavier.
function TabIcon({
  tab,
  color,
  focused,
}: {
  tab: TabKey;
  color: string;
  focused: boolean;
}) {
  const stroke = {
    fill: 'none',
    stroke: color,
    strokeWidth: focused ? 2 : 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24">
      {tab === 'HomeTab' ? (
        <>
          <Path {...stroke} d="M15 21v-7a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v7" />
          <Path
            {...stroke}
            d="M3 10a2 2 0 0 1 .7-1.5l7-6a2 2 0 0 1 2.6 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
          />
        </>
      ) : tab === 'RunTab' ? (
        <>
          <Path
            {...stroke}
            d="M4 16v-2.4C4 11.5 3 10.5 3 8c0-2.7 1.5-6 4.5-6C9.4 2 10 3.8 10 5.5c0 3.1-2 5.7-2 8.7V16a2 2 0 1 1-4 0z"
          />
          <Path
            {...stroke}
            d="M20 20v-2.4c0-2.1 1-3.1 1-5.6 0-2.7-1.5-6-4.5-6C14.6 6 14 7.8 14 9.5c0 3.1 2 5.7 2 8.7V20a2 2 0 1 0 4 0z"
          />
        </>
      ) : tab === 'GroupTab' ? (
        <>
          <Path {...stroke} d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <Circle {...stroke} cx={9} cy={7} r={4} />
          <Path {...stroke} d="M22 21v-2a4 4 0 0 0-3-3.9" />
          <Path {...stroke} d="M16 3.1a4 4 0 0 1 0 7.8" />
        </>
      ) : tab === 'CommunityTab' ? (
        <Path {...stroke} d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />
      ) : (
        <>
          <Circle {...stroke} cx={12} cy={8} r={4.2} />
          <Path {...stroke} d="M4.5 21c.8-4 3.8-6.3 7.5-6.3s6.7 2.3 7.5 6.3" />
        </>
      )}
    </Svg>
  );
}

// 하단 탭 바 (runway-tabbar): a floating 64-high bar of five tabs, 16 in from the sides; the chosen tab fills a
// 52-high tile (black texture on the light bar, white on the navy one).
export function PillTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const shown = getFocusedRouteNameFromRoute(state.routes[state.index]);
  if (shown && hiddenOn.includes(shown)) {
    return null;
  }
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
          {
            backgroundColor: light.bar,
            borderColor: light.barBorder,
            boxShadow: light.barShadow,
          },
        ]}
      >
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const key = route.name as TabKey;
          const color = focused ? light.active : light.inactive;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={tabs[key].label}
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
              style={({ pressed }) => [
                styles.tab,
                focused && {
                  backgroundColor: light.tile,
                  boxShadow: light.tileShadow,
                },
                pressed && styles.pressed,
              ]}
            >
              {focused && light.texture ? (
                <View style={styles.textureClip}>
                  <Image
                    source={texture}
                    resizeMode="cover"
                    style={styles.texture}
                  />
                </View>
              ) : null}
              <TabIcon tab={key} color={color} focused={focused} />
              <AppText
                numberOfLines={1}
                style={[styles.label, focused && styles.labelOn, { color }]}
              >
                {tabs[key].label}
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
    alignItems: 'center',
    paddingHorizontal: 3,
    borderRadius: 24,
    borderWidth: 1,
  },
  tab: {
    flex: 1,
    height: 52,
    marginHorizontal: 2,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  // The handoff's press feedback (scale .96).
  pressed: { transform: [{ scale: 0.96 }] },
  // The texture is clipped in its own view, so the tile's shadow is not.
  textureClip: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 18,
    overflow: 'hidden',
  },
  texture: { width: '100%', height: '100%' },
  label: {
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 14,
    letterSpacing: -0.1,
  },
  labelOn: { fontFamily: fontFamily.bold },
});
