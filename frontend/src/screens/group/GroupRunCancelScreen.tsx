import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StatusBar,
  StyleSheet,
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
  BottomSheet,
  Card,
  EmptyState,
  Icon,
  IconButton,
  useToast,
} from '../../components';
import {
  useRepositories,
  useResource,
  type GroupRunCancelReason,
  type Repositories,
} from '../../data';
import type { RootStackParamList } from '../../navigation/types';
import {
  fontFamily,
  k1,
  size,
  spacing,
  ThemeProvider,
  useTheme,
} from '../../theme';
import { cancelReasons, FooterButton } from './GroupRunDetailScreen';
import { formatSchedule, useGroupRunDraft } from './parts';

// 6.4c 그룹런 취소 (only for the run's creator) with 6.4d 취소 확인; it ends on 6.4e, the cancelled 6.4.
export function GroupRunCancelScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'GroupRunCancel'>>();
  const groupRunId = route.params?.groupRunId ?? 'gr-wednesday';
  const { colors } = useTheme();
  const { groupRuns } = useRepositories();
  const toast = useToast();
  const { changed } = useGroupRunDraft();
  const detail = useResource(
    useCallback(
      (repositories: Repositories) => repositories.groupRuns.get(groupRunId),
      [groupRunId],
    ),
  );
  const [reason, setReason] = useState<GroupRunCancelReason | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = detail.status === 'ready' ? detail.data : null;
  const label = cancelReasons.find(item => item.value === reason)?.label;

  const cancel = async () => {
    if (!reason) {
      return;
    }
    setBusy(true);
    try {
      await groupRuns.cancel(groupRunId, reason);
      changed();
      setConfirming(false);
      // Back to 6.4, which now shows the cancelled run (6.4e).
      navigation.goBack();
    } catch {
      toast('그룹런을 취소하지 못했어요. 잠시 후 다시 시도해 주세요');
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <IconButton
            icon="back"
            accessibilityLabel="뒤로"
            onPress={() => navigation.goBack()}
          />
          <AppText style={styles.headerTitle} accessibilityRole="header">
            그룹런 취소
          </AppText>
        </View>
      </SafeAreaView>
      {detail.status === 'error' ? (
        <EmptyState
          icon="alert"
          title="그룹런 정보를 불러오지 못했어요"
          actionLabel="다시 시도"
          onAction={detail.reload}
        />
      ) : !run ? (
        <ActivityIndicator style={styles.loading} />
      ) : (
        <View style={styles.content}>
          <Card variant="solid" style={styles.card}>
            <AppText variant="caption" tone="textSecondary">
              {run.crewName}
            </AppText>
            <AppText style={styles.title}>{run.title}</AppText>
            <AppText variant="caption" tone="textSecondary">
              {`${formatSchedule(run.scheduledAt)} · ${run.meetingPlaceName}`}
            </AppText>
          </Card>
          <Card variant="solid" style={styles.card}>
            <View style={styles.rowBetween}>
              <AppText variant="bodyMedium">취소 이유</AppText>
              <AppText variant="label" tone="textSecondary">
                하나만 골라요
              </AppText>
            </View>
            <View style={styles.chips}>
              {cancelReasons.map(item => {
                const selected = item.value === reason;
                return (
                  <Pressable
                    key={item.value}
                    accessibilityRole="radio"
                    accessibilityLabel={item.label}
                    accessibilityState={{ selected }}
                    onPress={() => setReason(item.value)}
                    style={[
                      styles.chip,
                      selected
                        ? {
                            backgroundColor: colors.accent,
                            borderColor: colors.accent,
                          }
                        : { borderColor: colors.border },
                    ]}
                  >
                    <AppText
                      variant={selected ? 'captionStrong' : 'caption'}
                      style={{
                        color: selected
                          ? colors.onAccent
                          : colors.textSecondary,
                      }}
                    >
                      {item.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </Card>
          {/* See-through background-color box with a coral 60% rim (DESIGN.md 2-10 취소). */}
          <View style={[styles.warning, { backgroundColor: colors.glass }]}>
            <Icon name="bell" color={k1.coral} size={16} />
            <AppText variant="caption" style={styles.flex}>
              {`참가자 ${run.participantCount}명과 크루 멤버에게 취소 알림이 가요. 취소한 그룹런은 되돌릴 수 없어요.`}
            </AppText>
          </View>
        </View>
      )}
      <ThemeProvider tone="dark">
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <FooterButton
            title="그룹런 취소하기"
            dangerOutline
            disabled={!reason}
            onPress={() => setConfirming(true)}
          />
        </SafeAreaView>
      </ThemeProvider>
      <BottomSheet visible={confirming} onClose={() => setConfirming(false)}>
        {run ? (
          <View style={styles.sheet}>
            <View
              style={[
                styles.sheetIcon,
                { backgroundColor: colors.dangerSurface },
              ]}
            >
              <Icon name="alert" color={k1.coral} size={22} />
            </View>
            <AppText style={styles.sheetTitle}>그룹런을 취소할까요?</AppText>
            <AppText variant="body" tone="textSecondary">
              {`${formatSchedule(run.scheduledAt)} ‘${
                run.title
              }’가 취소되고, 크루 멤버 ${
                run.crewMemberCount
              }명에게 바로 알림이 가요.`}
            </AppText>
            <View
              style={[
                styles.reasonRow,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.borderStrong,
                },
              ]}
            >
              <AppText variant="caption" tone="textSecondary">
                취소 이유
              </AppText>
              <AppText variant="captionStrong">{label ?? ''}</AppText>
            </View>
            <View style={styles.sheetButtons}>
              <FooterButton
                title="돌아가기"
                onPress={() => setConfirming(false)}
              />
              <FooterButton
                title="취소하기"
                danger
                disabled={busy}
                onPress={cancel}
              />
            </View>
          </View>
        ) : null}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: spacing.xxxl },
  header: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.screen,
  },
  headerTitle: { fontFamily: fontFamily.medium, fontSize: 19, lineHeight: 26 },
  content: { padding: 14, gap: spacing.lg },
  card: { gap: spacing.sm },
  title: { fontFamily: fontFamily.medium, fontSize: 22, lineHeight: 30 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  chip: {
    height: 38,
    paddingHorizontal: spacing.xl,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
  },
  warning: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(226,135,111,0.6)',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingBottom: spacing.xl,
  },
  sheet: { gap: spacing.xl },
  sheetIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(226,135,111,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: { fontFamily: fontFamily.medium, fontSize: 22, lineHeight: 30 },
  reasonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.xl,
    borderRadius: 18,
    borderWidth: 1,
  },
  sheetButtons: { flexDirection: 'row', gap: spacing.md },
});
