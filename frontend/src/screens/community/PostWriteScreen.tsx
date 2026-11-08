import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AppText,
  Backdrop,
  EmptyState,
  PressableScale,
  useToast,
} from '../../components';
import {
  useRepositories,
  useResource,
  type PostDraft,
  type PostRecord,
  type Repositories,
  type RunnerProfile,
} from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import { fontFamily, typography } from '../../theme';
import { communityLook, CourseToggle } from './look';
import { Avatar, RunPhoto } from './parts';
import { KeyboardLift } from '../../components/KeyboardLift';

const bodyLimit = 500;

// 7.3 and 7.3e: what I write over the run card, and whether the course goes with it.
function Composer({
  title,
  action,
  me,
  record,
  initial,
  onSubmit,
}: {
  title: string;
  action: string;
  me: RunnerProfile;
  record: PostRecord;
  initial: PostDraft;
  onSubmit: (draft: PostDraft) => Promise<void>;
}) {
  const navigation = useNavigation();
  const [body, setBody] = useState(initial.body ?? '');
  const [courseShared, setCourseShared] = useState(initial.courseShared);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit({ body: body.trim() || null, courseShared });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="취소"
            onPress={() => navigation.goBack()}
            hitSlop={6}
          >
            <View style={styles.cancel}>
              <AppText style={styles.cancelText}>취소</AppText>
            </View>
          </PressableScale>
          <View style={styles.titleBox} pointerEvents="none">
            <AppText style={styles.title} accessibilityRole="header">
              {title}
            </AppText>
          </View>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={action}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={submit}
            hitSlop={6}
          >
            <View style={styles.submit}>
              <AppText style={[styles.submitText, busy && styles.busy]}>
                {action}
              </AppText>
            </View>
          </PressableScale>
        </View>
      </SafeAreaView>
      <KeyboardLift style={styles.flex}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <View style={styles.writer}>
            <Avatar nickname={me.nickname} userId={me.userId} mine />
            <AppText style={styles.handle}>{me.handle}</AppText>
          </View>
          <View style={styles.bodyField}>
            <TextInput
              accessibilityLabel="글 내용"
              placeholder="오늘 러닝은 어땠나요?"
              placeholderTextColor={communityLook.meta}
              selectionColor={communityLook.ink}
              value={body}
              onChangeText={setBody}
              maxLength={bodyLimit}
              multiline
              style={styles.bodyInput}
            />
          </View>
          <View style={styles.card}>
            <RunPhoto
              record={record}
              courseShared={courseShared}
              seed={record.id}
            />
          </View>
          <View style={styles.share}>
            <View style={styles.flex}>
              <View style={styles.shareLabel}>
                <AppText style={styles.shareTitle}>코스도 함께 공유</AppText>
              </View>
              <AppText style={styles.shareNote}>
                이 게시물에 경로·출발/도착 지점과 코스 설명(출발지+거리)이
                보여요 · 내 별명은 보이지 않아요 · 이 게시물을 볼 수 있는 사람이
                내 코스에 저장할 수 있어요
              </AppText>
            </View>
            <CourseToggle
              label="코스도 함께 공유"
              value={courseShared}
              onChange={setCourseShared}
            />
          </View>
        </ScrollView>
      </KeyboardLift>
    </>
  );
}

// 7.3 · 7.3e sit on the mist like the other community screens (S15P31E105-483).
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      {/* On the mist like 홈 and 러닝 (S15P31E105-483); the long text keeps the light part to ~80%. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop tail />
      </View>
      {children}
    </View>
  );
}

const loadMe = (repositories: Repositories) =>
  repositories.runners.getProfile(null);

// 7.3 글쓰기 · 기록 공유: opened from 4.5, 5.2 or 6.7 with the run to share.
export function PostWriteScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'PostWrite'>>();
  const recordId = route.params?.recordId ?? null;
  const toast = useToast();
  const { community } = useRepositories();
  const me = useResource(loadMe);
  const record = useResource(
    useCallback(
      (repositories: Repositories) =>
        repositories.community.getShareable(recordId),
      [recordId],
    ),
  );
  if (me.status === 'error' || record.status === 'error') {
    return (
      <Frame>
        <EmptyState
          icon="alert"
          title="공유할 기록을 불러오지 못했어요"
          actionLabel="다시 시도"
          onAction={() => {
            me.reload();
            record.reload();
          }}
        />
      </Frame>
    );
  }
  if (me.status !== 'ready' || record.status !== 'ready') {
    return (
      <Frame>
        <ActivityIndicator style={styles.loading} color={communityLook.ink} />
      </Frame>
    );
  }
  return (
    <Frame>
      <Composer
        title="기록 공유"
        action="게시"
        me={me.data}
        record={record.data}
        initial={{ body: null, courseShared: record.data.courseRun }}
        onSubmit={async draft => {
          try {
            await community.create(record.data.id, draft);
            toast('러닝 기록을 공유했어요');
            navigateTo(navigation, 'Community');
          } catch {
            toast('게시하지 못했어요. 잠시 후 다시 시도해 주세요');
          }
        }}
      />
    </Frame>
  );
}

// 7.3e 게시물 수정: the same layout, saving the text and the course sharing.
export function PostEditScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'PostEdit'>>();
  const postId = route.params?.postId ?? '';
  const toast = useToast();
  const { community } = useRepositories();
  const me = useResource(loadMe);
  const post = useResource(
    useCallback(
      (repositories: Repositories) => repositories.community.get(postId),
      [postId],
    ),
  );
  // The composer keeps its own text once shown, so it mounts only after the post loads.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (post.status === 'ready') {
      setReady(true);
    }
  }, [post.status]);
  if (me.status === 'error' || post.status === 'error') {
    return (
      <Frame>
        <EmptyState
          icon="alert"
          title="게시물을 불러오지 못했어요"
          actionLabel="다시 시도"
          onAction={() => {
            me.reload();
            post.reload();
          }}
        />
      </Frame>
    );
  }
  if (!ready || me.status !== 'ready' || post.status !== 'ready') {
    return (
      <Frame>
        <ActivityIndicator style={styles.loading} color={communityLook.ink} />
      </Frame>
    );
  }
  return (
    <Frame>
      <Composer
        title="게시물 수정"
        action="저장"
        me={me.data}
        record={post.data.record}
        initial={{ body: post.data.body, courseShared: post.data.courseShared }}
        onSubmit={async draft => {
          try {
            await community.update(postId, draft);
            toast('게시물을 수정했어요');
            navigation.goBack();
          } catch {
            toast('저장하지 못했어요. 잠시 후 다시 시도해 주세요');
          }
        }}
      />
    </Frame>
  );
}

// runway-community-handoff 7.3 · 7.3e: no cards or dividers, the toggle under a line label.
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: communityLook.background },
  flex: { flex: 1 },
  loading: { marginTop: 48 },
  // 상단 56: 취소 and 게시 as words, the title in the middle.
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  cancel: { height: 40, justifyContent: 'center', paddingHorizontal: 4 },
  cancelText: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: communityLook.ink,
  },
  titleBox: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.3,
    color: communityLook.ink,
  },
  submit: { height: 40, justifyContent: 'center', paddingHorizontal: 4 },
  submitText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: communityLook.ink,
  },
  busy: { opacity: 0.45 },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 48 },
  writer: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  handle: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 22,
    color: communityLook.ink,
  },
  // 본문: a flat mist field.
  bodyField: {
    marginTop: 12,
    minHeight: 56,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 15,
    backgroundColor: communityLook.field,
  },
  // No lineHeight: on Android it clips the top of the placeholder (as in group/look's search field).
  bodyInput: {
    minHeight: 26,
    padding: 0,
    fontFamily: typography.input.fontFamily,
    fontSize: 16,
    includeFontPadding: false,
    color: communityLook.ink,
    textAlignVertical: 'top',
  },
  // The photo runs edge to edge past the screen's 16 sides.
  card: { marginTop: 16, marginHorizontal: -16 },
  share: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 20,
    marginTop: 20,
  },
  shareLabel: {
    borderLeftWidth: 1.5,
    borderLeftColor: communityLook.ink,
    paddingLeft: 8,
  },
  shareTitle: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    lineHeight: 20,
    color: communityLook.ink,
  },
  shareNote: {
    marginTop: 8,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: communityLook.sub,
  },
});
