import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { BackButton } from '../../components/BackButton';
import { useRepositories, useResource, type Repositories } from '../../data';
import { isNight } from '../../format';
import { MapScreenFrame } from './MapScreenFrame';
import { RunMap } from '../../components/RunMap';
import { RunGoalSheet } from './goal/RunGoalSheet';
import { goalConfig, goalLabel, type RunGoal } from './goal/runGoal';
import { PlaceCard, RunStartBar } from './parts';
import { navigateTo } from '../../navigation/navigateTo';

const loadPlace = (repositories: Repositories) =>
  repositories.run.getCurrentPlace();

// The map from where you are and the start row, without the tab bar (2.0F · 2.0C). The top shows the current
// place; the bottom card holds the chip and 러닝 방식 · 러닝 시작 · 음악.
function MapStart({ bottom }: { bottom: React.ReactNode }) {
  const navigation = useNavigation();
  const { clock } = useRepositories();
  const night = isNight(clock.now());
  const place = useResource(useCallback(loadPlace, []));
  return (
    <MapScreenFrame
      renderMap={logo => (
        <RunMap
          position={place.status === 'ready' ? place.data.position : undefined}
          area={{ top: 0.36, bottom: 0.36 }}
          logo={logo}
          style={StyleSheet.absoluteFill}
        />
      )}
      top={
        <View style={styles.top}>
          <BackButton
            tone={night ? 'dark' : 'light'}
            onPress={navigation.goBack}
          />
          <View style={styles.flex}>
            {place.status === 'ready' ? (
              <PlaceCard name={place.data.name} gps={place.data.gps} />
            ) : place.status === 'error' ? (
              // A failed lookup stops saying it is still searching; a tap tries again.
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="현재 위치 다시 찾기"
                onPress={place.reload}
              >
                <PlaceCard name="못 찾았어요 · 다시 찾기" gps="none" />
              </Pressable>
            ) : (
              <PlaceCard name="현재 위치를 찾는 중이에요" gps="none" />
            )}
          </View>
        </View>
      }
      bottom={bottom}
    />
  );
}

// 2.0F 자유 러닝 (S15P31E105-517): the chip opens 운동 목표 (목표 없음 · 거리 · 시간 · 페이서); a card's start button
// starts with that goal.
export function FreeRunScreen() {
  const { clock } = useRepositories();
  const night = isNight(clock.now());
  const [goal, setGoal] = useState<RunGoal>({ kind: 'NONE' });
  const [choosing, setChoosing] = useState(false);
  const [startSignal, setStartSignal] = useState(0);

  return (
    <>
      <MapStart
        bottom={
          <RunStartBar
            night={night}
            mode="FREE"
            goal={{ label: goalLabel(goal), onPress: () => setChoosing(true) }}
            startSignal={startSignal}
            config={{ mode: 'FREE', plan: null, ...goalConfig(goal) }}
          />
        }
      />
      <RunGoalSheet
        visible={choosing}
        onClose={() => setChoosing(false)}
        mode="FREE"
        goal={goal}
        onSet={next => {
          setGoal(next);
          setChoosing(false);
        }}
        onStart={next => {
          setGoal(next);
          setChoosing(false);
          setStartSignal(value => value + 1);
        }}
      />
    </>
  );
}

// 2.0C 코스 러닝 시작 (담당자 요청): 코스 러닝 opens on the same map as 2.0F. 코스 설정 takes the conditions to 3.1 코스
// 추천, and the picked course opens 2.0 with its plan; until then 러닝 시작 waits for a course.
export function CourseStartScreen() {
  const navigation = useNavigation();
  const { clock } = useRepositories();
  const night = isNight(clock.now());
  return (
    <MapStart
      bottom={
        <RunStartBar
          night={night}
          mode="COURSE"
          goal={{
            label: '코스 설정',
            title: '코스 설정',
            onPress: () => navigateTo(navigation, 'TodayRun'),
          }}
          config={null}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
