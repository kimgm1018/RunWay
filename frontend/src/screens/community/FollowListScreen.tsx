import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {
  StackActions,
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AppText,
  Backdrop,
  Button,
  EmptyState,
  Icon,
  Segmented,
} from '../../components';
import { BackButton } from '../../components/BackButton';
import {
  errorCode,
  useRepositories,
  type FollowListItem,
  type FollowListKind,
} from '../../data';
import type { RootStackParamList } from '../../navigation/types';
import { fontFamily, ThemeProvider } from '../../theme';

// 7.4c 팔로워 · 팔로잉 (U26 · U27, S15P31E105-534): from the counts on 7.4 · 7.4b, the runners approved on
// either side, newest first, 20 a page. A row opens that runner's 7.4; 뒤로 comes back here. Each tab reads
// again whenever the screen shows, so a follow changed on a profile shows here as it does in the counts.

const look = {
  ink: '#02050E',
  sub: '#56646C',
  mark: '#0F1011',
} as const;

const tabs: { value: FollowListKind; label: string }[] = [
  { value: 'followers', label: '팔로워' },
  { value: 'following', label: '팔로잉' },
];

const emptyText: Record<FollowListKind, string> = {
  followers: '아직 팔로워가 없어요',
  following: '아직 팔로우하는 러너가 없어요',
};

type State =
  | { status: 'loading' }
  | { status: 'locked' }
  | { status: 'gone' }
  | { status: 'error' }
  | {
      status: 'ready';
      items: FollowListItem[];
      nextCursor: string | null;
      loadingMore: boolean;
      moreFailed: boolean;
      // The read on return failed: the list shown is the one read before.
      stale: boolean;
    };

// U26 · U27 answer 403 once the account is private to me and 404 once the runner is gone; the list closes.
const closedBy = (error: unknown): 'locked' | 'gone' | null => {
  const code = errorCode(error);
  return code === 'ACCOUNT_ACCESS_DENIED'
    ? 'locked'
    : code === 'USER_NOT_FOUND'
    ? 'gone'
    : null;
};

function Row({
  item,
  onPress,
}: {
  item: FollowListItem;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.nickname} 러너 프로필`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.avatar}>
        {item.profileImageUrl ? (
          <Image
            source={{ uri: item.profileImageUrl }}
            style={styles.photo}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <AppText style={styles.initial}>
            {item.nickname.slice(0, 1).toUpperCase()}
          </AppText>
        )}
      </View>
      <AppText style={styles.name} numberOfLines={1}>
        {item.nickname}
      </AppText>
      <Icon name="forward" color={look.sub} size={18} strokeWidth={1.8} />
    </Pressable>
  );
}

export function FollowListScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'FollowList'>>();
  const { userId, nickname } = route.params;
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { runners } = useRepositories();
  const [kind, setKind] = useState<FollowListKind>(route.params.kind);
  const [state, setState] = useState<State>({ status: 'loading' });
  // Answers for an earlier tab or an earlier read are dropped.
  const attempt = useRef(0);
  // A first-page read is under way; 더 보기 waits for it, as its cursor belongs to the list being replaced.
  const reloading = useRef(false);

  const load = useCallback(async () => {
    const mine = ++attempt.current;
    reloading.current = true;
    // On return the list stays up while it reads again.
    setState(current =>
      current.status === 'ready'
        ? { ...current, loadingMore: false }
        : { status: 'loading' },
    );
    try {
      const page = await runners.listFollows(userId, kind, null);
      if (mine === attempt.current) {
        setState({
          status: 'ready',
          items: page.items,
          nextCursor: page.nextCursor,
          loadingMore: false,
          moreFailed: false,
          stale: false,
        });
      }
    } catch (error) {
      if (mine === attempt.current) {
        const closed = closedBy(error);
        // A refused or vanished list closes; any other failure keeps the list shown with a note.
        setState(current =>
          closed
            ? { status: closed }
            : current.status === 'ready'
            ? { ...current, stale: true }
            : { status: 'error' },
        );
      }
    } finally {
      if (mine === attempt.current) {
        reloading.current = false;
      }
    }
  }, [kind, runners, userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const switchTo = (next: FollowListKind) => {
    if (next !== kind) {
      attempt.current += 1;
      setState({ status: 'loading' });
      setKind(next);
    }
  };

  const loadMore = async () => {
    if (
      reloading.current ||
      state.status !== 'ready' ||
      !state.nextCursor ||
      state.loadingMore
    ) {
      return;
    }
    const mine = attempt.current;
    const cursor = state.nextCursor;
    setState(current =>
      current.status === 'ready'
        ? { ...current, loadingMore: true, moreFailed: false }
        : current,
    );
    try {
      const page = await runners.listFollows(userId, kind, cursor);
      if (mine === attempt.current) {
        setState(current =>
          current.status === 'ready'
            ? {
                ...current,
                // A relation removed and made again between pages comes back newer, so drop repeats.
                items: [
                  ...current.items,
                  ...page.items.filter(
                    item =>
                      !current.items.some(shown => shown.userId === item.userId),
                  ),
                ],
                nextCursor: page.nextCursor,
                loadingMore: false,
              }
            : current,
        );
      }
    } catch (error) {
      if (mine === attempt.current) {
        const closed = closedBy(error);
        setState(current =>
          closed
            ? { status: closed }
            : current.status === 'ready'
            ? { ...current, loadingMore: false, moreFailed: true }
            : current,
        );
      }
    }
  };

  const open = (item: FollowListItem) =>
    navigation.dispatch(
      StackActions.push('RunnerProfile', { userId: item.userId }),
    );

  return (
    <ThemeProvider tone="light">
      <View style={styles.root}>
        <StatusBar barStyle="dark-content" />
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Backdrop tail />
        </View>
        <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
          <BackButton onPress={() => navigation.goBack()} />
          <AppText
            style={styles.title}
            numberOfLines={1}
            accessibilityRole="header"
          >
            {nickname}
          </AppText>
        </View>
        <View style={styles.tabs}>
          <Segmented options={tabs} value={kind} onChange={switchTo} />
        </View>
        {state.status === 'loading' ? (
          <ActivityIndicator style={styles.loading} color={look.ink} />
        ) : state.status === 'locked' ? (
          <EmptyState
            icon="lock"
            title="비공개 계정이에요"
            description="팔로우 요청이 승인되면 목록이 보여요."
          />
        ) : state.status === 'gone' ? (
          <EmptyState icon="alert" title="탈퇴했거나 찾을 수 없는 러너예요" />
        ) : state.status === 'error' ? (
          <EmptyState
            icon="alert"
            title="목록을 불러오지 못했어요"
            actionLabel="다시 시도"
            onAction={load}
          />
        ) : state.items.length === 0 && !state.stale ? (
          <EmptyState icon="users" title={emptyText[kind]} />
        ) : (
          <FlatList
            data={state.items}
            ListHeaderComponent={
              state.stale ? (
                <AppText style={styles.stale} accessibilityRole="alert">
                  목록을 새로 고치지 못했어요
                </AppText>
              ) : null
            }
            keyExtractor={item => item.userId}
            renderItem={({ item }) => (
              <Row item={item} onPress={() => open(item)} />
            )}
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            ListFooterComponent={
              state.nextCursor ? (
                <View style={styles.footer}>
                  {state.moreFailed ? (
                    <AppText style={styles.note} accessibilityRole="alert">
                      목록을 더 불러오지 못했어요
                    </AppText>
                  ) : null}
                  <Button
                    title={state.moreFailed ? '다시 시도' : '더 보기'}
                    variant="text"
                    size="small"
                    loading={state.loadingMore}
                    onPress={loadMore}
                  />
                </View>
              ) : null
            }
          />
        )}
      </View>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  title: {
    flex: 1,
    fontFamily: fontFamily.bold,
    fontSize: 18,
    lineHeight: 24,
    color: look.ink,
  },
  tabs: { paddingHorizontal: 16, paddingVertical: 8 },
  loading: { marginTop: 64 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 16,
  },
  rowPressed: { backgroundColor: 'rgba(24,46,61,0.06)' },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: look.mark,
  },
  photo: { width: 44, height: 44 },
  initial: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 22,
    color: '#FFFFFF',
  },
  name: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 16,
    lineHeight: 21,
    color: look.ink,
  },
  stale: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: look.sub,
  },
  footer: { alignItems: 'center', gap: 4, paddingVertical: 12 },
  note: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: look.sub,
  },
});
