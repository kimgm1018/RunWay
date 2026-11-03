import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import PagerView from 'react-native-pager-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Backdrop } from '../../components';
import type { GroupTabRouteName } from '../../navigation/routes';
import type { MainTabParamList } from '../../navigation/types';
import { spacing, useTheme } from '../../theme';
import { CrewRecruitPage } from './CrewRecruitScreen';
import { MyCrewsPage } from './GroupScreen';

// 내 크루 is the left page, 크루 모집 the right one.
const pages: readonly GroupTabRouteName[] = ['MyCrews', 'CrewRecruit'];
const pageOf = (name: GroupTabRouteName | undefined) =>
  name === 'CrewRecruit' ? 1 : 0;

// 내 크루 · 크루 모집 (6.0 · 6.1) tabs over the pager.
export function GroupTabs({
  active,
  onSelect,
}: {
  active: number;
  onSelect: (page: number) => void;
}) {
  const { colors } = useTheme();
  const tab = (page: number, label: string) => {
    const selected = page === active;
    return (
      <Pressable
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        onPress={() => !selected && onSelect(page)}
        style={styles.tab}
      >
        <View style={styles.tabLabel}>
          <AppText
            variant="heading"
            tone={selected ? 'text' : 'textTertiary'}
            style={styles.tabText}
          >
            {label}
          </AppText>
          {selected ? (
            <View style={[styles.tabDot, { backgroundColor: colors.accent }]} />
          ) : null}
        </View>
        <View
          style={[
            styles.tabLine,
            { backgroundColor: selected ? colors.accent : 'transparent' },
          ]}
        />
      </Pressable>
    );
  };
  return (
    <View style={[styles.tabs, { borderColor: colors.border }]}>
      {tab(0, '내 크루')}
      {tab(1, '크루 모집')}
    </View>
  );
}

// 6.0 · 6.1 그룹 탭: both pages sit side by side so a sideways swipe drags the next one in under the
// finger. navigateTo(…, 'MyCrews' | 'CrewRecruit') opens the tab on that page.
export function GroupTabScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<MainTabParamList, 'GroupTab'>>();
  const requested = route.params?.screen;
  const pager = useRef<PagerView>(null);
  const [page, setPage] = useState(() => pageOf(requested));

  // A link from another screen picks the page once, then the param is cleared so the same link
  // works again after the user swipes away.
  useEffect(() => {
    if (!requested) {
      return;
    }
    const target = pageOf(requested);
    pager.current?.setPageWithoutAnimation(target);
    setPage(target);
    navigation.setParams({ screen: undefined } as never);
  }, [requested, navigation]);

  // react-native-pager-view 8 on Android turns off swiping when the new architecture clears the pager's
  // children while mounting, and only a changed scrollEnabled prop turns it back on. Turn it on again
  // once the pages are in place.
  useEffect(() => {
    pager.current?.setScrollEnabled(true);
  }, []);

  const select = useCallback((target: number) => {
    pager.current?.setPage(target);
    setPage(target);
  }, []);

  // Android back on 크루 모집 returns to 내 크루 first, as it did when 6.1 was pushed over 6.0.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          if (page === 0) {
            return false;
          }
          select(0);
          return true;
        },
      );
      return () => subscription.remove();
    }, [page, select]),
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <View style={{ paddingTop: insets.top }}>
        <GroupTabs active={page} onSelect={select} />
      </View>
      <PagerView
        ref={pager}
        style={styles.root}
        initialPage={page}
        keyboardDismissMode="on-drag"
        // The tab follows the page that covers most of the screen while dragging.
        onPageScroll={event => {
          const { position, offset } = event.nativeEvent;
          const shown = offset > 0.5 ? position + 1 : position;
          setPage(current =>
            current === shown || !pages[shown] ? current : shown,
          );
        }}
        onPageSelected={event => setPage(event.nativeEvent.position)}
      >
        <View key="mine" style={styles.root} collapsable={false}>
          <MyCrewsPage />
        </View>
        <View key="recruit" style={styles.root} collapsable={false}>
          <CrewRecruitPage />
        </View>
      </PagerView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: spacing.screen,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: { flex: 1, alignItems: 'center', paddingTop: spacing.xl },
  tabLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  tabText: { paddingBottom: spacing.lg },
  tabDot: { width: 5, height: 5, borderRadius: 3, marginBottom: spacing.lg },
  tabLine: { height: 2, width: 52, borderRadius: 1 },
});
