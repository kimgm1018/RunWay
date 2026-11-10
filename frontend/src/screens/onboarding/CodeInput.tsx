import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useReduceMotion } from '../../components';
import { fontFamily } from '../../theme';

// 인증번호 6자리 입력(S15P31E105-646). 회원가입(1.3)과 비밀번호 찾기(1.2q)가 같이 쓴다. 화면에 보이지 않는 입력란
// 하나가 값을 받고, 타일 6칸(3+3)은 그 값을 보여 주기만 한다. 상태는 부르는 쪽이 정하고(입력·확인 중·성공·실패·잠김),
// 이 컴포넌트는 그 사이의 움직임만 맡는다: 숫자 올라오기·빠지기, 활성 테두리 미끄러짐, 6자리 입력 뒤 점으로 모이기,
// 성공 체크 그리기, 실패 흔들림. 동작 줄이기(reduce motion)면 앱 움직임 기준(Motion.tsx)대로 움직임 없이 마지막
// 상태를 바로 보인다.
// React Native에는 글자 흐림(blur)이 없어 시안의 blur는 투명도·이동으로 대신한다.

export type CodeInputStatus =
  | 'entering'
  | 'verifying'
  | 'success'
  | 'error'
  | 'locked';

const LENGTH = 6;
const GAP = 8;
const GROUP_GAP = 18;
const MAX_TILE = 44;
const INK = '#061216';
const MUTED = 'rgba(6,18,22,0.6)';
const ERROR = '#B2533B';
// 키보드 문자 자동완성처럼 여러 자리가 한 번에 들어오면 앞 칸부터 이 간격으로 하나씩 채운다.
const FILL_STEP_MS = 60;
const ROLL_MS = 320;
// 6자리를 다 채운 뒤 점으로 모이기 전 잠깐 멈춘다.
const COLLAPSE_DELAY_MS = 150;
const COLLAPSE_MS = 360;
const CHECK_MS = 350;
const SHAKE_MS = 300;

function tileGeometry(width: number) {
  const tile = Math.min(
    MAX_TILE,
    Math.floor((width - (LENGTH - 2) * GAP - GROUP_GAP) / LENGTH),
  );
  const height = Math.round((tile * 52) / 44);
  const xs = Array.from({ length: LENGTH }, (_, index) => {
    const group = index < 3 ? 0 : 1;
    const inGroup = index % 3;
    return group * (3 * tile + 2 * GAP + GROUP_GAP) + inGroup * (tile + GAP);
  });
  const total = xs[LENGTH - 1] + tile;
  return { tile, height, xs, total };
}

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  status: CodeInputStatus;
  // 타일 아래 빨간 안내(오답·만료 등). 성공·확인 중에는 보이지 않는다.
  error?: string | null;
  // 성공 체크 아래 문구.
  successText?: string;
  accessibilityLabel?: string;
  autoFocus?: boolean;
  // 체크 그리기가 끝난 뒤 한 번 부른다(다음 단계로 넘어가기).
  onSuccess?: () => void;
};

export function CodeInput({
  value,
  onChangeText,
  status,
  error = null,
  successText = '인증 완료',
  accessibilityLabel = '인증번호 6자리',
  autoFocus = false,
  onSuccess,
}: Props) {
  const reduce = useReduceMotion();
  const input = useRef<TextInput>(null);
  const [width, setWidth] = useState(0);
  const [focused, setFocused] = useState(false);
  const geometry = useMemo(() => tileGeometry(width), [width]);

  // ── 보이는 값: 한 번에 여러 자리가 들어오면 FILL_STEP_MS마다 한 칸씩 드러낸다(문자 자동완성).
  const [shown, setShown] = useState(value.length);
  const [rolled, setRolled] = useState<Set<number>>(new Set());
  const previous = useRef(value);
  const [leaving, setLeaving] = useState<
    { index: number; char: string; key: number }[]
  >([]);
  const leaveKey = useRef(0);
  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    if (value.length < before.length) {
      // 지운 칸: 숫자가 위로 빠지며 사라진다.
      const gone = before
        .slice(value.length)
        .split('')
        .map((char, offset) => ({
          index: value.length + offset,
          char,
          key: (leaveKey.current += 1),
        }));
      setLeaving(current => [...current, ...gone]);
      setShown(value.length);
      setRolled(new Set());
      return;
    }
    if (value.length - before.length <= 1 || reduce) {
      setShown(value.length);
      return;
    }
    // 여러 자리가 한 번에: 앞 칸부터 하나씩 굴려 채운다.
    const from = before.length;
    setRolled(new Set(Array.from({ length: value.length - from }, (_, i) => from + i)));
    const timers = Array.from({ length: value.length - from }, (_, step) =>
      setTimeout(() => setShown(from + step + 1), step * FILL_STEP_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [value, reduce]);
  const revealDone = shown >= value.length;
  // 마지막으로 굴린 숫자가 멈출 때까지 기다린 뒤 점으로 모인다.
  const settleMs = rolled.size > 0 && !reduce ? ROLL_MS : 0;

  // ── 확인 중·성공·실패 단계의 움직임.
  const collapse = useRef(new Animated.Value(0)).current;
  const check = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  // 'tiles' → (확인 중) 'collapsed' → (성공) 'checked'. 실패면 다시 'tiles'.
  const [stage, setStage] = useState<'tiles' | 'collapsed' | 'checked'>('tiles');
  const stageRef = useRef(stage);
  stageRef.current = stage;

  useEffect(() => {
    if (status !== 'verifying' || !revealDone) {
      return;
    }
    if (reduce) {
      collapse.setValue(1);
      setStage('collapsed');
      return;
    }
    const timer = setTimeout(() => {
      Animated.timing(collapse, {
        toValue: 1,
        duration: COLLAPSE_MS,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setStage('collapsed');
        }
      });
    }, COLLAPSE_DELAY_MS + settleMs);
    return () => clearTimeout(timer);
  }, [collapse, reduce, revealDone, settleMs, status]);

  // 확인을 기다리는 동안 점이 천천히 숨 쉰다.
  useEffect(() => {
    if (stage !== 'collapsed' || status !== 'verifying' || reduce) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 450,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, { toValue: 1, duration: 450, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduce, stage, status]);

  const notifiedSuccess = useRef(false);
  useEffect(() => {
    if (status !== 'success') {
      notifiedSuccess.current = false;
      return;
    }
    if (reduce) {
      collapse.setValue(1);
      check.setValue(1);
      setStage('checked');
      if (!notifiedSuccess.current) {
        notifiedSuccess.current = true;
        onSuccess?.();
      }
      return;
    }
    // 확인이 아주 빨리 끝나도 점으로 모인 뒤에 체크를 그린다.
    const draw = () => {
      setStage('checked');
      Animated.timing(check, {
        toValue: 1,
        duration: CHECK_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start(() => {
        if (!notifiedSuccess.current) {
          notifiedSuccess.current = true;
          onSuccess?.();
        }
      });
    };
    if (stageRef.current === 'collapsed') {
      draw();
      return;
    }
    Animated.timing(collapse, {
      toValue: 1,
      duration: COLLAPSE_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(draw);
    // onSuccess는 바뀌어도 다시 그리지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check, collapse, reduce, status]);

  useEffect(() => {
    if (status !== 'error' && status !== 'entering' && status !== 'locked') {
      return;
    }
    check.setValue(0);
    const wasCollapsed = stageRef.current !== 'tiles';
    setStage('tiles');
    if (reduce) {
      collapse.setValue(0);
      if (status === 'error') {
        input.current?.focus();
      }
      return;
    }
    Animated.timing(collapse, {
      toValue: 0,
      duration: wasCollapsed ? COLLAPSE_MS : 0,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    if (status !== 'error') {
      return;
    }
    // 실패: 펼쳐진 뒤 좌우로 짧게 흔들리고 테두리가 잠깐 빨개진다. 첫 칸에서 다시 입력한다.
    flash.setValue(1);
    Animated.sequence([
      Animated.delay(wasCollapsed ? COLLAPSE_MS : 0),
      Animated.sequence(
        [-8, 8, -6, 6, -2, 0].map(toValue =>
          Animated.timing(shake, {
            toValue,
            duration: SHAKE_MS / 6,
            useNativeDriver: true,
          }),
        ),
      ),
      Animated.timing(flash, {
        toValue: 0,
        duration: 600,
        useNativeDriver: false,
      }),
    ]).start();
    input.current?.focus();
  }, [check, collapse, flash, reduce, shake, status]);

  // 상태가 바뀔 때 화면 낭독기에 알린다(시안의 aria-live).
  useEffect(() => {
    const message =
      status === 'verifying'
        ? '인증번호를 확인하고 있어요'
        : status === 'success'
        ? successText
        : status === 'error' && error
        ? error
        : null;
    if (message) {
      AccessibilityInfo.announceForAccessibility?.(message);
    }
  }, [error, status, successText]);

  // ── 활성 테두리: 칸 사이를 미끄러져 다음 칸으로 간다.
  const editable = status === 'entering' || status === 'error';
  const active = Math.min(value.length, LENGTH - 1);
  const ringX = useRef(new Animated.Value(0)).current;
  const ringReady = useRef(false);
  useEffect(() => {
    if (width === 0) {
      return;
    }
    const to = geometry.xs[active];
    if (!ringReady.current || reduce) {
      ringReady.current = true;
      ringX.setValue(to);
      return;
    }
    Animated.spring(ringX, {
      toValue: to,
      speed: 26,
      bounciness: 4,
      useNativeDriver: true,
    }).start();
  }, [active, geometry, reduce, ringX, width]);
  const showRing =
    editable && focused && value.length < LENGTH && stage === 'tiles';

  const cursor = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!showRing) {
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(cursor, { toValue: 0, duration: 0, delay: 500, useNativeDriver: true }),
        Animated.timing(cursor, { toValue: 1, duration: 0, delay: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      cursor.setValue(1);
    };
  }, [cursor, showRing]);

  const measure = (event: LayoutChangeEvent) =>
    setWidth(event.nativeEvent.layout.width);
  const center = geometry.total / 2;
  const tileBorder = flash.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(6,18,22,0)', ERROR],
  });

  return (
    <View style={styles.root} onLayout={measure}>
      <Pressable
        accessible={false}
        onPress={() => input.current?.focus()}
        style={{ height: geometry.height, width: geometry.total }}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { transform: [{ translateX: shake }] },
          ]}
        >
          {width > 0
            ? geometry.xs.map((x, index) => {
                const toCenter = center - (x + geometry.tile / 2);
                return (
                  <Animated.View
                    key={index}
                    style={[
                      styles.tile,
                      {
                        left: x,
                        width: geometry.tile,
                        height: geometry.height,
                        borderColor: tileBorder,
                        opacity: collapse.interpolate({
                          inputRange: [0, 0.7, 1],
                          outputRange: [1, 0.5, 0],
                        }),
                        transform: reduce
                          ? []
                          : [
                              {
                                translateX: collapse.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [0, toCenter],
                                }),
                              },
                              {
                                scale: collapse.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [1, 0.2],
                                }),
                              },
                            ],
                      },
                    ]}
                  >
                    {index < shown && value[index] ? (
                      rolled.has(index) && !reduce ? (
                        <RollingDigit
                          key={`r${index}${value[index]}`}
                          digit={value[index]}
                          height={geometry.height}
                        />
                      ) : (
                        <EnteringDigit
                          key={`e${index}${value[index]}`}
                          digit={value[index]}
                          reduce={reduce}
                        />
                      )
                    ) : null}
                    {leaving
                      .filter(item => item.index === index)
                      .map(item => (
                        <LeavingDigit
                          key={item.key}
                          digit={item.char}
                          reduce={reduce}
                          onDone={() =>
                            setLeaving(current =>
                              current.filter(other => other.key !== item.key),
                            )
                          }
                        />
                      ))}
                  </Animated.View>
                );
              })
            : null}
          {width > 0 && showRing ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.ring,
                {
                  width: geometry.tile,
                  height: geometry.height,
                  transform: [{ translateX: ringX }],
                },
              ]}
            >
              {value.length < LENGTH ? (
                <Animated.View style={[styles.cursor, { opacity: cursor }]} />
              ) : null}
            </Animated.View>
          ) : null}
        </Animated.View>
        {width > 0 && stage !== 'tiles' ? (
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.middle]}
          >
            {stage === 'collapsed' ? (
              <Animated.View style={[styles.dot, { opacity: pulse }]} />
            ) : (
              <SuccessCheck progress={check} reduce={reduce} />
            )}
          </View>
        ) : null}
        <TextInput
          ref={input}
          value={value}
          onChangeText={text => onChangeText(text.replace(/\D/g, '').slice(0, LENGTH))}
          editable={editable}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          inputMode="numeric"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={LENGTH}
          caretHidden
          accessibilityLabel={accessibilityLabel}
          style={styles.hidden}
        />
      </Pressable>
      {stage === 'checked' ? (
        <Animated.Text
          style={[
            styles.success,
            {
              opacity: check.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [0, 0.2, 1],
              }),
            },
          ]}
        >
          {successText}
        </Animated.Text>
      ) : error && status !== 'verifying' ? (
        <Text style={styles.error}>{error}</Text>
      ) : null}
    </View>
  );
}

function EnteringDigit({ digit, reduce }: { digit: string; reduce: boolean }) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(enter, {
      toValue: 1,
      speed: 28,
      bounciness: 3,
      useNativeDriver: true,
    }).start();
  }, [enter]);
  return (
    <Animated.Text
      style={[
        styles.digit,
        {
          opacity: enter,
          transform: reduce
            ? []
            : [
                {
                  translateY: enter.interpolate({
                    inputRange: [0, 1],
                    outputRange: [6, 0],
                  }),
                },
              ],
        },
      ]}
    >
      {digit}
    </Animated.Text>
  );
}

function LeavingDigit({
  digit,
  reduce,
  onDone,
}: {
  digit: string;
  reduce: boolean;
  onDone: () => void;
}) {
  const leave = useRef(new Animated.Value(0)).current;
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (reduce) {
      done.current();
      return;
    }
    Animated.timing(leave, {
      toValue: 1,
      duration: 150,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => done.current());
  }, [leave, reduce]);
  if (reduce) {
    return null;
  }
  return (
    <Animated.Text
      style={[
        styles.digit,
        styles.overlay,
        {
          opacity: leave.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          transform: reduce
            ? []
            : [
                {
                  translateY: leave.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -6],
                  }),
                },
              ],
        },
      ]}
    >
      {digit}
    </Animated.Text>
  );
}

// 슬롯머신처럼 0~9가 빠르게 지나가다 실제 숫자에서 멈춘다(문자 자동완성으로 한 번에 들어온 값).
function RollingDigit({ digit, height }: { digit: string; height: number }) {
  const roll = useRef(new Animated.Value(0)).current;
  const target = 10 + Number(digit);
  useEffect(() => {
    Animated.timing(roll, {
      toValue: 1,
      duration: ROLL_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [roll]);
  return (
    <View style={[styles.window, { height }]}>
      <Animated.View
        style={{
          transform: [
            {
              translateY: roll.interpolate({
                inputRange: [0, 1],
                outputRange: [0, -target * height],
              }),
            },
          ],
        }}
      >
        {Array.from({ length: target + 1 }, (_, index) => (
          <View key={index} style={[styles.cell, { height }]}>
            <Text style={styles.digit}>{index % 10}</Text>
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
const CHECK_LENGTH = 30;

function SuccessCheck({
  progress,
  reduce,
}: {
  progress: Animated.Value;
  reduce: boolean;
}) {
  return (
    <Animated.View style={reduce ? { opacity: progress } : null}>
      <Svg width={28} height={28} viewBox="0 0 28 28">
        <AnimatedPath
          d="M6 14.5 L11.5 20 L22 8.5"
          stroke={INK}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          strokeDasharray={CHECK_LENGTH}
          strokeDashoffset={
            reduce
              ? 0
              : progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [CHECK_LENGTH, 0],
                })
          }
        />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 12 },
  tile: {
    position: 'absolute',
    top: 0,
    borderRadius: 11,
    borderWidth: 1.5,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cursor: { width: 1.5, height: 22, borderRadius: 1, backgroundColor: INK },
  digit: {
    fontFamily: fontFamily.numberSemiBold,
    fontSize: 23,
    color: INK,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  overlay: { position: 'absolute' },
  window: { overflow: 'hidden', alignSelf: 'stretch' },
  cell: { alignItems: 'center', justifyContent: 'center' },
  middle: { alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: INK },
  success: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: MUTED,
  },
  error: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: ERROR,
    textAlign: 'center',
  },
  hidden: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0,
    color: 'transparent',
  },
});
