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
import { fontFamily, spacing, ThemeProvider, typography } from '../../theme';
import { cancelReasons } from './GroupRunDetailScreen';
import { NightBackground, NumText } from './look';
import {
  ColorBar,
  crewColor,
  stand,
  StandButton,
  StandHeader,
  standType,
} from './stand';
import { MissingTarget } from './MissingTarget';
import { BottomFade, formatSchedule, useGroupRunDraft } from './parts';

// G13 cancelMessage: at most 100 characters, sent once as the members' notification body.
const messageLimit = 100;

// 6.4c-CancelButton: the white pill of the 시안 with a red circle and a ×; quiet until a reason is picked.
function CancelButton({
  disabled,
  onPress,
}: {
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <StandButton
      title="그룹런 취소하기"
      tone="white"
      icon="close"
      iconBackground={stand.danger}
      disabled={disabled}
      onPress={onPress}
    />
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
      <SafeAreaView edges={['top']} style={styles.header}>
        <StandHeader
          title="그룹런 취소"
          onBack={() => navigation.goBack()}
          dim={confirming}
        />
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
            {/* 그룹런 시안 (S15P31E105-673): no cards. 6.4c-RunSummary: the run beside its icon with the crew and its
                colour bar under it, then when and where a row each over a heavier line. */}
            <View style={confirming && styles.dim}>
              <View style={styles.summaryHead}>
                <View style={styles.runIcon}>
                  <Icon name="runner" color={stand.text} size={20} />
                </View>
                <View style={styles.flex}>
                  <AppText style={styles.title}>{run.title}</AppText>
                  <View style={styles.crewRow}>
                    <AppText style={styles.crew}>{run.crewName}</AppText>
                    <ColorBar color={crewColor(run.crewId)} height={11} />
                  </View>
                </View>
              </View>
              <View style={styles.facts}>
                <View style={styles.fact}>
                  <View style={styles.iconCell}>
                    <Icon name="calendar" color={stand.sub} size={16} />
                  </View>
                  <NumText
                    text={formatSchedule(run.scheduledAt)}
                    style={[styles.factStrong, styles.flex]}
                  />
                </View>
                <View style={styles.fact}>
                  <View style={styles.iconCell}>
                    <Icon name="mapPin" color={stand.sub} size={16} />
                  </View>
                  <AppText style={[styles.factText, styles.flex]}>
                    {run.meetingPlaceName}
                  </AppText>
                </View>
              </View>
              {/* 6.4c-CancelReason: square-cornered choices, the picked one mint with a navy check. */}
              <View style={styles.rowBetween}>
                <AppText style={standType.label} accessibilityRole="header">
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
                          <Icon name="check" color={stand.onMint} size={14} />
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
              {/* 6.4c-CancelMessage: optional; blank is omitted. Sent once as the notification body, not stored on
                  G03. */}
              <View style={styles.rowBetween}>
                <AppText style={standType.label} accessibilityRole="header">
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
                  placeholderTextColor={stand.muted}
                  selectionColor="transparent"
                  cursorColor={stand.text}
                  value={message}
                  onChangeText={setMessage}
                  maxLength={messageLimit}
                  multiline
                  textAlignVertical="top"
                  style={styles.messageInput}
                />
              </View>
              <AppText style={[styles.note, styles.messageNote]}>
                상세 화면에는 남지 않고, 크루 멤버 알림 본문으로만 전달돼요
              </AppText>
              {/* 6.4c-CancelNotice: the red pink bell and the line on the page, no box. */}
              <View style={styles.warning}>
                <Icon name="bell" color={stand.danger} size={16} />
                <AppText style={[styles.warningText, styles.flex]}>
                  {`참가자 ${run.participantCount}명과 크루 멤버에게 취소 알림이 가요. 취소한 그룹런은 되돌릴 수 없어요.`}
                </AppText>
              </View>
            </View>
          </ScrollView>
        </KeyboardLift>
      )}
      <SafeAreaView
        edges={['bottom']}
        style={[styles.footer, confirming && styles.dim]}
      >
        <BottomFade />
        <CancelButton disabled={!reason} onPress={() => setConfirming(true)} />
      </SafeAreaView>
      {/* 6.4d 취소 최종 확인, centred as in the 시안: the alert, the question, the line, the reason, the buttons. */}
      <ThemeProvider tone="dark">
        <BottomSheet
          visible={confirming}
          onClose={() => setConfirming(false)}
          background={stand.sheet}
        >
          {run ? (
            <View style={styles.sheet}>
              <View style={styles.sheetIcon}>
                <Icon name="alert" color={stand.danger} size={22} />
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
                <StandButton
                  title="돌아가기"
                  tone="outline"
                  style={styles.flex}
                  onPress={() => setConfirming(false)}
                />
                <StandButton
                  title="취소하기"
                  tone="danger"
                  style={styles.flex}
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
  header: { paddingHorizontal: 17 },
  // Faded under the 6.4d sheet, as in the 시안.
  dim: { opacity: 0.45 },
  // paddingBottom keeps the last line clear of the pinned footer button.
  content: {
    paddingHorizontal: 19,
    paddingTop: 6,
    paddingBottom: 120,
  },
  summaryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    borderBottomWidth: 1,
    borderBottomColor: stand.line,
  },
  runIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: stand.glass,
  },
  crewRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  crew: {
    fontFamily: fontFamily.bold,
    fontSize: 12.5,
    lineHeight: 17,
    color: stand.sub,
  },
  title: {
    fontFamily: fontFamily.black,
    fontSize: 20,
    lineHeight: 26,
    color: stand.text,
  },
  facts: {
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: stand.rule,
  },
  fact: { flexDirection: 'row', alignItems: 'center', height: 40 },
  iconCell: { width: 30 },
  factStrong: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: stand.text,
  },
  factText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 19,
    color: stand.text,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    minHeight: 22,
  },
  note: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    color: stand.sub,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: stand.glassLine,
  },
  // The picked reason in mint with navy text and a check.
  chipOn: { borderColor: stand.mint, backgroundColor: stand.mint },
  chipText: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: stand.text,
  },
  chipTextOn: {
    fontFamily: fontFamily.black,
    fontSize: 14,
    lineHeight: 19,
    color: stand.onMint,
  },
  messageBox: {
    marginTop: 8,
    minHeight: 78,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: stand.glassLine,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  // lineHeight keeps the Android caret to the text line instead of the 78px box
  // (S15P31E105-793).
  messageInput: {
    height: 78,
    padding: 0,
    paddingVertical: 12,
    fontFamily: typography.input.fontFamily,
    fontSize: 14,
    lineHeight: 20,
    includeFontPadding: false,
    textAlignVertical: 'top',
    color: stand.text,
  },
  messageNote: { marginTop: 8 },
  warning: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  warningText: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 19.5,
    color: stand.sub,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 19,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  sheet: { paddingTop: 4 },
  // Centred: the red alert on a faint red circle.
  sheetIcon: {
    alignSelf: 'center',
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: stand.dangerFill,
  },
  sheetTitle: {
    marginTop: 14,
    textAlign: 'center',
    fontFamily: fontFamily.black,
    fontSize: 22,
    lineHeight: 30,
    color: stand.text,
  },
  sheetText: {
    marginTop: 8,
    textAlign: 'center',
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 21,
    color: stand.sub,
  },
  // 취소 이유 as a row between a heavier and a thin line.
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: stand.rule,
    borderBottomWidth: 1,
    borderBottomColor: stand.line,
  },
  reasonLabel: {
    flex: 1,
    fontFamily: fontFamily.black,
    fontSize: 14,
    lineHeight: 19,
    color: stand.mint,
  },
  reasonValue: {
    fontFamily: fontFamily.black,
    fontSize: 14,
    lineHeight: 19,
    color: stand.text,
  },
  sheetButtons: { flexDirection: 'row', gap: 8, marginTop: 14 },
});
