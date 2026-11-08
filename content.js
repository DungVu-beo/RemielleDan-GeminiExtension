/**
 * Remielle - Gemini Companion
 * - kiss.gif: luôn cố định bên trái màn hình
 * - Nhân vật bên phải đổi GIF theo trạng thái Gemini:
 *     idle    -> leisure1.gif / leisure2.gif luân phiên (mỗi GIF chạy hết 1 vòng rồi đổi)
 *     think   -> think.gif (Gemini đang suy nghĩ, chưa có chữ trả lời)
 *     write   -> write.gif (Gemini đang viết câu trả lời ra)
 *     impress -> impress.gif (vừa trả lời xong, phát vài vòng rồi về idle)
 * - Nhấn vào nhân vật: hiệu ứng jelly/wobble.
 *   Nhấp đúp: về vị trí mặc định. Kéo thả: di chuyển.
 * Dùng Shadow DOM để cô lập CSS, không dùng innerHTML (tương thích Trusted Types).
 */
(function () {
  'use strict';

  if (window.__REMIELLE_GEMINI__) return;
  window.__REMIELLE_GEMINI__ = true;

  /* ==========================================================================
     0. CONFIG
     ========================================================================== */
  const DEFAULTS = {
    enabled: true,
    showKiss: true,
    showMascot: true,
    kissSize: 200,     // chiều rộng kiss.gif (px)
    mascotSize: 170,   // kích thước nhân vật trạng thái (px)
    opacity: 100,      // %
    lockPos: false,    // khóa kéo thả & nhấp đúp đặt lại vị trí
    kissPos: null,     // {x, y} khi người dùng kéo thả
    mascotPos: null
  };

  const url = (name) => chrome.runtime.getURL('assets/' + name);
  const GIFS = {
    kiss: url('kiss.gif'),
    leisure1: url('leisure1.gif'),
    leisure2: url('leisure2.gif'),
    think: url('think.gif'),
    write: url('write.gif'),
    impress: url('impress.gif')
  };

  let settings = { ...DEFAULTS };

  /* ==========================================================================
     1. GIF DURATION PARSER (để leisure1/leisure2 chạy hết 1 vòng rồi mới đổi)
     ========================================================================== */
  const durationCache = {};

  function parseGifDuration(buf) {
    const b = new Uint8Array(buf);
    if (b.length < 13 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return 0;
    let p = 13;
    const lsdFlags = b[10];
    if (lsdFlags & 0x80) p += 3 * (1 << ((lsdFlags & 0x07) + 1));
    let total = 0;
    let pendingDelay = 0;

    const skipSubBlocks = () => {
      while (p < b.length) {
        const size = b[p++];
        if (size === 0) break;
        p += size;
      }
    };

    while (p < b.length) {
      const id = b[p++];
      if (id === 0x21) {
        const label = b[p++];
        if (label === 0xF9 && b[p] === 4) {
          // Graphic Control Extension: delay tính theo 1/100 giây
          pendingDelay = (b[p + 2] | (b[p + 3] << 8)) * 10;
        }
        skipSubBlocks();
      } else if (id === 0x2C) {
        const flags = b[p + 8];
        p += 9;
        if (flags & 0x80) p += 3 * (1 << ((flags & 0x07) + 1));
        p += 1; // LZW min code size
        skipSubBlocks();
        // Chrome coi delay <= 10ms là 100ms
        total += pendingDelay <= 10 ? 100 : pendingDelay;
        pendingDelay = 0;
      } else if (id === 0x3B) {
        break;
      } else {
        break; // dữ liệu lỗi
      }
    }
    return total;
  }

  async function getDuration(key) {
    if (durationCache[key]) return durationCache[key];
    try {
      const res = await fetch(GIFS[key]);
      const ms = parseGifDuration(await res.arrayBuffer());
      durationCache[key] = ms > 500 ? ms : 8000;
    } catch (e) {
      durationCache[key] = 8000;
    }
    return durationCache[key];
  }

  /* ==========================================================================
     2. UI (Shadow DOM)
     ========================================================================== */
  const host = document.createElement('div');
  host.id = 'remielle-gemini-host';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 999;
    }
    .sprite {
      position: fixed;
      pointer-events: auto;
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
      transition: opacity 0.25s ease, filter 0.2s ease;
      filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.18));
    }
    .sprite.dragging {
      cursor: grabbing;
      filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.35));
    }
    .sprite.locked { cursor: pointer; }
    .sprite.hidden { display: none; }
    .sprite .body {
      position: relative;
      width: 100%;
      height: 100%;
      transform-origin: 50% 100%;
      transition: opacity 0.35s ease;
      will-change: transform;
    }
    /* Hiệu ứng jelly / wobble khi nhấn */
    .sprite .body.jelly {
      animation: rm-jelly 0.65s cubic-bezier(0.25, 0.8, 0.35, 1);
    }
    @keyframes rm-jelly {
      0%   { transform: scale(1, 1); }
      18%  { transform: scale(1.18, 0.82); }
      34%  { transform: scale(0.86, 1.14) rotate(-2deg); }
      50%  { transform: scale(1.08, 0.93) rotate(1.5deg); }
      66%  { transform: scale(0.96, 1.04) rotate(-0.8deg); }
      82%  { transform: scale(1.02, 0.98); }
      100% { transform: scale(1, 1); }
    }
    .sprite img {
      display: block;
      width: 100%;
      height: auto;
      pointer-events: none;
      -webkit-user-drag: none;
    }
    .mascot .layer {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      opacity: 0;
      transition: opacity 0.18s ease;
    }
    .mascot .layer.show { opacity: 1; }
  `;
  shadow.appendChild(style);

  const HINT = ' (kéo để di chuyển • nhấp đúp để về chỗ cũ)';

  // kiss.gif (bên trái, vĩnh viễn)
  const kissEl = document.createElement('div');
  kissEl.className = 'sprite kiss';
  kissEl.title = 'Remielle 💕' + HINT;
  const kissBody = document.createElement('div');
  kissBody.className = 'body';
  const kissImg = document.createElement('img');
  kissImg.alt = '';
  kissImg.draggable = false;
  kissImg.src = GIFS.kiss;
  kissBody.appendChild(kissImg);
  kissEl.appendChild(kissBody);

  // Nhân vật trạng thái (bên phải) – 2 layer để chuyển GIF mượt, không nháy
  const mascotEl = document.createElement('div');
  mascotEl.className = 'sprite mascot';
  mascotEl.title = 'Remielle' + HINT;
  const mascotBody = document.createElement('div');
  mascotBody.className = 'body';
  const layers = [document.createElement('img'), document.createElement('img')];
  layers.forEach((img) => {
    img.className = 'layer';
    img.alt = '';
    img.draggable = false;
    mascotBody.appendChild(img);
  });
  mascotEl.appendChild(mascotBody);
  let frontLayer = 0;

  shadow.appendChild(kissEl);
  shadow.appendChild(mascotEl);

  function mount() {
    if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
  }

  /* ---------- Vị trí & kích thước ---------- */
  const MARGIN = 8;

  function spriteSize(el) {
    if (el === kissEl) return { w: settings.kissSize, h: Math.round(settings.kissSize * (1000 / 1200)) };
    return { w: settings.mascotSize, h: settings.mascotSize };
  }

  function defaultPos(el) {
    const { w, h } = spriteSize(el);
    if (el === kissEl) return { x: MARGIN, y: window.innerHeight - h - MARGIN };
    return { x: window.innerWidth - w - 16, y: window.innerHeight - h - 16 };
  }

  function clampPos(el, pos) {
    const { w, h } = spriteSize(el);
    return {
      x: Math.min(Math.max(0, pos.x), Math.max(0, window.innerWidth - w)),
      y: Math.min(Math.max(0, pos.y), Math.max(0, window.innerHeight - h))
    };
  }

  function placeSprite(el) {
    const saved = el === kissEl ? settings.kissPos : settings.mascotPos;
    const pos = clampPos(el, saved || defaultPos(el));
    const { w, h } = spriteSize(el);
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';
  }

  function applySettings() {
    const op = Math.min(1, Math.max(0.1, settings.opacity / 100));
    kissEl.style.opacity = op;
    mascotEl.style.opacity = op;
    kissEl.classList.toggle('hidden', !settings.enabled || !settings.showKiss);
    mascotEl.classList.toggle('hidden', !settings.enabled || !settings.showMascot);
    kissEl.classList.toggle('locked', !!settings.lockPos);
    mascotEl.classList.toggle('locked', !!settings.lockPos);
    const hint = settings.lockPos ? ' (đã khóa vị trí)' : HINT;
    kissEl.title = 'Remielle 💕' + hint;
    mascotEl.title = 'Remielle' + hint;
    placeSprite(kissEl);
    placeSprite(mascotEl);
  }

  window.addEventListener('resize', () => {
    placeSprite(kissEl);
    placeSprite(mascotEl);
  });

  /* ---------- Kéo thả ---------- */
  function makeDraggable(el, key) {
    let start = null;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const rect = el.getBoundingClientRect();
      start = { px: e.clientX, py: e.clientY, x: rect.left, y: rect.top, moved: false };
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    el.addEventListener('pointermove', (e) => {
      if (!start || settings.lockPos) return;
      const dx = e.clientX - start.px;
      const dy = e.clientY - start.py;
      if (!start.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      start.moved = true;
      el.classList.add('dragging');
      const pos = clampPos(el, { x: start.x + dx, y: start.y + dy });
      el.style.left = pos.x + 'px';
      el.style.top = pos.y + 'px';
    });

    const end = (e) => {
      if (!start) return;
      const moved = start.moved;
      start = null;
      el.classList.remove('dragging');
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      if (moved) {
        const rect = el.getBoundingClientRect();
        settings[key] = { x: Math.round(rect.left), y: Math.round(rect.top) };
        save({ [key]: settings[key] });
      } else if (e.type === 'pointerup') {
        handleClick();
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    /* ---------- Nhấn: jelly • nhấp đúp: về chỗ cũ ---------- */
    const body = el.querySelector('.body');
    const DBL_WINDOW = 350;
    let clicks = 0;
    let clickTimer = null;

    function jelly() {
      body.classList.remove('jelly');
      void body.offsetWidth; // reflow để animation chạy lại từ đầu
      body.classList.add('jelly');
    }
    body.addEventListener('animationend', () => body.classList.remove('jelly'));

    function handleClick() {
      jelly();
      if (settings.lockPos) return;
      clicks++;
      clearTimeout(clickTimer);
      if (clicks >= 2) {
        clicks = 0;
        settings[key] = null;
        save({ [key]: null });
        placeSprite(el);
        return;
      }
      clickTimer = setTimeout(() => {
        clicks = 0;
      }, DBL_WINDOW);
    }
  }
  makeDraggable(kissEl, 'kissPos');
  makeDraggable(mascotEl, 'mascotPos');

  /* ---------- Đổi GIF cho nhân vật ---------- */
  let restartCounter = 0;

  // Thêm query khác nhau để GIF luôn phát lại từ frame đầu.
  // onShown được gọi đúng lúc GIF bắt đầu hiển thị (để hẹn giờ chính xác).
  function showGif(key, onShown) {
    const back = layers[1 - frontLayer];
    const front = layers[frontLayer];
    const src = GIFS[key] + '?r=' + (++restartCounter);
    back.onload = () => {
      back.onload = null;
      back.classList.add('show');
      front.classList.remove('show');
      frontLayer = 1 - frontLayer;
      if (onShown) onShown();
      // giải phóng bộ nhớ của GIF cũ sau khi chuyển xong
      setTimeout(() => {
        if (layers[1 - frontLayer] === front && !front.classList.contains('show')) {
          front.removeAttribute('src');
        }
      }, 300);
    };
    back.onerror = () => { back.onerror = null; };
    back.src = src;
  }

  /* ==========================================================================
     3. ANIMATION STATE MACHINE
     ========================================================================== */
  const IMPRESS_LOOPS = 2;   // impress.gif ngắn (~2.5s) nên phát 2 vòng
  let currentState = null;   // 'idle' | 'think' | 'write' | 'impress'
  let stateToken = 0;        // tăng mỗi lần đổi state để huỷ hẹn giờ cũ
  let leisureKey = 'leisure2';
  let stateTimer = null;

  // Phát GIF key rồi sau `loops` vòng gọi next() (nếu state chưa bị đổi)
  function playThen(key, loops, next) {
    const token = stateToken;
    const durationP = getDuration(key);
    showGif(key, () => {
      durationP.then((ms) => {
        if (token !== stateToken) return;
        clearTimeout(stateTimer);
        stateTimer = setTimeout(() => {
          if (token === stateToken) next();
        }, ms * loops);
      });
    });
  }

  function playNextLeisure() {
    leisureKey = leisureKey === 'leisure1' ? 'leisure2' : 'leisure1';
    playThen(leisureKey, 1, playNextLeisure);
  }

  function setState(state) {
    if (state === currentState) return;
    currentState = state;
    stateToken++;
    clearTimeout(stateTimer);
    mascotEl.dataset.state = state;
    if (state === 'idle') playNextLeisure();
    else if (state === 'impress') playThen('impress', IMPRESS_LOOPS, () => setState('idle'));
    else showGif(state); // 'think' | 'write' -> lặp liên tục
  }

  /* ==========================================================================
     4. PHÁT HIỆN TRẠNG THÁI GEMINI
     ========================================================================== */
  // Nút Stop xuất hiện trong khi Gemini đang xử lý / trả lời
  const STOP_CLASS_SELECTORS = [
    'button.send-button.stop',
    '.send-button-container button.stop',
    'button[data-test-id="stop-button"]'
  ];
  const STOP_GENERIC_SELECTORS = [
    'button[aria-label*="Stop" i]',
    'button[aria-label*="Dừng" i]',
    'mat-icon[fonticon="stop"]',
    'mat-icon[data-mat-icon-name="stop"]',
    'mat-icon[fonticon="stop_circle"]'
  ];
  const INPUT_SELECTOR = 'rich-textarea, .ql-editor, [contenteditable="true"]';

  function isVisible(el) {
    return !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  }

  function nearInput(el) {
    let node = el;
    for (let i = 0; i < 8 && node; i++) {
      node = node.parentElement;
      if (node && node.querySelector(INPUT_SELECTOR)) return true;
    }
    return false;
  }

  function isStopVisible() {
    for (const sel of STOP_CLASS_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        if (isVisible(el)) return true;
      }
    }
    for (const sel of STOP_GENERIC_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        const btn = el.closest('button') || el;
        if (isVisible(btn) && nearInput(btn)) return true;
      }
    }
    return false;
  }

  function getLastResponse() {
    const list = document.querySelectorAll('model-response');
    return list.length ? list[list.length - 1] : null;
  }

  // Độ dài phần chữ trả lời (bỏ qua phần "suy nghĩ" của model)
  function answerLength(resp) {
    if (!resp) return 0;
    let nodes = resp.querySelectorAll('message-content');
    if (!nodes.length) nodes = resp.querySelectorAll('.markdown');
    let len = 0;
    nodes.forEach((n) => {
      if (n.closest('model-thoughts, .thoughts-container')) return;
      len += (n.textContent || '').trim().length;
      n.querySelectorAll('model-thoughts, .thoughts-container').forEach((t) => {
        len -= (t.textContent || '').trim().length;
      });
    });
    // Ảnh/nội dung media trong câu trả lời cũng tính là "đã viết"
    if (len <= 0 && resp.querySelector('message-content img, generated-image, single-image')) len = 1;
    return Math.max(0, len);
  }

  const GROW_WINDOW = 1500;   // chữ tăng trong 1.5s gần nhất -> đang viết
  const IDLE_GRACE = 900;     // chờ thêm trước khi quay về idle (tránh nháy)
  const SUBMIT_TIMEOUT = 60000;

  let lastResp = null;
  let lastLen = 0;
  let lastGrowAt = -Infinity;
  let navAt = performance.now();
  let lastUrl = location.href;
  let episode = null;          // {baseResp, baseLen, sawStop}
  let submitPending = 0;       // thời điểm gửi câu hỏi (0 = không chờ)
  let lastBusyAt = -Infinity;

  function startEpisode() {
    const resp = getLastResponse();
    episode = { baseResp: resp, baseLen: answerLength(resp), sawStop: false, wrote: false, submitted: false };
  }

  function markSubmit() {
    submitPending = performance.now();
    startEpisode();
    episode.submitted = true;
    setState('think');
  }

  function evaluate() {
    const now = performance.now();

    if (location.href !== lastUrl) {
      // Chuyển cuộc trò chuyện: reset để không nhầm lúc load nội dung cũ là "đang viết"
      lastUrl = location.href;
      navAt = now;
      lastResp = null;
      lastLen = 0;
      lastGrowAt = -Infinity;
      if (!submitPending) episode = null;
    }

    const resp = getLastResponse();
    const len = answerLength(resp);
    if (resp && resp === lastResp && len > lastLen && now - navAt > 2500) lastGrowAt = now;
    lastResp = resp;
    lastLen = len;

    const stop = isStopVisible();
    const growing = now - lastGrowAt < GROW_WINDOW;

    if (submitPending) {
      const elapsed = now - submitPending;
      if (elapsed > SUBMIT_TIMEOUT) submitPending = 0;
      else if (episode && episode.sawStop && !stop && !growing) submitPending = 0;
      // Không thấy nút Stop và cũng không có câu trả lời mới -> có lẽ gửi không thành công
      else if (elapsed > 10000 && episode && !episode.sawStop && resp === episode.baseResp) submitPending = 0;
    }

    const busy = stop || growing || !!submitPending;

    if (busy) {
      if (!episode) startEpisode();
      if (stop) episode.sawStop = true;
      lastBusyAt = now;
      const hasNewText = len > 0 && (resp !== episode.baseResp || len !== episode.baseLen);
      if (hasNewText && growing) submitPending = 0; // đã bắt đầu viết
      if (hasNewText) episode.wrote = true;
      setState(hasNewText ? 'write' : 'think');
    } else if (now - lastBusyAt > IDLE_GRACE) {
      // Vừa trả lời xong -> impress.gif (tự về idle khi phát xong)
      const finished = episode && (episode.sawStop || (episode.wrote && episode.submitted));
      episode = null;
      if (finished) setState('impress');
      else if (currentState !== 'impress') setState('idle');
    }
  }

  // Bắt sự kiện gửi câu hỏi (Enter hoặc bấm nút gửi) để chuyển sang "think" ngay lập tức
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
    const input = e.target && e.target.closest && e.target.closest(INPUT_SELECTOR);
    if (!input || host.contains(input)) return;
    if (!(input.textContent || '').trim()) return;
    setTimeout(markSubmit, 0);
  }, true);

  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('button');
    if (!btn) return;
    if (btn.classList.contains('stop')) return;
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    const isSend =
      btn.classList.contains('send-button') ||
      label.includes('send') || label.includes('gửi') ||
      !!btn.querySelector('mat-icon[fonticon="send"], mat-icon[data-mat-icon-name="send"]');
    if (isSend && !/stop|dừng/.test(label) && nearInput(btn)) setTimeout(markSubmit, 0);
  }, true);

  /* ==========================================================================
     5. SETTINGS & INIT
     ========================================================================== */
  function save(partial) {
    try { chrome.storage.local.set(partial); } catch (e) {}
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let touched = false;
    for (const k of Object.keys(changes)) {
      if (k in DEFAULTS) {
        settings[k] = changes[k].newValue === undefined ? DEFAULTS[k] : changes[k].newValue;
        touched = true;
      }
    }
    if (touched) applySettings();
  });

  function init(stored) {
    settings = { ...DEFAULTS, ...(stored || {}) };
    mount();
    applySettings();
    setState('idle');
    evaluate();
    setInterval(() => {
      mount(); // Gemini là SPA, đảm bảo host không bị gỡ
      evaluate();
    }, 350);
    // Tính sẵn thời lượng GIF leisure
    getDuration('leisure1');
    getDuration('leisure2');
    getDuration('impress');
  }

  try {
    chrome.storage.local.get(DEFAULTS, init);
  } catch (e) {
    init(null);
  }
})();
