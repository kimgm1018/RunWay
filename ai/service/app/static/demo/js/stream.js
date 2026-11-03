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
        if (!stopped && runGeneration === generation && error.name !== 'AbortError') options.onStatus && options.onStatus(error.message === 'waiting' ? 'waiting' : 'disconnected');
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

  root.RunwayDemoStream = {connect: connect};
}(typeof window !== 'undefined' ? window : globalThis));
