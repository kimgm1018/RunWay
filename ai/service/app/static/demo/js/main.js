(function (root) {
  'use strict';

  var state = {traces: [], snapshot: null, stream: null, bootId: null, serverOffsetMs: 0,
    lastMessageAtMs: null, mode: 'replay', recording: null, playbackIndex: -1, playbackSpeed: 1,
    playbackTimer: null, playing: false, restartSeen: false, sessions: [], token: null, liveSession: null,
    viewing: null};
  root.__demoState = state;
  root.__demoMetrics = {renderLagMs: null};

  function byId(id) { return document.getElementById(id); }
  function show(el, visible) { if (el) el.classList.toggle('hidden', !visible); }
  function setBanner(kind, text) { root.RunwayDemoRender.setBanner(kind ? {kind: kind, text: text} : null); }
  function updateBanner() {
    if (state.mode === 'history') { root.RunwayDemoRender.setBanner(null); return; }   // 738: 지난 기록은 경고 없음
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

  // ── 738 '이전 기록' ─────────────────────
  function renderHistory() {
    var list = byId('history-list');
    var button = byId('history-toggle');
    if (button) button.classList.toggle('hidden', state.mode === 'replay');
    if (!list) return;
    list.textContent = '';
    var rows = state.sessions || [];
    if (!rows.length) {
      var empty = document.createElement('li');
      empty.className = 'history-empty';
      empty.textContent = '아직 보관된 기록이 없습니다';
      list.appendChild(empty);
      return;
    }
    rows.forEach(function (row) {
      var item = document.createElement('li');
      var pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'history-item' + (row.live ? ' live' : '') + (state.viewing === row.sessionId ? ' current' : '');
      pick.textContent = root.RunwayDemoLogic.historyRowText(row);
      if (row.label) pick.title = row.label;
      pick.addEventListener('click', function () { openHistory(row); });
      item.appendChild(pick);
      list.appendChild(item);
    });
  }

  function toggleHistoryPanel(open) {
    var panel = byId('history-panel');
    var button = byId('history-toggle');
    if (!panel) return;
    var willOpen = open == null ? panel.classList.contains('hidden') : open;
    show(panel, willOpen);
    if (button) button.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) renderHistory();
  }

  async function openHistory(row) {
    toggleHistoryPanel(false);
    if (!state.token) return;
    setBanner(null);
    root.RunwayDemoRender.setConnection('이전 기록 불러오는 중…');
    var data;
    try {
      data = await root.RunwayDemoStream.fetchSnapshot({token: state.token, session: 'h' + row.sessionId});
    } catch (error) {
      root.RunwayDemoRender.setConnection('이전 기록을 불러오지 못했습니다');
      return;
    }
    if (state.stream) { state.stream.close(); state.stream = null; }
    state.mode = 'history';
    state.viewing = row.sessionId;
    state.sessions = data.sessions || state.sessions;
    var traces = Array.isArray(data.traces) ? data.traces : [];
    var recording = {id: 'h' + row.sessionId, label: (data.label || '이전 기록') + ' · ' + root.RunwayDemoLogic.historyRowText(row),
      modelLabel: traces.length ? traces[traces.length - 1].modelVersion || null : null,
      snapshot: {stage: 'L3', label: data.label, course: data.course || null}, traces: traces};
    show(byId('replay-controls'), true);
    show(byId('recording-select'), false);
    show(byId('history-chip'), true);
    bindHistoryControls();
    var chipText = byId('history-chip-text');
    if (chipText) chipText.textContent = '이전 기록 · ' + root.RunwayDemoLogic.historyRowText(row);
    selectRecording([recording], 0);
    gotoReplay(traces.length - 1);
    if (root.RunwayDemoLiveMap) {
      root.RunwayDemoLiveMap.reset();
      root.RunwayDemoLiveMap.setCourse(data.course || null);
      root.RunwayDemoLiveMap.setRoutes(data.routes || []);
      root.RunwayDemoLiveMap.setCourse(data.course || null);
    }
    root.RunwayDemoRender.setConnection('이전 기록 다시 보기 · 슬라이더로 처음부터 볼 수 있습니다');
  }

  // 라이브 모드에서는 재생 조작을 묶지 않았으므로(startReplayMode에서만) 다시 보기 때 한 번만 묶는다
  function bindHistoryControls() {
    if (state.historyControlsBound) return;
    state.historyControlsBound = true;
    byId('play-toggle').addEventListener('click', function () {
      if (state.mode === 'history') { state.playing ? stopPlayback() : startPlayback(); }
    });
    byId('play-speed').addEventListener('change', function (event) {
      if (state.mode !== 'history') return;
      state.playbackSpeed = Number(event.target.value) || 1;
      root.RunwayDemoRender.setStage('L3', state.playbackSpeed);
      if (state.playing) { if (state.playbackTimer) clearTimeout(state.playbackTimer); schedulePlayback(); }
    });
    byId('progress').addEventListener('input', function (event) {
      if (state.mode === 'history') gotoReplay(Number(event.target.value));
    });
  }

  function backToLive() {
    stopPlayback();
    show(byId('replay-controls'), false);
    show(byId('recording-select'), true);
    show(byId('history-chip'), false);
    state.mode = 'live';
    state.viewing = null;
    state.recording = null;
    state.traces = [];          // 지난 기록을 라이브 기록과 합치지 않게 비운다
    state.bootId = null;
    state.playbackIndex = -1;
    if (root.RunwayDemoLiveMap) root.RunwayDemoLiveMap.reset();
    if (state.token) connectLive(state.token, state.liveSession);
    renderHistory();
  }

  function handleSnapshot(snapshot) {
    if (Array.isArray(snapshot.sessions)) { state.sessions = snapshot.sessions; renderHistory(); }
    var previousBoot = state.bootId;
    var previousTraces = state.traces.slice();
    state.bootId = snapshot.bootId || state.bootId;
    if (previousBoot && state.bootId && previousBoot !== state.bootId) state.restartSeen = true;
    state.snapshot = snapshot;
    state.serverOffsetMs = snapshot.serverTime ? Date.parse(snapshot.serverTime) - Date.now() : state.serverOffsetMs;
    state.traces = root.RunwayDemoLogic.mergeTraces(previousTraces, snapshot.traces || []);
    root.RunwayDemoRender.reset(snapshot);
    if (root.RunwayDemoLiveMap) {          // 722: 실시간 경로 지도
      root.RunwayDemoLiveMap.setCourse(snapshot.course || null);   // 727: 코스를 먼저 알려야 첫 판정이 코스 기준
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
    if (name === 'SESSIONS') {               // 738: 목록이 바뀌었을 때
      state.sessions = data && Array.isArray(data.sessions) ? data.sessions : state.sessions;
      renderHistory();
      return;
    }
    if (name === 'COURSE_UPDATE') {
      // 722: 실제 경로는 같은 이벤트의 routes로 온다. course가 없는 이벤트는 코스를 지우지 않는다
      if (data && Object.prototype.hasOwnProperty.call(data, 'course')) {
        state.snapshot = Object.assign({}, state.snapshot || {}, {course: data.course || null});
        root.RunwayDemoRender.updateCourse(state.snapshot.course, state.traces[state.traces.length - 1] || null);
      }
      if (data && Array.isArray(data.routes) && root.RunwayDemoLiveMap) {
        root.RunwayDemoLiveMap.setCourse(state.snapshot && state.snapshot.course || null);
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
    state.token = token;
    state.liveSession = session;
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
    var historyToggle = byId('history-toggle');
    if (historyToggle) historyToggle.addEventListener('click', function () { toggleHistoryPanel(); });
    var historyBack = byId('history-back');
    if (historyBack) historyBack.addEventListener('click', backToLive);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && byId('history-panel') && !byId('history-panel').classList.contains('hidden')) toggleHistoryPanel(false);
    });
    renderHistory();
    if (state.mode === 'live') startLiveMode(params);
    else startReplayMode();
  });
}(window));
