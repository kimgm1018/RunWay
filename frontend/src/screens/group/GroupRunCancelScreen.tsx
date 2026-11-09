import React, { useCallback, useState } from 'react';
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
  BottomSheet,
  EmptyState,
  Icon,
  KeyboardLift,
  PressableScale,
  useToast,
} from '../../components';
import {
  DataError,
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
  typography,
  useTheme,
} from '../../theme';
import { cancelReasons, FooterButton } from './GroupRunDetailScreen';
import { groupLook, groupPage, SectionLabel } from './look';
import { BottomFade, formatSchedule, useGroupRunDraft } from './parts';
import { BackButton } from '../../components/BackButton';

// G13 cancelMessage: at most 100 characters, sent once as the members' notification body.
const messageLimit = 100;

// 6.4c-CancelButton: the flat navy bottom button of 6.2 · 6.4 · 6.8 (S15P31E105-563), its circle in --warn with a ×.
function CancelButton({
  disabled,
  onPress,
}: {
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="그룹런 취소하기"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
    >
      <View style={styles.cta}>
        {/* Disabled dims the label only, so the pill stays solid over the background. */}
        <View style={[styles.ctaContent, disabled && styles.disabled]}>
          <AppText style={styles.ctaText}>그룹런 취소하기</AppText>
          <View style={styles.ctaIcon}>
            <Icon name="close" color={groupLook.onDark} size={14} />
          </View>
        </View>
      </View>
    </PressableScale>
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
  const [message, setMessage] = useState('');
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
      await groupRuns.cancel(groupRunId, reason, message);
      changed();
      setConfirming(false);
      // Back to 6.4, which now shows the cancelled run (6.4e).
      navigation.goBack();
    } catch (error) {
      toast(
        error instanceof DataError && error.status === 409
          ? '이미 취소되었거나 끝난 그룹런이에요. 상세에서 상태를 확인해 주세요'
          : '그룹런을 취소하지 못했어요. 잠시 후 다시 시도해 주세요',
      );
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, groupPage.page]}>
      <StatusBar barStyle="dark-content" />
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
        <KeyboardLift style={styles.flex}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            {/* 6.4c-RunSummary: no card. */}
            <View style={styles.summary}>
              <AppText style={styles.crew}>{run.crewName}</AppText>
              <AppText style={styles.title}>{run.title}</AppText>
              <AppText style={styles.sub}>
                {`${formatSchedule(run.scheduledAt)} · ${run.meetingPlaceName}`}
              </AppText>
            </View>
            {/* 6.4c-CancelReason: a block under a grey band; the picked chip is flat navy, the rest flat grey. */}
            <View style={groupPage.block}>
              <View style={styles.rowBetween}>
                <SectionLabel tone="mist">취소 이유</SectionLabel>
                <AppText style={styles.note}>하나만 골라요</AppText>
              </View>
              <View style={styles.chips}>
                {cancelReasons.map(item => {
                  const selected = item.value === reason;
                  return (
                    <PressableScale
                      key={item.value}
                      accessibilityRole="radio"
                      accessibilityLabel={item.label}
                      accessibilityState={{ selected }}
                      onPress={() => setReason(item.value)}
                    >
                      <View style={[styles.chip, selected && styles.chipOn]}>
                        <AppText
                          style={selected ? styles.chipTextOn : styles.chipText}
                        >
                          {item.label}
                        </AppText>
                      </View>
                    </PressableScale>
                  );
                })}
              </View>
            </View>
            {/* 6.4c-CancelMessage: optional; blank is omitted. Sent once as the notification body, not stored on G03. */}
            <View style={groupPage.block}>
              <View style={styles.rowBetween}>
                <SectionLabel tone="mist">남길 말</SectionLabel>
                <AppText style={styles.note}>
                  {`선택 · ${message.length} / ${messageLimit}`}
                </AppText>
              </View>
              <View style={styles.messageBox}>
                <TextInput
                  accessibilityLabel="남길 말"
                  placeholder="알림으로 전할 말을 적어 주세요"
                  placeholderTextColor={groupLook.onLightSub}
                  selectionColor={groupLook.navy}
                  value={message}
                  onChangeText={setMessage}
                  maxLength={messageLimit}
                  multiline
                  textAlignVertical="top"
                  style={styles.messageInput}
                />
              </View>
              <AppText style={styles.note}>
                상세 화면에는 남지 않고, 크루 멤버 알림 본문으로만 전달돼요
              </AppText>
            </View>
            {/* 6.4c-CancelNotice: the coral bell and the line, no box. */}
            <View style={styles.warning}>
              <Icon name="bell" color={k1.coral} size={16} />
              <AppText style={[styles.warningText, styles.flex]}>
                {`참가자 ${run.participantCount}명과 크루 멤버에게 취소 알림이 가요. 취소한 그룹런은 되돌릴 수 없어요.`}
              </AppText>
            </View>
          </ScrollView>
        </KeyboardLift>
      )}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <BottomFade white />
        <CancelButton disabled={!reason} onPress={() => setConfirming(true)} />
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
  // paddingBottom keeps the last line clear of the pinned footer button.
  content: { paddingTop: spacing.md, paddingBottom: 120 },
  summary: { gap: spacing.xs, paddingHorizontal: 20, paddingBottom: 24 },
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
    backgroundColor: groupLook.lightFill,
  },
  chipOn: { backgroundColor: groupLook.navy },
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
  messageBox: {
    minHeight: 88,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: groupLook.lightFill,
  },
  // No lineHeight: on Android it clips the top of the input.
  messageInput: {
    height: 88,
    padding: 0,
    paddingVertical: spacing.lg,
    fontFamily: typography.input.fontFamily,
    fontSize: 15,
    color: groupLook.onLight,
  },
  warning: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: 20 },
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
    backgroundColor: groupLook.navy,
    boxShadow: '0 4px 12px rgba(2,5,14,0.16)',
  },
  ctaContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ctaText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    color: groupLook.onDark,
  },
  ctaIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: groupLook.warn,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.45 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingTop: spacing.md,
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
