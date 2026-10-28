import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Card, Screen, ScreenHeader } from '../components';
import { navigateTo } from '../navigation/navigateTo';
import {
  isSessionAction,
  routes,
  type RouteName,
  type SessionAction,
} from '../navigation/routes';
import { useSession } from '../session/SessionProvider';
import { radius, spacing, useTheme } from '../theme';

const actionLabels: Record<SessionAction, string> = {
  signIn: '로그인 완료 → 2.1 홈',
  signOut: '로그아웃 → 1.1 시작',
};

// Entry screens have no back button in the prototype. canGoBack() is not checked here because
// right after sign-in it still sees the old stack and is not re-evaluated.
const entryScreens: ReadonlySet<RouteName> = new Set<RouteName>([
  'Start',
  'Home',
  'RunMode',
  'MyCrews',
  'CrewRecruit',
  'Community',
]);

// Stands in for each prototype screen until its Jira task replaces it with the real UI.
export function PlaceholderScreen({
  name,
  children,
}: {
  name: RouteName;
  children?: React.ReactNode;
}) {
  const navigation = useNavigation();
  const session = useSession();
  const { colors } = useTheme();
  const route = routes[name];
  // 1.7 워치 연결 is also opened from 8.1 설정, where finishing returns home instead of signing in.
  const links = route.links.map(link =>
    link === 'signIn' && session.signedIn ? 'Home' : link,
  );
  return (
    <Screen
      withTabBar={route.tab !== undefined}
      header={
        <ScreenHeader
          title={route.title}
          onBack={
            !entryScreens.has(name) && navigation.canGoBack()
              ? navigation.goBack
              : undefined
          }
        />
      }
    >
      <View style={styles.titleRow}>
        <View style={[styles.code, { backgroundColor: colors.surfaceMuted }]}>
          <AppText variant="labelStrong">{route.code}</AppText>
        </View>
        <AppText variant="title">{route.title}</AppText>
      </View>
      <Card variant="muted">
        <AppText variant="caption" tone="textSecondary">
          프로토타입 v15 화면 {route.code}의 자리입니다. 실제 화면은{' '}
          {route.task}
          에서 구현합니다.
        </AppText>
      </Card>
      {children}
      <View style={styles.links}>
        {links.map(link =>
          isSessionAction(link) ? (
            <Button
              key={link}
              title={actionLabels[link]}
              variant={link === 'signIn' ? 'primary' : 'secondary'}
              size="medium"
              onPress={link === 'signIn' ? session.signIn : session.signOut}
            />
          ) : (
            <Button
              key={link}
              title={`${routes[link].code} ${routes[link].title}`}
              variant="secondary"
              size="medium"
              icon="forward"
              onPress={() => navigateTo(navigation, link)}
            />
          ),
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  code: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  links: { gap: spacing.md },
});
