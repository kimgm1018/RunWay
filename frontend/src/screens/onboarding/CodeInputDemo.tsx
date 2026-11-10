import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useReduceMotion } from '../../components';
import { fontFamily } from '../../theme';
import { CodeInput, type CodeInputStatus } from './CodeInput';

// 인증번호 입력 시연(S15P31E105-646, 공통 컴포넌트 화면). "482913"만 맞는 가짜 확인과, 문자 자동입력 칩을 누르면
// 숫자가 한 번에 들어오는 경우(앞 칸부터 하나씩 굴려 채움)를 보여 준다. 앱 화면에는 칩이 없고 키보드 자동완성을 쓴다.
const DEMO_CODE = '482913';

export function CodeInputDemo() {
  const reduce = useReduceMotion();
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<CodeInputStatus>('entering');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
  }, []);

  const change = (next: string) => {
    setValue(next);
    if (next.length < 6) {
      if (status === 'error') {
        setStatus('entering');
      }
      return;
    }
    setStatus('verifying');
    setError(null);
    // 가짜 확인: 서버 응답을 기다리는 것처럼 잠깐 뒤 결과를 낸다.
    timer.current = setTimeout(() => {
      if (next === DEMO_CODE) {
        setStatus('success');
      } else {
        setValue('');
        setError('인증번호가 일치하지 않아요');
        setStatus('error');
      }
    }, 1200);
  };

  const showChip = value.length === 0 && status !== 'success' && status !== 'verifying';
  const chip = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    chip.setValue(0);
    if (showChip) {
      Animated.timing(chip, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [chip, showChip]);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>인증번호를 입력해주세요</Text>
      <Text style={styles.sub}>남은 시간 03:00</Text>
      <View style={styles.tiles}>
        <CodeInput
          value={value}
          onChangeText={change}
          status={status}
          error={error}
        />
      </View>
      {showChip ? (
        <Animated.View
          style={{
            opacity: chip,
            transform: reduce
              ? []
              : [
                  {
                    translateY: chip.interpolate({
                      inputRange: [0, 1],
                      outputRange: [6, 0],
                    }),
                  },
                ],
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`메시지에서 받은 인증번호 ${DEMO_CODE} 넣기`}
            onPress={() => change(DEMO_CODE)}
            style={styles.chip}
          >
            <Text style={styles.chipFrom}>메시지에서 · </Text>
            <Text style={styles.chipCode}>482 913</Text>
          </Pressable>
        </Animated.View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="시연 처음부터"
        onPress={() => {
          if (timer.current) {
            clearTimeout(timer.current);
          }
          setValue('');
          setError(null);
          setStatus('entering');
        }}
        hitSlop={8}
      >
        <Text style={styles.reset}>처음부터</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 12,
    borderRadius: 24,
    backgroundColor: '#F7F6F4',
  },
  title: { fontFamily: fontFamily.medium, fontSize: 18, lineHeight: 26, color: '#061216' },
  sub: {
    marginTop: 4,
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 18,
    color: 'rgba(6,18,22,0.6)',
  },
  tiles: { marginTop: 24, alignSelf: 'stretch' },
  chip: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  chipFrom: { fontFamily: fontFamily.regular, fontSize: 11.5, color: 'rgba(6,18,22,0.6)' },
  chipCode: {
    fontFamily: fontFamily.numberSemiBold,
    fontSize: 12,
    color: '#061216',
    fontVariant: ['tabular-nums'],
  },
  reset: {
    marginTop: 16,
    fontFamily: fontFamily.regular,
    fontSize: 12,
    color: 'rgba(6,18,22,0.6)',
    textDecorationLine: 'underline',
  },
});
