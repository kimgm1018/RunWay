// Only this web-script test loads Node built-ins; the mobile tsconfig excludes Node globals.
const fs = jest.requireActual('fs') as {
  readFileSync: (p: string, e: string) => string;
};
const path = jest.requireActual('path') as { resolve: (p: string) => string };
const vm = jest.requireActual('vm') as {
  runInNewContext: (s: string, c: object) => unknown;
};
const parts = [
  [
    [129.1, 35.15],
    [129.101, 35.15],
  ],
  [
    [129.103, 35.15],
    [129.104, 35.15],
  ],
];

class Element {
  style: Record<string, unknown> = {};
  children: Element[] = [];
  className = '';
  textContent = '';
  hidden = false;
  src = '';
  onload?: () => void;
  onerror?: () => void;
  constructor(public tagName = 'div') {}
  appendChild(child: Element) {
    this.children.push(child);
    return child;
  }
}
async function boot(
  photo: string | null = '/api/v1/images/synthetic-avatar',
  gl = true,
  mapThrows = false,
  routeParts = parts,
) {
  const html = fs.readFileSync(path.resolve('landing/share.html'), 'utf8');
  const elements = new Map<string, Element>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id)!;
  };
  const lines: Polyline[] = [],
    markers: Marker[] = [];
  const frames = new Map<number, (t: number) => void>(),
    timers = new Map<number, () => void>();
  const events: Array<{
    target: object;
    name: string;
    callback: () => void;
    once: boolean;
  }> = [];
  let next = 0,
    map!: MapView,
    scriptUrl = '';
  const engine = {
    easeTo: jest.fn(),
    jumpTo: jest.fn(),
    stop: jest.fn(),
    loaded: () => false,
    getCenter: () => ({ lng: 129.102, lat: 35.15 }),
    getZoom: () => 14,
    getPadding: () => ({ top: 140, bottom: 360, left: 40, right: 40 }),
    once: (name: string, callback: () => void) =>
      events.push({ target: engine, name, callback, once: true }),
  };
  class LatLng {
    constructor(public latitude: number, public longitude: number) {}
    lat() {
      return this.latitude;
    }
    lng() {
      return this.longitude;
    }
  }
  class Bounds {
    extend() {}
    getCenter() {
      return new LatLng(35.15, 129.102);
    }
  }
  class MapView {
    ready = false;
    fitBounds = jest.fn();
    morph = jest.fn();
    constructor(public id: string, public options: Record<string, any>) {
      if (mapThrows)
        throw new TypeError('Synthetic map initialization failure');
      map = this;
    }
    getMapbox() {
      return gl ? engine : null;
    }
  }
  class Marker {
    position: LatLng;
    map: object | null;
    constructor(public options: Record<string, any>) {
      this.position = options.position;
      this.map = options.map;
      markers.push(this);
    }
    setPosition(p: LatLng) {
      this.position = p;
    }
    setMap(m: object | null) {
      this.map = m;
    }
  }
  class Polyline {
    drawn: LatLng[] = [];
    constructor(public options: Record<string, any>) {
      // GL creates its overlay manager asynchronously, when the map is ready.
      if (gl && !map.ready) throw new TypeError('Overlay manager is not ready');
      lines.push(this);
    }
    setPath = jest.fn((p: LatLng[]) => {
      this.drawn = p;
    });
  }
  class Point {}
  class Size {}
  const naver = {
    maps: {
      LatLng,
      LatLngBounds: Bounds,
      Map: MapView,
      Marker,
      Point,
      Size,
      Polyline,
      MapTypeId: { NORMAL: 'normal' },
      Position: { TOP_RIGHT: 'top-right' },
      Event: {
        addListener: (target: object, name: string, callback: () => void) =>
          events.push({ target, name, callback, once: false }),
        once: (target: object, name: string, callback: () => void) =>
          events.push({ target, name, callback, once: true }),
      },
    },
  };
  const windowEvents = new Map<string, () => void>();
  const window: Record<string, any> = {
    naver,
    innerHeight: 800,
    innerWidth: 400,
    addEventListener: (name: string, callback: () => void) =>
      windowEvents.set(name, callback),
  };
  const fire = (target: object, name: string) => {
    for (const e of events.filter(
      e => e.target === target && e.name === name,
    )) {
      if (e.once) events.splice(events.indexOf(e), 1);
      e.callback();
    }
  };
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1], {
    location: {
      pathname: '/r/' + 'a'.repeat(43),
      href: 'https://example.test/r/' + 'a'.repeat(43),
      host: 'example.test',
    },
    navigator: { userAgent: 'Test browser' },
    window,
    naver,
    document: {
      getElementById: element,
      createElement: (tag: string) => new Element(tag),
      body: { classList: { add() {}, remove() {} } },
      head: {
        appendChild: (node: Element) => {
          scriptUrl = node.src;
          const cb = /[?&]callback=([^&]+)/.exec(node.src)?.[1];
          if (cb) window[cb]();
          else node.onload?.();
        },
      },
    },
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        title: 'Synthetic run',
        runner: { nickname: 'Runner', profileImageUrl: photo },
        startedAt: '2026-11-12T00:00:00Z',
        averagePaceSecPerKm: 400,
        distanceM: 400,
        durationSec: 160,
        cadence: 160,
        segments: routeParts.map(coordinates => ({ coordinates })),
      }),
    }),
    requestAnimationFrame: (callback: (t: number) => void) => {
      const id = ++next;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    setTimeout: (callback: () => void) => {
      const id = ++next;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id: number) => timers.delete(id),
  });
  await new Promise<void>(resolve => setImmediate(resolve));
  return {
    map,
    engine,
    lines,
    markers,
    frames,
    timers,
    element,
    scriptUrl,
    windowEvent: (name: string) => windowEvents.get(name)?.(),
    ready: () => {
      map.ready = true;
      fire(map, 'init');
      fire(engine, 'idle');
      fire(map, 'idle');
    },
    click: () => fire(map, 'click'),
    frame: (t: number) => {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const cb of callbacks) cb(t);
    },
  };
}
type Env = Awaited<ReturnType<typeof boot>>;
const painted = (e: Env) => e.lines.filter(l => l.drawn.length > 0);
function playing(e: Env) {
  e.ready();
  e.frame(0);
  e.frame(1500);
  e.frame(4000);
}
function descendants(e: Element): Element[] {
  return [e, ...e.children.flatMap(descendants)];
}

test('whole route is shown before the 60 degree intro and following camera', async () => {
  const e = await boot();
  expect(e.scriptUrl).toContain('submodules=gl');
  expect(e.map.options.gl).toBe(true);
  expect(e.engine.easeTo).not.toHaveBeenCalled();
  e.ready();
  e.frame(0);
  expect(painted(e)).toHaveLength(8);
  expect(e.element('km').textContent).toBe('0.00');
  e.frame(1499);
  expect(e.engine.easeTo).not.toHaveBeenCalled();
  e.frame(1500);
  expect(painted(e)).toHaveLength(0);
  expect(e.engine.easeTo).toHaveBeenCalledWith(
    expect.objectContaining({ pitch: 60, zoom: 16.6, duration: 2200 }),
  );
  e.frame(4000);
  e.frame(6000);
  expect(e.engine.jumpTo).toHaveBeenLastCalledWith(
    expect.objectContaining({ pitch: 60, zoom: 16.6 }),
  );
});

test('camera and trail advance together on consecutive display frames without restarting easing', async () => {
  const e = await boot();
  playing(e);
  const eased = e.engine.easeTo.mock.calls.length;
  e.frame(4016);
  const first = e.engine.jumpTo.mock.calls.at(-1)?.[0].center;
  e.frame(4032);
  const second = e.engine.jumpTo.mock.calls.at(-1)?.[0].center;
  expect(first).toBeDefined();
  expect(second[0]).toBeGreaterThan(first[0]);
  const head = painted(e)[0].drawn.at(-1)!;
  expect(second).toEqual([head.longitude, head.latitude]);
  expect(e.engine.easeTo).toHaveBeenCalledTimes(eased);
  expect(e.frames.size).toBe(1);
});

test('web replay removes GPS spikes using the community route smoothing while preserving endpoints', async () => {
  const raw = [
    [
      [129.1, 35.15],
      [129.1001, 35.15],
      [129.1002, 35.16],
      [129.1003, 35.15],
      [129.1004, 35.15],
    ],
  ];
  const e = await boot(null, true, false, raw);
  e.ready();
  e.frame(0);
  const points = painted(e)[0].drawn;
  expect(points).toHaveLength(4);
  expect(points.every(p => p.latitude === 35.15)).toBe(true);
  expect([points[0].longitude, points.at(-1)!.longitude]).toEqual([
    129.1, 129.1004,
  ]);
});

test('finished route parts are not rebuilt while only the current part advances', async () => {
  const e = await boot();
  playing(e);
  e.frame(10000);
  const completedCalls = e.lines
    .slice(0, 4)
    .map(line => line.setPath.mock.calls.length);
  e.frame(10016);
  e.frame(10032);
  expect(
    e.lines.slice(0, 4).map(line => line.setPath.mock.calls.length),
  ).toEqual(completedCalls);
});

test('a valid point between successive GPS spikes is retained like the app', async () => {
  const raw = [
    [
      [129.1, 35.15],
      [129.1002, 35.16],
      [129.1004, 35.15],
      [129.1005, 35.16005],
      [129.1008, 35.15],
    ],
  ];
  const e = await boot(null, true, false, raw);
  e.ready();
  e.frame(0);
  expect(painted(e)[0].drawn).toHaveLength(3);
});

test('map initialization failures preserve the run and bottom actions', async () => {
  const e = await boot(null, true, true);
  expect(e.element('title').textContent).toBe('Synthetic run');
  expect(e.element('noticeText').textContent).toBe('');
  expect(e.element('hint').textContent).toContain('지도 생성');
});

test('browser back restores a paused replay without losing its progress', async () => {
  const e = await boot();
  playing(e);
  e.frame(6000);
  e.windowEvent('pagehide');
  expect(e.frames.size).toBe(0);
  e.windowEvent('pageshow');
  expect(e.element('hint').textContent).toContain('계속 재생');
  e.click();
  e.frame(20000);
  e.frame(22000);
  expect(e.element('km').textContent).toBe('0.20');
});

test('raster fallback keeps the profile marker on the actual route head', async () => {
  const e = await boot(null, false);
  playing(e);
  e.frame(6000);
  expect(e.element('runnerFixed').hidden).toBe(true);
  expect(e.markers[0].map).toBe(e.map);
  expect(e.map.morph).toHaveBeenCalled();
});
test('all four layers stay within each measured part and never bridge its gap', async () => {
  const e = await boot();
  playing(e);
  e.frame(12000);
  expect(painted(e)).toHaveLength(8);
  for (const p of parts) {
    const layers = painted(e).filter(l => l.drawn[0].longitude === p[0][0]);
    expect(layers.map(l => l.options.strokeColor)).toEqual([
      '#003A2C',
      '#00785A',
      '#B3FFEC',
      '#4DFFD2',
    ]);
    expect(layers.map(l => l.options.strokeWeight)).toEqual([
      18, 12.2, 9.3, 6.9,
    ]);
    for (const l of layers) {
      expect(l.options.strokeOpacity).toBe(1);
      expect(l.drawn.map(p => [p.longitude, p.latitude])).toEqual(p);
    }
  }
});
test('rapid clicks pause and resume progress with one animation loop', async () => {
  const e = await boot();
  playing(e);
  e.frame(6000);
  const before = JSON.stringify(painted(e).map(l => l.drawn));
  expect(e.element('km').textContent).toBe('0.10');
  e.click();
  expect(e.frames.size).toBe(0);
  expect(e.element('hint').textContent).toContain('계속 재생');
  e.click();
  e.click();
  expect(e.frames.size).toBe(0);
  expect(JSON.stringify(painted(e).map(l => l.drawn))).toBe(before);
  e.click();
  expect(e.frames.size).toBe(1);
  e.frame(20000);
  e.frame(22000);
  expect(e.element('km').textContent).toBe('0.20');
  expect(e.frames.size).toBe(1);
});
test('finish returns to overview and a replay clears old progress before drawing again', async () => {
  const e = await boot();
  playing(e);
  e.frame(12000);
  e.frame(12600);
  expect(e.engine.easeTo).toHaveBeenLastCalledWith(
    expect.objectContaining({ pitch: 0, bearing: 0, duration: 2400 }),
  );
  e.frame(15000);
  expect(e.frames.size).toBe(0);
  expect(e.element('hint').textContent).toContain('다시 재생');
  e.click();
  e.frame(16000);
  e.frame(16300);
  expect(painted(e)).toHaveLength(0);
  expect(e.element('km').textContent).toBe('0.00');
  expect(e.frames.size).toBe(1);
});
test('map and following pins use the sharer photo with a failed-image fallback', async () => {
  const e = await boot();
  e.ready();
  for (const pin of [
    e.markers[0].options.icon.content,
    e.element('runnerFixed'),
  ]) {
    const nodes = descendants(pin),
      img = nodes.find(n => n.tagName === 'img')!;
    expect(img.src).toBe('/api/v1/images/synthetic-avatar');
    img.onerror!();
    expect(img.hidden).toBe(true);
    expect(nodes.find(n => n.textContent === 'R')?.hidden).toBe(false);
  }
});
test('absent and unsafe avatar URLs keep the nickname fallback', async () => {
  for (const photo of [null, 'javascript:alert(1)']) {
    const e = await boot(photo);
    e.ready();
    const nodes = descendants(e.markers[0].options.icon.content);
    expect(nodes.filter(n => n.tagName === 'img')).toHaveLength(0);
    expect(nodes.some(n => n.textContent === 'R')).toBe(true);
  }
});
