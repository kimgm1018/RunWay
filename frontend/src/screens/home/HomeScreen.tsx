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
import { AppText, Backdrop, Button, Icon, Logo } from '../../components';
import { useResource, type Repositories } from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import {
  fontFamily,
  homePalette,
  mistGradient,
  size,
  spacing,
  useTheme,
} from '../../theme';
import { GlassCard, HomeRefreshProvider, RetryNotice } from './parts';
import {
  cardHeight,
  ConditionCard,
  conditionHeight,
  gap,
  gutter,
  HomeGrid,
} from './widgets';

// S15P31E105-382 (in -391): no greeting, so 오늘 컨디션 sits 4 under the header and the last cards keep
// 14 clear of the floating tab bar.
const headerGap = 4;
const tabBarGap = 14;
// Cards stop above the floating tab bar and its margins.
const bottomSpace = size.tabBar + size.tabBarInset * 2;

// Each part loads on its own, so one that fails (the notifications, say) leaves the rest of 2.1 on screen.
const loadMe = (repositories: Repositories) => repositories.profile.getMe();
const loadToday = (repositories: Repositories) =>
  repositories.home.getTodayCondition();
const loadCourses = (repositories: Repositories) =>
  repositories.courses.getSaved();
const loadNotifications = (repositories: Repositories) =>
  repositories.notifications.list();

// The 40 round header buttons of the 2.1 핸드오프: a misty white disc, no border, an orange dot for unread.
function HeaderButton({
  icon,
  label,
  dot = false,
  onPress,
}: {
  icon: 'bell' | 'settings';
  label: string;
  dot?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
    >
      <Icon name={icon} color={homePalette.header} size={20} />
      {dot ? <View style={styles.unread} /> : null}
    </Pressable>
  );
}

function Avatar({
  nickname,
  photo,
  onPress,
}: {
  nickname: string;
  photo: string | null;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="내 프로필"
      hitSlop={4}
      onPress={onPress}
      style={styles.avatar}
    >
      {photo ? (
        <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} />
      ) : (
        <AppText style={styles.initial}>{nickname.slice(0, 1)}</AppText>
      )}
    </Pressable>
  );
}

// 2.1 홈 (S15P31E105-367·-391 핸드오프): 오늘 컨디션 with 러닝 시작, then two columns of cards.
export function HomeScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const me = useResource(loadMe);
  const today = useResource(loadToday);
  const courses = useResource(loadCourses);
  const notifications = useResource(loadNotifications);
  // Back from 8.2 the avatar shows the saved nickname and photo, and back from 2.9 the bell
  // loses its dot (leaving 2.9 marks all read). The first focus is the first load.
  const refreshMe = me.refresh;
  const refreshNotifications = notifications.refresh;
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) {
        void refreshMe();
        void refreshNotifications();
      }
      focused.current = true;
    }, [refreshMe, refreshNotifications]),
  );
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
    [me, today, courses, notifications].forEach(resource =>
      track(resource.refresh()),
    );
    setPull(count => count + 1);
  };
  // 2.1 fits one screen: the two rows of cards share the height left under the header and 오늘 컨디션,
  // above the tab bar. They never go below the mockup's 216; a shorter phone scrolls instead.
  const [viewport, setViewport] = useState(0);
  const top = insets.top + size.header;
  const room =
    viewport -
    top -
    headerGap -
    bottomSpace -
    tabBarGap -
    conditionHeight -
    gap * 2;
  const gridHeight = viewport ? Math.max(cardHeight, room / 2) : cardHeight;
  const scrollY = useRef(new Animated.Value(0)).current;
  // The header gets the K1 top colour once the cards start passing under it, so the two never overlap.
  const headerFill = scrollY.interpolate({
    inputRange: [0, spacing.xxxl],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  return (
    <View
      style={[styles.root, { backgroundColor: colors.background }]}
      onLayout={event => setViewport(event.nativeEvent.layout.height)}
    >
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <Animated.ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + size.header + headerGap },
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
            <ConditionCard today={today.data} />
          )}
          <HomeGrid courses={courses.data} height={gridHeight} />
          {courses.status === 'error' ? (
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
            <Logo width={104} />
          </View>
          <HeaderButton
            icon="bell"
            label="알림"
            dot={unread}
            onPress={() => navigateTo(navigation, 'Notifications')}
          />
          <HeaderButton
            icon="settings"
            label="설정"
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
  // Behind the status bar and the header row, the same colour as the top of the mist background.
  headerFill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: mistGradient.colors[0],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  header: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  logo: { flex: 1 },
  pressed: { opacity: 0.7 },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: homePalette.headerButton,
  },
  unread: {
    position: 'absolute',
    top: 9,
    right: 10,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: homePalette.unread,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: homePalette.avatar,
  },
  initial: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  // Cards sit 8 from the edges, 14 above the tab bar.
  content: {
    paddingHorizontal: gutter,
    paddingBottom: bottomSpace + tabBarGap,
    gap,
  },
});
