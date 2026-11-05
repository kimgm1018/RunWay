import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { AppText, EmptyState, Icon, useToast } from '../../components';
import {
  useRepositories,
  useResource,
  type PostComment,
  type PostDetail,
  type Repositories,
} from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import { fontFamily, typography } from '../../theme';
import { communityLook, LineLabel } from './look';
import {
  Avatar,
  placeLine,
  PostActions,
  PostMenu,
  postedAt,
  RunPhoto,
  usePostChanges,
} from './parts';
import { commentFailure, CommentRow } from './comments';
import { BackButton } from '../../components/BackButton';
import { GlassIconButton } from '../../components/GlassIconButton';

const loadPost = (repositories: Repositories, postId: string) =>
  repositories.community.get(postId);

// 7.2 게시물 상세 with its comments; on my own post the menu opens 7.2b and 7.2c.
export function PostDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'PostDetail'>>();
  const postId = route.params?.postId ?? 'post-seoyun-1019';
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
  // The comment whose sheet is open, and the one being edited in the comment bar.
  const [commentMenu, setCommentMenu] = useState<PostComment | null>(null);
  const [editing, setEditing] = useState<PostComment | null>(null);
  const input = useRef<TextInput>(null);

  const stopEditing = () => {
    setEditing(null);
    setDraft('');
  };
  const startEditing = (comment: PostComment) => {
    setEditing(comment);
    setDraft(comment.body);
    // After the sheet has closed, so the keyboard stays up.
    setTimeout(() => input.current?.focus(), 300);
  };
  // CMT08: the saved text replaces the comment in place.
  const saveEdit = async (comment: PostComment) => {
    const body = draft.trim();
    if (!post) {
      return;
    }
    if (!body) {
      toast('댓글 내용을 입력해 주세요');
      return;
    }
    setSending(true);
    try {
      const saved = await community.updateComment(comment.id, body);
      setPost({
        ...post,
        comments: post.comments.map(item =>
          item.id === comment.id ? { ...item, body: saved } : item,
        ),
      });
      stopEditing();
      toast('댓글을 수정했어요');
    } catch (error) {
      toast(commentFailure(error, '수정'));
    } finally {
      setSending(false);
    }
  };
  // CMT09: the comment leaves the list and the count.
  const removeComment = async (comment: PostComment) => {
    setCommentMenu(null);
    if (!post) {
      return;
    }
    try {
      await community.removeComment(comment.id);
      setPost({
        ...post,
        comments: post.comments.filter(item => item.id !== comment.id),
        commentCount: post.commentCount === null ? null : post.commentCount - 1,
      });
      if (editing?.id === comment.id) {
        stopEditing();
      }
      toast('댓글을 삭제했어요');
    } catch (error) {
      toast(commentFailure(error, '삭제'));
    }
  };

  const send = async () => {
    if (editing) {
      await saveEdit(editing);
      return;
    }
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
        commentCount: post.commentCount === null ? null : post.commentCount + 1,
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

  const sendable = Boolean(editing) || Boolean(draft.trim());
  const commentCount = post ? post.commentCount ?? post.comments.length : 0;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <>
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <BackButton onPress={() => navigation.goBack()} />
            <AppText style={styles.headerTitle} accessibilityRole="header">
              게시물
            </AppText>
            {post?.isMine ? (
              <GlassIconButton
                icon="more"
                accessibilityLabel="게시물 메뉴 열기"
                onPress={() => setMenu(true)}
              />
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
          <ActivityIndicator style={styles.loading} color={communityLook.ink} />
        ) : (
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.scroll}
            >
              <View style={styles.authorRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${post.author.handle} 프로필`}
                  onPress={() => openAuthor(post)}
                  style={({ pressed }) => [
                    styles.author,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <Avatar
                    nickname={post.author.nickname}
                    userId={post.author.userId}
                    mine={post.isMine}
                  />
                  <View style={styles.flex}>
                    <AppText style={styles.handle} numberOfLines={1}>
                      {post.author.handle}
                    </AppText>
                    {placeLine(post.record) ? (
                      <AppText style={styles.place} numberOfLines={1}>
                        {placeLine(post.record)}
                      </AppText>
                    ) : null}
                  </View>
                  <Icon
                    name="forward"
                    color={communityLook.meta}
                    size={14}
                    strokeWidth={2.4}
                  />
                </Pressable>
                {post.isMine ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="게시물 메뉴"
                    onPress={() => setMenu(true)}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.rowMenu,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Icon
                      name="moreVertical"
                      color={communityLook.ink}
                      size={18}
                    />
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.photo}>
                <RunPhoto
                  record={post.record}
                  courseShared={post.courseShared}
                  seed={post.id}
                />
              </View>
              <PostActions
                post={post}
                onLike={() => like(post)}
                onComment={() => undefined}
                onBookmark={() => bookmark(post)}
              />
              <View style={styles.caption}>
                {post.body ? (
                  <AppText style={styles.postText}>
                    <AppText style={[styles.postText, styles.strong]}>
                      {post.author.handle}{' '}
                    </AppText>
                    {post.body}
                  </AppText>
                ) : null}
                <AppText style={styles.time}>
                  {postedAt(post.createdAt, clock.now())}
                </AppText>
              </View>
              <View style={styles.comments}>
                <LineLabel>{`댓글 ${commentCount}`}</LineLabel>
                {post.comments.length === 0 ? (
                  <AppText style={styles.empty}>
                    아직 댓글이 없어요. 첫 댓글을 남겨 보세요.
                  </AppText>
                ) : (
                  post.comments.map(comment => (
                    <CommentRow
                      key={comment.id}
                      comment={comment}
                      onReply={() => setDraft(`@${comment.author.handle} `)}
                      onMenu={
                        comment.isMine ? () => setCommentMenu(comment) : null
                      }
                    />
                  ))
                )}
              </View>
            </ScrollView>
            <SafeAreaView edges={['bottom']}>
              {editing ? (
                <View style={styles.editing}>
                  <AppText style={styles.editingText}>댓글 수정 중</AppText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="수정 취소"
                    onPress={stopEditing}
                    hitSlop={8}
                  >
                    <AppText style={styles.editingText}>취소</AppText>
                  </Pressable>
                </View>
              ) : null}
              <View style={styles.inputBar}>
                <Avatar
                  nickname={me.status === 'ready' ? me.data.nickname : ''}
                  userId="me"
                  mine
                  size={36}
                />
                <View style={styles.input}>
                  <TextInput
                    ref={input}
                    accessibilityLabel="댓글 입력"
                    placeholder={
                      editing
                        ? '댓글 수정'
                        : `${post.author.handle}님에게 댓글 달기…`
                    }
                    placeholderTextColor={communityLook.meta}
                    selectionColor={communityLook.ink}
                    value={draft}
                    onChangeText={setDraft}
                    style={styles.inputText}
                  />
                </View>
                {/* 저장 stays pressable on an emptied comment so it can say why it does not save. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={editing ? '댓글 수정 저장' : '게시'}
                  accessibilityState={{ disabled: !sendable || sending }}
                  disabled={!sendable || sending}
                  onPress={send}
                  hitSlop={6}
                  style={({ pressed }) => pressed && styles.sendPressed}
                >
                  <View style={styles.send}>
                    <AppText
                      style={[styles.sendText, !sendable && styles.sendOff]}
                    >
                      {editing ? '저장' : '게시'}
                    </AppText>
                  </View>
                </Pressable>
              </View>
            </SafeAreaView>
          </KeyboardAvoidingView>
        )}
      </>
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
      <PostMenu
        subject="comment"
        visible={commentMenu !== null}
        onClose={() => setCommentMenu(null)}
        onEdit={() => commentMenu && startEditing(commentMenu)}
        onDelete={async () => {
          if (commentMenu) {
            await removeComment(commentMenu);
          }
        }}
      />
    </View>
  );
}

// runway-community-handoff 7.2 on white (담당자 요청): no cards or pills; groups part by space and line labels.
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: communityLook.background },
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  loading: { marginTop: 48 },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fontFamily.bold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.5,
    color: communityLook.ink,
  },
  scroll: { paddingHorizontal: 16, paddingBottom: 24 },
  // 작성자 줄: the whole row opens the profile; it lights up faintly when pressed.
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingTop: 8,
    paddingBottom: 6,
  },
  author: {
    flex: 1,
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: -6,
    paddingHorizontal: 6,
    borderRadius: 16,
  },
  rowPressed: {
    backgroundColor: communityLook.pressedRow,
    transform: [{ scale: 0.985 }],
  },
  handle: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.3,
    color: communityLook.ink,
  },
  place: {
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: -0.2,
    color: communityLook.sub,
  },
  rowMenu: {
    width: 30,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The photo runs edge to edge past the screen's 16 sides.
  photo: { marginHorizontal: -16, marginTop: 4 },
  caption: { paddingTop: 16 },
  postText: {
    fontFamily: fontFamily.regular,
    fontSize: 15.5,
    lineHeight: 22,
    letterSpacing: -0.3,
    color: communityLook.ink,
  },
  strong: { fontFamily: fontFamily.bold, color: communityLook.ink },
  time: {
    marginTop: 7,
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 16,
    color: communityLook.meta,
  },
  comments: { marginTop: 22, gap: 8 },
  empty: {
    marginTop: 4,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 19,
    color: communityLook.sub,
  },
  // 댓글 수정 중 · 취소 over the bar while a comment is edited.
  editing: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  editingText: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: communityLook.sub,
  },
  // 댓글 입력 60: my avatar, a flat mist field and 게시 as a bold word.
  inputBar: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
  },
  input: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    justifyContent: 'center',
    backgroundColor: communityLook.field,
  },
  inputText: {
    height: 44,
    padding: 0,
    color: communityLook.ink,
    fontFamily: typography.input.fontFamily,
    fontSize: 15,
  },
  send: { height: 44, paddingHorizontal: 4, justifyContent: 'center' },
  sendPressed: { transform: [{ scale: 0.96 }] },
  sendText: {
    fontFamily: fontFamily.bold,
    fontSize: 14.5,
    lineHeight: 19,
    color: communityLook.ink,
  },
  sendOff: { opacity: 0.4 },
});
