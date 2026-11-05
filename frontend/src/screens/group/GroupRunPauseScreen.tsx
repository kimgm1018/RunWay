import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, View } from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, BottomSheet, useToast } from '../../components';
import { useRepositories } from '../../data';
import { formatDuration, formatKm, formatPace } from '../../format';
import { fontFamily, spacing, ThemeProvider } from '../../theme';
import { ResumeButton, StopButton } from '../run/RunPauseScreen';
import { useRunSession } from '../run/RunSession';
import { FooterButton } from './GroupRunDetailScreen';
import { GroupBackground, groupLook } from './look';

// 6.6c 그룹런 일시정지: pause and finish apply to my record only; the others keep running.
// runway-group-handoff: the common background (white into navy), the time, and 재개·종료 straight on it
// without a card. The leader of this run (not the crew leader) also gets 그룹 전체 강제 종료.
export function GroupRunPauseScreen() {
  const navigation = useNavigation();
  const { groupRuns } = useRepositories();
  const { run, finish } = useRunSession();
  const [isHost, setIsHost] = useState(false);
  const toast = useToast();
  const finishing = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const groupRunId = run?.config.groupRunId;

  useEffect(() => {
    if (!run && navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [navigation, run]);
  useEffect(() => {
    if (!groupRunId) {
      return;
    }
    let active = true;
    groupRuns.get(groupRunId).then(
      detail => active && setIsHost(detail.isHost),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [groupRunId, groupRuns]);

  if (!run) {
    return <View style={[styles.root, styles.ground]} />;
  }
  const { sample } = run;
  const average =
    sample.distanceM > 0 ? sample.elapsedSec / (sample.distanceM / 1000) : null;
  const toResult = () => {
    finish();
    navigation.dispatch(
      CommonActions.reset({
        index: 1,
        routes: [
          { name: 'MainTabs' },
          {
            name: 'GroupRunResult',
            params: groupRunId ? { groupRunId } : undefined,
          },
        ],
      }),
    );
  };

  return (
    // The upper part is white whatever the screen mode, so the light theme draws the buttons navy.
    <ThemeProvider tone="light">
      <View style={[styles.root, styles.ground]}>
        <StatusBar barStyle="dark-content" />
        <GroupBackground id="groupRunPauseBackground" kind="common" />
        <SafeAreaView edges={['top', 'bottom']} style={styles.layout}>
          {/* 6.6c-PauseSummary */}
          <View style={styles.summary}>
            <AppText style={styles.label}>그룹런 일시정지</AppText>
            <AppText style={styles.time} accessibilityLabel="경과 시간">
              {formatDuration(sample.elapsedSec)}
            </AppText>
            <AppText style={styles.sub}>
              {`${formatKm(sample.distanceM)}km · 평균 ${
                average === null ? '– –' : formatPace(average)
              }/km`}
            </AppText>
          </View>
          {/* 6.6c-ControlPanel: 재개 · 종료 on the background, no card. */}
          <View style={styles.actions}>
            <View style={styles.buttons}>
              <View style={styles.action}>
                <ResumeButton onPress={() => navigation.goBack()} />
                <AppText style={styles.actionText}>재개</AppText>
              </View>
              <View style={styles.action}>
                <StopButton onFinish={toResult} />
                <AppText style={styles.actionText}>종료</AppText>
              </View>
            </View>
            <AppText style={styles.hint}>
              종료는 1초 길게 눌러야 동작해요
            </AppText>
            {isHost ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="그룹 전체 강제 종료"
                onPress={() => setConfirming(true)}
                hitSlop={8}
              >
                <AppText variant="captionStrong" tone="danger">
                  그룹 전체 강제 종료
                </AppText>
              </Pressable>
            ) : null}
          </View>
          {/* White helper text on the black lower part. */}
          <ThemeProvider tone="dark">
            <View style={styles.bottom}>
              <AppText variant="body" style={styles.note}>
                {
                  '일시정지·종료는 내 기록에만 적용돼요.\n다른 멤버는 계속 달려요.'
                }
              </AppText>
            </View>
          </ThemeProvider>
        </SafeAreaView>
        <BottomSheet
          visible={confirming}
          onClose={() => setConfirming(false)}
          title="그룹런을 모두 끝낼까요?"
          description="달리고 있는 멤버의 기록도 지금까지로 끝나요. 완주로 바뀌지는 않아요."
        >
          <View style={styles.sheetButtons}>
            <FooterButton
              title="돌아가기"
              onPress={() => setConfirming(false)}
            />
            <FooterButton
              title="전체 종료"
              danger
              onPress={async () => {
                if (finishing.current || !groupRunId) return;
                finishing.current = true;
                try {
                  await groupRuns.forceFinish(groupRunId);
                  setConfirming(false);
                  toResult();
                } catch {
                  toast(
                    '전체 종료 응답을 확인하지 못했어요. 그룹 상태를 확인한 뒤 다시 시도해 주세요',
                  );
                } finally {
                  finishing.current = false;
                }
              }}
            />
          </View>
        </BottomSheet>
      </View>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  ground: { backgroundColor: groupLook.navy },
  layout: { flex: 1, paddingHorizontal: 14 },
  // The time sits on the white top (6.6c-PauseSummary at 85 of 844).
  summary: { alignItems: 'center', paddingTop: 56 },
  label: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 24,
    color: groupLook.onLightSub2,
  },
  // Big numbers stay Barlow Regular at the sheet's 100.
  time: {
    marginTop: 10,
    fontFamily: fontFamily.numberRegular,
    fontSize: 100,
    lineHeight: 104,
    letterSpacing: 1,
    color: groupLook.onLight,
  },
  sub: {
    marginTop: 6,
    fontFamily: fontFamily.regular,
    fontSize: 15,
    lineHeight: 20,
    color: groupLook.onLightSub2,
  },
  actions: { alignItems: 'center', gap: 10, paddingTop: 64 },
  buttons: { flexDirection: 'row', gap: 38 },
  action: { width: 102, alignItems: 'center', gap: 10 },
  actionText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupLook.onLight,
  },
  hint: {
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    lineHeight: 18,
    color: groupLook.onLightSub2,
  },
  bottom: { flex: 1, justifyContent: 'flex-end', paddingBottom: spacing.xxl },
  note: { textAlign: 'center' },
  sheetButtons: { flexDirection: 'row', gap: spacing.md },
});
