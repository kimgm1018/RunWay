import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { AppText, BottomSheet, Button, DefaultAvatar } from '../../components';
import {
  errorCode,
  useRepositories,
  type FollowDecision,
  type FollowRequest,
} from '../../data';
import { spacing, useTheme } from '../../theme';

// 7.4b 팔로우 요청 (runway-flow v15 reqSheet, U24 · U25, S15P31E105-525): the requests waiting for my answer,
// each with 승인 and 거절. An answered row leaves the list. Results show inside the sheet, as a toast would sit
// behind it.

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready';
      items: FollowRequest[];
      nextCursor: string | null;
      loadingMore: boolean;
    };

const approvedText = (name: string) => `${name}님을 승인했어요`;
const rejectedText = (name: string) => `${name}님의 요청을 거절했어요`;

export function FollowRequestSheet({
  visible,
  onClose,
  onDecided,
}: {
  visible: boolean;
  onClose: () => void;
  // An answer changes my follower count and the request count on 7.4b.
  onDecided: () => void;
}) {
  const { runners } = useRepositories();
  const { colors } = useTheme();
  const [state, setState] = useState<State>({ status: 'loading' });
  // The request being answered, so its buttons wait and a second tap does nothing.
  const [deciding, setDeciding] = useState<string | null>(null);
  const opened = useRef(0);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const attempt = ++opened.current;
    setState({ status: 'loading' });
    setNote(null);
    try {
      const page = await runners.listFollowRequests(null);
      if (attempt === opened.current) {
        setState({
          status: 'ready',
          items: page.items,
          nextCursor: page.nextCursor,
          loadingMore: false,
        });
      }
    } catch {
      if (attempt === opened.current) {
        setState({ status: 'error' });
      }
    }
  }, [runners]);

  useEffect(() => {
    if (visible) {
      load();
    }
  }, [load, visible]);

  const loadMore = async () => {
    if (state.status !== 'ready' || !state.nextCursor || state.loadingMore) {
      return;
    }
    const attempt = opened.current;
    setState({ ...state, loadingMore: true });
    try {
      const page = await runners.listFollowRequests(state.nextCursor);
      if (attempt === opened.current) {
        setState(current =>
          current.status === 'ready'
            ? {
                status: 'ready',
                // A request answered meanwhile may come again on the next page.
                items: [
                  ...current.items,
                  ...page.items.filter(
                    item =>
                      !current.items.some(
                        shown => shown.requestId === item.requestId,
                      ),
                  ),
                ],
                nextCursor: page.nextCursor,
                loadingMore: false,
              }
            : current,
        );
      }
    } catch {
      setNote('요청을 더 불러오지 못했어요');
      setState(current =>
        current.status === 'ready'
          ? { ...current, loadingMore: false }
          : current,
      );
    }
  };

  const drop = (request: FollowRequest) =>
    setState(current =>
      current.status === 'ready'
        ? {
            ...current,
            items: current.items.filter(
              item => item.requestId !== request.requestId,
            ),
          }
        : current,
    );

  const decide = async (request: FollowRequest, decision: FollowDecision) => {
    if (deciding) {
      return;
    }
    setDeciding(request.requestId);
    try {
      await runners.decideFollowRequest(request, decision);
      drop(request);
      onDecided();
      setNote(
        decision === 'APPROVE'
          ? approvedText(request.nickname)
          : rejectedText(request.nickname),
      );
    } catch (error) {
      const code = errorCode(error);
      if (code === 'REQUEST_NOT_FOUND' || code === 'REQUEST_STATE_CONFLICT') {
        // Cancelled by the runner, or answered elsewhere: it is no longer waiting.
        drop(request);
        onDecided();
        setNote('이미 처리됐거나 취소된 요청이에요');
      } else {
        setNote('처리하지 못했어요. 잠시 후 다시 시도해 주세요');
      }
    } finally {
      setDeciding(null);
    }
  };

  const empty = state.status === 'ready' && state.items.length === 0;
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="팔로우 요청"
      description={
        state.status !== 'ready'
          ? undefined
          : empty
          ? '아직 대기 중인 요청이 없어요'
          : '승인하면 맞팔로우 없이도 내 게시물을 볼 수 있어요.'
      }
    >
      {state.status === 'loading' ? (
        <ActivityIndicator style={styles.loading} color={colors.text} />
      ) : state.status === 'error' ? (
        <View style={styles.failed}>
          <AppText variant="body" tone="textSecondary">
            요청을 불러오지 못했어요
          </AppText>
          <Button
            title="다시 시도"
            variant="secondary"
            size="small"
            onPress={load}
          />
        </View>
      ) : empty ? null : (
        <ScrollView style={styles.list} contentContainerStyle={styles.rows}>
          {state.items.map(request => {
            const busy = deciding === request.requestId;
            return (
              <View key={request.requestId} style={styles.row}>
                {/* The request carries no photo, so the default profile picture (S15P31E105-775). */}
                <DefaultAvatar size={36} />
                <AppText
                  variant="bodyStrong"
                  numberOfLines={1}
                  style={styles.name}
                >
                  {request.nickname}
                </AppText>
                <Button
                  title="승인"
                  size="small"
                  style={styles.action}
                  accessibilityLabel={`${request.nickname} 승인`}
                  loading={busy}
                  disabled={deciding !== null && !busy}
                  onPress={() => decide(request, 'APPROVE')}
                />
                <Button
                  title="거절"
                  variant="secondary"
                  size="small"
                  style={styles.action}
                  accessibilityLabel={`${request.nickname} 거절`}
                  disabled={deciding !== null}
                  onPress={() => decide(request, 'REJECT')}
                />
              </View>
            );
          })}
          {state.nextCursor ? (
            <Button
              title="더 보기"
              variant="text"
              size="small"
              loading={state.loadingMore}
              onPress={loadMore}
            />
          ) : null}
        </ScrollView>
      )}
      {note ? (
        <AppText
          variant="bodyMedium"
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          {note}
        </AppText>
      ) : null}
      <Button title="닫기" variant="secondary" onPress={onClose} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  loading: { marginVertical: spacing.xl },
  failed: { alignItems: 'flex-start', gap: spacing.md },
  list: { maxHeight: 360 },
  rows: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flex: 1 },
  // Keep both decisions the same compact size. Without an explicit flex boundary,
  // Android can stretch the animated button while the row resolves a long name or loading spinner.
  // Keep the compact decision controls visually stable while the approval request is in flight.
  // Button's generic loading opacity otherwise makes the control flash on Android.
  action: { width: 64, flexShrink: 0, opacity: 1 },
});
