import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AppText,
  Backdrop,
  EmptyState,
  Icon,
  Logo,
  useToast,
} from '../../components';
import {
  useRepositories,
  useResource,
  type FeedScope,
  type Post,
  type Repositories,
} from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { size, spacing, useTheme } from '../../theme';
import {
  Avatar,
  placeLine,
  PostActions,
  PostMenu,
  postedAt,
  RecordCard,
  usePostChanges,
} from './parts';

const scopes: { value: FeedScope; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'FOLLOWING', label: '팔로잉' },
];

function FeedItem({
  post,
  onChange,
  onMenu,
}: {
  post: Post;
  onChange: (post: Post) => void;
  onMenu: () => void;
}) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { clock } = useRepositories();
  const { like, bookmark } = usePostChanges(onChange);
  const open = () => navigation.navigate('PostDetail', { postId: post.id });
  const openAuthor = () =>
    post.isMine
      ? navigateTo(navigation, 'MyProfile')
      : navigation.navigate('RunnerProfile', { userId: post.author.userId });
  return (
    <View style={[styles.item, { borderColor: colors.border }]}>
      <View style={styles.authorRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${post.author.handle} 프로필`}
          onPress={openAuthor}
          style={styles.author}
        >
          <Avatar
            nickname={post.author.nickname}
            userId={post.author.userId}
            mine={post.isMine}
            size={34}
          />
          <View style={styles.flex}>
            <AppText variant="bodyStrong">{post.author.handle}</AppText>
            <AppText variant="label" tone="textSecondary">
              {placeLine(post.record)}
            </AppText>
          </View>
        </Pressable>
        {post.isMine ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="게시물 메뉴"
            onPress={onMenu}
            hitSlop={8}
            style={[styles.menu, { borderColor: colors.border }]}
          >
            <Icon name="moreVertical" color={colors.text} size={18} />
          </Pressable>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${post.author.handle}의 게시물`}
        onPress={open}
      >
        <RecordCard record={post.record} courseShared={post.courseShared} />
      </Pressable>
      <PostActions
        post={post}
        onLike={() => like(post)}
        onComment={open}
        onBookmark={() => bookmark(post)}
      />
      {post.body ? (
        <AppText variant="body">
          <AppText variant="bodyStrong">{post.author.handle} </AppText>
          {post.body}
        </AppText>
      ) : null}
      {post.commentCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`댓글 ${post.commentCount}개 모두 보기`}
          onPress={open}
        >
          <AppText variant="caption" tone="textSecondary">
            {`댓글 ${post.commentCount}개 모두 보기`}
          </AppText>
        </Pressable>
      ) : null}
      <AppText variant="label" tone="textTertiary">
        {postedAt(post.createdAt, clock.now())}
      </AppText>
    </View>
  );
}

// 7.1 커뮤니티: the runs people shared, everyone's or only those I follow (CMT02 scope).
export function CommunityScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
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
  // Coming back from 7.2 or 7.3 shows new likes, comments and posts.
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

  const replace = (next: Post) =>
    setPosts(current =>
      current
        ? current.map(post => (post.id === next.id ? next : post))
        : current,
    );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop tail />
      </View>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Logo width={92} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="지역 부산"
          onPress={() => toast('지역 고르기는 준비 중이에요')}
          style={styles.region}
        >
          <AppText variant="caption" tone="textSecondary">
            부산
          </AppText>
          <Icon name="chevronDown" color={colors.textSecondary} size={14} />
        </Pressable>
        <View style={styles.flex} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="알림"
          onPress={() => navigateTo(navigation, 'Notifications')}
          hitSlop={8}
        >
          <Icon name="bell" color={colors.text} size={22} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="검색"
          onPress={() => toast('검색은 준비 중이에요')}
          hitSlop={8}
        >
          <Icon name="search" color={colors.text} size={22} />
        </Pressable>
      </View>
      <View style={[styles.tabs, { borderColor: colors.border }]}>
        {scopes.map(option => {
          const selected = option.value === scope;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="tab"
              accessibilityLabel={option.label}
              accessibilityState={{ selected }}
              onPress={() => setScope(option.value)}
              style={[styles.tab, selected && { borderColor: colors.text }]}
            >
              <AppText
                variant={selected ? 'bodyStrong' : 'body'}
                tone={selected ? 'text' : 'textTertiary'}
              >
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {feed.status === 'error' ? (
        <EmptyState
          icon="alert"
          title="게시물을 불러오지 못했어요"
          actionLabel="다시 시도"
          onAction={reload}
        />
      ) : !posts ? (
        <ActivityIndicator style={styles.loading} />
      ) : posts.length === 0 ? (
        <EmptyState
          icon="community"
          title={
            scope === 'FOLLOWING'
              ? '팔로우한 러너의 게시물이 아직 없어요'
              : '아직 공유된 러닝이 없어요'
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingBottom:
              insets.bottom + size.tabBar + size.tabBarInset * 2 + spacing.xl,
          }}
        >
          {posts.map(post => (
            <FeedItem
              key={post.id}
              post={post}
              onChange={replace}
              onMenu={() => setMenuFor(post)}
            />
          ))}
        </ScrollView>
      )}
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

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: spacing.xxxl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.md,
  },
  region: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  tabs: {
    flexDirection: 'row',
    gap: spacing.xl,
    paddingHorizontal: spacing.screen,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    paddingVertical: spacing.md,
    borderBottomWidth: 2,
    borderColor: 'transparent',
  },
  item: {
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.xl,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  author: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  menu: {
    width: 28,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
