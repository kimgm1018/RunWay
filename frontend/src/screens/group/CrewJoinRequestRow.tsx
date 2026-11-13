import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, DefaultAvatar, PressableScale } from '../../components';
import {
  useRepositories,
  type CrewJoinRequest,
  type SelfReportedLevel,
} from '../../data';
import {
  formatDotDate,
  formatPace,
  formatRelative,
  isSameDay,
} from '../../format';
import { fontFamily } from '../../theme';
import { PhotoOr } from './parts';
import { groupTone, NumText } from './look';

const levelLabels: Record<SelfReportedLevel, string> = {
  BEGINNER: '초급',
  INTERMEDIATE: '중급',
  ADVANCED: '고급',
};

// 중급 · 최근 5km 5′56″ · 3분 전 신청, or 초급 · 첫 크루 · 10.17 신청.
function requestLine(request: CrewJoinRequest, now: Date) {
  const when = isSameDay(request.requestedAt, now)
    ? `${formatRelative(request.requestedAt, now)} 신청`
    : `${formatDotDate(request.requestedAt)} 신청`;
  return [
    request.level ? levelLabels[request.level] : null,
    request.recent5kPaceSecPerKm
      ? `최근 5km ${formatPace(request.recent5kPaceSecPerKm)}`
      : null,
    request.firstCrew ? '첫 크루' : null,
    when,
  ]
    .filter(Boolean)
    .join(' · ');
}

// One request as its own faint white panel on the navy page (S15P31E105-594 담당자 시안): the name on top,
// then its line with 거절 quiet and 승인 in the mockup's mint (navy text) on the right. The line keeps the date in it (중급 · 최근 5km 5′56″ · 3분 전 신청), so it is not
// split off to the top right as in the mockup. Without a photo the default profile picture stands by the
// name, as everywhere else (S15P31E105-775).
// Shared by 6.2a 가입 신청 관리 and the leader's 6.2 크루 상세 (S15P31E105-678).
export function CrewJoinRequestRow({
  request,
  canApprove,
  busy,
  onDecide,
}: {
  request: CrewJoinRequest;
  canApprove: boolean;
  busy: boolean;
  onDecide: (approve: boolean) => void;
}) {
  const { clock } = useRepositories();
  return (
    <View style={styles.card}>
      {/* The applicant's photo by the name (S15P31E105-636), or the default one (S15P31E105-775). */}
      <View style={styles.photoRow}>
        <PhotoOr
          photo={request.profileImageUrl}
          size={32}
          fallback={<DefaultAvatar size={32} />}
        />
        <AppText style={[styles.name, styles.flex]}>
          {request.loginId
            ? `${request.nickname} · ${request.loginId}`
            : request.nickname}
        </AppText>
      </View>
      <View style={styles.requestBottom}>
        <NumText
          text={requestLine(request, clock.now())}
          style={[styles.cardSub, styles.flex]}
        />
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${request.nickname} 거절`}
          disabled={busy}
          onPress={() => onDecide(false)}
        >
          <View style={[styles.decide, styles.decideQuiet]}>
            <AppText style={styles.decideTextLight}>거절</AppText>
          </View>
        </PressableScale>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${request.nickname} 승인`}
          accessibilityState={{ disabled: !canApprove }}
          disabled={busy || !canApprove}
          onPress={() => onDecide(true)}
          style={[!canApprove && styles.locked]}
        >
          <View style={[styles.decide, styles.decideMint]}>
            <AppText style={styles.decideTextOnMint}>승인</AppText>
          </View>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // A faint white panel with a faint white rim on the navy page.
  card: {
    gap: 10,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: groupTone.cardLine,
    backgroundColor: groupTone.card,
  },
  name: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 23,
    color: groupTone.text,
  },
  cardSub: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 19,
    color: groupTone.sub,
  },
  requestBottom: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  decide: {
    height: 34,
    paddingHorizontal: 16,
    borderRadius: 10,
    justifyContent: 'center',
  },
  decideMint: { backgroundColor: groupTone.accent },
  decideQuiet: { backgroundColor: groupTone.quiet },
  decideTextOnMint: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: groupTone.onAccent,
  },
  decideTextLight: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 19,
    color: groupTone.text,
  },
  locked: { opacity: 0.5 },
});
