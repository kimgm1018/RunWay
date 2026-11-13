(function (root) {
  'use strict';

  function connect(options) {
    var stopped = false;
    var controller = null;
    var attempt = 0;
    var retryTimer = null;
    var generation = 0;

    async function run() {
      if (stopped) return;
      var runGeneration = generation;
      var requestController = new AbortController();
      controller = requestController;
      var path = '/v1/demo/sessions/' + encodeURIComponent(options.session || 'latest') + '/events';
      try {
        var response = await fetch(path, {
          headers: {Authorization: 'Bearer ' + options.token, Accept: 'text/event-stream'},
          cache: 'no-store', signal: requestController.signal
        });
        if (stopped || runGeneration !== generation) return;
        if (response.status === 401) {          // 토큰이 틀림: 다시 묻도록 멈춘다(재시도해도 같은 결과)
          stopped = true;
          options.onStatus && options.onStatus('unauthorized');
          return;
        }
        if (response.status === 429) {          // 747: 이 세션 화면 연결이 가득 참 → 안내하고 천천히 다시 시도
          options.onStatus && options.onStatus('full');
          throw new Error('full');
        }
        if (response.status === 503) {          // 747: AI 준비 중(재배포 직후·시연 꺼짐) → 안내하고 자동 재시도
          options.onStatus && options.onStatus('unavailable');
          throw new Error('unavailable');
        }
        if (response.status === 404) {
          options.onStatus && options.onStatus('waiting');
          throw new Error('waiting');
        }
        if (!response.ok || !response.body) throw new Error('stream ' + response.status);
        attempt = 0;
        options.onStatus && options.onStatus('connected');
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var rest = '';
        while (!stopped) {
          var item = await reader.read();
          if (runGeneration !== generation) return;
          if (item.done) break;
          var parsed = root.RunwayDemoLogic.parseSseChunk(rest + decoder.decode(item.value, {stream: true}));
          rest = parsed.rest;
          parsed.events.forEach(function (event) { options.onEvent && options.onEvent(event.event, event.data); });
        }
      } catch (error) {
        if (!stopped && runGeneration === generation && error.name !== 'AbortError' && error.message !== 'full' && error.message !== 'unavailable') options.onStatus && options.onStatus(error.message === 'waiting' ? 'waiting' : 'disconnected');
      }
      if (!stopped && runGeneration === generation) {
        var wait = root.RunwayDemoLogic.backoffMs(attempt++);
        retryTimer = setTimeout(run, wait);
      }
    }

    run();
    return {
      close: function () {
        stopped = true;
        if (retryTimer) clearTimeout(retryTimer);
        if (controller) controller.abort();
      },
      reconnectNow: function () {
        if (retryTimer) clearTimeout(retryTimer);
        generation += 1;
        if (controller) controller.abort();
        attempt = 0;
        run();
      }
    };
  }

  // 738: '이전 기록' 다시 보기. 'h<id>' 스트림에서 첫 SNAPSHOT만 받고 닫는다.
  async function fetchSnapshot(options) {
    var response = await fetch('/v1/demo/sessions/' + encodeURIComponent(options.session) + '/events', {
      headers: {Authorization: 'Bearer ' + options.token, Accept: 'text/event-stream'}, cache: 'no-store'
    });
    if (!response.ok || !response.body) throw new Error('history ' + response.status);
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var rest = '';
    try {
      while (true) {
        var item = await reader.read();
        if (item.done) break;
        var parsed = root.RunwayDemoLogic.parseSseChunk(rest + decoder.decode(item.value, {stream: true}));
        rest = parsed.rest;
        for (var i = 0; i < parsed.events.length; i += 1) {
          if (parsed.events[i].event === 'SNAPSHOT') return parsed.events[i].data;
        }
      }
    } finally {
      try { reader.cancel(); } catch (error) { /* 이미 닫힘 */ }
    }
    throw new Error('history empty');
  }

  root.RunwayDemoStream = {connect: connect, fetchSnapshot: fetchSnapshot};
}(typeof window !== 'undefined' ? window : globalThis));
