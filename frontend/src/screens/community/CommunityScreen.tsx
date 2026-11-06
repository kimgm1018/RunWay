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
import { AppText, EmptyState, Icon, Logo, useToast } from '../../components';
import {
  useRepositories,
  useResource,
  type FeedScope,
  type Post,
  type Repositories,
} from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, size, spacing } from '../../theme';
import { CommentSheet } from './comments';
import { communityLook } from './look';
import {
  Avatar,
  placeLine,
  PostActions,
  PostMenu,
  postedAt,
  RunPhoto,
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
  onComments,
}: {
  post: Post;
  onChange: (post: Post) => void;
  onMenu: () => void;
  // 댓글 and 댓글 N개 모두 보기 open the 댓글 sheet over the feed (담당자 요청).
  onComments: () => void;
}) {
  const navigation = useNavigation();
  const { clock } = useRepositories();
  const { like, bookmark } = usePostChanges(onChange);
  const openAuthor = () =>
    post.isMine
      ? navigateTo(navigation, 'MyProfile')
      : navigation.navigate('RunnerProfile', { userId: post.author.userId });
  return (
    <View style={styles.item}>
      <View style={styles.authorRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${post.author.handle} 프로필`}
          onPress={openAuthor}
          style={({ pressed }) => [styles.author, pressed && styles.pressed]}
        >
          <Avatar
            nickname={post.author.nickname}
            userId={post.author.userId}
            mine={post.isMine}
            size={38}
          />
          <View style={styles.flex}>
            <AppText style={styles.handle} numberOfLines={1}>
              {post.author.handle}
            </AppText>
            {placeLine(post.record) ? (
              <View style={styles.place}>
                <Icon
                  name="mapPin"
                  color={communityLook.sub}
                  size={11}
                  strokeWidth={2.2}
                />
                <AppText style={styles.placeText} numberOfLines={1}>
                  {placeLine(post.record)}
                </AppText>
              </View>
            ) : null}
          </View>
        </Pressable>
        {post.isMine ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="게시물 메뉴"
            onPress={onMenu}
            hitSlop={8}
            style={({ pressed }) => [styles.menu, pressed && styles.pressed]}
          >
            <Icon
              name="menu"
              color={communityLook.ink}
              size={20}
              strokeWidth={2}
            />
          </Pressable>
        ) : null}
      </View>
      {/* The photo only shows the run; it opens nothing (담당자 결정). */}
      <RunPhoto
        record={post.record}
        courseShared={post.courseShared}
        seed={post.id}
      />
      <View style={styles.actions}>
        <PostActions
          post={post}
          onLike={() => like(post)}
          onComment={onComments}
          onBookmark={() => bookmark(post)}
        />
      </View>
      <View style={styles.words}>
        {post.body ? (
          <AppText style={styles.body}>
            <AppText style={[styles.body, styles.bodyHandle]}>
              {post.author.handle}{' '}
            </AppText>
            {post.body}
          </AppText>
        ) : null}
        {post.commentCount ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`댓글 ${post.commentCount}개 모두 보기`}
            onPress={onComments}
            style={({ pressed }) => [
              styles.comments,
              pressed && styles.pressed,
            ]}
          >
            <AppText style={styles.metaText}>
              {`댓글 ${post.commentCount}개 모두 보기`}
            </AppText>
          </Pressable>
        ) : null}
        <AppText style={[styles.metaText, styles.time]}>
          {postedAt(post.createdAt, clock.now())}
        </AppText>
      </View>
    </View>
  );
}

// 7.1 커뮤니티: the runs people shared, everyone's or only those I follow (CMT02 scope).
export function CommunityScreen() {
  const navigation = useNavigation();
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

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={[styles.header, { marginTop: insets.top }]}>
        <Logo width={104} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="지역 부산"
          onPress={() => toast('지역 고르기는 준비 중이에요')}
          style={({ pressed }) => [styles.region, pressed && styles.pressed]}
        >
          <AppText style={styles.regionText}>부산</AppText>
          <Icon
            name="chevronDown"
            color={communityLook.ink}
            size={14}
            strokeWidth={2.2}
          />
        </Pressable>
        <View style={styles.flex} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="알림"
          onPress={() => navigateTo(navigation, 'Notifications')}
          style={({ pressed }) => [
            styles.headerButton,
            pressed && styles.pressed,
          ]}
        >
          <Icon name="bell" color={communityLook.ink} size={24} />
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
          <Icon name="search" color={communityLook.ink} size={24} />
        </Pressable>
      </View>
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
              style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
            >
              <AppText
                style={[styles.tabText, selected && styles.tabTextSelected]}
              >
                {option.label}
              </AppText>
              {selected ? <View style={styles.tabBar} /> : null}
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
              onComments={() => setCommentsFor(post)}
            />
          ))}
        </ScrollView>
      )}
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

// runway-community-handoff 7.1: a white photo feed without cards, pills or dividers.
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: communityLook.background },
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  loading: { marginTop: spacing.xxxl },
  // 상단 44: the navy wordmark, 부산 ▾ and the outline icons in 40 squares.
  header: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 16,
    paddingRight: 8,
  },
  region: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  regionText: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: communityLook.ink,
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 피드 탭 40: words 22 apart, the picked one bold navy over a 2px bar.
  tabs: {
    height: 40,
    flexDirection: 'row',
    gap: 22,
    paddingHorizontal: 16,
  },
  tab: { justifyContent: 'center' },
  tabText: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: communityLook.meta,
  },
  tabTextSelected: { fontFamily: fontFamily.bold, color: communityLook.ink },
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 4,
    height: 2,
    borderRadius: 1,
    backgroundColor: communityLook.ink,
  },
  // Posts sit 16 apart; the photo runs edge to edge.
  item: { marginBottom: 16 },
  authorRow: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 6,
  },
  author: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  handle: {
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    lineHeight: 18,
    color: communityLook.ink,
  },
  place: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  placeText: {
    flexShrink: 1,
    fontFamily: fontFamily.regular,
    fontSize: 11.5,
    lineHeight: 15,
    color: communityLook.sub,
  },
  menu: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { paddingLeft: 10, paddingRight: 8 },
  words: { paddingHorizontal: 12 },
  body: {
    fontFamily: fontFamily.regular,
    fontSize: 13.5,
    lineHeight: 20,
    color: communityLook.ink,
  },
  bodyHandle: { fontFamily: fontFamily.medium },
  comments: { alignSelf: 'flex-start', marginTop: 4 },
  metaText: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 20,
    color: communityLook.meta,
  },
  time: { marginTop: 4, fontSize: 11.5, lineHeight: 18 },
});
