import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Backdrop } from '../../components';
import { k1 } from '../../theme';
import type { MusicState } from '../../data';

type Playing = NonNullable<MusicState['nowPlaying']>;

// How often a playing song's position moves on screen between reads.
const tickMs = 250;

// The position to show now (S15P31E105-398). The state is read every few seconds, so while the song plays the
// position runs on from the last read and is set right again by the next read; it stops at the song's end.
export function useLivePosition(track: Playing | null | undefined) {
  // Each read brings a new track object, which restarts the count from its position.
  const read = useRef({ track, at: Date.now() });
  if (read.current.track !== track) {
    read.current = { track, at: Date.now() };
  }
  const readAt = read.current.at;
  const [now, setNow] = useState(readAt);
  const playing = track?.playing === true;
  useEffect(() => {
    if (!playing) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [playing]);
  if (!track) {
    return 0;
  }
  const run = playing ? Math.max(0, now - readAt) / 1000 : 0;
  const at = track.positionSec + run;
  return track.durationSec ? Math.min(at, track.durationSec) : at;
}

// Album art stand-ins in K1 tones for 4.2's mini player.
const artColors: [string, string][] = [
  [k1.mid, k1.deep],
  [k1.top, k1.mid],
  [k1.mid, k1.night],
];

// Without a size the art fills its container as a square.
export function AlbumArt({ index, size }: { index: number; size?: number }) {
  const [from, to] = artColors[index % artColors.length];
  const id = `art${index % artColors.length}`;
  return (
    <View style={size ? { width: size, height: size } : styles.square}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Rect
          width={100}
          height={100}
          rx={size && size < 60 ? 22 : 14}
          fill={`url(#${id})`}
        />
      </Svg>
    </View>
  );
}

// 2.7 핸드오프 (S15P31E105-374): the dark field behind the music card, blue grey down to near black.
const darkField: [number, string][] = [
  [0, '#616A74'],
  [220 / 844, '#626B75'],
  [420 / 844, '#626B75'],
  [500 / 844, '#5B6570'],
  [560 / 844, '#4A5665'],
  [620 / 844, '#313D4C'],
  [680 / 844, '#121C29'],
  [740 / 844, '#060B14'],
  [760 / 844, '#02050E'],
  [1, '#010307'],
];

// It takes the measured size: an Svg sized in percent falls back to 300×150 on Android.
function DarkField({ width, height }: { width: number; height: number }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width={width} height={height}>
      <Defs>
        <LinearGradient id="musicField" x1="0" y1="0" x2="0" y2="1">
          {darkField.map(([offset, color]) => (
            <Stop key={offset} offset={offset} stopColor={color} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect width={width} height={height} fill="url(#musicField)" />
    </Svg>
  );
}

// The room the floating tab bar takes in the mockups; the card centers in the space above it.
const tabBarRoom = 96;

// 2.7 and 2.8 open over the run screen as one card in the middle: 2.7 on the dark field, 2.8 on the K1
// background. Tapping outside the card closes it.
export function MusicOverlay({
  dark,
  children,
}: {
  dark: boolean;
  children: React.ReactNode;
}) {
  const navigation = useNavigation();
  const [box, setBox] = useState<{ width: number; height: number } | null>(
    null,
  );
  const measure = (event: LayoutChangeEvent) =>
    setBox(event.nativeEvent.layout);
  return (
    <View style={styles.root} onLayout={measure}>
      {dark ? (
        box ? (
          <DarkField {...box} />
        ) : null
      ) : (
        <View style={StyleSheet.absoluteFill}>
          <Backdrop />
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="닫기"
        onPress={navigation.goBack}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.center} pointerEvents="box-none">
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  square: { width: '100%', aspectRatio: 1 },
  center: {
    flex: 1,
    paddingHorizontal: 10,
    paddingBottom: tabBarRoom,
    justifyContent: 'center',
  },
});
