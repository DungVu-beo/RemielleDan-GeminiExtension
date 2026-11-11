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
    jellyLevel: 100,   // mức độ hiệu ứng jelly / đàn hồi (0 - 200%)
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
      18%  { transform: scale(calc(1 + 0.18 * var(--j, 1)), calc(1 - 0.18 * var(--j, 1))); }
      34%  { transform: scale(calc(1 - 0.14 * var(--j, 1)), calc(1 + 0.14 * var(--j, 1))) rotate(calc(-2deg * var(--j, 1))); }
      50%  { transform: scale(calc(1 + 0.08 * var(--j, 1)), calc(1 - 0.07 * var(--j, 1))) rotate(calc(1.5deg * var(--j, 1))); }
      66%  { transform: scale(calc(1 - 0.04 * var(--j, 1)), calc(1 + 0.04 * var(--j, 1))) rotate(calc(-0.8deg * var(--j, 1))); }
      82%  { transform: scale(calc(1 + 0.02 * var(--j, 1)), calc(1 - 0.02 * var(--j, 1))); }
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
    const j = Math.max(0, (settings.jellyLevel ?? 100) / 100);
    host.style.setProperty('--j', String(j));
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
      if (!start) return;
      const dx = e.clientX - start.px;
      const dy = e.clientY - start.py;
      if (!start.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      start.moved = true;
      el.classList.add('dragging');
      if (settings.lockPos) {
        // Khi khóa vị trí: kéo sẽ làm nhân vật giãn nhẹ đàn hồi như thạch theo mức jellyLevel
        const k = Math.max(0, (settings.jellyLevel ?? 100) / 100);
        if (k > 0) {
          body.classList.remove('jelly');
          const tx = Math.tanh(dx / 90) * 14 * k;
          const ty = Math.tanh(dy / 90) * 14 * k;
          const sx = Math.max(0.5, 1 + (Math.tanh(Math.abs(dx) / 110) * 0.16 - Math.tanh(Math.abs(dy) / 110) * 0.08) * k);
          const sy = Math.max(0.5, 1 + (Math.tanh(Math.abs(dy) / 110) * 0.16 - Math.tanh(Math.abs(dx) / 110) * 0.08) * k);
          const rot = Math.tanh(dx / 110) * 4 * k;
          body.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
        }
        return;
      }
      const pos = clampPos(el, { x: start.x + dx, y: start.y + dy });
      el.style.left = pos.x + 'px';
      el.style.top = pos.y + 'px';
    });

    const end = (e) => {
      if (!start) return;
      const moved = start.moved;
      start = null;
      el.classList.remove('dragging');
      body.style.transform = '';
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      if (moved) {
        if (settings.lockPos) {
          jelly();
        } else {
          const rect = el.getBoundingClientRect();
          settings[key] = { x: Math.round(rect.left), y: Math.round(rect.top) };
          save({ [key]: settings[key] });
        }
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
      if ((settings.jellyLevel ?? 100) <= 0) return;
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
  let showToken = 0;

  // Chuyển layer mượt, không dùng setTimeout xóa src (tránh lỗi race condition làm mất write.gif)
  function showGif(key, onShown) {
    const token = ++showToken;
    const nextIdx = 1 - frontLayer;
    const back = layers[nextIdx];
    const front = layers[frontLayer];
    back.onload = null;
    back.onerror = null;
    back.removeAttribute('src');

    let done = false;
    const commit = () => {
      if (done || token !== showToken) return;
      done = true;
      back.onload = null;
      back.classList.add('show');
      front.classList.remove('show');
      frontLayer = nextIdx;
      if (onShown) onShown();
    };

    back.onload = commit;
    back.src = GIFS[key];
    if (back.complete && back.naturalWidth > 0) commit();
  }

  /* ==========================================================================
     3. ANIMATION STATE MACHINE
     ========================================================================== */
  const IMPRESS_LOOPS = 4;   // impress.gif (~2.55s) -> phát 4 vòng (~10.2s) rồi về idle
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
  // Nút Stop xuất hiện trong khi Gemini đang xử lý / trả lời (hỗ trợ đa ngôn ngữ & giao diện mới)
  const STOP_CLASS_SELECTORS = [
    'button.send-button.stop',
    '.send-button-container button.stop',
    'button[data-test-id="stop-button"]',
    'button[data-test-id*="stop"]',
    '.blue-circle.stop-icon',
    'button .stop-icon'
  ];
  const STOP_GENERIC_SELECTORS = [
    'button[aria-label*="Stop" i]',
    'button[aria-label*="Dừng" i]',
    'button[aria-label*="停止"]',
    'button[aria-label*="중지"]',
    'button[aria-label*="Arrêter" i]',
    'button[aria-label*="Detener" i]',
    'mat-icon[fonticon="stop"]',
    'mat-icon[data-mat-icon-name="stop"]',
    'mat-icon[fonticon="stop_circle"]',
    'mat-icon[data-mat-icon-name="stop_circle"]'
  ];
  const INPUT_SELECTOR = 'rich-textarea, .ql-editor, [contenteditable="true"], textarea';
  const THOUGHT_SELECTOR = 'model-thoughts, .thoughts-container, .thoughts-content, [data-test-id*="thought"], [class*="thoughts-"], [class*="-thoughts"]';

  function isVisible(el) {
    return !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  }

  function nearInput(el) {
    let node = el;
    for (let i = 0; i < 10 && node; i++) {
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
    // Kiểm tra thêm icon ligature (Material Symbols) trong nút cạnh ô nhập
    const icons = document.querySelectorAll('button mat-icon, button .google-symbols, button .material-symbols-outlined');
    for (const icon of icons) {
      const txt = (icon.textContent || '').trim().toLowerCase();
      if ((txt === 'stop' || txt === 'stop_circle' || txt === 'filled_stop') && isVisible(icon) && nearInput(icon)) {
        return true;
      }
    }
    return false;
  }

  function getLastResponse() {
    const list = document.querySelectorAll('model-response, [data-message-author-role="model"], [data-message-author="model"]');
    if (list.length) return list[list.length - 1];
    const containers = document.querySelectorAll('.response-container, .model-response-text');
    return containers.length ? containers[containers.length - 1] : null;
  }

  // Độ dài phần chữ trả lời thực tế (bỏ qua phần "suy nghĩ" model-thoughts)
  function answerLength(resp) {
    if (!resp) return 0;
    const candidates = Array.from(
      resp.querySelectorAll('message-content, .model-response-text, .markdown-main-panel, .markdown, .response-content, .response-container-content, code-block')
    ).filter((el) => !el.closest(THOUGHT_SELECTOR));

    // Chỉ lấy các node cấp cao nhất để không cộng trùng lặp cha + con
    const topNodes = candidates.filter((el) => !candidates.some((other) => other !== el && other.contains(el)));

    let len = 0;
    if (topNodes.length) {
      topNodes.forEach((n) => {
        let sub = (n.textContent || '').trim().length;
        n.querySelectorAll(THOUGHT_SELECTOR).forEach((t) => {
          sub -= (t.textContent || '').trim().length;
        });
        len += Math.max(0, sub);
      });
    } else {
      // Dự phòng nếu Gemini đổi cấu trúc thẻ bên trong model-response
      let sub = (resp.textContent || '').trim().length;
      resp.querySelectorAll(THOUGHT_SELECTOR + ', button, mat-icon, svg, [aria-hidden="true"]').forEach((t) => {
        sub -= (t.textContent || '').trim().length;
      });
      len = Math.max(0, sub);
    }

    // Ảnh / media / canvas trong câu trả lời cũng tính là đang/đã viết
    if (len <= 0) {
      const media = resp.querySelectorAll('img, generated-image, single-image, canvas-panel, immersive-editor');
      for (const m of media) {
        if (!m.closest(THOUGHT_SELECTOR) && !m.closest('.avatar, [class*="avatar"], [class*="icon"]')) {
          len = 1;
          break;
        }
      }
    }
    return Math.max(0, len);
  }

  const GROW_WINDOW = 1600;   // chữ tăng trong 1.6s gần nhất -> đang viết
  const MIN_WRITE_MS = 1400;  // giữ write.gif tối thiểu 1.4s để câu trả lời ngắn không bị lướt mất
  const IDLE_GRACE = 900;     // chờ thêm trước khi kết thúc (tránh nháy)
  const SUBMIT_TIMEOUT = 60000;

  let lastResp = null;
  let lastLen = 0;
  let lastGrowAt = -Infinity;
  let writeStartedAt = -Infinity;
  let navAt = performance.now();
  let lastUrl = location.href;
  let episode = null;          // {baseResp, baseLen, sawStop, wrote, submitted}
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
    const stop = isStopVisible();

    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // Chỉ reset khi chuyển sang cuộc trò chuyện khác lúc đang rảnh.
      // Nếu đang gửi câu hỏi ở chat mới (/app -> /app/<id>) thì giữ nguyên episode!
      if (!submitPending && !episode && !stop) {
        navAt = now;
        lastResp = null;
        lastLen = 0;
        lastGrowAt = -Infinity;
      }
    }

    const resp = getLastResponse();
    const len = answerLength(resp);
    const inNavCooldown = !submitPending && !episode && !stop && (now - navAt < 1800);

    if (!inNavCooldown && resp) {
      if (resp === lastResp && len > lastLen) {
        lastGrowAt = now;
      } else if (resp !== lastResp && episode && resp !== episode.baseResp && len > 0) {
        // Phản hồi mới vừa xuất hiện và đã có sẵn chữ trả lời
        lastGrowAt = now;
      }
    }
    lastResp = resp;
    lastLen = len;

    const growing = now - lastGrowAt < GROW_WINDOW;
    const hasNewText = len > 0 && (growing || !!(episode && (resp !== episode.baseResp || len > episode.baseLen)));

    if (submitPending) {
      const elapsed = now - submitPending;
      if (elapsed > SUBMIT_TIMEOUT) submitPending = 0;
      else if (episode && (episode.sawStop || episode.wrote) && !stop && !growing) submitPending = 0;
      // Không thấy nút Stop và cũng không có câu trả lời mới -> gửi không thành công
      else if (elapsed > 10000 && episode && !episode.sawStop && !hasNewText && resp === episode.baseResp) submitPending = 0;
    }

    const writeHold = episode && episode.wrote && (now - writeStartedAt < MIN_WRITE_MS);
    const busy = stop || growing || !!submitPending || !!writeHold;

    if (busy) {
      if (!episode) startEpisode();
      if (stop) episode.sawStop = true;
      lastBusyAt = now;
      const writing = hasNewText || (episode && episode.wrote);
      if (writing) {
        if (!episode.wrote) {
          episode.wrote = true;
          writeStartedAt = now;
        }
        if (growing) submitPending = 0;
        setState('write');
      } else {
        setState('think');
      }
    } else if (now - lastBusyAt > IDLE_GRACE) {
      // Vừa trả lời xong -> impress.gif (tự về idle khi phát xong)
      const finished = episode && (episode.sawStop || episode.wrote);
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

  let evalScheduled = false;
  function scheduleEvaluate() {
    if (evalScheduled) return;
    evalScheduled = true;
    setTimeout(() => {
      evalScheduled = false;
      evaluate();
    }, 80);
  }

  function init(stored) {
    settings = { ...DEFAULTS, ...(stored || {}) };
    mount();
    applySettings();
    setState('idle');
    evaluate();
    setInterval(() => {
      mount(); // Gemini là SPA, đảm bảo host không bị gỡ
      evaluate();
    }, 300);

    // Theo dõi DOM thời gian thực để bắt kịp ngay cả những câu trả lời cực nhanh
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const t = m.target;
        const el = t && (t.nodeType === 1 ? t : t.parentElement);
        if (el && !host.contains(el)) {
          scheduleEvaluate();
          break;
        }
      }
    });
    if (document.body) {
      obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    // Tính sẵn thời lượng GIF
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
