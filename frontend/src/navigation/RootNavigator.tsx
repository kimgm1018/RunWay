import React from 'react';
import { View } from 'react-native';
import {
  DarkTheme,
  DefaultTheme,
  createNavigationContainerRef,
  NavigationContainer,
  useNavigation,
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
import { SplashScreen } from '../screens/SplashScreen';
import { communityScreens, MyProfileTabScreen } from '../screens/community';
import { prefetchFeed } from '../screens/community/feedPrefetch';
import { FeedMapWarmup } from '../screens/community/FeedMapWarmup';
import { useRepositories } from '../data';
import { settingsScreens } from '../screens/settings';
import {
  groupScreens,
  GroupRunDraftProvider,
  GroupTabScreen,
} from '../screens/group';
import { recordScreens } from '../screens/records';
import { runScreens } from '../screens/run';
import { RunSessionProvider, useRunResume } from '../screens/run/RunSession';
import { useRunForeground } from '../screens/run/useRunForeground';
import { RunGoalDraftProvider } from '../screens/run/goal/RunGoalDraft';
import { useSession } from '../session/SessionProvider';
import { fontFamily, useTheme } from '../theme';
import { navigateTo } from './navigateTo';
import { PillTabBar } from './PillTabBar';
import { ShareLinkOpener } from './ShareLinkOpener';
import { PushBridge } from '../push/PushBridge';
import {
  authRoutes,
  groupTabRoutes,
  homeTabRoutes,
  mainRoutes,
  runTabInitialRoute,
  runTabRoutes,
  type RouteName,
} from './routes';
import type {
  HomeStackParamList,
  MainTabParamList,
  RootStackParamList,
  RunStackParamList,
} from './types';

const Root = createNativeStackNavigator<RootStackParamList>();
// For opening shared links from outside any screen (S15P31E105-704).
const navigationRef = createNavigationContainerRef<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();
const RunStack = createNativeStackNavigator<RunStackParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();

// Built once per route so React Navigation always receives the same component.
const placeholders = Object.fromEntries(
  (
    [
      ...authRoutes,
      ...mainRoutes,
      ...runTabRoutes,
      ...homeTabRoutes,
      ...groupTabRoutes,
      'Home',
      'Community',
    ] as RouteName[]
  ).map(name => {
    function Placeholder() {
      return <PlaceholderScreen name={name} />;
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
  ...communityScreens,
  ...settingsScreens,
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
  'RunResult',
  'GroupRunProgress',
  'GroupRunPosition',
  'GroupRunResult',
]);

const noHeader = { headerShown: false } as const;
// The tabs over the first community map warmed behind them (S15P31E105-665).
const tabsStyle = { flex: 1 } as const;

// 2.9 알림 rises from the bottom over 홈 (담당자 레퍼런스: 알림 페이지 영상). The page moves itself (see
// NotificationsScreen), over a transparent screen so 홈 stays in view under it while it rises.
const risingPage = {
  presentation: 'transparentModal',
  animation: 'none',
} as const;

// The PoC pulls in native health modules, so load it only when the developer opens it.
function loadHealthPoc() {
  return require('../screens/HealthPocScreen').HealthPocScreen;
}

// The map check pulls in the Naver Map native module the same way.
function loadMapPoc() {
  return require('../screens/MapPocScreen').MapPocScreen;
}

// 2.1 with 5.1 · 5.3 on top, all under the tab bar (runway-records).
function HomeTab() {
  return (
    <HomeStack.Navigator screenOptions={noHeader}>
      <HomeStack.Screen name="Home" component={screens.Home} />
      {homeTabRoutes.map(name => (
        <HomeStack.Screen key={name} name={name} component={screens[name]} />
      ))}
    </HomeStack.Navigator>
  );
}

// The 러닝 tab opens straight on the 2.0F map (S15P31E105-683); 2.0M 러닝 방식 선택 is kept but no longer on the way.
// 2.0F and 2.0 are one map with or without a course, so they fade into each other instead of sliding.
const sameMap = { animation: 'fade' } as const;
const mapRoutes: ReadonlySet<RouteName> = new Set<RouteName>([
  'FreeRun',
  'CourseRun',
]);

function RunTab() {
  return (
    <RunStack.Navigator
      screenOptions={noHeader}
      initialRouteName={runTabInitialRoute}
    >
      {runTabRoutes.map(name => (
        <RunStack.Screen
          key={name}
          name={name}
          component={screens[name]}
          options={mapRoutes.has(name) ? sameMap : undefined}
        />
      ))}
    </RunStack.Navigator>
  );
}

function renderTabBar(props: React.ComponentProps<typeof PillTabBar>) {
  return <PillTabBar {...props} />;
}

function MainTabs() {
  useResumeRun();
  // 커뮤니티's first page and its first courses are read ahead, and its first map drawn once behind the tabs, so
  // entering it draws at once (S15P31E105-665).
  const { community } = useRepositories();
  const [firstCourse, setFirstCourse] = React.useState<ReturnType<
    typeof prefetchFeed
  > | null>(null);
  React.useEffect(() => {
    setFirstCourse(prefetchFeed(community));
  }, [community]);
  const [communityOpen, setCommunityOpen] = React.useState(false);
  const tabListeners = React.useCallback(
    ({ route }: { route: { name: string } }) => ({
      focus: () => setCommunityOpen(route.name === 'CommunityTab'),
    }),
    [],
  );
  return (
    <View style={tabsStyle}>
      <FeedMapWarmup course={firstCourse} stop={communityOpen} />
      <Tabs.Navigator
        screenOptions={noHeader}
        screenListeners={tabListeners}
        tabBar={renderTabBar}
      >
        {/* The tab bar draws the tabs in this order: 홈·커뮤니티·러닝·그룹·프로필 (S15P31E105-522). */}
        <Tabs.Screen name="HomeTab" component={HomeTab} />
        <Tabs.Screen name="CommunityTab" component={screens.Community} />
        <Tabs.Screen name="RunTab" component={RunTab} />
        <Tabs.Screen name="GroupTab" component={GroupTabScreen} />
        <Tabs.Screen name="ProfileTab" component={MyProfileTabScreen} />
      </Tabs.Navigator>
    </View>
  );
}

// 앱을 다시 열었을 때 진행 중인 개인 러닝이 있으면 그 화면으로 돌아간다.
function useResumeRun() {
  const navigation = useNavigation();
  const foreground = useRunForeground();
  const { target, consume } = useRunResume();
  React.useEffect(() => {
    if (foreground && target) {
      consume();
      navigateTo(navigation, target);
    }
  }, [consume, foreground, navigation, target]);
}

export function RootNavigator() {
  const { signedIn, restoring, loginRequired } = useSession();
  // After expiry, Login is first so the user lands there; Start stays next so back is not a dead end
  // (LoginScreen navigates to Start when loginRequired — S15P31E105-638).
  const signedOutRoutes = loginRequired
    ? ([
        'Login',
        'Start',
        ...authRoutes.filter(route => route !== 'Login' && route !== 'Start'),
      ] as const)
    : authRoutes;
  const { name, colors } = useTheme();
  if (restoring) {
    // The splash while the saved tokens load, so a signed-in user never sees 1.2 로그인 flash by.
    return <SplashScreen />;
  }
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
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
      <ShareLinkOpener navigation={navigationRef} signedIn={signedIn} />
      <PushBridge navigation={navigationRef} signedIn={signedIn} />
      <SignUpDraftProvider>
        <CourseSearchProvider>
          <RunSessionProvider>
            <RunGoalDraftProvider>
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
                              : route === 'Notifications'
                              ? risingPage
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
                          <Root.Screen
                            name="MapPoc"
                            getComponent={loadMapPoc}
                          />
                        </>
                      ) : null}
                    </Root.Group>
                  ) : (
                    <Root.Group navigationKey="signed-out">
                      {signedOutRoutes.map(route => (
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
            </RunGoalDraftProvider>
          </RunSessionProvider>
        </CourseSearchProvider>
      </SignUpDraftProvider>
    </NavigationContainer>
  );
}
