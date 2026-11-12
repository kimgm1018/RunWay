import { connectorDots, distanceM, type LngLat } from '../src/geo';

// S15P31E105-715: a pause connector is drawn as grey dots between the two course points it joins.
const from: LngLat = [129.1, 35.15];
const to: LngLat = [129.1006, 35.15];

test('the dots are evenly spaced on the line, half a gap in from each end', () => {
  const dots = connectorDots([from, to]);
  expect(dots.length).toBeGreaterThan(3);
  const gaps = dots.slice(1).map((dot, index) => distanceM(dots[index], dot));
  for (const gap of gaps) {
    expect(gap).toBeCloseTo(gaps[0], 3);
  }
  // Nothing on the course points, and the same margin at both ends (half a gap).
  expect(distanceM(from, dots[0])).toBeCloseTo(gaps[0] / 2, 3);
  expect(distanceM(dots[dots.length - 1], to)).toBeCloseTo(gaps[0] / 2, 3);
  for (const dot of dots) {
    expect(dot[1]).toBeCloseTo(from[1], 8);
  }
});

test('a short connector still has one dot in the middle, and a zero-length one has none', () => {
  const near: LngLat = [129.1, 35.15004];
  const dots = connectorDots([from, near]);
  expect(dots).toHaveLength(1);
  expect(distanceM(from, dots[0])).toBeCloseTo(distanceM(dots[0], near), 3);
  expect(connectorDots([from, from])).toEqual([]);
});
