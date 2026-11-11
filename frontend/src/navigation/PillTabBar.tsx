import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { PressableScale } from '../components';
import { useResource, type Repositories } from '../data';
import { fontFamily, k1, size } from '../theme';
import type { MainTabParamList } from './types';
import { runTabInitialRoute } from './routes';

type TabKey = keyof MainTabParamList;

const tabs: Record<TabKey, { label: string }> = {
  HomeTab: { label: '홈' },
  RunTab: { label: '러닝' },
  GroupTab: { label: '그룹' },
  CommunityTab: { label: '커뮤니티' },
  ProfileTab: { label: '프로필' },
};

type BarLook = {
  bar: string;
  barBorder: string;
  barShadow: string;
  inactive: string;
  active: string;
  // The lines cut into a filled icon (the door, the feed's lines, the face).
  cutout: string;
};

// runway-tabbar (S15P31E105-428): the light bar. The full-screen map screens (2.0·2.0F) hide it (S15P31E105-517).
const light: BarLook = {
  bar: '#FFFFFF',
  barBorder: 'rgba(2,5,14,0.05)',
  barShadow: '0 12px 32px rgba(9,17,26,0.12), 0 2px 6px rgba(9,17,26,0.05)',
  // No tile for the chosen tab: its icon and name deepen to the deep navy, the others stay pale
  // (담당자 요청 2026-11-10, S15P31E105-657).
  inactive: 'rgba(2,5,14,0.38)',
  active: k1.night,
  cutout: '#FFFFFF',
};

// Over the group tab's first screen (GroupIntro, S15P31E105-563, 담당자 요청): a see-through bar so the photo and
// its navy foot run under it; the chosen tab's icon and name turn full white, the others stay dim.
const glass: BarLook = {
  bar: 'rgba(255,255,255,0.06)',
  barBorder: 'rgba(255,255,255,0.16)',
  barShadow: 'none',
  inactive: 'rgba(255,255,255,0.5)',
  active: '#FFFFFF',
  cutout: k1.night,
};

// 러닝 is a narrow, well-rounded deep navy tile inside the bar with the runner and its name in white, so it reads as
// the one to press (담당자 결정 2026-11-10, S15P31E105-657).
const runOn = '#FFFFFF';

// The run start screens hide the tab bar: their own start row sits at the foot (S15P31E105-517, 담당자 결정).
const hiddenOn = ['FreeRun', 'CourseStart', 'CourseRun'];

// The run tab's top screen; before its stack has a state of its own, it shows its first screen.
function runFocusedRoute(
  route: Parameters<typeof getFocusedRouteNameFromRoute>[0],
) {
  return getFocusedRouteNameFromRoute(route) ?? runTabInitialRoute;
}

const loadMe = (repositories: Repositories) => repositories.profile.getMe();

// 25 (담당자 요청 2026-11-10: 아이콘을 더 크게, was 21).
const iconSize = 25;

// 러닝's tile: 58 wide, as tall as a tab, rounded 22.
const runTileWidth = 58;

// The handoff's line icons over the tab names. The chosen one is filled in (담당자 요청 2026-11-10: 선만 바뀌지 않고
// 칠해지는 느낌), its inner lines cut out in the bar's colour. 커뮤니티 is a feed and 러닝 a runner (S15P31E105-522);
// 프로필 is drawn by ProfileIcon.
function TabIcon({
  tab,
  color,
  focused,
  cutout = '#FFFFFF',
}: {
  tab: TabKey;
  color: string;
  focused: boolean;
  cutout?: string;
}) {
  const stroke = {
    fill: focused ? color : 'none',
    stroke: color,
    strokeWidth: focused ? 2 : 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  // Inner lines: plain lines when outlined, cut out of the fill when filled.
  const inner = focused
    ? { ...stroke, fill: cutout, stroke: cutout }
    : { ...stroke, fill: 'none' };
  const line = { ...inner, fill: 'none' };
  return (
    <Svg width={iconSize} height={iconSize} viewBox="0 0 24 24">
      {tab === 'HomeTab' ? (
        <>
          <Path
            {...stroke}
            d="M3 10a2 2 0 0 1 .7-1.5l7-6a2 2 0 0 1 2.6 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
          />
          <Path {...inner} d="M15 21v-7a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v7" />
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
          <Path {...line} d="M7 6.5h6M7 17.5h6" />
        </>
      ) : (
        // 프로필 without a photo: a person in a circle.
        <>
          <Circle {...stroke} cx={12} cy={12} r={9.5} />
          <Circle {...inner} cx={12} cy={10} r={3.2} />
          <Path
            {...line}
            d="M6.3 18.6c1.1-2.4 3.2-3.7 5.7-3.7s4.6 1.3 5.7 3.7"
          />
        </>
      )}
    </Svg>
  );
}

// 프로필 shows my profile photo in a circle (S15P31E105-522, 담당자 결정): a little faded when not chosen, ringed in
// the active colour when chosen; without a photo, or until it loads, the line icon.
function ProfileIcon({
  photo,
  color,
  focused,
  cutout,
}: {
  photo: string | null;
  color: string;
  focused: boolean;
  cutout: string;
}) {
  if (!photo) {
    return (
      <TabIcon
        tab="ProfileTab"
        color={color}
        focused={focused}
        cutout={cutout}
      />
    );
  }
  return (
    <View style={[styles.photoRing, focused && { borderColor: color }]}>
      <Image
        source={{ uri: photo }}
        style={[styles.photo, !focused && styles.photoOff]}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

// One tab's icon and name. Choosing a tab deepens them from pale to the bar's active colour: the chosen icon fades in
// over the pale one with a small lift, and the name's colour follows (담당자 요청 2026-11-10, S15P31E105-657).
function TabFace({
  tab,
  label,
  photo,
  focused,
  look,
}: {
  tab: TabKey;
  label: string;
  photo: string | null;
  focused: boolean;
  look: BarLook;
}) {
  const on = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(on, {
      toValue: focused ? 1 : 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [focused, on]);
  const icon = (color: string, chosen: boolean) =>
    tab === 'ProfileTab' ? (
      <ProfileIcon
        photo={photo}
        color={color}
        focused={chosen}
        cutout={look.cutout}
      />
    ) : (
      <TabIcon tab={tab} color={color} focused={chosen} cutout={look.cutout} />
    );
  if (tab === 'RunTab') {
    return (
      <>
        <TabIcon tab={tab} color={runOn} focused={false} />
        <Animated.Text
          numberOfLines={1}
          allowFontScaling={false}
          style={[styles.label, styles.labelOn, { color: runOn }]}
        >
          {label}
        </Animated.Text>
      </>
    );
  }
  const scale = on.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  // The filled icon grows into place as it fades in, like being painted in.
  const fillIn = on.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const color = on.interpolate({
    inputRange: [0, 1],
    outputRange: [look.inactive, look.active],
  });
  return (
    <>
      <Animated.View style={{ transform: [{ scale }] }}>
        {icon(look.inactive, false)}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.iconOn,
            { opacity: on, transform: [{ scale: fillIn }] },
          ]}
        >
          {icon(look.active, true)}
        </Animated.View>
      </Animated.View>
      <Animated.Text
        numberOfLines={1}
        // 10 whatever the phone's text size, so the five names fit the bar (담당자 결정).
        allowFontScaling={false}
        style={[styles.label, focused && styles.labelOn, { color }]}
      >
        {label}
      </Animated.Text>
    </>
  );
}

// 하단 탭 바 (runway-tabbar): a floating 64-high bar of five tabs (icon over name), 16 in from the sides. 러닝 is a
// deep navy tile; the chosen tab's icon and name deepen in colour (S15P31E105-657).
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
  const current = state.routes[state.index];
  const shown =
    current.name === 'RunTab'
      ? runFocusedRoute(current)
      : getFocusedRouteNameFromRoute(current);
  if (shown && hiddenOn.includes(shown)) {
    return null;
  }
  const look =
    current.name === 'GroupTab' &&
    (current.params as { intro?: boolean } | undefined)?.intro
      ? glass
      : light;
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
            backgroundColor: look.bar,
            borderColor: look.barBorder,
            boxShadow: look.barShadow,
          },
        ]}
      >
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const key = route.name as TabKey;
          const run = key === 'RunTab';
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
              style={styles.tab}
            >
              {run ? (
                <View pointerEvents="none" style={styles.runTile} />
              ) : null}
              <TabFace
                tab={key}
                label={tabs[key].label}
                photo={photo}
                focused={focused}
                look={look}
              />
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
  runTile: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: runTileWidth,
    alignSelf: 'center',
    borderRadius: 22,
    backgroundColor: k1.night,
  },
  // The chosen icon, drawn over the pale one.
  iconOn: { position: 'absolute', top: 0, left: 0 },
  // The full tab width, centred: measured on its own, the name can come out 0 wide on the first draw before the
  // font is ready and stay hidden until the tab draws again.
  label: {
    alignSelf: 'stretch',
    textAlign: 'center',
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
  photo: { width: iconSize, height: iconSize, borderRadius: iconSize / 2 },
  photoOff: { opacity: 0.6 },
});
