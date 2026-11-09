import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Icon } from '../../components';
import {
  DataError,
  useRepositories,
  useResource,
  type Post,
  type PostComment,
  type Repositories,
} from '../../data';
import { fontFamily, typography } from '../../theme';
import { communityLook, sheetLook } from './look';
import { Avatar, PostMenu, postedAt } from './parts';

// What a failed 댓글 수정·삭제 says; the list stays as it was (CMT08 · CMT09).
export function commentFailure(error: unknown, action: '수정' | '삭제') {
  const code = error instanceof DataError ? error.code : null;
  if (code === 'EMPTY_COMMENT') {
    return '댓글 내용을 입력해 주세요';
  }
  if (code === 'NOT_AUTHOR') {
    return `내가 쓴 댓글만 ${action}할 수 있어요`;
  }
  if (code === 'COMMENT_NOT_FOUND') {
    return '이미 삭제된 댓글이에요';
  }
  return `댓글을 ${action}하지 못했어요. 잠시 후 다시 시도해 주세요`;
}

// One comment: avatar, handle and text, the time · likes · 답글 달기, and its heart (7.2 and the 댓글 sheet).
export function CommentRow({
  comment,
  onReply,
  onMenu,
}: {
  comment: PostComment;
  onReply: () => void;
  // My own comments open the 댓글 수정·삭제 sheet.
  onMenu: (() => void) | null;
}) {
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
        <AppText style={styles.commentText}>
          <AppText style={[styles.commentText, styles.strong]}>
            {comment.author.handle}{' '}
          </AppText>
          {comment.body}
        </AppText>
        <View style={styles.commentMeta}>
          <AppText style={styles.commentMetaText}>{`${meta} · `}</AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${comment.author.handle}에게 답글 달기`}
            onPress={onReply}
            hitSlop={6}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <AppText style={[styles.commentMetaText, styles.reply]}>
              답글 달기
            </AppText>
          </Pressable>
        </View>
      </View>
      {onMenu ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="댓글 메뉴"
          onPress={onMenu}
          hitSlop={4}
          style={({ pressed }) => [
            styles.commentButton,
            pressed && styles.pressed,
          ]}
        >
          <Icon name="moreVertical" color={communityLook.sub} size={15} />
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={liked ? '댓글 좋아요 취소' : '댓글 좋아요'}
        accessibilityState={{ selected: liked }}
        onPress={() => setLiked(value => !value)}
        hitSlop={4}
        style={({ pressed }) => [
          styles.commentButton,
          pressed && styles.pressed,
        ]}
      >
        <Icon
          name="heart"
          color={liked ? communityLook.like : communityLook.sub}
          solid={liked}
          size={15}
          strokeWidth={2}
        />
      </Pressable>
    </View>
  );
}

const loadMe = (repositories: Repositories) => repositories.profile.getMe();

// A pull of more than this closes the sheet.
const closeDrag = 120;

// The sheet's height and foot padding (S15P31E105-596). `open` is the sheet window's height with the keyboard
// down, `frame` its height now (0 until laid out, then the screen stands in). On Android the Modal window may
// shrink above the keyboard or stay full under it, by phone: a window that shrank already keeps the comment bar
// clear, one that did not needs the bar lifted by the keyboard's height. Never both, or the bar floats above
// the keyboard with a gap. Two thirds of the window (68%) at rest; up to just under the status bar while typing.
export function sheetFit({
  open,
  frame,
  screen,
  keyboard,
  top,
  bottom,
}: {
  open: number;
  frame: number;
  screen: number;
  keyboard: number;
  top: number;
  bottom: number;
}) {
  const full = open || frame || screen;
  const now = frame || full;
  if (!keyboard) {
    return { full, height: Math.round(full * 0.68), paddingBottom: bottom };
  }
  const shrank = full - now > keyboard / 2;
  return {
    full,
    height: now - top - 8,
    paddingBottom: shrank ? 0 : keyboard,
  };
}

// The 7.1 댓글 sheet (담당자 요청, 레퍼런스 영상): pressing 댓글 in the feed raises the post's comments from the
// bottom over the dimmed feed, with my comment bar at its foot. It rises to two thirds of the screen and
// to the top while the keyboard is up; pulling its handle down or tapping the dim closes it. The comment
// work is 7.2's: adding (CMT03), replying by handle, editing and deleting my own (CMT08 · CMT09).
export function CommentSheet({
  post,
  onClose,
  onCountChange,
}: {
  // The post whose comments are open, or null when the sheet is closed.
  post: Post | null;
  onClose: () => void;
  // The post's comment count after one is added or deleted, for the feed line under it.
  onCountChange: (postId: string, count: number) => void;
}) {
  const { community } = useRepositories();
  const me = useResource(loadMe);
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const postId = post?.id ?? null;
  const [comments, setComments] = useState<PostComment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // The comment whose sheet is open, and the one being edited in the comment bar.
  const [commentMenu, setCommentMenu] = useState<PostComment | null>(null);
  const [editing, setEditing] = useState<PostComment | null>(null);
  // The app's toasts sit under this sheet, so what happened shows above the comment bar instead.
  const [notice, setNotice] = useState<string | null>(null);
  const [keyboard, setKeyboard] = useState(0);
  // The height the sheet's own window really has (S15P31E105-596): on Android the Modal window may or may
  // not shrink when the keyboard comes up, and the phone's bars may take some of the screen. `open` is the
  // window with the keyboard down; `frame` is what it is now.
  const [frame, setFrame] = useState(0);
  const [open, setOpen] = useState(0);
  const input = useRef<TextInput>(null);
  const drag = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(1)).current;
  // Whether the Modal's window is up. The rise starts only then: started as the window is still being
  // made, a phone could drop it partway and leave the sheet hanging halfway up (S15P31E105-596).
  const windowUp = useRef(false);
  const riseUp = useCallback(() => {
    Animated.timing(rise, {
      toValue: 0,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, [rise]);

  const load = useCallback(async () => {
    if (!postId) {
      return;
    }
    setFailed(false);
    setComments(null);
    try {
      setComments((await community.get(postId)).comments);
    } catch {
      setFailed(true);
    }
  }, [community, postId]);

  // A new post starts clean: its own comments, an empty bar.
  useEffect(() => {
    setDraft('');
    setEditing(null);
    setNotice(null);
    if (postId) {
      drag.setValue(0);
      rise.setValue(1);
      // Another post while the window is already up rises at once; a first opening waits for onShow.
      if (windowUp.current) {
        riseUp();
      }
      load();
    } else {
      windowUp.current = false;
    }
  }, [drag, load, postId, rise, riseUp]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  // The keyboard pushes the bar up and the sheet grows to the top, as in the reference.
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', event =>
      setKeyboard(event.endCoordinates.height),
    );
    const hidden = Keyboard.addListener('keyboardDidHide', () =>
      setKeyboard(0),
    );
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 6,
      onPanResponderMove: (_, gesture) =>
        drag.setValue(Math.max(0, gesture.dy)),
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > closeDrag) {
          Keyboard.dismiss();
          onCloseRef.current();
        } else {
          Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    }),
  ).current;

  const count = (next: PostComment[]) => {
    if (postId) {
      onCountChange(postId, next.length);
    }
  };
  const stopEditing = () => {
    setEditing(null);
    setDraft('');
  };
  const startEditing = (comment: PostComment) => {
    setEditing(comment);
    setDraft(comment.body);
    // After the menu sheet has closed, so the keyboard stays up.
    setTimeout(() => input.current?.focus(), 300);
  };
  // CMT08: the saved text replaces the comment in place.
  const saveEdit = async (comment: PostComment) => {
    const body = draft.trim();
    if (!comments) {
      return;
    }
    if (!body) {
      setNotice('댓글 내용을 입력해 주세요');
      return;
    }
    setSending(true);
    try {
      const saved = await community.updateComment(comment.id, body);
      setComments(
        comments.map(item =>
          item.id === comment.id ? { ...item, body: saved } : item,
        ),
      );
      stopEditing();
      setNotice('댓글을 수정했어요');
    } catch (error) {
      setNotice(commentFailure(error, '수정'));
    } finally {
      setSending(false);
    }
  };
  // CMT09: the comment leaves the list and the count.
  const removeComment = async (comment: PostComment) => {
    setCommentMenu(null);
    if (!comments) {
      return;
    }
    try {
      await community.removeComment(comment.id);
      const next = comments.filter(item => item.id !== comment.id);
      setComments(next);
      count(next);
      if (editing?.id === comment.id) {
        stopEditing();
      }
      setNotice('댓글을 삭제했어요');
    } catch (error) {
      setNotice(commentFailure(error, '삭제'));
    }
  };
  const send = async () => {
    if (editing) {
      await saveEdit(editing);
      return;
    }
    const body = draft.trim();
    if (!postId || !comments || !body) {
      return;
    }
    setSending(true);
    try {
      const comment = await community.addComment(postId, body);
      const next = [...comments, comment];
      setComments(next);
      count(next);
      setDraft('');
    } catch {
      setNotice('댓글을 남기지 못했어요. 잠시 후 다시 시도해 주세요');
    } finally {
      setSending(false);
    }
  };

  const sendable = Boolean(editing) || Boolean(draft.trim());
  const { full, height, paddingBottom } = sheetFit({
    open,
    frame,
    screen: screenHeight,
    keyboard,
    top: insets.top,
    bottom: insets.bottom,
  });

  return (
    <Modal
      visible={post !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
      onShow={() => {
        windowUp.current = true;
        riseUp();
      }}
    >
      <View
        style={styles.root}
        onLayout={event => {
          const measured = Math.round(event.nativeEvent.layout.height);
          setFrame(measured);
          // The window can shrink before the keyboard's event arrives, so the open height only grows.
          setOpen(current => Math.max(current, measured));
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="댓글 닫기"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, sheetLook.scrim]}
        />
        <Animated.View
          accessibilityViewIsModal
          style={[
            sheetLook.sheet,
            {
              height,
              paddingBottom,
              transform: [
                {
                  // Starts a whole window below, so no part of it shows before it rises.
                  translateY: Animated.add(
                    drag,
                    rise.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, full],
                    }),
                  ),
                },
              ],
            },
          ]}
        >
          <View style={sheetLook.header} {...pan.panHandlers}>
            <View style={sheetLook.handle} />
            <AppText style={sheetLook.title} accessibilityRole="header">
              댓글
            </AppText>
          </View>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
          >
            {failed ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="댓글 다시 불러오기"
                onPress={load}
                style={styles.center}
              >
                <AppText style={styles.empty}>
                  {`댓글을 불러오지 못했어요\n눌러서 다시 시도해 주세요`}
                </AppText>
              </Pressable>
            ) : !comments ? (
              <ActivityIndicator
                style={styles.loading}
                color={communityLook.sub}
              />
            ) : comments.length === 0 ? (
              <View style={styles.center}>
                <AppText style={styles.emptyTitle}>아직 댓글이 없어요</AppText>
                <AppText style={styles.empty}>첫 댓글을 남겨 보세요</AppText>
              </View>
            ) : (
              comments.map(comment => (
                <CommentRow
                  key={comment.id}
                  comment={comment}
                  onReply={() => {
                    setDraft(`@${comment.author.handle} `);
                    input.current?.focus();
                  }}
                  onMenu={comment.isMine ? () => setCommentMenu(comment) : null}
                />
              ))
            )}
          </ScrollView>
          {notice ? (
            <AppText style={styles.notice} accessibilityLiveRegion="polite">
              {notice}
            </AppText>
          ) : null}
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
                    : `${post?.author.handle ?? ''}님에게 댓글 달기…`
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
              style={({ pressed }) => [styles.send, pressed && styles.pressed]}
            >
              <AppText style={[styles.sendText, !sendable && styles.sendOff]}>
                {editing ? '저장' : '게시'}
              </AppText>
            </Pressable>
          </View>
        </Animated.View>
      </View>
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  strong: { fontFamily: fontFamily.bold, color: communityLook.ink },
  comment: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingTop: 8,
  },
  commentText: {
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.3,
    color: communityLook.ink,
  },
  commentMeta: { flexDirection: 'row', alignItems: 'center' },
  commentMetaText: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 19,
    color: communityLook.meta,
  },
  reply: { color: communityLook.sub },
  commentButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  root: { flex: 1, justifyContent: 'flex-end' },
  list: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  loading: { marginTop: 40 },
  center: { alignItems: 'center', paddingTop: 48, gap: 4 },
  emptyTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 23,
    color: communityLook.ink,
  },
  empty: {
    textAlign: 'center',
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 19,
    color: communityLook.sub,
  },
  notice: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 17,
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
  sendText: {
    fontFamily: fontFamily.bold,
    fontSize: 14.5,
    lineHeight: 19,
    color: communityLook.ink,
  },
  sendOff: { opacity: 0.4 },
});
