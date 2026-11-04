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
import { AppText, Icon, MistFill } from '../../components';
import type { GroupTabRouteName } from '../../navigation/routes';
import type { MainTabParamList } from '../../navigation/types';
import { fontFamily, spacing, ThemeProvider } from '../../theme';
import { CrewRecruitPage } from './CrewRecruitScreen';
import { MyCrewsPage } from './GroupScreen';
import { groupLook, insetTrackDark, Raised } from './look';

// 내 크루 is the left page, 크루 모집 the right one.
const pages: readonly GroupTabRouteName[] = ['MyCrews', 'CrewRecruit'];
const pageOf = (name: GroupTabRouteName | undefined) =>
  name === 'CrewRecruit' ? 1 : 0;

// 내 크루 · 크루 모집 (6.0 · 6.1) tabs over the pager: the handoff's segmented switch, the picked tab a
// raised white pill on a pressed-in track.
export function GroupTabs({
  active,
  onSelect,
}: {
  active: number;
  onSelect: (page: number) => void;
}) {
  const tab = (page: number, label: string) => {
    const selected = page === active;
    const text = (
      <AppText style={[styles.tabText, selected && styles.tabTextOn]}>
        {label}
      </AppText>
    );
    return (
      <Pressable
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        onPress={() => !selected && onSelect(page)}
        style={styles.tab}
      >
        {selected ? (
          <Raised tone="white" style={styles.tabOn}>
            {text}
          </Raised>
        ) : (
          text
        )}
      </Pressable>
    );
  };
  return (
    <View style={styles.tabs}>
      {tab(0, '내 크루')}
      {tab(1, '크루 모집')}
    </View>
  );
}

// 6.0 · 6.1 그룹 탭: both pages sit side by side so a sideways swipe drags the next one in under the
// finger. navigateTo(…, 'MyCrews' | 'CrewRecruit') opens the tab on that page.
export function GroupTabScreen() {
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
  // Search: a round button beside the tabs (담당자 요청) that opens the field at the top of the page shown,
  // 내 크루 or 크루 모집; each page keeps its own.
  const [searching, setSearching] = useState([false, false]);
  const setSearchingOn = (target: number, open: boolean) =>
    setSearching(current =>
      current.map((value, index) => (index === target ? open : value)),
    );

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
    // 6.0 · 6.1 sit on --bg-analysis-dark, so both pages take the dark theme (white text).
    <ThemeProvider tone="dark">
      <View style={[styles.root, { backgroundColor: groupLook.navy }]}>
        <StatusBar barStyle="light-content" />
        <MistFill
          id="groupTabBackground"
          colors={[...groupLook.darkBackground]}
          offsets={[...groupLook.darkBackgroundStops]}
        />
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <View style={styles.root}>
            <GroupTabs active={page} onSelect={select} />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              page === 1 ? '크루 검색 열기' : '내 크루 검색 열기'
            }
            accessibilityState={{ expanded: searching[page] }}
            onPress={() => setSearchingOn(page, true)}
            style={({ pressed }) => [
              styles.search,
              pressed && styles.searchPressed,
            ]}
          >
            <Icon name="search" color={groupLook.onDark} size={18} />
          </Pressable>
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
            <MyCrewsPage
              searching={searching[0]}
              onCloseSearch={() => setSearchingOn(0, false)}
            />
          </View>
          <View key="recruit" style={styles.root} collapsable={false}>
            <CrewRecruitPage
              searching={searching[1]}
              onCloseSearch={() => setSearchingOn(1, false)}
            />
          </View>
        </PagerView>
      </View>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // The tabs and the round search button beside them, 16 from the screen edges.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: spacing.md,
  },
  // 6.0-TabSwitcher: 44 high, 4 inside.
  tabs: {
    flexDirection: 'row',
    height: 44,
    marginTop: 3,
    padding: 4,
    gap: 4,
    borderRadius: 22,
    backgroundColor: groupLook.darkButton,
    boxShadow: insetTrackDark,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabOn: {
    alignSelf: 'stretch',
    flex: 1,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: -0.3,
    color: 'rgba(255,255,255,0.7)',
  },
  tabTextOn: { color: groupLook.navy },
  // As tall as the tabs, flat like the round buttons on the crew cards.
  search: {
    width: 44,
    height: 44,
    marginTop: 3,
    borderRadius: 22,
    backgroundColor: groupLook.darkButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchPressed: { transform: [{ scale: 0.95 }] },
});
