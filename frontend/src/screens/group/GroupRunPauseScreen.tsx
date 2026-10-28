import React, { useEffect, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, View } from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, BottomSheet, Icon } from '../../components';
import { useRepositories } from '../../data';
import { formatDuration, formatKm, formatPace } from '../../format';
import { spacing, typography, useTheme } from '../../theme';
import { MockMap } from '../run/MockMap';
import { StopButton } from '../run/RunPauseScreen';
import { useRunSession } from '../run/RunSession';
import { FooterButton } from './GroupRunDetailScreen';

const buttonSize = 88;

// 6.6c 그룹런 일시정지: pause and finish apply to my record only; the others keep running.
// The leader of this run (not the crew leader) also gets 그룹 전체 강제 종료.
export function GroupRunPauseScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { groupRuns } = useRepositories();
  const { run, finish } = useRunSession();
  const [isHost, setIsHost] = useState(false);
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
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]} />
    );
  }
  const { sample, trail, config } = run;
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
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <MockMap
        night
        route={config.plan?.route}
        trail={trail.length > 0 ? trail : undefined}
        routeArea={{ top: 200, bottom: 520 }}
      />
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
      />
      <SafeAreaView edges={['top', 'bottom']} style={styles.layout}>
        <View style={styles.center}>
          <AppText variant="heading" tone="accentText">
            그룹런 일시정지
          </AppText>
          <AppText style={styles.time} accessibilityLabel="경과 시간">
            {formatDuration(sample.elapsedSec)}
          </AppText>
          <AppText variant="body" tone="textSecondary">
            {`${formatKm(sample.distanceM)}km · 평균 ${
              average === null ? '– –' : formatPace(average)
            }/km`}
          </AppText>
        </View>
        <View style={styles.actions}>
          <View style={styles.buttons}>
            <View style={styles.action}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="재개"
                onPress={() => navigation.goBack()}
                style={({ pressed }) => [
                  styles.round,
                  { backgroundColor: colors.accent },
                  pressed && styles.pressed,
                ]}
              >
                <Icon name="play" color={colors.onAccent} size={30} />
              </Pressable>
              <AppText variant="captionStrong">재개</AppText>
            </View>
            <View style={styles.action}>
              <StopButton onFinish={toResult} />
              <AppText variant="captionStrong">종료</AppText>
            </View>
          </View>
          <AppText variant="caption" tone="textTertiary">
            종료는 1초 길게 눌러야 동작해요
          </AppText>
          <AppText variant="body" tone="textSecondary" style={styles.note}>
            {'일시정지·종료는 내 기록에만 적용돼요.\n다른 멤버는 계속 달려요.'}
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
      </SafeAreaView>
      <BottomSheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        title="그룹런을 모두 끝낼까요?"
        description="달리고 있는 멤버의 기록도 지금까지로 끝나요. 완주로 바뀌지는 않아요."
      >
        <View style={styles.sheetButtons}>
          <FooterButton title="돌아가기" onPress={() => setConfirming(false)} />
          <FooterButton
            title="전체 종료"
            danger
            onPress={async () => {
              setConfirming(false);
              if (groupRunId) {
                await groupRuns.forceFinish(groupRunId);
              }
              toResult();
            }}
          />
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  layout: { flex: 1, justifyContent: 'space-between' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  time: { ...typography.metricHero, fontSize: 80, lineHeight: 88 },
  actions: {
    alignItems: 'center',
    gap: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  buttons: { flexDirection: 'row', gap: spacing.xxxl * 2 },
  action: { alignItems: 'center', gap: spacing.lg },
  round: {
    width: buttonSize,
    height: buttonSize,
    borderRadius: buttonSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
  note: { textAlign: 'center' },
  sheetButtons: { flexDirection: 'row', gap: spacing.md },
});
