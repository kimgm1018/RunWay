import React from 'react';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type Theme as NavigationTheme,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { appConfig } from '../config';
import { ComponentGalleryScreen } from '../screens/ComponentGalleryScreen';
import { CourseSearchProvider, courseScreens } from '../screens/course';
import { homeScreens } from '../screens/home';
import { onboardingScreens, SignUpDraftProvider } from '../screens/onboarding';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { groupScreens, GroupRunDraftProvider } from '../screens/group';
import { recordScreens } from '../screens/records';
import { SettingsPreview } from '../screens/previews';
import { runScreens } from '../screens/run';
import { RunSessionProvider } from '../screens/run/RunSession';
import { useSession } from '../session/SessionProvider';
import { fontFamily, useTheme } from '../theme';
import { PillTabBar } from './PillTabBar';
import {
  authRoutes,
  groupTabRoutes,
  mainRoutes,
  runTabRoutes,
  type RouteName,
} from './routes';
import type {
  GroupStackParamList,
  MainTabParamList,
  RootStackParamList,
  RunStackParamList,
} from './types';

const Root = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();
const RunStack = createNativeStackNavigator<RunStackParamList>();
const GroupStack = createNativeStackNavigator<GroupStackParamList>();

const previews: Partial<Record<RouteName, React.ComponentType>> = {
  Settings: SettingsPreview,
};

// Built once per route so React Navigation always receives the same component.
const placeholders = Object.fromEntries(
  (
    [
      ...authRoutes,
      ...mainRoutes,
      ...runTabRoutes,
      ...groupTabRoutes,
      'Home',
      'Community',
    ] as RouteName[]
  ).map(name => {
    const Preview = previews[name];
    function Placeholder() {
      return (
        <PlaceholderScreen name={name}>
          {Preview ? <Preview /> : null}
        </PlaceholderScreen>
      );
    }
    Placeholder.displayName = `${name}Placeholder`;
    return [name, Placeholder];
  }),
) as unknown as Record<RouteName, React.ComponentType>;

// Implemented screens replace their placeholders here.
const screens: Record<RouteName, React.ComponentType> = {
  ...placeholders,
  ...onboardingScreens,
  ...homeScreens,
  ...runScreens,
  ...courseScreens,
  ...recordScreens,
  ...groupScreens,
};

// 2.7·2.8 float over the run screen, which stays visible behind the dimmed backdrop.
const musicSheet = {
  presentation: 'transparentModal',
  animation: 'fade',
} as const;

const modalRoutes: ReadonlySet<RouteName> = new Set<RouteName>([
  'MusicCard',
  'MusicSource',
]);

// A swipe must not leave a run midway; 4.2 sends the back key to 4.3 and 4.5 to 홈.
const runScreen = { gestureEnabled: false, animation: 'fade' } as const;

const runRoutes: ReadonlySet<RouteName> = new Set<RouteName>([
  'RunProgress',
  'RunPause',
  'RunResult',
  'GroupRunProgress',
  'GroupRunPosition',
  'GroupRunPause',
  'GroupRunResult',
]);

const noHeader = { headerShown: false } as const;

// The PoC pulls in native health modules, so load it only when the developer opens it.
function loadHealthPoc() {
  return require('../screens/HealthPocScreen').HealthPocScreen;
}

function RunTab() {
  return (
    <RunStack.Navigator screenOptions={noHeader}>
      {runTabRoutes.map(name => (
        <RunStack.Screen key={name} name={name} component={screens[name]} />
      ))}
    </RunStack.Navigator>
  );
}

function GroupTab() {
  return (
    <GroupStack.Navigator screenOptions={noHeader}>
      {groupTabRoutes.map(name => (
        <GroupStack.Screen key={name} name={name} component={screens[name]} />
      ))}
    </GroupStack.Navigator>
  );
}

function renderTabBar(props: React.ComponentProps<typeof PillTabBar>) {
  return <PillTabBar {...props} />;
}

function MainTabs() {
  return (
    <Tabs.Navigator screenOptions={noHeader} tabBar={renderTabBar}>
      <Tabs.Screen name="HomeTab" component={screens.Home} />
      <Tabs.Screen name="RunTab" component={RunTab} />
      <Tabs.Screen name="GroupTab" component={GroupTab} />
      <Tabs.Screen name="CommunityTab" component={screens.Community} />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  const { signedIn } = useSession();
  const { name, colors } = useTheme();
  const base = name === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme: NavigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.accent,
      background: colors.background,
      card: colors.surfaceRaised,
      text: colors.text,
      border: colors.border,
      notification: colors.danger,
    },
    fonts: {
      regular: { fontFamily: fontFamily.regular, fontWeight: 'normal' },
      medium: { fontFamily: fontFamily.medium, fontWeight: 'normal' },
      bold: { fontFamily: fontFamily.bold, fontWeight: 'normal' },
      heavy: { fontFamily: fontFamily.black, fontWeight: 'normal' },
    },
  };
  return (
    <NavigationContainer theme={navigationTheme}>
      <SignUpDraftProvider>
        <CourseSearchProvider>
          <RunSessionProvider>
            <GroupRunDraftProvider>
              <Root.Navigator screenOptions={noHeader}>
                {/* 1.7 워치 연결 exists in both groups; the key makes sign-in/out start a fresh stack instead of staying on it. */}
                {signedIn ? (
                  <Root.Group navigationKey="signed-in">
                    <Root.Screen name="MainTabs" component={MainTabs} />
                    {mainRoutes.map(route => (
                      <Root.Screen
                        key={route}
                        name={route}
                        component={screens[route]}
                        options={
                          modalRoutes.has(route)
                            ? musicSheet
                            : runRoutes.has(route)
                            ? runScreen
                            : undefined
                        }
                      />
                    ))}
                    {appConfig.developerMenu ? (
                      <>
                        <Root.Screen
                          name="ComponentGallery"
                          component={ComponentGalleryScreen}
                        />
                        <Root.Screen
                          name="HealthPoc"
                          getComponent={loadHealthPoc}
                        />
                      </>
                    ) : null}
                  </Root.Group>
                ) : (
                  <Root.Group navigationKey="signed-out">
                    {authRoutes.map(route => (
                      <Root.Screen
                        key={route}
                        name={route}
                        component={screens[route]}
                      />
                    ))}
                  </Root.Group>
                )}
              </Root.Navigator>
            </GroupRunDraftProvider>
          </RunSessionProvider>
        </CourseSearchProvider>
      </SignUpDraftProvider>
    </NavigationContainer>
  );
}
