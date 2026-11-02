import React, { useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { AppText, Backdrop, Button, IconButton, Logo } from '../../components';
import { useResource, type Repositories } from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, k1, size, spacing, useTheme } from '../../theme';
import { GlassCard } from './parts';
import { AnalysisCard, CoursesCard, RecordsCard } from './sections';
import { HomeWidgets } from './widgets';

const loadHome = (repositories: Repositories) =>
  Promise.all([
    repositories.profile.getMe(),
    repositories.home.getTodayCondition(),
    repositories.home.getMonthlySummary(),
    repositories.courses.getSaved(),
    repositories.notifications.list(),
  ]);

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
  const home = useResource(useCallback(loadHome, []));
  const insets = useSafeAreaInsets();
  const [me, today, summary, courses, notifications] =
    home.status === 'ready' ? home.data : [];
  const photo = me?.profileImageUrl ?? null;
  const unread = notifications?.some(item => !item.read) ?? false;
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
      >
        <AppText style={styles.greeting}>
          {me ? `${me.nickname}님,\n` : ''}
          <AppText tone="textTertiary" style={styles.greetingText}>
            오늘 달리기 좋은 날이에요
          </AppText>
        </AppText>
        {home.status === 'loading' ? (
          <ActivityIndicator color={colors.accent} />
        ) : home.status === 'error' ? (
          <GlassCard>
            <AppText tone="danger">홈 정보를 불러오지 못했어요</AppText>
            <Button
              title="다시 시도"
              variant="secondary"
              size="small"
              onPress={home.reload}
            />
          </GlassCard>
        ) : null}
        {today ? <HomeWidgets today={today} /> : null}
        {summary ? <AnalysisCard summary={summary} /> : null}
        {home.status === 'ready' ? <RecordsCard /> : null}
        {courses ? <CoursesCard courses={courses} /> : null}
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
            nickname={me?.nickname ?? ''}
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
