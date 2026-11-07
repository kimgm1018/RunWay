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

const loadPlace = (repositories: Repositories) =>
  repositories.run.getCurrentPlace();

// 2.0F 자유 러닝 (S15P31E105-517): the map from where you are, a goal chip and the start row, without the tab
// bar. The chip opens 운동 목표 (목표 없음 · 거리 · 시간 · 페이서); a card's start button starts with that goal.
export function FreeRunScreen() {
  const navigation = useNavigation();
  const { clock } = useRepositories();
  const night = isNight(clock.now());
  const place = useResource(useCallback(loadPlace, []));
  const [goal, setGoal] = useState<RunGoal>({ kind: 'NONE' });
  const [choosing, setChoosing] = useState(false);
  const [startSignal, setStartSignal] = useState(0);

  return (
    <>
      <MapScreenFrame
        renderMap={logo => (
          <RunMap
            position={
              place.status === 'ready' ? place.data.position : undefined
            }
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
        bottom={
          <RunStartBar
            night={night}
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
