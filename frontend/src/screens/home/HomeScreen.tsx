import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  RefreshControl,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { AppText, Backdrop, Button, IconButton, Logo } from '../../components';
import { useResource, type Repositories } from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, k1, size, spacing, useTheme } from '../../theme';
import { GlassCard, HomeRefreshProvider, RetryNotice } from './parts';
import { AnalysisCard, CoursesCard, RecordsCard } from './sections';
import { HomeWidgets } from './widgets';

// Each part loads on its own, so one that fails (the notifications, say) leaves the rest of 2.1 on screen.
const loadMe = (repositories: Repositories) => repositories.profile.getMe();
const loadToday = (repositories: Repositories) =>
  repositories.home.getTodayCondition();
const loadSummary = (repositories: Repositories) =>
  repositories.home.getMonthlySummary();
const loadCourses = (repositories: Repositories) =>
  repositories.courses.getSaved();
const loadNotifications = (repositories: Repositories) =>
  repositories.notifications.list();

function Avatar({
  nickname,
  photo,
  onPress,
}: {
  nickname: string;
  photo: string | null;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="내 프로필"
      onPress={onPress}
      style={[
        styles.avatar,
        {
          borderColor: colors.borderStrong,
          backgroundColor: colors.surfaceMuted,
        },
      ]}
    >
      {photo ? (
        <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} />
      ) : (
        <AppText variant="bodyStrong">{nickname.slice(0, 1)}</AppText>
      )}
    </Pressable>
  );
}

// 2.1 홈: the widget board of 대표화면시안 on the K1 background, then the analysis, records and saved course sections.
export function HomeScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const me = useResource(loadMe);
  // Back from 8.2 the greeting and avatar show the saved nickname and photo; the first focus is the first load.
  const refreshMe = me.refresh;
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) {
        void refreshMe();
      }
      focused.current = true;
    }, [refreshMe]),
  );
  const today = useResource(loadToday);
  const summary = useResource(loadSummary);
  const courses = useResource(loadCourses);
  const notifications = useResource(loadNotifications);
  const insets = useSafeAreaInsets();
  const photo = me.data?.profileImageUrl ?? null;
  // Notifications that did not load only leave the bell without its dot.
  const unread = notifications.data?.some(item => !item.read) ?? false;
  // Pull to refresh: the spinner stays until every section that reloads has settled.
  const [pull, setPull] = useState(0);
  const [pending, setPending] = useState(0);
  const track = useCallback((load: Promise<void>) => {
    setPending(count => count + 1);
    load.finally(() => setPending(count => count - 1));
  }, []);
  const refresh = useMemo(() => ({ pull, track }), [pull, track]);
  const onRefresh = () => {
    [me, today, summary, courses, notifications].forEach(resource =>
      track(resource.refresh()),
    );
    setPull(count => count + 1);
  };
  const scrollY = useRef(new Animated.Value(0)).current;
  // The header gets the K1 top colour once the cards start passing under it, so the two never overlap.
  const headerFill = scrollY.interpolate({
    inputRange: [0, spacing.xxxl],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <Animated.ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + size.header },
        ]}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true },
        )}
        refreshControl={
          <RefreshControl
            refreshing={pending > 0}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surfaceRaised}
            // Below the floating header, not under it.
            progressViewOffset={insets.top + size.header}
          />
        }
      >
        <HomeRefreshProvider value={refresh}>
          <AppText style={styles.greeting}>
            {me.data ? `${me.data.nickname}님,\n` : ''}
            <AppText tone="textTertiary" style={styles.greetingText}>
              오늘 달리기 좋은 날이에요
            </AppText>
          </AppText>
          {today.status === 'loading' ? (
            <ActivityIndicator color={colors.accent} />
          ) : today.status === 'error' ? (
            <GlassCard>
              <AppText tone="danger">오늘 컨디션을 불러오지 못했어요</AppText>
              <Button
                title="다시 시도"
                variant="secondary"
                size="small"
                onPress={today.reload}
              />
            </GlassCard>
          ) : (
            <HomeWidgets today={today.data} />
          )}
          {summary.status === 'ready' ? (
            <AnalysisCard summary={summary.data} />
          ) : summary.status === 'error' ? (
            <RetryNotice
              message="러닝 분석을 불러오지 못했어요"
              onRetry={summary.reload}
            />
          ) : null}
          <RecordsCard />
          {courses.status === 'ready' ? (
            <CoursesCard courses={courses.data} />
          ) : courses.status === 'error' ? (
            <RetryNotice
              message="저장한 코스를 불러오지 못했어요"
              onRetry={courses.reload}
            />
          ) : null}
        </HomeRefreshProvider>
      </Animated.ScrollView>
      {/* The header floats over the cards as they scroll up, as in the prototype. */}
      <SafeAreaView
        edges={['top']}
        style={styles.headerLayer}
        pointerEvents="box-none"
      >
        <Animated.View
          pointerEvents="none"
          style={[
            styles.headerFill,
            { borderBottomColor: colors.border, opacity: headerFill },
          ]}
        />
        <View style={styles.header}>
          <View style={styles.logo}>
            <Logo width={88} />
          </View>
          <IconButton
            icon="bell"
            accessibilityLabel="알림"
            badge={unread}
            onPress={() => navigateTo(navigation, 'Notifications')}
          />
          <IconButton
            icon="settings"
            accessibilityLabel="설정"
            onPress={() => navigateTo(navigation, 'Settings')}
          />
          <Avatar
            nickname={me.data?.nickname ?? ''}
            photo={photo}
            onPress={() => navigateTo(navigation, 'MyProfile')}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerLayer: { position: 'absolute', top: 0, left: 0, right: 0 },
  // Behind the status bar and the header row, the same colour as the top of the K1 background.
  headerFill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: k1.top,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  header: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.screen,
  },
  logo: { flex: 1 },
  avatar: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: size.iconButton / 2,
    borderWidth: 1.5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: spacing.screen,
    paddingBottom: size.tabBar + size.tabBarInset * 2 + spacing.xxxl,
    gap: spacing.xl,
  },
  // 25 Medium with a smaller, dimmed second line: it ranks by size, not by fading further.
  greetingText: {
    fontFamily: fontFamily.medium,
    fontSize: 20,
    lineHeight: 28,
    letterSpacing: -0.5,
  },
  greeting: {
    fontFamily: fontFamily.medium,
    fontSize: 25,
    lineHeight: 33,
    letterSpacing: -0.7,
    paddingTop: spacing.xl,
  },
});
