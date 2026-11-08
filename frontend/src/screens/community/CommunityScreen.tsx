import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, EmptyState, Icon, useToast } from '../../components';
import {
  useRepositories,
  useResource,
  type FeedScope,
  type Post,
  type Repositories,
} from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, size, spacing, ThemeProvider } from '../../theme';
import { CommentSheet } from './comments';
import { FeedPage, feedLook } from './FeedPage';
import { PostMenu } from './parts';

const scopes: { value: FeedScope; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'FOLLOWING', label: '팔로잉' },
];

// The header row floats over the pages, under the status bar.
const headerHeight = 48;

// 7.1 커뮤니티: the runs people shared, everyone's or only those I follow (CMT02 scope), one full-screen page per
// post paged up and down (S15P31E105-561, 담당자 시안).
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
  const feed = useResource(
    useCallback(
      (repositories: Repositories) => repositories.community.listFeed(scope),
      [scope],
    ),
  );
  const { reload } = feed;
  // Coming back from 7.3 or 7.3e shows new posts and edits.
  useFocusEffect(useCallback(() => reload(), [reload]));
  // The last list stays while it reloads, and likes change it at once.
  const [posts, setPosts] = useState<Post[] | null>(null);
  const loaded = feed.status === 'ready' ? feed.data : null;
  useEffect(() => {
    if (loaded) {
      setPosts(loaded);
    }
  }, [loaded]);
  const [menuFor, setMenuFor] = useState<Post | null>(null);
  const [commentsFor, setCommentsFor] = useState<Post | null>(null);

  const replace = (next: Post) =>
    setPosts(current =>
      current
        ? current.map(post => (post.id === next.id ? next : post))
        : current,
    );

  const pageTop = insets.top + headerHeight + 8;
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
              onAction={reload}
            />
          </View>
        </ThemeProvider>
      ) : !posts ? (
        <ActivityIndicator
          color={feedLook.white}
          style={[styles.loading, { marginTop: pageTop + spacing.xxxl }]}
        />
      ) : posts.length === 0 ? (
        <ThemeProvider tone="dark">
          <View style={[styles.state, { paddingTop: pageTop }]}>
            <EmptyState
              icon="community"
              title={
                scope === 'FOLLOWING'
                  ? '팔로우한 러너의 게시물이 아직 없어요'
                  : '아직 공유된 러닝이 없어요'
              }
            />
          </View>
        </ThemeProvider>
      ) : (
        <FlatList
          // A new scope starts at its first post.
          key={scope}
          data={posts}
          keyExtractor={post => post.id}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          decelerationRate="fast"
          // A few pages either side, so a quick swipe never lands on an empty page.
          windowSize={5}
          initialNumToRender={4}
          getItemLayout={(_, index) => ({
            length: pageSize.height,
            offset: pageSize.height * index,
            index,
          })}
          renderItem={({ item }) => (
            <FeedPage
              post={item}
              width={pageSize.width}
              height={pageSize.height}
              top={pageTop}
              bottom={pageBottom}
              onChange={replace}
              onMenu={() => setMenuFor(item)}
              onComments={() => setCommentsFor(item)}
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
                onPress={() => setScope(option.value)}
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
          accessibilityLabel="지역 부산"
          onPress={() => toast('지역 고르기는 준비 중이에요')}
          style={({ pressed }) => [styles.region, pressed && styles.pressed]}
        >
          <Icon name="mapPin" color={feedLook.white} size={14} />
          <AppText style={styles.regionText}>부산</AppText>
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
      <CommentSheet
        post={commentsFor}
        onClose={() => setCommentsFor(null)}
        onCountChange={(postId, commentCount) =>
          setPosts(current =>
            current
              ? current.map(item =>
                  // A server post without a count keeps none.
                  item.id === postId && item.commentCount !== null
                    ? { ...item, commentCount }
                    : item,
                )
              : current,
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
            reload();
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
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
