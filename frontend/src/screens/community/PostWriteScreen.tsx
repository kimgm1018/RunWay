import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  AppText,
  EmptyState,
  Icon,
  PressableScale,
  useToast,
} from '../../components';
import {
  DataError,
  errorCode,
  useRepositories,
  useResource,
  type PostDraft,
  type PostRecord,
  type PostRegion,
  type Repositories,
  type RunnerProfile,
} from '../../data';
import { runRouteOf, type RunRoute } from '../../components/mapRoute';
import { formatDuration, formatKm, formatRecordPace } from '../../format';
import { postsChanged } from '../../data/postsChanged';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import { fontFamily, ThemeProvider, typography } from '../../theme';
import {
  feedLook,
  MapBackdrop,
  RouteLine,
  Shade,
  Stat,
  useMapCover,
} from './FeedPage';
import { communityLook, CourseToggle } from './look';
import { Avatar, recordLabel, stamp } from './parts';
import { KeyboardLift } from '../../components/KeyboardLift';
import { InlineRunReplay, type ReplayRun } from './RouteReplay';

const bodyLimit = 500;

// What a failed 게시 (CMT01) or 저장 (CMT04) says, by the server's reason (S15P31E105-633).
export function postFailure(error: unknown, action: '게시' | '저장') {
  switch (errorCode(error)) {
    // CMT01: the run was deleted or never completed, or is not mine.
    case 'INVALID_POST':
      return '삭제됐거나 완료되지 않은 기록은 공유할 수 없어요';
    case 'RESOURCE_NOT_OWNED':
      return '내 러닝 기록만 공유할 수 있어요';
    // CMT01: one post per run (S15P31E105-830). With the post's id the screen opens it after this message.
    case 'POST_ALREADY_EXISTS':
      return '이미 공유한 기록이에요';
    // CMT04: the post is gone, or is someone else's.
    case 'POST_NOT_FOUND':
      return '이미 삭제된 게시물이에요';
    case 'NOT_AUTHOR':
      return '내가 쓴 게시물만 수정할 수 있어요';
    case 'VALIDATION_ERROR':
      return '글 내용을 확인해 주세요';
    // CMT01: the region sent with the post is not in the server's list (S15P31E105-778). 7.3 takes that region
    // from the run's start (the 지역 line under the map), not from any setting, so there is nothing to re-pick; the
    // failed post keeps what was written (the screen stays open). Say what failed and that the text is kept,
    // never to reopen the app, which would lose it (S15P31E105-803 리뷰 A-2).
    case 'INVALID_REGION':
      return '이 기록의 지역을 확인하지 못해 게시하지 못했어요. 쓴 글은 그대로 있어요';
    case 'NETWORK_ERROR':
      return '인터넷 연결을 확인한 뒤 다시 시도해 주세요';
    default:
      return action === '게시'
        ? '게시하지 못했어요. 잠시 후 다시 시도해 주세요'
        : '저장하지 못했어요. 잠시 후 다시 시도해 주세요';
  }
}

// CMT01 409 POST_ALREADY_EXISTS: the post this run already has (details.postId, a number from the server). Null when
// the server could not say which one (its final DB check), so the screen only shows the message (S15P31E105-830).
export function existingPostId(error: unknown): string | null {
  if (!(error instanceof DataError) || error.code !== 'POST_ALREADY_EXISTS') {
    return null;
  }
  const postId = error.details?.postId;
  if (typeof postId === 'number' && Number.isSafeInteger(postId)) {
    return String(postId);
  }
  return typeof postId === 'string' && postId !== '' ? postId : null;
}

// 7.3 and 7.3e: what I write, laid over the run as it will show in the 7.1 feed (S15P31E105-563, 담당자 요청: 지금
// 커뮤니티 화면처럼): the same bright map and profile replay, with the run's numbers and title at the foot.
function Composer({
  title,
  action,
  me,
  record,
  initial,
  onSubmit,
  regionAt,
  courseSharingEditable = true,
  measuredRoute,
}: {
  title: string;
  action: string;
  me: RunnerProfile;
  record: PostRecord;
  initial: PostDraft;
  onSubmit: (draft: PostDraft) => Promise<void>;
  // 7.3 only (a new post): the region of the run's start, shown and sent with it. 7.3e cannot change it.
  regionAt?: (position: [number, number]) => Promise<PostRegion | null>;
  courseSharingEditable?: boolean;
  measuredRoute?: RunRoute | null;
}) {
  const navigation = useNavigation();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [body, setBody] = useState(initial.body ?? '');
  const free = !record.courseRun;
  const [courseShared, setCourseShared] = useState(initial.courseShared);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const bodyInput = useRef<TextInput>(null);
  // KeyboardLift resizes the viewport; keep the focused field in that viewport after layout or text growth.
  const revealBody = () => {
    if (bodyInput.current?.isFocused()) {
      scroll.current?.scrollToEnd({ animated: false });
    }
  };
  // An existing course uses C03. A free run previews its measured parts until CMT01 creates its course.
  const courseMap =
    courseShared && record.route !== null && record.route.length >= 2
      ? record.route
      : null;
  // A free run becomes a course on CMT01. Preview its own measured parts until that course exists.
  const preview = courseShared && !courseMap ? measuredRoute : null;
  const realMap = courseMap ?? preview?.route ?? null;
  const replayRun = useMemo<ReplayRun>(
    () => ({
      key: `draft-${record.id}`,
      kind: record.courseRun ? '코스' : '경로',
      title: record.title,
      byline: me.handle,
      startedAt: record.startedAt,
      shareMessage: '',
      link: null,
      runner: {
        nickname: me.nickname,
        userId: me.userId,
        photo: me.profileImageUrl ?? null,
        mine: true,
      },
      distanceM: record.distanceM,
      durationSec: record.durationSec,
      averagePaceSecPerKm: record.averagePaceSecPerKm,
      cadence: record.cadence,
      shape: record.shape,
      parts: courseMap ? [courseMap] : preview?.parts ?? null,
    }),
    [record, me, courseMap, preview],
  );
  const { uncover, coverView } = useMapCover(
    realMap !== null,
    'composer-map-cover',
  );
  const drawnShape = courseShared && !realMap && record.shape.length >= 2;
  // 지역: prefer the shared/planned course start and otherwise use the first measured point retained for region
  // classification. Course sharing controls route disclosure, not whether the post belongs to a region.
  const start = record.route?.[0] ?? record.regionStart ?? undefined;
  const startLongitude = start?.[0];
  const startLatitude = start?.[1];
  const [region, setRegion] = useState<PostRegion | null>(null);
  useEffect(() => {
    setRegion(null);
    if (!regionAt || startLongitude == null || startLatitude == null) {
      return;
    }
    let live = true;
    regionAt([startLongitude, startLatitude])
      .then(found => {
        if (live) {
          setRegion(found);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [regionAt, startLongitude, startLatitude]);
  const submit = async () => {
    // State disables the button on the next render; the ref also guards taps in this render.
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      await onSubmit({
        body: body.trim() || null,
        courseShared,
        regionCode: region?.code ?? null,
      });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  // A run with no distance has no pace: – – as on its result, not 0′00″ (S15P31E105-834).
  const pace = formatRecordPace(record.averagePaceSecPerKm);
  const extra = [
    stamp(record.startedAt),
    record.averageHeartRate ? `평균 심박 ${record.averageHeartRate} bpm` : null,
    record.cadence ? `케이던스 ${record.cadence} spm` : null,
  ].filter(Boolean);
  return (
    <>
      {realMap ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <InlineRunReplay run={replayRun} onShown={uncover} />
          {coverView}
        </View>
      ) : (
        <>
          <MapBackdrop seed={record.id} width={width} height={height} />
          {drawnShape ? (
            <RouteLine shape={record.shape} width={width} height={height} />
          ) : null}
        </>
      )}
      <Shade width={width} height={height} strong={realMap !== null} />
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
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          onLayout={revealBody}
          onContentSizeChange={revealBody}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: 28 + insets.bottom },
          ]}
        >
          <View>
            <View style={styles.writer}>
              <Avatar
                nickname={me.nickname}
                userId={me.userId}
                photo={me.profileImageUrl}
                mine
              />
              <AppText style={styles.handle}>{me.handle}</AppText>
            </View>
            {drawnShape ? (
              // The drawn shape is not the real map, so the page says so (as on 7.1).
              <AppText style={styles.example}>예시 경로</AppText>
            ) : null}
          </View>
          {/* The run's words as in the feed; only edits retain a course sharing choice. */}
          <View>
            <View style={styles.stats}>
              <Stat value={formatKm(record.distanceM)} unit="km" label="거리" />
              <Stat value={formatDuration(record.durationSec)} label="시간" />
              <Stat
                value={pace ?? '– –'}
                unit={pace === null ? undefined : '/km'}
                label="평균 페이스"
              />
            </View>
            <AppText style={styles.extra} numberOfLines={2}>
              {extra.join(' · ')}
            </AppText>
            <View style={styles.recordTitle}>
              <Icon name="runner" color={feedLook.route} size={18} />
              <AppText style={styles.recordText} numberOfLines={1}>
                {recordLabel(record, courseShared)}
              </AppText>
            </View>
            <View style={styles.bodyField}>
              <TextInput
                ref={bodyInput}
                accessibilityLabel="글 내용"
                placeholder="오늘 러닝은 어땠나요?"
                placeholderTextColor={feedLook.faint}
                selectionColor={communityLook.selection}
                cursorColor={feedLook.route}
                value={body}
                onChangeText={setBody}
                onFocus={revealBody}
                maxLength={bodyLimit}
                multiline
                style={styles.bodyInput}
              />
            </View>
            {courseSharingEditable ? (
              <View style={styles.share}>
                <View style={styles.flex}>
                  <AppText style={styles.shareTitle}>코스도 함께 공유</AppText>
                  <AppText style={styles.shareNote}>
                    {free
                      ? '공유하면 이 기록의 경로를 코스로 만들어요. GPS가 부족하면 기록만 공유돼요.'
                      : '이 게시물에 경로·출발/도착 지점과 코스 설명(출발지+거리)이 보여요 · 내 별명은 보이지 않아요 · 이 게시물을 볼 수 있는 사람이 내 코스에 저장할 수 있어요'}
                  </AppText>
                </View>
                <CourseToggle
                  label="코스도 함께 공유"
                  value={courseShared}
                  onChange={setCourseShared}
                  dark
                />
              </View>
            ) : null}
            {region ? (
              <View style={styles.region}>
                <Icon name="mapPin" color={feedLook.white} size={14} />
                <AppText style={styles.shareNote}>
                  {`지역: ${region.label}`}
                </AppText>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardLift>
    </>
  );
}

// 7.3 · 7.3e on the feed's dark ground (S15P31E105-563), in the dark theme so loading and errors read white.
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider tone="dark">
      <View style={styles.root}>
        <StatusBar barStyle="light-content" />
        {children}
      </View>
    </ThemeProvider>
  );
}

const loadMe = (repositories: Repositories) =>
  repositories.runners.getProfile(null);

// 7.3 글쓰기 · 기록 공유: opened from 4.5, 5.2 or 6.7 with the run to share.
export function PostWriteScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'PostWrite'>>();
  const recordId = route.params?.recordId ?? null;
  const toast = useToast();
  const { community } = useRepositories();
  const me = useResource(loadMe);
  const record = useResource(
    useCallback(
      async (repositories: Repositories) => {
        const shareable = await repositories.community.getShareable(recordId);
        const measuredRoute =
          !shareable.courseRun && !shareable.route
            ? runRouteOf(
                await repositories.records
                  .getRoute(shareable.id)
                  .catch(() => null),
              )
            : null;
        return { shareable, measuredRoute };
      },
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
        <ActivityIndicator style={styles.loading} color={feedLook.white} />
      </Frame>
    );
  }
  return (
    <Frame>
      <Composer
        title="기록 공유"
        action="게시"
        me={me.data}
        record={record.data.shareable}
        measuredRoute={record.data.measuredRoute}
        initial={{ body: null, courseShared: true }}
        courseSharingEditable={false}
        regionAt={community.regionAt}
        onSubmit={async draft => {
          try {
            const created = await community.create(
              record.data.shareable.id,
              draft,
            );
            postsChanged();
            toast(
              draft.courseShared && !created.courseShared
                ? created.courseShareFailureReason === 'INSUFFICIENT_GPS'
                  ? 'GPS 경로가 부족해 기록만 공유했어요. 코스 공유는 꺼졌어요.'
                  : '코스를 만들지 못해 기록만 공유했어요. 코스 공유는 꺼졌어요.'
                : '러닝 기록을 공유했어요',
            );
            if (route.params?.fromRecords) {
              // Back from the new post returns to the saved record, never to an already submitted draft.
              navigation.replace('PostDetail', { postId: created.id });
            } else {
              navigateTo(navigation, 'Community');
            }
          } catch (error) {
            toast(postFailure(error, '게시'));
            // This run is already shared (from any 기록 공유 entry, or a retry after a lost answer): open that post
            // in place of this draft, so back never returns to a draft that cannot be posted.
            const postId = existingPostId(error);
            if (postId !== null) {
              // The post may have been written elsewhere (another phone), so lists read it again (리뷰 A-7).
              postsChanged();
              navigation.replace('PostDetail', { postId });
            }
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
        <ActivityIndicator style={styles.loading} color={feedLook.white} />
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
            postsChanged();
            toast('게시물을 수정했어요');
            navigation.goBack();
          } catch (error) {
            toast(postFailure(error, '저장'));
          }
        }}
      />
    </Frame>
  );
}

// 7.3 · 7.3e over the feed's dark map: white words, a see-through dark field, no cards or dividers.
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: feedLook.ground },
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
    color: feedLook.white,
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
    color: feedLook.white,
  },
  submit: { height: 40, justifyContent: 'center', paddingHorizontal: 4 },
  submitText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: feedLook.route,
  },
  busy: { opacity: 0.45 },
  // The writing at the top, the run's words at the foot, as on a 7.1 page.
  content: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 28,
    gap: 32,
  },
  writer: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  handle: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 22,
    color: feedLook.white,
  },
  // 본문: a see-through dark field over the map.
  bodyField: {
    marginTop: 12,
    minHeight: 56,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 15,
    backgroundColor: 'rgba(12,20,27,0.82)',
  },
  // Keep an explicit text line for Android: without it the native caret can use the
  // whole multiline input height and look much taller than the glyphs (S15P31E105-793).
  bodyInput: {
    minHeight: 26,
    // Longer drafts scroll inside the native input, keeping the caret above the keyboard.
    maxHeight: 120,
    padding: 0,
    fontFamily: typography.input.fontFamily,
    fontSize: 16,
    lineHeight: 22,
    includeFontPadding: false,
    color: feedLook.white,
    textAlignVertical: 'top',
  },
  example: {
    marginTop: 10,
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 15,
    color: feedLook.faint,
  },
  // 7.1's numbers, extra line and title.
  stats: { flexDirection: 'row', gap: 20 },
  extra: {
    marginTop: 8,
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: feedLook.sub,
  },
  recordTitle: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recordText: {
    flexShrink: 1,
    fontFamily: fontFamily.medium,
    fontSize: 17,
    lineHeight: 22,
    color: feedLook.white,
  },
  share: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 20,
    marginTop: 24,
  },
  shareTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 20,
    color: feedLook.white,
  },
  // 7.3 지역: 부산 수영구 under the course switch.
  region: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  shareNote: {
    marginTop: 8,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: feedLook.sub,
  },
});
