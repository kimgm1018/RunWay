import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, StatusBar, StyleSheet, View } from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import PagerView from 'react-native-pager-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../../components';
import type { GroupTabRouteName } from '../../navigation/routes';
import type { MainTabParamList } from '../../navigation/types';
import { fontFamily, spacing, ThemeProvider } from '../../theme';
import { CrewRecruitPage } from './CrewRecruitScreen';
import { groupIntroSeen } from '../../data/group/groupIntroSeen';
import { GroupIntro } from './GroupIntro';
import { groupLook, NightBackground } from './look';
import { MyCrewsPage } from './GroupScreen';
import { stand, UnderlineTabs } from './stand';
import { GlassIconButton } from '../../components/GlassIconButton';

// 내 크루 is the left page, 크루 모집 the right one.
const pages: readonly GroupTabRouteName[] = ['MyCrews', 'CrewRecruit'];
const pageOf = (name: GroupTabRouteName | undefined) =>
  name === 'CrewRecruit' ? 1 : 0;

// 내 크루 · 크루 모집 (6.0 · 6.1) tabs over the pager: words on a line, the picked one bold over a mint line
// (그룹런 시안, S15P31E105-673).
const tabItems = [
  { key: 'mine', label: '내 크루' },
  { key: 'recruit', label: '크루 모집' },
] as const;

export function GroupTabs({
  active,
  onSelect,
}: {
  active: number;
  onSelect: (page: number) => void;
}) {
  return (
    <UnderlineTabs
      items={tabItems}
      active={tabItems[active].key}
      onSelect={key => onSelect(key === 'recruit' ? 1 : 0)}
    />
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
  // 그룹 탭 첫 화면 (GroupIntro) until the member has seen it once (S15P31E105-697); null while the keystore answers.
  // A link to a page skips it without counting it as seen.
  const [intro, setIntro] = useState<boolean | null>(() => {
    if (requested) return false;
    const seen = groupIntroSeen.peek();
    return seen === undefined ? null : !seen;
  });
  useEffect(() => {
    if (intro !== null) {
      return;
    }
    let live = true;
    groupIntroSeen.load().then(seen => {
      if (live) {
        setIntro(current => (current === null ? !seen : current));
      }
    });
    return () => {
      live = false;
    };
  }, [intro]);
  const startGroups = useCallback(() => {
    void groupIntroSeen.mark();
    setIntro(false);
  }, []);
  // The tab bar reads this to go see-through over the intro.
  useEffect(() => {
    navigation.setParams({ intro: intro === true } as never);
  }, [intro, navigation]);

  // A link from another screen picks the page once, then the param is cleared so the same link
  // works again after the user swipes away.
  useEffect(() => {
    if (!requested) {
      return;
    }
    setIntro(false);
    const target = pageOf(requested);
    pager.current?.setPageWithoutAnimation(target);
    setPage(target);
    navigation.setParams({ screen: undefined } as never);
  }, [requested, navigation]);

  // react-native-pager-view 8 on Android turns off swiping when the new architecture clears the pager's
  // children while mounting, and only a changed scrollEnabled prop turns it back on. Turn it on again
  // once the pages are in place, which is after the intro when it shows.
  useEffect(() => {
    if (intro === false) {
      pager.current?.setScrollEnabled(true);
    }
  }, [intro]);

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

  if (intro) {
    return <GroupIntro onStart={startGroups} />;
  }
  // The intro's navy for the moment the keystore takes, so neither screen flashes before the answer.
  if (intro === null) {
    return <View style={[styles.root, { backgroundColor: groupLook.navy }]} />;
  }

  return (
    // 6.0 · 6.1 on the home card's navy (S15P31E105-594 담당자 결정), white text and faint white cards.
    <ThemeProvider tone="dark">
      <View style={styles.root}>
        <StatusBar barStyle="light-content" />
        {/* The home card's navy behind the group screens (S15P31E105-594 담당자 결정: 진한 네이비 배경). */}
        <NightBackground />
        {/* 그룹 title with search on its right, the tabs full width under it (S15P31E105-594 담당자 시안). */}
        <View
          style={[
            styles.titleRow,
            { paddingTop: insets.top, minHeight: insets.top + 54 },
          ]}
        >
          <AppText style={styles.title} accessibilityRole="header">
            그룹
          </AppText>
          <GlassIconButton
            icon="search"
            tone="dark"
            diameter={40}
            accessibilityLabel={
              page === 1 ? '크루 검색 열기' : '내 크루 검색 열기'
            }
            accessibilityState={{ expanded: searching[page] }}
            onPress={() => setSearchingOn(page, true)}
          />
        </View>
        <View style={styles.header}>
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 19,
  },
  title: {
    fontFamily: fontFamily.black,
    fontSize: 28,
    lineHeight: 36,
    color: stand.text,
  },
  // The tabs, 19 from the screen edges, 8 under the title.
  header: {
    paddingHorizontal: 19,
    marginTop: 8,
    marginBottom: spacing.md,
  },
});
