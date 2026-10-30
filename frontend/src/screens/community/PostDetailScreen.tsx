import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AppText,
  Backdrop,
  EmptyState,
  Icon,
  useToast,
} from '../../components';
import {
  useRepositories,
  useResource,
  type PostComment,
  type PostDetail,
  type Repositories,
} from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import {
  fontFamily,
  k1,
  spacing,
  ThemeProvider,
  typography,
  useTheme,
} from '../../theme';
import {
  Avatar,
  placeLine,
  PostActions,
  PostMenu,
  postedAt,
  RecordCard,
  usePostChanges,
} from './parts';

function CommentRow({
  comment,
  onReply,
}: {
  comment: PostComment;
  onReply: () => void;
}) {
  const { colors } = useTheme();
  const { clock } = useRepositories();
  // Comment likes have no API yet, so they stay on this screen.
  const [liked, setLiked] = useState(comment.liked);
  const likes =
    comment.likeCount + (liked === comment.liked ? 0 : liked ? 1 : -1);
  const meta = [
    postedAt(comment.createdAt, clock.now()),
    likes > 0 ? `좋아요 ${likes}개` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={styles.comment}>
      <Avatar
        nickname={comment.author.nickname}
        userId={comment.author.userId}
        size={32}
      />
      <View style={styles.flex}>
        <AppText variant="body">
          <AppText variant="bodyStrong">{comment.author.handle} </AppText>
          {comment.body}
        </AppText>
        <View style={styles.commentMeta}>
          <AppText variant="label" tone="textSecondary">
            {meta}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${comment.author.handle}에게 답글 달기`}
            onPress={onReply}
            hitSlop={6}
          >
            <AppText variant="label" tone="textSecondary">
              · 답글 달기
            </AppText>
          </Pressable>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={liked ? '댓글 좋아요 취소' : '댓글 좋아요'}
        accessibilityState={{ selected: liked }}
        onPress={() => setLiked(value => !value)}
        hitSlop={8}
        style={styles.commentLike}
      >
        <Icon
          name="heart"
          color={liked ? k1.coral : colors.textSecondary}
          solid={liked}
          size={14}
        />
      </Pressable>
    </View>
  );
}

const loadPost = (repositories: Repositories, postId: string) =>
  repositories.community.get(postId);

// 7.2 게시물 상세 with its comments; on my own post the menu opens 7.2b and 7.2c.
export function PostDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'PostDetail'>>();
  const postId = route.params?.postId ?? 'post-seoyun-1019';
  const { colors } = useTheme();
  const toast = useToast();
  const { community, clock } = useRepositories();
  const me = useResource(
    useCallback(
      (repositories: Repositories) => repositories.profile.getMe(),
      [],
    ),
  );
  const detail = useResource(
    useCallback(
      (repositories: Repositories) => loadPost(repositories, postId),
      [postId],
    ),
  );
  const { reload } = detail;
  // Coming back from 7.3e shows the edited post.
  useFocusEffect(useCallback(() => reload(), [reload]));
  const [post, setPost] = useState<PostDetail | null>(null);
  const loaded = detail.status === 'ready' ? detail.data : null;
  useEffect(() => {
    if (loaded) {
      setPost(loaded);
    }
  }, [loaded]);
  const { like, bookmark } = usePostChanges(next =>
    setPost(current => (current ? { ...current, ...next } : current)),
  );
  const [menu, setMenu] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    const body = draft.trim();
    if (!post || !body) {
      return;
    }
    setSending(true);
    try {
      const comment = await community.addComment(post.id, body);
      setPost({
        ...post,
        comments: [...post.comments, comment],
        commentCount: post.commentCount + 1,
      });
      setDraft('');
    } catch {
      toast('댓글을 남기지 못했어요. 잠시 후 다시 시도해 주세요');
    } finally {
      setSending(false);
    }
  };
  const openAuthor = (current: PostDetail) =>
    current.isMine
      ? navigateTo(navigation, 'MyProfile')
      : navigation.navigate('RunnerProfile', {
          userId: current.author.userId,
        });

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop tail />
      </View>
      <SafeAreaView edges={['top']}>
        <View style={[styles.header, { borderColor: colors.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            onPress={() => navigation.goBack()}
            hitSlop={8}
          >
            <Icon name="back" color={colors.text} size={22} />
          </Pressable>
          <AppText style={styles.headerTitle} accessibilityRole="header">
            게시물
          </AppText>
          {post?.isMine ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="게시물 메뉴 열기"
              onPress={() => setMenu(true)}
              hitSlop={8}
            >
              <Icon name="more" color={colors.text} size={22} />
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
      {detail.status === 'error' && !post ? (
        <EmptyState
          icon="alert"
          title="게시물을 불러오지 못했어요"
          actionLabel="다시 시도"
          onAction={reload}
        />
      ) : !post ? (
        <ActivityIndicator style={styles.loading} />
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={styles.body}>
              <View style={styles.authorRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${post.author.handle} 프로필`}
                  onPress={() => openAuthor(post)}
                  style={styles.author}
                >
                  <Avatar
                    nickname={post.author.nickname}
                    userId={post.author.userId}
                    mine={post.isMine}
                  />
                  <View style={styles.flex}>
                    <AppText style={styles.handle}>
                      {post.author.handle}
                    </AppText>
                    <AppText variant="caption" tone="textSecondary">
                      {placeLine(post.record)}
                    </AppText>
                  </View>
                </Pressable>
                {post.isMine ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="게시물 메뉴"
                    onPress={() => setMenu(true)}
                    hitSlop={8}
                    style={[styles.menu, { borderColor: colors.border }]}
                  >
                    <Icon name="moreVertical" color={colors.text} size={18} />
                  </Pressable>
                ) : null}
              </View>
              <RecordCard
                record={post.record}
                courseShared={post.courseShared}
              />
              <PostActions
                post={post}
                onLike={() => like(post)}
                onComment={() => undefined}
                onBookmark={() => bookmark(post)}
              />
              {post.body ? (
                <AppText style={styles.postText}>
                  <AppText style={[styles.postText, styles.bold]}>
                    {post.author.handle}{' '}
                  </AppText>
                  {post.body}
                </AppText>
              ) : null}
              <AppText variant="caption" tone="textTertiary">
                {postedAt(post.createdAt, clock.now())}
              </AppText>
            </View>
            <View style={[styles.comments, { borderColor: colors.border }]}>
              {post.comments.length === 0 ? (
                <AppText variant="caption" tone="textSecondary">
                  아직 댓글이 없어요. 첫 댓글을 남겨 보세요.
                </AppText>
              ) : (
                post.comments.map(comment => (
                  <CommentRow
                    key={comment.id}
                    comment={comment}
                    onReply={() => setDraft(`@${comment.author.handle} `)}
                  />
                ))
              )}
            </View>
          </ScrollView>
          {/* The comment bar sits on the black lower part. */}
          <ThemeProvider tone="dark">
            <SafeAreaView edges={['bottom']} style={styles.inputBar}>
              <Avatar
                nickname={me.status === 'ready' ? me.data.nickname : ''}
                userId="me"
                mine
                size={36}
              />
              <View style={styles.input}>
                <TextInput
                  accessibilityLabel="댓글 입력"
                  placeholder={`${post.author.handle}님에게 댓글 달기…`}
                  placeholderTextColor="rgba(232,238,244,0.5)"
                  selectionColor={k1.ice}
                  value={draft}
                  onChangeText={setDraft}
                  style={styles.inputText}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="게시"
                accessibilityState={{ disabled: !draft.trim() || sending }}
                disabled={!draft.trim() || sending}
                onPress={send}
                hitSlop={8}
              >
                <AppText
                  variant="bodyStrong"
                  style={draft.trim() ? styles.send : styles.sendOff}
                >
                  게시
                </AppText>
              </Pressable>
            </SafeAreaView>
          </ThemeProvider>
        </KeyboardAvoidingView>
      )}
      <PostMenu
        visible={menu}
        onClose={() => setMenu(false)}
        onEdit={() => navigation.navigate('PostEdit', { postId })}
        onDelete={async () => {
          try {
            await community.remove(postId);
            setMenu(false);
            toast('게시물을 삭제했어요');
            navigation.goBack();
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
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.screen,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fontFamily.bold,
    fontSize: 18,
    lineHeight: 24,
  },
  body: { padding: spacing.screen, gap: spacing.md },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  author: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  handle: { fontFamily: fontFamily.bold, fontSize: 16, lineHeight: 22 },
  menu: {
    width: 28,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postText: { fontFamily: fontFamily.regular, fontSize: 15, lineHeight: 23 },
  bold: { fontFamily: fontFamily.bold },
  comments: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.screen,
    gap: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  comment: { flexDirection: 'row', gap: spacing.lg },
  commentMeta: { flexDirection: 'row', gap: spacing.xs, marginTop: 2 },
  commentLike: { paddingTop: spacing.xs },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: k1.black,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(232,238,244,0.12)',
  },
  input: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(232,238,244,0.18)',
    paddingHorizontal: spacing.xxl,
    justifyContent: 'center',
  },
  send: { color: k1.ice },
  sendOff: { color: 'rgba(232,238,244,0.4)' },
  inputText: {
    height: 44,
    padding: 0,
    color: k1.ice,
    fontFamily: typography.input.fontFamily,
    fontSize: 14,
  },
});
