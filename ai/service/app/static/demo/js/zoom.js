(function (root) {
  'use strict';

  // 736: 패널 확대 모달. 발표장 큰 화면에서 작은 글씨를 읽을 수 있게 패널을 가운데 크게 띄운다.
  // 패널 DOM을 그대로 모달 안으로 옮기므로 기존 render.js·livemap.js가 id로 찾아 계속 갱신한다(실시간 유지).
  // 글자는 rem 기준이라 모달이 열린 동안 루트 글자 크기를 키우고(html.zoom-open), 그래프는 ResizeObserver로 다시 그려진다.
  var PANELS = [
    {selector: '.guide-card', key: 'guide', title: '지금 갈 안내 페이스', scale: 1.5, wholeClick: true,
     text: 'AI가 지금 러너(그룹)에게 보내는 페이스입니다. 후보 페이스마다 2분 뒤 심박을 예측해 허용 심박을 넘지 않는 페이스를 고릅니다. ' +
           "'실제'는 최근 60초 동안 실제로 뛴 페이스입니다."},
    {selector: '.candidates-panel', key: 'candidates', title: '페이스 후보', scale: 1.4, wholeClick: true,
     text: '지금 페이스보다 30초 빠른 것부터 60초 느린 것까지 9개 후보를 놓고, 그 페이스로 2분 뛰면 심박이 얼마가 될지 AI(GRU)가 예측한 값입니다. ' +
           '빗금은 허용 심박을 넘는 후보, 민트색 칸이 고른 페이스입니다.'},
    {selector: '.chart-panel', key: 'chart', title: '심박 예측', scale: 1.4, wholeClick: true,
     text: '왼쪽 선은 실제 심박, 오른쪽으로 뻗은 선은 고른 페이스로 뛸 때 2분 뒤까지의 예측입니다. 빨간 점선이 넘지 말아야 할 허용 심박입니다.'},
    {selector: '.records-panel', key: 'records', title: '판단 기록', scale: 1.45, wholeClick: true,
     text: 'AI가 판단할 때마다 남긴 기록입니다. ▲ 빠르게, ■ 유지, ▼ 느리게. 페이스를 바꾼 뒤 2분 동안은 위험할 때가 아니면 그대로 유지합니다.'},
    {selector: '.map-panel', key: 'map', title: '지도', scale: 1.3, wholeClick: false,
     text: '대상 러너가 실제로 뛴 경로와 지금 위치입니다. 그룹런이면 사람마다 색이 다르고, 선두·후미와 둘 사이 간격을 보여 줍니다.'},
  ];
  var FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  var modal = null, body = null, titleEl = null, textEl = null, closeBtn = null;
  var open = null;   // {panel, placeholder, opener, config}

  function doc() { return root.document; }

  function buildModal() {
    var d = doc();
    modal = d.createElement('div');
    modal.id = 'zoom-modal';
    modal.className = 'zoom-modal hidden';
    modal.innerHTML =
      '<div class="zoom-dialog tone-dark" role="dialog" aria-modal="true" aria-labelledby="zoom-title" aria-describedby="zoom-text">' +
      '<div class="zoom-head"><div class="zoom-head-text"><h2 id="zoom-title"></h2><p id="zoom-text"></p></div>' +
      '<button type="button" class="zoom-close" aria-label="닫기 (Esc)">닫기 ✕</button></div>' +
      '<div class="zoom-body"></div></div>';
    d.body.appendChild(modal);
    body = modal.querySelector('.zoom-body');
    titleEl = modal.querySelector('#zoom-title');
    textEl = modal.querySelector('#zoom-text');
    closeBtn = modal.querySelector('.zoom-close');
    closeBtn.addEventListener('click', close);
    modal.addEventListener('mousedown', function (event) {   // 바깥(어두운 배경) 클릭으로 닫기
      if (event.target === modal) close();
    });
    d.addEventListener('keydown', onKey, true);
  }

  function onKey(event) {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === ' ' && event.target === doc().body) event.stopPropagation();   // 재생 단축키(스페이스)는 모달 중엔 막는다
    if (event.key !== 'Tab') return;
    var items = Array.prototype.filter.call(modal.querySelectorAll(FOCUSABLE), function (el) {
      return el.offsetParent !== null || el === closeBtn;
    });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (event.shiftKey && doc().activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && doc().activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function notifyResize() {
    // livemap(Leaflet)은 창 크기 변화 이벤트로 지도 크기를 다시 잰다. SVG는 ResizeObserver가 다시 그린다.
    setTimeout(function () { root.dispatchEvent(new Event('resize')); }, 30);
    setTimeout(function () { root.dispatchEvent(new Event('resize')); }, 250);
  }

  function openPanel(config, panel, opener) {
    if (open) close();
    if (!modal) buildModal();
    var d = doc();
    var placeholder = d.createComment('zoom-placeholder');
    panel.parentNode.insertBefore(placeholder, panel);
    body.appendChild(panel);
    panel.classList.add('is-zoomed');
    // 모달 바탕은 어두운 톤이라 흰 패널은 밝은 톤 글자색을 다시 지정한다(앱 Card와 같은 규칙)
    var addedLight = !panel.classList.contains('tone-dark') && !panel.classList.contains('tone-light');
    if (addedLight) panel.classList.add('tone-light');
    titleEl.textContent = config.title;
    textEl.textContent = config.text;
    modal.setAttribute('data-panel', config.key);
    d.documentElement.style.setProperty('--zoom-scale', String(config.scale));
    d.documentElement.classList.add('zoom-open');
    var main = d.querySelector('main.console');
    if (main) { main.setAttribute('aria-hidden', 'true'); if ('inert' in main) main.inert = true; }
    modal.classList.remove('hidden');
    open = {panel: panel, placeholder: placeholder, opener: opener, config: config, addedLight: addedLight};
    closeBtn.focus();
    notifyResize();
  }

  function close() {
    if (!open) return;
    var d = doc();
    var state = open;
    open = null;
    state.panel.classList.remove('is-zoomed');
    if (state.addedLight) state.panel.classList.remove('tone-light');
    state.placeholder.parentNode.insertBefore(state.panel, state.placeholder);
    state.placeholder.parentNode.removeChild(state.placeholder);
    modal.classList.add('hidden');
    d.documentElement.classList.remove('zoom-open');
    d.documentElement.style.removeProperty('--zoom-scale');
    var main = d.querySelector('main.console');
    if (main) { main.removeAttribute('aria-hidden'); if ('inert' in main) main.inert = false; }
    if (state.opener && state.opener.focus) state.opener.focus();
    notifyResize();
  }

  function attach(config) {
    var panel = doc().querySelector(config.selector);
    if (!panel || panel.querySelector('.zoom-open-btn')) return;
    var button = doc().createElement('button');
    button.type = 'button';
    button.className = 'zoom-open-btn';
    button.setAttribute('aria-label', config.title + ' 크게 보기');
    button.title = '크게 보기';
    button.textContent = '⤢';
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      if (open && open.panel === panel) close(); else openPanel(config, panel, button);
    });
    var head = panel.querySelector('.panel-head') || panel.querySelector('.kicker') || panel;
    head.appendChild(button);
    if (config.wholeClick) {
      panel.classList.add('zoomable');
      panel.addEventListener('click', function (event) {
        if (open) return;
        if (event.target.closest && event.target.closest('button, a, input, select, label')) return;
        openPanel(config, panel, button);
      });
    }
  }

  function init() {
    if (!doc() || !doc().body) return;
    PANELS.forEach(attach);
  }

  root.RunwayDemoZoom = {init: init, close: close, isOpen: function () { return !!open; }, PANELS: PANELS};
}(typeof window !== 'undefined' ? window : globalThis));
