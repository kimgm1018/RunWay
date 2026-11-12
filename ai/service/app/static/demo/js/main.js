(function (root) {
  'use strict';

  var state = {traces: [], snapshot: null, stream: null, bootId: null, serverOffsetMs: 0,
    lastMessageAtMs: null, mode: 'replay', recording: null, playbackIndex: -1, playbackSpeed: 1,
    playbackTimer: null, playing: false, restartSeen: false};
  root.__demoState = state;
  root.__demoMetrics = {renderLagMs: null};

  function byId(id) { return document.getElementById(id); }
  function show(el, visible) { if (el) el.classList.toggle('hidden', !visible); }
  function setBanner(kind, text) { root.RunwayDemoRender.setBanner(kind ? {kind: kind, text: text} : null); }
  function updateBanner() {
    var trace = state.traces[state.traces.length - 1];
    if (!trace) return;
    var banner = root.RunwayDemoLogic.bannerFor({trace: trace, nowMs: Date.now(), serverOffsetMs: state.serverOffsetMs,
      lastMessageAtMs: state.lastMessageAtMs, stage: state.snapshot && state.snapshot.stage || trace.stage});
    root.RunwayDemoRender.setBanner(banner);
  }
  function noteMessage() { state.lastMessageAtMs = Date.now(); }
  function processTrace(trace, animate, options) {
    if (!trace) return;
    state.traces = root.RunwayDemoLogic.mergeTraces(state.traces, trace);
    var cfg = options || {};
    root.RunwayDemoRender.renderTrace(trace, state.traces, {
      animate: !!animate,
      replay: cfg.replay === true,
      stage: cfg.stage || state.snapshot && state.snapshot.stage || trace.stage,
      replaySpeed: cfg.replaySpeed || state.playbackSpeed,
      modelLabel: cfg.modelLabel || state.recording && state.recording.modelLabel,
      policyVersion: cfg.policyVersion || state.recording && state.recording.policyVersion,
      restartMarker: state.restartSeen,
      serverOffsetMs: state.serverOffsetMs,
      lastMessageAtMs: state.lastMessageAtMs
    });
  }

  function addRestartMarker() {
    var list = byId('record-list');
    if (!list || list.querySelector('.restart-marker')) return;
    var marker = document.createElement('li');
    marker.className = 'restart-marker';
    marker.textContent = 'AI 재시작';
    list.insertBefore(marker, list.firstChild);
  }

  function handleSnapshot(snapshot) {
    var previousBoot = state.bootId;
    var previousTraces = state.traces.slice();
    state.bootId = snapshot.bootId || state.bootId;
    if (previousBoot && state.bootId && previousBoot !== state.bootId) state.restartSeen = true;
    state.snapshot = snapshot;
    state.serverOffsetMs = snapshot.serverTime ? Date.parse(snapshot.serverTime) - Date.now() : state.serverOffsetMs;
    state.traces = root.RunwayDemoLogic.mergeTraces(previousTraces, snapshot.traces || []);
    root.RunwayDemoRender.reset(snapshot);
    if (root.RunwayDemoLiveMap) {          // 722: 실시간 경로 지도
      root.RunwayDemoLiveMap.setRoutes(snapshot.routes || []);
      root.RunwayDemoLiveMap.setCourse(snapshot.course || null);
    }
    if (state.traces.length) {
      state.traces.forEach(function (trace) { processTrace(trace, false); });
    }
    if (state.restartSeen && !state.traces.length) addRestartMarker();
    root.RunwayDemoRender.setConnection('연결됨 · ' + (snapshot.label || '러닝 세션'));
  }

  function handleEvent(name, data) {
    noteMessage();
    if (name === 'SNAPSHOT') {
      handleSnapshot(data || {});
      return;
    }
    if (name === 'HEARTBEAT') {
      if (data && data.serverTime) state.serverOffsetMs = Date.parse(data.serverTime) - Date.now();
      root.RunwayDemoRender.setConnection('연결됨 · 실시간 대기');
      updateBanner();
      return;
    }
    if (name === 'COURSE_UPDATE') {
      // 722: 실제 경로는 같은 이벤트의 routes로 온다. course가 없는 이벤트는 코스를 지우지 않는다
      if (data && Object.prototype.hasOwnProperty.call(data, 'course')) {
        state.snapshot = Object.assign({}, state.snapshot || {}, {course: data.course || null});
        root.RunwayDemoRender.updateCourse(state.snapshot.course, state.traces[state.traces.length - 1] || null);
      }
      if (data && Array.isArray(data.routes) && root.RunwayDemoLiveMap) {
        root.RunwayDemoLiveMap.setRoutes(data.routes);
        root.RunwayDemoLiveMap.setCourse(state.snapshot && state.snapshot.course || null);
      }
      return;
    }
    if (name === 'MPC_TRACE') {
      if (data && data.bootId && state.bootId && data.bootId !== state.bootId) {
        state.bootId = data.bootId;
        state.restartSeen = true;
        addRestartMarker();
      }
      processTrace(data, true);
    }
  }

  function connectLive(token, session) {
    if (state.stream) state.stream.close();
    state.snapshot = {stage: 'L1A', label: '실시간 세션 대기', course: null};
    root.RunwayDemoRender.reset(state.snapshot);
    root.RunwayDemoRender.setHeader('예측기 연결 대기', root.RunwayDemoLogic.DEFAULT_POLICY_VERSION);
    root.RunwayDemoRender.setConnection('세션 대기 중');
    state.stream = root.RunwayDemoStream.connect({token: token, session: session,
      onEvent: handleEvent,
      onStatus: function (status) {
        if (status === 'connected') root.RunwayDemoRender.setConnection('연결됨 · 판단 기록 대기');
        else if (status === 'waiting') root.RunwayDemoRender.setConnection('세션 대기 중');
        else if (status === 'unauthorized') {
          sessionStorage.removeItem('runwayDemoToken');
          root.RunwayDemoRender.setConnection('보기 토큰이 맞지 않습니다');
          var input = byId('token-input');
          if (input) { input.value = ''; input.focus(); }
          show(byId('auth-error'), true);
          show(byId('auth-panel'), true);
        } else { root.RunwayDemoRender.setConnection('연결 끊김 · 재접속 중'); updateBanner(); }
      }});
    root.__demo = {reconnectNow: function () { if (state.stream) state.stream.reconnectNow(); }};
  }

  function loadClassicScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error('기록 스크립트를 읽지 못했습니다: ' + src)); };
      document.head.appendChild(script);
    });
  }

  async function loadRecordings() {
    // 한 파일로 묶은 콘솔(tools/build_single_html.py)은 기록을 이미 들고 있다
    if (Array.isArray(root.RunwayDemoInlineRecordings)) return root.RunwayDemoInlineRecordings;
    root.RunwayDemoRecordings = [];
    root.RunwayDemoRecordingFiles = [];
    // 기록은 다시 만들 수 있으므로 브라우저 캐시를 쓰지 않는다(예전 기록이 보이는 문제)
    var bust = '?v=' + Date.now();
    await loadClassicScript('recordings/index.js' + bust);
    var files = Array.isArray(root.RunwayDemoRecordingFiles) ? root.RunwayDemoRecordingFiles : [];
    for (var i = 0; i < files.length; i += 1) {
      var name = String(files[i]);
      if (!/^[A-Za-z0-9_-]+\.js$/.test(name)) continue;
      await loadClassicScript('recordings/' + name + bust);
    }
    return Array.isArray(root.RunwayDemoRecordings) ? root.RunwayDemoRecordings : [];
  }

  function stopPlayback() {
    state.playing = false;
    if (state.playbackTimer) clearTimeout(state.playbackTimer);
    state.playbackTimer = null;
    var button = byId('play-toggle');
    if (button) { button.textContent = '재생'; button.setAttribute('data-playing', 'false'); }
  }

  function updateProgress() {
    var input = byId('progress');
    var count = state.recording && Array.isArray(state.recording.traces) ? state.recording.traces.length : 0;
    if (input) { input.max = String(Math.max(0, count - 1)); input.value = String(Math.max(0, state.playbackIndex)); }
    var label = byId('progress-label');
    if (label) label.textContent = (state.playbackIndex < 0 ? 0 : state.playbackIndex + 1) + ' / ' + count;
  }

  // 재생 중 4× 이하에서는 라이브와 같은 전환을 보여 준다. 16×·위치 이동에서는 전환 없이 바로 그린다
  function replayAnimates() { return state.playing && state.playbackSpeed <= 4; }

  function replayOptions() {
    return {replay: true, stage: 'L3', replaySpeed: state.playbackSpeed,
      modelLabel: state.recording && state.recording.modelLabel,
      policyVersion: state.recording && state.recording.policyVersion};
  }

  function gotoReplay(index) {
    stopPlayback();
    var recording = state.recording;
    var rows = recording && Array.isArray(recording.traces) ? recording.traces : [];
    if (!rows.length) { state.playbackIndex = -1; updateProgress(); return; }
    state.playbackIndex = Math.max(0, Math.min(rows.length - 1, Number(index) || 0));
    state.traces = [];
    root.RunwayDemoRender.reset(recording.snapshot || {stage: 'L3', label: recording.label, course: null});
    for (var i = 0; i <= state.playbackIndex; i += 1) processTrace(rows[i], false, replayOptions());
    root.RunwayDemoRender.setHeader('예측기: ' + (recording.modelLabel || recording.modelVersion || '알 수 없음'), root.RunwayDemoLogic.policyVersionOf((recording.traces || [])[0], recording));
    root.RunwayDemoRender.setStage('L3', state.playbackSpeed);
    root.RunwayDemoRender.setConnection('정적 재생 · ' + (recording.label || '녹화 기록'));
    updateProgress();
  }

  function playbackDelay(fromIndex, toIndex) {
    var rows = state.recording.traces;
    var first = Date.parse(rows[fromIndex] && rows[fromIndex].inputAsOf || '');
    var second = Date.parse(rows[toIndex] && rows[toIndex].inputAsOf || '');
    var gap = Number.isFinite(first) && Number.isFinite(second) ? Math.max(0, second - first) : 5000;
    return Math.max(100, gap / Math.max(1, state.playbackSpeed));
  }

  function schedulePlayback() {
    if (!state.playing || !state.recording) return;
    var next = state.playbackIndex + 1;
    if (next >= state.recording.traces.length) { stopPlayback(); return; }
    state.playbackTimer = setTimeout(function () {
      if (!state.playing) return;
      var trace = state.recording.traces[next];
      state.playbackIndex = next;
      processTrace(trace, replayAnimates(), replayOptions());
      root.RunwayDemoRender.setStage('L3', state.playbackSpeed);
      updateProgress();
      schedulePlayback();
    }, playbackDelay(state.playbackIndex, next));
  }

  function startPlayback() {
    var rows = state.recording && state.recording.traces || [];
    if (!rows.length) return;
    if (state.playbackIndex >= rows.length - 1) {
      state.playbackIndex = -1;
      state.traces = [];
      root.RunwayDemoRender.reset(state.recording.snapshot || {stage: 'L3', label: state.recording.label, course: null});
    }
    state.playing = true;
    var button = byId('play-toggle');
    if (button) { button.textContent = '일시정지'; button.setAttribute('data-playing', 'true'); }
    if (state.playbackIndex < 0) {
      state.playbackIndex = 0;
      processTrace(rows[0], replayAnimates(), replayOptions());
      root.RunwayDemoRender.setStage('L3', state.playbackSpeed);
      updateProgress();
    }
    schedulePlayback();
  }

  function selectRecording(recordings, index) {
    stopPlayback();
    var recording = recordings[index];
    state.recording = recording || null;
    state.traces = [];
    state.playbackIndex = -1;
    if (!recording) {
      root.RunwayDemoRender.reset({stage: 'L3', label: '재생 기록 없음', course: null});
      root.RunwayDemoRender.setHeader('예측기 대기', root.RunwayDemoLogic.DEFAULT_POLICY_VERSION);
      setBanner('insufficient', '재생 기록을 recordings/에 추가해 주세요.');
      updateProgress();
      return;
    }
    root.RunwayDemoRender.reset(recording.snapshot || {stage: 'L3', label: recording.label, course: null});
    root.RunwayDemoRender.setHeader('예측기: ' + (recording.modelLabel || recording.modelVersion || '알 수 없음'), root.RunwayDemoLogic.policyVersionOf((recording.traces || [])[0], recording));
    root.RunwayDemoRender.setStage('L3', state.playbackSpeed);
    root.RunwayDemoRender.setConnection('정적 재생 · ' + (recording.label || '녹화 기록'));
    setBanner(null);
    updateProgress();
  }

  async function startReplayMode() {
    show(byId('replay-controls'), true);
    show(byId('auth-panel'), false);
    root.RunwayDemoRender.setHeader('예측기 대기', root.RunwayDemoLogic.DEFAULT_POLICY_VERSION);
    try {
      var recordings = await loadRecordings();
      var select = byId('recording-select');
      while (select.firstChild) select.removeChild(select.firstChild);
      root.RunwayDemoLogic.recordingOptionTexts(recordings).forEach(function (text, index) {
        var option = document.createElement('option');
        option.value = String(index);
        option.textContent = text;
        select.appendChild(option);
      });
      select.addEventListener('change', function () { selectRecording(recordings, Number(select.value)); });
      if (!recordings.length) selectRecording([], -1);
      else selectRecording(recordings, 0);
      var toggle = byId('play-toggle');
      toggle.addEventListener('click', function () { state.playing ? stopPlayback() : startPlayback(); });
      // 대기 화면의 큰 재생 버튼과 스페이스 키: 대체 시연에서 바로 시작할 수 있게
      var bigPlay = byId('waiting-play');
      show(bigPlay, recordings.length > 0);
      show(byId('waiting-hint'), recordings.length > 0);
      if (bigPlay) bigPlay.addEventListener('click', function () { if (!state.playing) startPlayback(); });
      document.addEventListener('keydown', function (event) {
        var tag = event.target && event.target.tagName;
        if (event.code !== 'Space' || tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON') return;
        event.preventDefault();
        state.playing ? stopPlayback() : startPlayback();
      });
      byId('play-speed').addEventListener('change', function (event) {
        state.playbackSpeed = Number(event.target.value) || 1;
        root.RunwayDemoRender.setStage('L3', state.playbackSpeed);
        if (state.playing) { if (state.playbackTimer) clearTimeout(state.playbackTimer); schedulePlayback(); }
      });
      byId('progress').addEventListener('input', function (event) { gotoReplay(Number(event.target.value)); });
    } catch (error) {
      root.RunwayDemoRender.setConnection('기록 파일을 읽지 못했습니다.');
      setBanner('insufficient', error.message);
    }
  }

  function startLiveMode(params) {
    show(byId('replay-controls'), false);
    var hasTokenInUrl = params.has('token') || params.has('access_token');
    if (hasTokenInUrl) {
      show(byId('auth-panel'), false);
      setBanner('stale', '토큰은 주소창에 넣지 마세요');
      root.RunwayDemoRender.setConnection('주소창 토큰이 거부되었습니다.');
      return;
    }
    var token = sessionStorage.getItem('runwayDemoToken') || '';
    var input = byId('token-input');
    if (input) input.value = token;
    show(byId('auth-panel'), !token);
    var session = root.RunwayDemoLogic.streamRef(params);
    function saveAndConnect() {
      var value = input ? input.value.trim() : '';
      if (!value) { setBanner('stale', '시연 보기 토큰을 입력해 주세요.'); return; }
      sessionStorage.setItem('runwayDemoToken', value);
      show(byId('auth-panel'), false);
      show(byId('auth-error'), false);
      setBanner(null);
      connectLive(value, session);
    }
    byId('token-save').addEventListener('click', saveAndConnect);
    if (input) input.addEventListener('keydown', function (event) { if (event.key === 'Enter') saveAndConnect(); });
    if (token) connectLive(token, session);
    else root.RunwayDemoRender.setConnection('시연 보기 토큰 대기');
    window.setInterval(updateBanner, 1000);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var params = new URLSearchParams(window.location.search);
    if (root.RunwayDemoLiveMap) root.RunwayDemoLiveMap.init();
    var zoom = byId('zoom-toggle');
    if (zoom) zoom.addEventListener('click', function () {
      var active = zoom.getAttribute('aria-pressed') !== 'true';
      zoom.setAttribute('aria-pressed', String(active));
      root.RunwayDemoRender.setZoom(active);
    });
    state.mode = params.get('mode') === 'live' ? 'live' : 'replay';
    if (state.mode === 'live') startLiveMode(params);
    else startReplayMode();
  });
}(window));
