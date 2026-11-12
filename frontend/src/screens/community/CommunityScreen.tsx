import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  useFocusEffect,
  useIsFocused,
  useNavigation,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, EmptyState, Icon, useToast } from '../../components';
import { useRepositories, type FeedScope, type Post } from '../../data';
import { onPostChanged, takePostsChanged } from '../../data/postsChanged';
import type { LngLat } from '../../geo';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, size, spacing, ThemeProvider } from '../../theme';
import { CommentSheet } from './comments';
import { FeedPage, feedLook } from './FeedPage';
import { takePrefetchedFeed } from './feedPrefetch';
import { PostMenu } from './parts';
import { FeedRouteReplay } from './RouteReplay';
import { NATIONWIDE, RegionSheet, type FeedRegion } from './RegionSheet';
import { usePostPages } from './usePostPages';

const scopes: { value: FeedScope; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'FOLLOWING', label: '팔로잉' },
];

// A list mounted for a new scope or region starts at its first post (S15P31E105-699).
const firstPost = { x: 0, y: 0 };

// The header row floats over the pages, under the status bar.
const headerHeight = 48;
// Where a page's own content starts, under the floating header.
export const feedPageTop = (insetTop: number) => insetTop + headerHeight + 8;

// 7.1 커뮤니티: the runs people shared, everyone's or only those I follow (CMT02 scope), one full-screen page per
// post paged up and down (S15P31E105-561, 담당자 시안). 20 posts a page, the next read near the end
// (S15P31E105-647).
// The page on screen plays its course in place (S15P31E105-721, 704에서 처리, 작업 요청자).
const feedReplay = (shown: {
  post: Post;
  route: LngLat[];
  unmeasuredEdges: number[];
  playing: boolean;
  onShown: () => void;
}) => <FeedRouteReplay {...shown} />;

export function CommunityScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  // The page is the screen's own size, measured once it lays out.
  const [pageSize, setPageSize] = useState<{ width: number; height: number }>({
    width: window.width,
    height: window.height,
  });
  const toast = useToast();
  const { community } = useRepositories();
  const [scope, setScope] = useState<FeedScope>('ALL');
  // 지역 고르기 (S15P31E105-687): 전국 until one is picked, kept while the app runs this screen.
  const [region, setRegion] = useState<FeedRegion>(NATIONWIDE);
  const [regionsOpen, setRegionsOpen] = useState(false);
  // A new scope or region starts again from its first page.
  const feed = usePostPages(
    useCallback(
      (cursor: string | null) => {
        // The first 전체 · 전국 page may have been read ahead from another tab; if that read failed, read it again.
        const ahead =
          cursor === null && scope === 'ALL' && region.code === null
            ? takePrefetchedFeed()
            : null;
        return ahead
          ? ahead.catch(() => community.listFeed(scope, cursor, region.code))
          : community.listFeed(scope, cursor, region.code);
      },
      [community, scope, region.code],
    ),
  );
  const { refresh, update } = feed;
  const list = useRef<FlatList<Post>>(null);
  // The page on screen, back to the first with a new scope. Away from 7.1 (7.2 over it, another tab) no page
  // keeps a map up.
  const [shownPage, setShownPage] = useState(0);
  useEffect(() => setShownPage(0), [scope, region.code]);
  // A new scope or region shows its list from the first post (S15P31E105-699). The list is mounted again for it
  // (its key), but Android can hand the new list the old one's scroll offset, so the feed is also put back at
  // the top when the choice is made and again once the new first page is on screen.
  const toTop = useRef(false);
  const showFirst = useCallback(() => {
    toTop.current = true;
    setShownPage(0);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);
  useEffect(() => {
    if (toTop.current && feed.status === 'ready') {
      toTop.current = false;
      list.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [feed.status, scope, region.code]);
  const pickScope = (next: FeedScope) => {
    if (next !== scope) {
      showFirst();
      setScope(next);
    }
  };
  const pickRegion = (next: FeedRegion) => {
    if (next.code !== region.code) {
      showFirst();
    }
    setRegion(next);
  };
  // Coming back from 7.2, a profile or another tab keeps the posts read so far and the page on screen. Only after
  // a post was written (7.3), edited (7.3e) or deleted elsewhere is the first page read again, the last list on
  // screen until it comes; then the feed is back at its first post. The first focus is the first load itself, so
  // a change before it is already in. A refresh that fails keeps the list and says so.
  const focusedBefore = useRef(false);
  useFocusEffect(
    useCallback(() => {
      const changed = takePostsChanged();
      if (focusedBefore.current && changed) {
        refresh().then(result => {
          if (result === 'refreshed') {
            setShownPage(0);
            list.current?.scrollToOffset({ offset: 0, animated: false });
          } else if (result === 'failed') {
            toast('새 게시물을 불러오지 못했어요');
          }
        });
      }
      focusedBefore.current = true;
    }, [refresh, toast]),
  );
  // Likes, bookmarks and comment counts changed on 7.2 show in place. A server post without a count keeps none.
  useEffect(
    () =>
      onPostChanged((postId, change) =>
        update(postId, post => ({
          ...post,
          ...change,
          commentCount:
            post.commentCount === null
              ? null
              : change.commentCount ?? post.commentCount,
        })),
      ),
    [update],
  );
  const focused = useIsFocused();
  // The pages around the one on screen draw their maps only after its map is up, so on entering 커뮤니티 the first
  // map does not share the phone with two more (사용자 요청: 첫 진입을 빠르게). Leaving the feed starts it over.
  const [firstMapUp, setFirstMapUp] = useState(false);
  useEffect(() => {
    if (!focused) {
      setFirstMapUp(false);
    }
  }, [focused]);
  const markFirstMapUp = useCallback(() => setFirstMapUp(true), []);
  const [menuFor, setMenuFor] = useState<Post | null>(null);
  const [commentsFor, setCommentsFor] = useState<Post | null>(null);

  const pageTop = feedPageTop(insets.top);
  // Above the floating tab bar.
  const pageBottom = insets.bottom + size.tabBar + size.tabBarInset * 2;
  return (
    <View
      style={styles.root}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        if (width && height) {
          setPageSize({ width, height });
        }
      }}
    >
      <StatusBar barStyle="light-content" />
      {feed.status === 'error' ? (
        <ThemeProvider tone="dark">
          <View style={[styles.state, { paddingTop: pageTop }]}>
            <EmptyState
              icon="alert"
              title="게시물을 불러오지 못했어요"
              actionLabel="다시 시도"
              onAction={feed.retry}
            />
          </View>
        </ThemeProvider>
      ) : feed.status === 'loading' ? (
        <ActivityIndicator
          color={feedLook.white}
          style={[styles.loading, { marginTop: pageTop + spacing.xxxl }]}
        />
      ) : feed.empty ? (
        <ThemeProvider tone="dark">
          <View style={[styles.state, { paddingTop: pageTop }]}>
            <EmptyState
              icon="community"
              title={
                region.code !== null
                  ? `${region.label}에서 공유된 러닝이 아직 없어요`
                  : scope === 'FOLLOWING'
                  ? '아직 팔로우한 러너의 게시물이 없어요'
                  : '아직 공유된 러닝이 없어요'
              }
            />
          </View>
        </ThemeProvider>
      ) : (
        <FlatList
          // A new scope or region starts at its first post.
          key={`${scope}:${region.code ?? ''}`}
          ref={list}
          contentOffset={firstPost}
          data={feed.posts}
          keyExtractor={post => post.id}
          // Two pages before the end the next 20 are read; nothing after the last page.
          onEndReached={feed.loadMore}
          onEndReachedThreshold={2}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          decelerationRate="fast"
          // A few pages either side, so a quick swipe never lands on an empty page.
          windowSize={5}
          initialNumToRender={4}
          // Android detaches the pages off screen by default, and a detached native map does not start; the pages
          // around the one on screen keep theirs attached so their maps are drawn before a swipe brings them in.
          removeClippedSubviews={false}
          getItemLayout={(_, index) => ({
            length: pageSize.height,
            offset: pageSize.height * index,
            index,
          })}
          // The page the feed settles on is the one that draws the real map (S15P31E105-521).
          onMomentumScrollEnd={event => {
            const page = Math.round(
              event.nativeEvent.contentOffset.y / pageSize.height,
            );
            setShownPage(page);
            // FlatList does not ask for the end again by itself after a failed page: settling near the end
            // tries the same page again.
            if (feed.moreError && page >= feed.posts.length - 3) {
              feed.loadMore();
            }
          }}
          // Under the last page: the next page on its way, or a way to ask for it again.
          ListFooterComponent={
            feed.loadingMore ? (
              <ActivityIndicator
                color={feedLook.white}
                style={[styles.more, { marginBottom: pageBottom }]}
              />
            ) : feed.moreError ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="다음 게시물 다시 불러오기"
                onPress={feed.retry}
                style={({ pressed }) => [
                  styles.more,
                  { marginBottom: pageBottom },
                  pressed && styles.pressed,
                ]}
              >
                <AppText style={styles.regionText}>
                  더 불러오지 못했어요 · 다시 시도
                </AppText>
              </Pressable>
            ) : null
          }
          renderItem={({ item, index }) => (
            <FeedPage
              post={item}
              width={pageSize.width}
              height={pageSize.height}
              top={pageTop}
              bottom={pageBottom}
              onChange={feed.replace}
              onMenu={() => setMenuFor(item)}
              onComments={() => setCommentsFor(item)}
              active={focused && index === shownPage}
              nearby={
                focused && firstMapUp && Math.abs(index - shownPage) === 1
              }
              onMapShown={markFirstMapUp}
              replay={feedReplay}
            />
          )}
        />
      )}
      {/* 시안 상단: 전체 · 팔로잉 on the left, 지역 · 알림 · 검색 on the right, white over the page. */}
      <View
        style={[styles.header, { top: insets.top }]}
        pointerEvents="box-none"
      >
        <View style={styles.tabs}>
          {scopes.map(option => {
            const selected = option.value === scope;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="tab"
                accessibilityLabel={option.label}
                accessibilityState={{ selected }}
                onPress={() => pickScope(option.value)}
                hitSlop={6}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <AppText
                  style={[styles.tabText, selected && styles.tabTextSelected]}
                >
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.flex} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`지역 ${region.label}`}
          accessibilityHint="지역을 골라 그 지역 게시물만 봐요"
          onPress={() => setRegionsOpen(true)}
          style={({ pressed }) => [styles.region, pressed && styles.pressed]}
        >
          <Icon name="mapPin" color={feedLook.white} size={14} />
          <AppText
            style={[styles.regionText, styles.regionLabel]}
            numberOfLines={1}
          >
            {region.label}
          </AppText>
          <Icon name="chevronDown" color={feedLook.white} size={13} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="알림"
          onPress={() => navigateTo(navigation, 'Notifications')}
          style={({ pressed }) => [
            styles.headerButton,
            pressed && styles.pressed,
          ]}
        >
          <Icon name="bell" color={feedLook.white} size={24} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="검색"
          onPress={() => navigateTo(navigation, 'CommunitySearch')}
          style={({ pressed }) => [
            styles.headerButton,
            pressed && styles.pressed,
          ]}
        >
          <Icon name="search" color={feedLook.white} size={24} />
        </Pressable>
      </View>
      <RegionSheet
        visible={regionsOpen}
        selected={region}
        onClose={() => setRegionsOpen(false)}
        onSelect={pickRegion}
      />
      <CommentSheet
        post={commentsFor}
        onClose={() => setCommentsFor(null)}
        onCountChange={(postId, commentCount) =>
          feed.update(postId, item =>
            // A server post without a count keeps none.
            item.commentCount !== null ? { ...item, commentCount } : item,
          )
        }
      />
      <PostMenu
        visible={menuFor !== null}
        onClose={() => setMenuFor(null)}
        onEdit={() =>
          menuFor && navigation.navigate('PostEdit', { postId: menuFor.id })
        }
        onDelete={async () => {
          if (!menuFor) {
            return;
          }
          try {
            await community.remove(menuFor.id);
            setMenuFor(null);
            toast('게시물을 삭제했어요');
            feed.remove(menuFor.id);
          } catch {
            toast('게시물을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요');
          }
        }}
      />
    </View>
  );
}

// 7.1 (S15P31E105-561, 담당자 시안): full-screen pages on the dark map ground, the header floating over them.
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: feedLook.ground },
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  loading: { alignSelf: 'center' },
  // The footer under the last page, above the floating tab bar (S15P31E105-647).
  more: { alignSelf: 'center', paddingVertical: spacing.xxl },
  state: { flex: 1 },
  header: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 16,
    paddingRight: 8,
  },
  // 시안의 For you · Following: the picked one bold white, the other faint, side by side.
  tabs: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  tabText: {
    fontFamily: fontFamily.bold,
    fontSize: 18,
    lineHeight: 24,
    color: feedLook.faint,
  },
  tabTextSelected: { color: feedLook.white },
  // A glass pill like the 시안's round icon buttons.
  region: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  regionText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 18,
    color: feedLook.white,
  },
  // ‘경기 수원시 장안구’ stays one line beside the tabs.
  regionLabel: { maxWidth: 120 },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
