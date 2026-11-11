import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { latinRuns } from '../../components';
import { fontFamily } from '../../theme';
import { CodeInput } from './CodeInput';
import {
  formatRemaining,
  type usePhoneVerification,
} from './usePhoneVerification';

// 인증번호 입력 단계(S15P31E105-646 시안): 제목 · 남은 시간 · 6칸 타일 · 다시 받기. 보낸 번호는 위 전화번호 칸에 있어
// 다시 쓰지 않는다(담당자 결정).
// 1.3 회원가입과 1.2q 비밀번호 찾기가 같은 모양으로 쓴다. 인증 요청·확인과 화면 흐름은 usePhoneVerification이 맡는다.

type Verification = ReturnType<typeof usePhoneVerification>;

const INK = '#061216';
const MUTED = 'rgba(6,18,22,0.6)';

function wait(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function PhoneCodeStep({ phone }: { phone: Verification }) {
  const verified = phone.phase === 'verified';
  const checking = phone.phase === 'verifying';
  return (
    <View style={styles.root}>
      {/* 인증을 마치면 제목·남은 시간은 빼고 체크와 '인증 완료'만 남긴다(담당자 결정). */}
      {verified ? null : (
        <>
          <Text style={styles.title}>인증번호를 입력해주세요</Text>
          <Text style={styles.sub}>
            {latinRuns(
              ['남은 시간 ', formatRemaining(phone.remainingSec)],
              styles.sub,
            )}
          </Text>
        </>
      )}
      <View style={[styles.tiles, verified && styles.tilesDone]}>
        <CodeInput
          value={phone.code}
          onChangeText={phone.setCode}
          status={phone.codeStatus}
          error={phone.error?.field === 'code' ? phone.error.message : null}
          autoFocus
        />
      </View>
      {verified || checking ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            phone.resendSec > 0
              ? `인증번호 다시 받기 ${wait(phone.resendSec)} 뒤`
              : '인증번호 다시 받기'
          }
          accessibilityState={{ disabled: phone.resendSec > 0 }}
          disabled={phone.resendSec > 0}
          onPress={phone.request}
          hitSlop={8}
        >
          <Text
            style={[styles.resend, phone.resendSec > 0 && styles.resendWaiting]}
          >
            {latinRuns(
              phone.resendSec > 0
                ? `인증번호 다시 받기 (${wait(phone.resendSec)})`
                : '인증번호 다시 받기',
              styles.resend,
            )}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', paddingVertical: 8 },
  title: {
    fontFamily: fontFamily.medium,
    fontSize: 18,
    lineHeight: 26,
    color: INK,
  },
  sub: {
    marginTop: 4,
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: MUTED,
    fontVariant: ['tabular-nums'],
  },
  tiles: { marginTop: 24, alignSelf: 'stretch' },
  tilesDone: { marginTop: 0 },
  resend: {
    marginTop: 12,
    fontFamily: fontFamily.medium,
    fontSize: 12.5,
    lineHeight: 18,
    color: INK,
    textDecorationLine: 'underline',
  },
  resendWaiting: { color: MUTED, textDecorationLine: 'none' },
});
