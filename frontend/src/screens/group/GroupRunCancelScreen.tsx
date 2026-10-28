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
  BottomSheet,
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
import { radius, size, spacing, useTheme } from '../../theme';
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
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <IconButton
            icon="back"
            accessibilityLabel="뒤로"
            onPress={() => navigation.goBack()}
          />
          <AppText variant="heading" accessibilityRole="header">
            그룹런 취소
          </AppText>
        </View>
      </SafeAreaView>
      {!run ? (
        <ActivityIndicator style={styles.loading} />
      ) : (
        <View style={styles.content}>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <AppText variant="captionStrong" tone="accentText">
              {run.crewName}
            </AppText>
            <AppText variant="title">{run.title}</AppText>
            <AppText variant="caption" tone="textSecondary">
              {`${formatSchedule(run.scheduledAt)} · ${run.meetingPlaceName}`}
            </AppText>
          </View>
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.rowBetween}>
              <AppText variant="bodyStrong">취소 이유</AppText>
              <AppText variant="label" tone="textTertiary">
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
                        : {
                            backgroundColor: colors.surfaceMuted,
                            borderColor: colors.border,
                          },
                    ]}
                  >
                    <AppText
                      variant="captionStrong"
                      style={{
                        color: selected ? colors.onAccent : colors.text,
                      }}
                    >
                      {item.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View
            style={[
              styles.warning,
              {
                backgroundColor: colors.dangerSurface,
                borderColor: colors.dangerBorder,
              },
            ]}
          >
            <Icon name="bell" color={colors.danger} size={16} />
            <AppText variant="caption" tone="textSecondary" style={styles.flex}>
              {`참가자 ${run.participantCount}명과 크루 멤버에게 취소 알림이 가요. 취소한 그룹런은 되돌릴 수 없어요.`}
            </AppText>
          </View>
        </View>
      )}
      <SafeAreaView
        edges={['bottom']}
        style={[styles.footer, { backgroundColor: colors.background }]}
      >
        <FooterButton
          title="그룹런 취소하기"
          danger
          disabled={!reason}
          onPress={() => setConfirming(true)}
        />
      </SafeAreaView>
      <BottomSheet visible={confirming} onClose={() => setConfirming(false)}>
        {run ? (
          <View style={styles.sheet}>
            <View
              style={[
                styles.sheetIcon,
                { backgroundColor: colors.dangerSurface },
              ]}
            >
              <Icon name="alert" color={colors.danger} size={22} />
            </View>
            <AppText variant="title">그룹런을 취소할까요?</AppText>
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
                { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <AppText variant="caption" tone="textTertiary">
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
  content: { padding: spacing.screen, gap: spacing.xl },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.xxl,
    gap: spacing.sm,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  chip: {
    height: 36,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
  },
  warning: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xl,
  },
  sheet: { gap: spacing.xl },
  sheetIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.xl,
    borderRadius: radius.md,
  },
  sheetButtons: { flexDirection: 'row', gap: spacing.md },
});
