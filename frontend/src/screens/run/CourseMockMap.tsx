import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path, Polyline, Rect, Text } from 'react-native-svg';
import type { LngLat } from '../../geo';
import { fontFamily } from '../../theme';
import {
  courseMapAlleys,
  courseMapAvenues,
  courseMapLabels,
  courseMapParks,
  courseMapRoads,
  courseMapSize,
  courseMapStreams,
  courseMapWater,
} from './courseMapArt';

// 2.0 구간 색 (runway-course-handoff): 빠름 black, 보통 navy, 느림 steel blue.
export const coursePaceColors = ['#060606', '#3A5A6C', '#8DACBA'];

const { width, height } = courseMapSize;

// The 2.0·2.0F day map of runway-course-handoff (지도 스타일): a race-course map in thin lines. Like the
// rest of MockMap it is a stand-in until the map SDK lands (S15P31E105-180), so the streets are fixed.
export function CourseMockMap({
  project,
  parts,
  colors,
  paceLabels,
  position,
}: {
  project: (point: LngLat) => { x: number; y: number };
  // The course split per km; empty without a course.
  parts: LngLat[][];
  colors: string[];
  // One label per part, or none.
  paceLabels: string[] | null;
  position?: LngLat;
}) {
  const toPoints = (line: LngLat[]) =>
    line
      .map(point => {
        const { x, y } = project(point);
        return `${x},${y}`;
      })
      .join(' ');
  const start = parts.length > 0 ? project(parts[0][0]) : null;
  const here = position && parts.length === 0 ? project(position) : null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid slice"
      >
        <Rect width={width} height={height} fill="#F3F5F6" />
        {courseMapParks.map(([x, y, w, h]) => (
          <Rect
            key={`${x}-${y}`}
            x={x}
            y={y}
            width={w}
            height={h}
            rx={6}
            fill="#E2EAEE"
          />
        ))}
        <G stroke="#8DACBA" strokeOpacity={0.5} strokeWidth={0.9} fill="none">
          {courseMapAlleys.map(d => (
            <Path key={d} d={d} />
          ))}
        </G>
        <G stroke="#A4BDC9" strokeOpacity={0.8} strokeWidth={1} fill="none">
          {courseMapStreams.map(d => (
            <Path key={d} d={d} />
          ))}
        </G>
        <G stroke="#7DA0B2" strokeOpacity={0.6} strokeWidth={1.4} fill="none">
          {courseMapRoads.map(d => (
            <Path key={d} d={d} />
          ))}
        </G>
        <G stroke="#5D8194" strokeOpacity={0.55} strokeWidth={2.2} fill="none">
          {courseMapAvenues.map(d => (
            <Path key={d} d={d} />
          ))}
        </G>
        {/* The sea covers the streets under it. */}
        <Path d={courseMapWater} fill="#C4D4DC" />
        {/* The course: a hollow line, the segment color outside a thin near-white core. */}
        {parts.map((part, index) => (
          <Polyline
            key={`outer-${index}`}
            points={toPoints(part)}
            stroke={colors[index]}
            strokeWidth={7}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {parts.map((part, index) => (
          <Polyline
            key={`inner-${index}`}
            points={toPoints(part)}
            stroke="#F9F9F9"
            strokeWidth={2}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {courseMapLabels.map(label => (
          <Text
            key={label.text}
            transform={`translate(${label.x} ${label.y}) rotate(${label.rotate})`}
            fontFamily={fontFamily.bold}
            fontSize={8.5}
            letterSpacing={label.water ? 3 : 1.4}
            fill={label.water ? '#3A5A6C' : '#5D8194'}
            fillOpacity={label.water ? 0.7 : 0.85}
          >
            {label.text}
          </Text>
        ))}
        {/* 구간 페이스 알약: black, a pale number circle on the left. */}
        {paceLabels
          ? parts.map((part, index) => {
              const middle = project(part[Math.floor(part.length / 2)]);
              const label = paceLabels[index];
              const pill = 40 + label.length * 9.5;
              const left = middle.x - pill / 2;
              return (
                <G key={`pace-${index}`}>
                  <Rect
                    x={left}
                    y={middle.y - 13}
                    width={pill}
                    height={26}
                    rx={13}
                    fill="#060606"
                  />
                  <Circle cx={left + 13} cy={middle.y} r={9} fill="#C4D4DC" />
                  <Text
                    x={left + 13}
                    y={middle.y + 4}
                    fontFamily={fontFamily.bold}
                    fontSize={11}
                    fill="#060606"
                    textAnchor="middle"
                  >
                    {index + 1}
                  </Text>
                  <Text
                    x={left + 28}
                    y={middle.y + 5.5}
                    fontFamily={fontFamily.bold}
                    fontSize={15}
                    fill="#FFFFFF"
                  >
                    {label}
                  </Text>
                </G>
              );
            })
          : null}
        {start ? (
          <G>
            <Circle
              cx={start.x}
              cy={start.y}
              r={11}
              fill="#060606"
              stroke="#FFFFFF"
              strokeWidth={2}
            />
            <Text
              x={start.x}
              y={start.y + 3}
              fontFamily={fontFamily.bold}
              fontSize={8}
              fill="#FFFFFF"
              textAnchor="middle"
            >
              SF
            </Text>
          </G>
        ) : null}
        {here ? (
          <G>
            <Circle
              cx={here.x}
              cy={here.y}
              r={24}
              fill="rgba(58,90,108,0.16)"
              stroke="rgba(58,90,108,0.18)"
              strokeWidth={1}
            />
            <Circle
              cx={here.x}
              cy={here.y}
              r={8.5}
              fill="#060606"
              stroke="#FFFFFF"
              strokeWidth={3}
            />
          </G>
        ) : null}
      </Svg>
    </View>
  );
}
