import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import type { MusicState } from '../src/data';
import { useLivePosition } from '../src/screens/run/musicParts';

// 2.7 진행바가 읽기 사이에도 재생 속도대로 움직인다(S15P31E105-398). 곡 정보는 합성 값만 쓴다.

type Playing = NonNullable<MusicState['nowPlaying']>;

const song = (patch: Partial<Playing> = {}): Playing => ({
  id: 'm1',
  title: 'Synthetic',
  subtitle: 'Synthetic Artist',
  durationSec: 200,
  positionSec: 10,
  playing: true,
  ...patch,
});

function Probe({ track }: { track: Playing | null }) {
  return <Text>{useLivePosition(track).toFixed(2)}</Text>;
}

const shown = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  Number(renderer.root.findByType(Text).props.children);

describe('useLivePosition', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-06T00:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('runs on from the last read while playing', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<Probe track={song()} />);
    });
    act(() => jest.advanceTimersByTime(2_000));
    expect(shown(renderer)).toBeCloseTo(12, 1);
  });

  it('stays put while paused', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <Probe track={song({ playing: false })} />,
      );
    });
    act(() => jest.advanceTimersByTime(3_000));
    expect(shown(renderer)).toBe(10);
  });

  it('starts over from a new read and stops at the end of the song', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<Probe track={song()} />);
    });
    act(() => jest.advanceTimersByTime(4_000));
    act(() => renderer.update(<Probe track={song({ positionSec: 198 })} />));
    expect(shown(renderer)).toBeCloseTo(198, 1);
    act(() => jest.advanceTimersByTime(5_000));
    expect(shown(renderer)).toBe(200);
  });

  it('shows 0 without a song', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<Probe track={null} />);
    });
    expect(shown(renderer)).toBe(0);
  });
});
