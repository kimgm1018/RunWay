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
  size,
  spacing,
  ThemeProvider,
  typography,
} from '../../theme';
import { cancelReasons, FooterButton } from './GroupRunDetailScreen';
import { groupTone, NightBackground, NumText, Raised } from './look';
import { MissingTarget } from './MissingTarget';
import { BottomFade, formatSchedule, useGroupRunDraft } from './parts';
import { BackButton } from '../../components/BackButton';

// G13 cancelMessage: at most 100 characters, sent once as the members' notification body.
const messageLimit = 100;

// 6.4c-CancelButton: the big white button of the navy group screens with navy text, its circle in red pink with a ×
// (S15P31E105-594 담당자 결정: 진한 네이비 톤, 큰 버튼은 흰색).
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
            <Icon name="close" color={groupTone.text} size={14} />
          </View>
        </View>
      </View>
    </PressableScale>
  );
}

// 6.4c 그룹런 취소 (only for the run's creator) with 6.4d 취소 확인; it ends on 6.4e, the cancelled 6.4.
// Laid out as in 담당자 시안 (S15P31E105-594 담당자 시안) on the navy page in the home's tone (담당자 결정: 진한 네이비):
// faint white cards, white text, mint only on the picked chip, a white big button and the red pink warnings.
export function GroupRunCancelScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'GroupRunCancel'>>();
  const groupRunId = route.params?.groupRunId;
  // Without an id the screen has nothing to show; no mock id stands in (S15P31E105-635).
  if (!groupRunId) {
    return <MissingTarget title="그룹런을 찾을 수 없어요" />;
  }
  return <GroupRunCancelContent groupRunId={groupRunId} />;
}

function GroupRunCancelContent({ groupRunId }: { groupRunId: string }) {
  const navigation = useNavigation();
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
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <NightBackground />
      <SafeAreaView edges={['top']}>
        {/* The title centred between back and a space as wide (S15P31E105-594 담당자 시안). */}
        <View style={styles.header}>
          <BackButton tone="dark" onPress={() => navigation.goBack()} />
          <AppText style={styles.headerTitle} accessibilityRole="header">
            그룹런 취소
          </AppText>
          <View style={styles.headerSpace} />
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
            {/* Each part of 담당자 시안 is one faint white card on the navy page (S15P31E105-594 담당자 시안).
                6.4c-RunSummary: the run beside its icon with the crew under it, a line, then when and where a row
                each with their icons. */}
            <Raised tone="night" style={styles.card}>
              <View style={styles.summaryHead}>
                <View style={styles.runIcon}>
                  <Icon name="runner" color={groupTone.text} size={22} />
                </View>
                <View style={styles.flex}>
                  <AppText style={styles.title}>{run.title}</AppText>
                  <AppText style={styles.crew}>{run.crewName}</AppText>
                </View>
              </View>
              <View style={styles.rule} />
              <View style={styles.fact}>
                <Icon name="calendar" color={groupTone.sub} size={16} />
                <NumText
                  text={formatSchedule(run.scheduledAt)}
                  style={[styles.sub, styles.flex]}
                />
              </View>
              <View style={styles.fact}>
                <Icon name="mapPin" color={groupTone.sub} size={16} />
                <AppText style={[styles.sub, styles.flex]}>
                  {run.meetingPlaceName}
                </AppText>
              </View>
            </Raised>
            {/* 6.4c-CancelReason on its own card; the picked chip is mint with a navy check, the rest faint white.
                The titles are plain white bold, without the left line. */}
            <Raised tone="night" style={styles.card}>
              <View style={styles.rowBetween}>
                <AppText style={styles.label} accessibilityRole="header">
                  취소 이유
                </AppText>
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
                        {selected ? (
                          <Icon
                            name="check"
                            color={groupTone.onAccent}
                            size={14}
                          />
                        ) : null}
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
            </Raised>
            {/* 6.4c-CancelMessage on its own card: optional; blank is omitted. Sent once as the notification body, not
                stored on G03. */}
            <Raised tone="night" style={styles.card}>
              <View style={styles.rowBetween}>
                <AppText style={styles.label} accessibilityRole="header">
                  남길 말
                </AppText>
                <NumText
                  text={`선택 · ${message.length} / ${messageLimit}`}
                  style={styles.note}
                />
              </View>
              <View style={styles.messageBox}>
                <TextInput
                  accessibilityLabel="남길 말"
                  placeholder="알림으로 전할 말을 적어 주세요"
                  placeholderTextColor={groupTone.muted}
                  selectionColor={groupTone.accent}
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
            </Raised>
            {/* 6.4c-CancelNotice: the red pink bell and the line on the page, no box. */}
            <View style={styles.warning}>
              <Icon name="bell" color={groupTone.danger} size={16} />
              <AppText style={[styles.warningText, styles.flex]}>
                {`참가자 ${run.participantCount}명과 크루 멤버에게 취소 알림이 가요. 취소한 그룹런은 되돌릴 수 없어요.`}
              </AppText>
            </View>
          </ScrollView>
        </KeyboardLift>
      )}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <BottomFade />
        <CancelButton disabled={!reason} onPress={() => setConfirming(true)} />
      </SafeAreaView>
      {/* 6.4d 취소 최종 확인, centred as in the 시안: the alert, the question, the line, the reason, the buttons. */}
      <ThemeProvider tone="dark">
        <BottomSheet
          visible={confirming}
          onClose={() => setConfirming(false)}
          background={groupTone.sheet}
        >
          {run ? (
            <View style={styles.sheet}>
              <View style={styles.sheetIcon}>
                <Icon name="alert" color={groupTone.danger} size={22} />
              </View>
              <AppText style={styles.sheetTitle}>그룹런을 취소할까요?</AppText>
              <NumText
                text={`${formatSchedule(run.scheduledAt)} ‘${
                  run.title
                }’가 취소되고, 크루 멤버 ${Math.max(
                  0,
                  run.crewMemberCount - 1,
                )}명에게 바로 알림이 가요.`}
                style={styles.sheetText}
              />
              <View style={styles.reasonRow}>
                <AppText style={styles.reasonLabel}>취소 이유</AppText>
                <AppText style={styles.reasonValue}>{label ?? ''}</AppText>
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
      </ThemeProvider>
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
    gap: 8,
    paddingHorizontal: 16,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontFamily.bold,
    fontSize: 19,
    lineHeight: 26,
    color: groupTone.text,
  },
  headerSpace: { width: 44 },
  // paddingBottom keeps the last line clear of the pinned footer button.
  content: {
    paddingHorizontal: 16,
    paddingTop: spacing.md,
    paddingBottom: 120,
    gap: 12,
  },
  // One faint white card per part of the 시안.
  card: { padding: 18, gap: 14, borderRadius: 20 },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  runIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: groupTone.inner,
  },
  crew: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 17,
    color: groupTone.sub,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 22,
    lineHeight: 30,
    letterSpacing: -0.5,
    color: groupTone.text,
  },
  rule: { height: 1, backgroundColor: groupTone.line },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sub: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 19,
    color: groupTone.sub,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.text,
  },
  note: {
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 16,
    color: groupTone.sub,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  chip: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: groupTone.cardLine,
    backgroundColor: groupTone.card,
  },
  // The picked reason as a small mint chip with navy text (S15P31E105-594 담당자 결정: 민트는 작은 칩에만).
  chipOn: {
    borderColor: groupTone.accent,
    backgroundColor: groupTone.accent,
  },
  chipText: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 19,
    color: groupTone.sub,
  },
  chipTextOn: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: groupTone.onAccent,
  },
  messageBox: {
    minHeight: 88,
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: groupTone.cardLine,
    backgroundColor: groupTone.inner,
  },
  // No lineHeight: on Android it clips the top of the input.
  messageInput: {
    height: 88,
    padding: 0,
    paddingVertical: spacing.lg,
    fontFamily: typography.input.fontFamily,
    fontSize: 15,
    color: groupTone.text,
  },
  warning: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  warningText: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 19,
    color: groupTone.sub,
  },
  cta: {
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: groupTone.button,
  },
  ctaContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ctaText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    color: groupTone.onButton,
  },
  ctaIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: groupTone.danger,
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
  // Centred as in the 시안's 취소 최종 확인; the red pink alert on a faint red pink circle.
  sheetIcon: {
    alignSelf: 'center',
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: groupTone.dangerSoft,
  },
  sheetTitle: {
    textAlign: 'center',
    fontFamily: fontFamily.medium,
    fontSize: 22,
    lineHeight: 30,
    color: groupTone.text,
  },
  sheetText: {
    textAlign: 'center',
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 22,
    color: groupTone.sub,
  },
  reasonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.xl,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: groupTone.cardLine,
    backgroundColor: groupTone.inner,
  },
  reasonLabel: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: groupTone.sub,
  },
  reasonValue: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 18,
    color: groupTone.text,
  },
  sheetButtons: { flexDirection: 'row', gap: spacing.md },
});
