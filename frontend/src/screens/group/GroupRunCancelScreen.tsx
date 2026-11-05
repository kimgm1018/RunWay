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
  EmptyState,
  Icon,
  LightGlass,
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
import { GroupBackground, groupLook, Raised, SectionLabel } from './look';
import { formatSchedule, useGroupRunDraft } from './parts';
import { BackButton } from '../../components/BackButton';

// 6.4c-CancelButton: the raised white bottom pill of the 6 그룹 screens, its circle in --warn with a ×.
function CancelButton({
  disabled,
  onPress,
}: {
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="그룹런 취소하기"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.ctaPressed}
    >
      <Raised tone="white" style={styles.cta}>
        {/* Disabled dims the label only, so the pill stays solid over the background. */}
        <View style={[styles.ctaContent, disabled && styles.disabled]}>
          <AppText style={styles.ctaText}>그룹런 취소하기</AppText>
          <View style={styles.ctaIcon}>
            <Icon name="close" color={groupLook.onDark} size={14} />
          </View>
        </View>
      </Raised>
    </Pressable>
  );
}

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
    <View style={[styles.root, { backgroundColor: groupLook.navy }]}>
      <StatusBar barStyle="dark-content" />
      <GroupBackground id="groupRunCancelBackground" kind="common" />
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <BackButton onPress={() => navigation.goBack()} />
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
          {/* 6.4c-RunSummary: no card. */}
          <View style={styles.summary}>
            <AppText style={styles.crew}>{run.crewName}</AppText>
            <AppText style={styles.title}>{run.title}</AppText>
            <AppText style={styles.sub}>
              {`${formatSchedule(run.scheduledAt)} · ${run.meetingPlaceName}`}
            </AppText>
          </View>
          {/* 6.4c-CancelReason: a line-labelled section; the picked chip is navy, the rest light glass. */}
          <View style={styles.reasons}>
            <View style={styles.rowBetween}>
              <SectionLabel tone="light">취소 이유</SectionLabel>
              <AppText style={styles.note}>하나만 골라요</AppText>
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
                    style={({ pressed }) => pressed && styles.chipPressed}
                  >
                    {selected ? (
                      <Raised tone="navy" style={styles.chip}>
                        <AppText style={styles.chipTextOn}>
                          {item.label}
                        </AppText>
                      </Raised>
                    ) : (
                      <LightGlass radius={19} style={styles.chip}>
                        <AppText style={styles.chipText}>{item.label}</AppText>
                      </LightGlass>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
          {/* 6.4c-CancelNotice: the coral bell and the line, no box. */}
          <View style={styles.warning}>
            <Icon name="bell" color={k1.coral} size={16} />
            <AppText style={[styles.warningText, styles.flex]}>
              {`참가자 ${run.participantCount}명과 크루 멤버에게 취소 알림이 가요. 취소한 그룹런은 되돌릴 수 없어요.`}
            </AppText>
          </View>
        </View>
      )}
      <ThemeProvider tone="dark">
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <CancelButton
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
  headerTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 19,
    lineHeight: 26,
    color: groupLook.onLight,
  },
  content: { paddingHorizontal: 16, paddingTop: spacing.md, gap: 28 },
  summary: { gap: spacing.xs },
  crew: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: groupLook.onLightSub,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 24,
    lineHeight: 32,
    letterSpacing: -0.5,
    color: groupLook.onLight,
  },
  sub: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 19,
    color: groupLook.onLightSub,
  },
  reasons: { gap: spacing.lg },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  note: {
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 16,
    color: groupLook.onLightSub,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  chip: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    justifyContent: 'center',
  },
  chipPressed: { transform: [{ scale: 0.97 }] },
  chipText: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 19,
    color: groupLook.onLightSub2,
  },
  chipTextOn: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: groupLook.onDark,
  },
  warning: { flexDirection: 'row', gap: spacing.md },
  warningText: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 19,
    color: groupLook.onLightSub2,
  },
  cta: {
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,1), inset 0 -2px 4px rgba(93,129,148,0.18), 0 12px 28px rgba(0,0,0,0.38)',
  },
  ctaContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ctaText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    color: groupLook.navy,
  },
  ctaIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: groupLook.warn,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPressed: { transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.45 },
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
