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
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AppText,
  Backdrop,
  EmptyState,
  Toggle,
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
import { fontFamily, spacing, typography, useTheme } from '../../theme';
import { Avatar, RecordCard } from './parts';

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
  const { colors } = useTheme();
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
        <View style={[styles.header, { borderColor: colors.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="취소"
            onPress={() => navigation.goBack()}
            hitSlop={8}
            style={styles.side}
          >
            <AppText variant="body">취소</AppText>
          </Pressable>
          <AppText style={styles.title} accessibilityRole="header">
            {title}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={submit}
            hitSlop={8}
            style={[styles.side, styles.sideEnd]}
          >
            <AppText style={styles.action}>{action}</AppText>
          </Pressable>
        </View>
      </SafeAreaView>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <View style={styles.writer}>
            <Avatar nickname={me.nickname} userId={me.userId} mine />
            <View style={styles.flex}>
              <AppText style={styles.handle}>{me.handle}</AppText>
              <TextInput
                accessibilityLabel="글 내용"
                placeholder="오늘 러닝은 어땠나요?"
                placeholderTextColor={colors.textTertiary}
                selectionColor={colors.accent}
                value={body}
                onChangeText={setBody}
                maxLength={bodyLimit}
                multiline
                style={[styles.bodyInput, { color: colors.text }]}
              />
              <RecordCard record={record} courseShared={courseShared} />
            </View>
          </View>
          <View style={[styles.share, { borderColor: colors.border }]}>
            <View style={styles.flex}>
              <AppText style={styles.shareTitle}>코스도 함께 공유</AppText>
              <AppText variant="caption" tone="textSecondary">
                이 게시물에 경로·출발/도착 지점과 코스 설명(출발지+거리)이
                보여요 · 내 별명은 보이지 않아요 · 이 게시물을 볼 수 있는 사람이
                내 코스에 저장할 수 있어요
              </AppText>
            </View>
            <Toggle
              label="코스도 함께 공유"
              value={courseShared}
              onChange={setCourseShared}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
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
        <ActivityIndicator style={styles.loading} />
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
        <ActivityIndicator style={styles.loading} />
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

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: spacing.xxxl },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.screen,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  side: { width: 56 },
  sideEnd: { alignItems: 'flex-end' },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontFamily.bold,
    fontSize: 18,
    lineHeight: 24,
  },
  action: { fontFamily: fontFamily.bold, fontSize: 16, lineHeight: 22 },
  content: { padding: spacing.screen, gap: spacing.xxl, paddingBottom: 48 },
  writer: { flexDirection: 'row', gap: spacing.xl },
  handle: { fontFamily: fontFamily.bold, fontSize: 16, lineHeight: 22 },
  bodyInput: {
    minHeight: 48,
    padding: 0,
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
    fontFamily: typography.input.fontFamily,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  share: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingTop: spacing.xxl,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  shareTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 22,
    marginBottom: spacing.xs,
  },
});
