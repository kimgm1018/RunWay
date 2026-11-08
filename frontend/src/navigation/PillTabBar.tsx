import React, { useEffect, useRef } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { AppText, PressableScale } from '../components';
import { useResource, type Repositories } from '../data';
import { fontFamily, k1, size } from '../theme';
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
  // Icons and names on the white bar are the deep navy (S15P31E105-522, 담당자 요청).
  inactive: k1.night,
  active: '#FFFFFF',
  // The chosen tab is a black textured tile.
  tile: '#0F1011',
  tileShadow:
    '0 6px 14px rgba(2,5,14,0.28), inset 0 1px 0 rgba(255,255,255,0.12), inset 0 0 0 1px rgba(255,255,255,0.06)',
  texture: true,
};

const texture = require('../../assets/images/tab-active-texture.png');

// The run start screens hide the tab bar: their own start row sits at the foot (S15P31E105-517, 담당자 결정).
const hiddenOn = ['FreeRun', 'CourseStart', 'CourseRun'];

const loadMe = (repositories: Repositories) => repositories.profile.getMe();

const iconSize = 21;

// The handoff's 21px line icons over the tab names; the chosen one is drawn a little heavier.
// 커뮤니티 is a feed and 러닝 a runner (S15P31E105-522); 프로필 is drawn by ProfileIcon.
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
    <Svg width={iconSize} height={iconSize} viewBox="0 0 24 24">
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
          <Circle {...stroke} cx={13} cy={4} r={1.6} />
          <Path {...stroke} d="M4 17l5 1 .75-1.5" />
          <Path {...stroke} d="M15 21v-4l-4-3 1-6" />
          <Path {...stroke} d="M7 12V9l5-1 3 3 3 1" />
        </>
      ) : tab === 'GroupTab' ? (
        <>
          <Path {...stroke} d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <Circle {...stroke} cx={9} cy={7} r={4} />
          <Path {...stroke} d="M22 21v-2a4 4 0 0 0-3-3.9" />
          <Path {...stroke} d="M16 3.1a4 4 0 0 1 0 7.8" />
        </>
      ) : tab === 'CommunityTab' ? (
        // A feed of posts rather than a chat bubble (S15P31E105-522, 담당자 결정).
        <>
          <Rect {...stroke} x={3} y={3} width={18} height={7} rx={2} />
          <Rect {...stroke} x={3} y={14} width={18} height={7} rx={2} />
          <Path {...stroke} d="M7 6.5h6M7 17.5h6" />
        </>
      ) : (
        // 프로필 without a photo: a person in a circle.
        <>
          <Circle {...stroke} cx={12} cy={12} r={9.5} />
          <Circle {...stroke} cx={12} cy={10} r={3.2} />
          <Path
            {...stroke}
            d="M6.3 18.6c1.1-2.4 3.2-3.7 5.7-3.7s4.6 1.3 5.7 3.7"
          />
        </>
      )}
    </Svg>
  );
}

// 프로필 shows my profile photo in a circle (S15P31E105-522, 담당자 결정), ringed white when chosen; without a photo,
// or until it loads, the line icon.
function ProfileIcon({
  photo,
  color,
  focused,
}: {
  photo: string | null;
  color: string;
  focused: boolean;
}) {
  if (!photo) {
    return <TabIcon tab="ProfileTab" color={color} focused={focused} />;
  }
  return (
    <View style={[styles.photoRing, focused && styles.photoRingOn]}>
      <Image
        source={{ uri: photo }}
        style={styles.photo}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

// 하단 탭 바 (runway-tabbar): a floating 64-high bar of five tabs (icon over name), 16 in from the sides; the chosen
// tab fills a 52-high black textured tile.
export function PillTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  // Read again on every tab change, so a photo changed on 8.2 shows when you come back.
  const me = useResource(loadMe);
  const refreshMe = me.refresh;
  const firstIndex = useRef(state.index);
  useEffect(() => {
    // The first render has just loaded it.
    if (firstIndex.current === state.index) {
      firstIndex.current = -1;
      return;
    }
    firstIndex.current = -1;
    void refreshMe();
  }, [refreshMe, state.index]);
  const photo = me.data?.profileImageUrl ?? null;
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
          const open = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };
          return (
            <PressableScale
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={tabs[key].label}
              accessibilityState={{ selected: focused }}
              onPress={open}
              style={[
                styles.tab,
                focused && {
                  backgroundColor: light.tile,
                  boxShadow: light.tileShadow,
                },
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
              {key === 'ProfileTab' ? (
                <ProfileIcon photo={photo} color={color} focused={focused} />
              ) : (
                <TabIcon tab={key} color={color} focused={focused} />
              )}
              {key === 'RunTab' ? (
                // 러닝 alone is framed by one thick deep navy line (S15P31E105-522, 담당자 요청).
                <View pointerEvents="none" style={styles.runFrame} />
              ) : null}
              <AppText
                numberOfLines={1}
                // 10 whatever the phone's text size, so the five names fit the bar (담당자 결정).
                allowFontScaling={false}
                style={[styles.label, focused && styles.labelOn, { color }]}
              >
                {tabs[key].label}
              </AppText>
            </PressableScale>
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
    gap: 3,
  },
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
  runFrame: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 18,
    borderWidth: 2.5,
    borderColor: k1.night,
  },
  label: {
    fontFamily: fontFamily.medium,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: -0.1,
  },
  labelOn: { fontFamily: fontFamily.bold },
  photoRing: {
    width: iconSize + 4,
    height: iconSize + 4,
    borderRadius: (iconSize + 4) / 2,
    // 4 taller than the other icons; the negative margin keeps 프로필's name in line with the rest.
    marginVertical: -2,
    borderWidth: 1.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRingOn: { borderColor: light.active },
  photo: { width: iconSize, height: iconSize, borderRadius: iconSize / 2 },
});
