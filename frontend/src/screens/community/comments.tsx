import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  NavigationContext,
  type NavigationProp,
} from '@react-navigation/native';
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
import {
  SafeAreaInsetsContext,
  SafeAreaProvider,
  useSafeAreaInsets,
  type EdgeInsets,
} from 'react-native-safe-area-context';
import { AppText, Icon } from '../../components';
import {
  countComments,
  DataError,
  errorCode,
  threadComments,
  useRepositories,
  withoutComment,
  useResource,
  type Post,
  type PostComment,
  type Repositories,
} from '../../data';
import { fontFamily, typography } from '../../theme';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import { communityLook, sheetLook } from './look';

type Navigate = NavigationProp<RootStackParamList>;
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

// The longest comment the bar takes (S15P31E105-780), like a post body (PostWriteScreen bodyLimit). The server keeps
// its own check (S15P31E105-779).
export const COMMENT_LIMIT = 500;
// From this many characters the bar shows how many are used.
export const COMMENT_COUNT_FROM = COMMENT_LIMIT - 50;
// A long comment shows this many lines until 더 보기 opens it, so one comment cannot fill the sheet.
export const COMMENT_FOLD_LINES = 6;
// About six lines on a phone: comments past it (or with more line breaks) fold.
export const longComment = (body: string) =>
  body.length > 140 || body.split('\n').length > COMMENT_FOLD_LINES;

// One comment: avatar, handle and text, the time · likes · 답글 달기, and its heart (7.2 and the 댓글 sheet). A reply
// sits indented under its root; a deleted root kept for its replies shows only '삭제된 댓글입니다'.
export function CommentRow({
  comment,
  reply = false,
  onReply,
  onMenu,
  onLike,
  onProfile = null,
}: {
  comment: PostComment;
  reply?: boolean;
  // S15P31E105-797 (T25): the author's photo and handle open their profile (mine opens 내 프로필).
  onProfile?: (() => void) | null;
  // Null under a deleted root: its thread takes no new replies (CMT07 INVALID_PARENT_COMMENT).
  onReply: (() => void) | null;
  // My own comments open the 댓글 수정·삭제 sheet.
  onMenu: (() => void) | null;
  // CMT14 · CMT15; the sheet changes the heart and the count at once.
  onLike: () => void;
}) {
  const { clock } = useRepositories();
  const [unfolded, setUnfolded] = useState(false);
  if (comment.deleted || !comment.author) {
    return (
      <View style={[styles.comment, reply && styles.reply]}>
        <View style={styles.deletedDot} />
        <AppText style={[styles.commentText, styles.deletedText]}>
          삭제된 댓글입니다
        </AppText>
      </View>
    );
  }
  const { author, liked } = comment;
  const meta = [
    postedAt(comment.createdAt, clock.now()),
    comment.likeCount > 0 ? `좋아요 ${comment.likeCount}개` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const folds = longComment(comment.body);
  return (
    <View style={[styles.comment, reply && styles.reply]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${author.handle} 프로필 보기`}
        disabled={!onProfile}
        onPress={onProfile ?? undefined}
        hitSlop={4}
      >
        <Avatar
          nickname={author.nickname}
          userId={author.userId}
          photo={author.profileImageUrl}
          size={reply ? 26 : 32}
        />
      </Pressable>
      <View style={styles.flex}>
        <AppText
          style={styles.commentText}
          numberOfLines={folds && !unfolded ? COMMENT_FOLD_LINES : undefined}
        >
          <AppText
            accessibilityRole={onProfile ? 'link' : undefined}
            onPress={onProfile ?? undefined}
            style={[styles.commentText, styles.strong]}
          >
            {author.handle}{' '}
          </AppText>
          {comment.body}
        </AppText>
        {folds ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={unfolded ? '댓글 접기' : '댓글 더 보기'}
            onPress={() => setUnfolded(open => !open)}
            hitSlop={6}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <AppText style={[styles.commentMetaText, styles.replyText]}>
              {unfolded ? '접기' : '더 보기'}
            </AppText>
          </Pressable>
        ) : null}
        <View style={styles.commentMeta}>
          <AppText style={styles.commentMetaText}>
            {onReply ? `${meta} · ` : meta}
          </AppText>
          {onReply ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${author.handle}에게 답글 달기`}
              onPress={onReply}
              hitSlop={6}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <AppText style={[styles.commentMetaText, styles.replyText]}>
                답글 달기
              </AppText>
            </Pressable>
          ) : null}
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
        onPress={onLike}
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

// The comment a reply answers: the root it goes under (CMT07 parentCommentId) and the runner it names.
type ReplyTarget = { rootId: string; handle: string };

// 답글 달기 on a reply answers its root, as replies go one level deep.
export const replyTargetOf = (comment: PostComment): ReplyTarget => ({
  rootId: comment.parentId ?? comment.id,
  handle: comment.author?.handle ?? '',
});

// Whether 답글 달기 shows on a comment: a reply whose root is deleted (or no longer listed) is in a closed
// thread, as CMT07 rejects a deleted root with INVALID_PARENT_COMMENT.
export const replyOpen = (comment: PostComment, comments: PostComment[]) => {
  if (!comment.parentId) {
    return true;
  }
  const root = comments.find(item => item.id === comment.parentId);
  return Boolean(root && !root.deleted);
};

// A deleted root kept for its replies, as CMT06 would list it.
const deletedPlace = (comment: PostComment): PostComment => ({
  ...comment,
  deleted: true,
  author: null,
  isMine: false,
  body: '',
  likeCount: 0,
  liked: false,
});

const loadMe = (repositories: Repositories) => repositories.profile.getMe();

// A pull of more than this closes the sheet.
const closeDrag = 120;

// The sheet's height and foot padding (S15P31E105-596). `open` is the sheet window's height with the keyboard
// down, `frame` its height now (0 until laid out, then the screen stands in). On Android the Modal window may
// shrink above the keyboard or stay full under it, by phone: a window that shrank already keeps the comment bar
// clear, one that did not needs the bar lifted by the keyboard's height. Never both, or the bar floats above
// the keyboard with a gap. Two thirds of the window (68%) at rest; up to just under the status bar while typing.
// React Native's keyboard height leaves out the navigation bar (IME minus system bars), so a window that reaches
// under that bar (Android 16, S15P31E105-619) lifts the bar by its own bottom inset as well; one that stops above
// it has no bottom inset to add.
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
    paddingBottom: shrank ? 0 : keyboard + bottom,
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
  // Absent outside a navigator (tests); the author's profile link is then off.
  const navigation = useContext(NavigationContext) as Navigate | undefined;
  const me = useResource(loadMe);
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const postId = post?.id ?? null;
  const [comments, setComments] = useState<PostComment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Set as soon as a 게시 or 저장 starts, before the re-render that disables the button: quick taps in between
  // would otherwise send the same comment twice (S15P31E105-780).
  const sendingNow = useRef(false);
  // The comment whose sheet is open, and the one being edited in the comment bar.
  const [commentMenu, setCommentMenu] = useState<PostComment | null>(null);
  const [editing, setEditing] = useState<PostComment | null>(null);
  // The comment 답글 달기 answers; the next 게시 goes under its root.
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  // Comments whose like is on its way to the server: another tap waits for it.
  const liking = useRef(new Set<string>());
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
    setReplyTo(null);
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

  // A deleted root kept for its replies is never counted.
  const count = (next: PostComment[]) => {
    if (postId) {
      onCountChange(postId, countComments(next));
    }
  };
  const stopEditing = () => {
    setEditing(null);
    setDraft('');
  };
  const startReply = (comment: PostComment) => {
    const target = replyTargetOf(comment);
    setEditing(null);
    setReplyTo(target);
    setDraft(`@${target.handle} `);
    input.current?.focus();
  };
  // 취소 makes the next 게시 a plain comment again, without the @handle 답글 달기 put in.
  const stopReply = () => {
    if (replyTo) {
      const mention = `@${replyTo.handle} `;
      setDraft(current =>
        current.startsWith(mention) ? current.slice(mention.length) : current,
      );
    }
    setReplyTo(null);
  };
  const changeComment = (
    commentId: string,
    change: (comment: PostComment) => PostComment,
  ) =>
    setComments(current =>
      current
        ? current.map(item => (item.id === commentId ? change(item) : item))
        : current,
    );
  // CMT14 · CMT15: the heart and count change at once (never below 0), take the server's count once saved, and
  // go back if it fails.
  const like = async (comment: PostComment) => {
    if (liking.current.has(comment.id)) {
      return;
    }
    liking.current.add(comment.id);
    const liked = !comment.liked;
    changeComment(comment.id, item => ({
      ...item,
      liked,
      likeCount: Math.max(0, item.likeCount + (liked ? 1 : -1)),
    }));
    try {
      const saved = await community.setCommentLiked(comment.id, liked);
      changeComment(comment.id, item => ({
        ...item,
        liked: saved.liked,
        likeCount: saved.likeCount ?? item.likeCount,
      }));
    } catch {
      changeComment(comment.id, item => ({
        ...item,
        liked: comment.liked,
        likeCount: comment.likeCount,
      }));
    } finally {
      liking.current.delete(comment.id);
    }
  };
  const startEditing = (comment: PostComment) => {
    setReplyTo(null);
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
    if (sendingNow.current) {
      return;
    }
    sendingNow.current = true;
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
      sendingNow.current = false;
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
      // A root with replies stays as '삭제된 댓글입니다'; any other comment leaves.
      const next = withoutComment(comments, comment.id, deletedPlace);
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
    if (!postId || !comments || !body || sendingNow.current) {
      return;
    }
    sendingNow.current = true;
    setSending(true);
    try {
      const comment = await community.addComment(
        postId,
        body,
        replyTo?.rootId ?? null,
      );
      // Last in the list, so a reply comes at the end of its root's group.
      const next = [...comments, comment];
      setComments(next);
      count(next);
      setDraft('');
      setReplyTo(null);
    } catch (error) {
      if (replyTo && errorCode(error) === 'INVALID_PARENT_COMMENT') {
        // The root was deleted meanwhile: back to a plain comment with the text kept, and the list read
        // again so its '삭제된 댓글입니다' shows.
        setReplyTo(null);
        setNotice('원댓글이 삭제돼 답글을 달 수 없어요');
        load();
        return;
      }
      setNotice('댓글을 남기지 못했어요. 잠시 후 다시 시도해 주세요');
    } finally {
      sendingNow.current = false;
      setSending(false);
    }
  };

  // S15P31E105-797 (T25): the sheet closes, then the author's profile opens (mine: 내 프로필).
  const openAuthor = (comment: PostComment) => {
    if (!navigation || !comment.author) {
      return;
    }
    Keyboard.dismiss();
    onClose();
    if (comment.isMine) {
      navigateTo(navigation, 'MyProfile');
    } else {
      navigation.navigate('RunnerProfile', { userId: comment.author.userId });
    }
  };
  const sendable = Boolean(editing) || Boolean(draft.trim());
  // The sheet's own window decides its insets (S15P31E105-619): on Android the Modal window may or may not
  // reach under the navigation bar, so the app window's bottom inset could leave the comment bar under the
  // bar (or float it). The provider inside the Modal measures that window; until it has, the app's stands in.
  const fitIn = (windowInsets: EdgeInsets | null) =>
    sheetFit({
      open,
      frame,
      screen: screenHeight,
      keyboard,
      top: (windowInsets ?? insets).top,
      bottom: (windowInsets ?? insets).bottom,
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
      <SafeAreaProvider>
        <SafeAreaInsetsContext.Consumer>
          {windowInsets => {
            const { full, height, paddingBottom } = fitIn(windowInsets);
            return (
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
                      <View style={[styles.center, styles.emptyState]}>
                        <AppText style={styles.emptyTitle}>
                          아직 댓글이 없어요
                        </AppText>
                        <AppText style={styles.empty}>
                          첫 댓글을 남겨 보세요
                        </AppText>
                      </View>
                    ) : (
                      threadComments(comments).map(({ comment, reply }) => (
                        <CommentRow
                          key={comment.id}
                          comment={comment}
                          reply={reply}
                          onReply={
                            replyOpen(comment, comments)
                              ? () => startReply(comment)
                              : null
                          }
                          onMenu={
                            comment.isMine
                              ? () => setCommentMenu(comment)
                              : null
                          }
                          onLike={() => like(comment)}
                          onProfile={
                            navigation && comment.author
                              ? () => openAuthor(comment)
                              : null
                          }
                        />
                      ))
                    )}
                  </ScrollView>
                  {notice ? (
                    <AppText
                      style={styles.notice}
                      accessibilityLiveRegion="polite"
                    >
                      {notice}
                    </AppText>
                  ) : null}
                  {replyTo && !editing ? (
                    <View style={styles.editing}>
                      <AppText style={styles.editingText}>
                        {`${replyTo.handle}님에게 답글 남기는 중`}
                      </AppText>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="답글 취소"
                        onPress={stopReply}
                        hitSlop={8}
                      >
                        <AppText style={styles.editingText}>취소</AppText>
                      </Pressable>
                    </View>
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
                      photo={
                        me.status === 'ready' ? me.data.profileImageUrl : null
                      }
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
                        maxLength={COMMENT_LIMIT}
                        style={styles.inputText}
                      />
                      {draft.length >= COMMENT_COUNT_FROM ? (
                        <AppText
                          style={styles.count}
                          accessibilityLabel={`${COMMENT_LIMIT}자 중 ${draft.length}자`}
                        >
                          {`${draft.length}/${COMMENT_LIMIT}`}
                        </AppText>
                      ) : null}
                    </View>
                    {/* 저장 stays pressable on an emptied comment so it can say why it does not save. */}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={editing ? '댓글 수정 저장' : '게시'}
                      accessibilityState={{ disabled: !sendable || sending }}
                      disabled={!sendable || sending}
                      onPress={send}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.send,
                        pressed && styles.pressed,
                      ]}
                    >
                      <AppText
                        style={[styles.sendText, !sendable && styles.sendOff]}
                      >
                        {editing ? '저장' : '게시'}
                      </AppText>
                    </Pressable>
                  </View>
                </Animated.View>
              </View>
            );
          }}
        </SafeAreaInsetsContext.Consumer>
      </SafeAreaProvider>
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
  replyText: { color: communityLook.sub },
  // A reply sits under its root, past the root's avatar.
  reply: { marginLeft: 42 },
  deletedDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: communityLook.field,
  },
  deletedText: { flex: 1, paddingTop: 5, color: communityLook.meta },
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
  // No comments yet: as much room under the note as over it, so the comment bar never sits right on it
  // (S15P31E105-619).
  emptyState: { paddingBottom: 48 },
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
  // Used/limit in the field's corner once the comment nears COMMENT_LIMIT.
  count: {
    position: 'absolute',
    right: 10,
    bottom: 2,
    fontFamily: fontFamily.medium,
    fontSize: 10.5,
    color: communityLook.meta,
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
