/* 절차적 간판 생성기: 가게 데이터(shops.json 한 줄)로 한국 대학가풍 간판 텍스처를 만든다.
   실제 로고 이미지는 쓰지 않는다. 프랜차이즈는 브랜드 색 조합과 상호 글자만 적용한다.
   사용: await Signs.ready(); const { texture, aspect, kind } = Signs.texture(THREE, shop, { width: 3, height: 0.9 }); */
(function () {
  'use strict';

  // ---------- 폰트 ----------
  const FONT_CSS = [
    'https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Do+Hyeon&family=Jua&family=Gowun+Batang:wght@700&family=Nanum+Myeongjo:wght@800&family=Gaegu:wght@700&display=swap',
    'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css',
  ];
  const F = {
    heavy: { family: 'Black Han Sans', weight: 400 },
    round: { family: 'Jua', weight: 400 },
    hyeon: { family: 'Do Hyeon', weight: 400 },
    batang: { family: 'Gowun Batang', weight: 700 },
    myeongjo: { family: 'Nanum Myeongjo', weight: 800 },
    hand: { family: 'Gaegu', weight: 700 },
    sans: { family: 'Pretendard Variable', weight: 800 },
  };
  const FALLBACK = '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
  const fontStr = (f, px, weight) => `${weight || f.weight} ${Math.round(px)}px "${f.family}", ${FALLBACK}`;

  // ---------- 로고(web/data/logos.json)와 사진 간판(web/data/sign_photos.json) ----------
  // 둘 다 없으면 조용히 넘어가고 절차적 간판을 쓴다.
  const BASE = (function () {
    const s = typeof document !== 'undefined' && document.currentScript && document.currentScript.src;
    return s ? s.replace(/[^/]*$/, '') : '';
  })();
  const LOGOS = [];            // { key, name, match: [], bg, fg, img, state: 'loading'|'ok'|'fail', waiters: [] }
  const PHOTO_IDS = new Set(); // web/assets/signs/<id>.(jpg|png|webp)
  const PHOTO_EXT = {};        // id → 확장자 (기본 jpg)
  const PHOTO_SRC = {};        // id → 직접 등록한 이미지/URL (setPhoto)

  function loadImage(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => res(im); im.onerror = rej; im.src = src;
    });
  }
  function fetchJSON(path) {
    return fetch(BASE + path, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  function loadLogos(json) {
    if (!json || !json.brands) return Promise.resolve();
    const jobs = Object.entries(json.brands).map(([key, b]) => {
      const L = { key, name: b.name || key, match: (b.match || [b.name || key]).map((m) => String(m).toLowerCase()),
        bg: b.bg || '#ffffff', fg: b.fg || ink(b.bg || '#ffffff'), img: null, state: 'loading', waiters: [] };
      LOGOS.push(L);
      if (!b.file) { L.state = 'fail'; return Promise.resolve(); }
      return loadImage(BASE + b.file).then((im) => { L.img = im; L.state = 'ok'; }, () => { L.state = 'fail'; })
        .then(() => { L.waiters.forEach((f) => f()); L.waiters = []; });
    });
    return Promise.all(jobs);
  }
  function loadPhotoList(json) {
    if (!json) return;
    (json.ids || []).forEach((id) => PHOTO_IDS.add(String(id)));
    Object.entries(json.ext || {}).forEach(([id, e]) => { PHOTO_EXT[id] = e; });
  }
  function logoOf(name) {
    const n = String(name || '').toLowerCase();
    return LOGOS.find((L) => L.state !== 'fail' && L.match.some((m) => m && n.includes(m))) || null;
  }

  let readyPromise = null;
  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = new Promise((resolve) => {
      if (typeof document === 'undefined') return resolve();
      FONT_CSS.forEach((href) => {
        if (document.querySelector(`link[href="${href}"]`)) return;
        const l = document.createElement('link');
        l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
      });
      const sample = '가나다라궁동어은커피치킨분식0123ABC';
      const loads = Object.values(F).map((f) => document.fonts.load(fontStr(f, 40), sample).catch(() => null));
      const data = Promise.all([fetchJSON('data/logos.json').then(loadLogos), fetchJSON('data/sign_photos.json').then(loadPhotoList)]);
      // 폰트 서버가 느려도 앱이 멈추지 않게 최대 4초만 기다린다
      Promise.race([Promise.all([Promise.all(loads), data]), new Promise((r) => setTimeout(r, 4000))]).then(() => resolve());
    });
    return readyPromise;
  }

  // 테스트나 앱에서 사진 간판을 직접 등록할 때 (src: URL 문자열, Image, Canvas)
  function setPhoto(id, src) { PHOTO_SRC[String(id)] = src; PHOTO_IDS.add(String(id)); }

  // ---------- 시드 난수 ----------
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

  // ---------- 색 ----------
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbToHex(c) { return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
  function lum(h) { const [r, g, b] = hexToRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
  function mix(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return rgbToHex(A.map((v, i) => v + (B[i] - v) * t)); }
  // 웹 전체 로우폴리 톤에 맞게 채도를 살짝 낮춘다
  function soften(h, k = 0.12) { const [r, g, b] = hexToRgb(h); const m = (r + g + b) / 3; return rgbToHex([r + (m - r) * k, g + (m - g) * k, b + (m - b) * k]); }
  const ink = (bg) => (lum(bg) > 0.38 ? '#1f2328' : '#fbfaf6');

  const FACES = ['#d64541', '#e8833a', '#f2c14e', '#3f9b6b', '#2f8f9d', '#3b6fb6', '#23395d', '#7a4b35', '#f3e9d2', '#f7f7f2', '#2a2a2e', '#b23a48', '#5b8c5a'];

  // ---------- 프랜차이즈: 브랜드 색 조합 + 상호 글자만 ----------
  const BRANDS = [
    { re: /GS25|지에스\s?25/i, text: 'GS25', bg: '#ffffff', fg: '#0b4f9c', bands: ['#38b6e8', '#0b4f9c'], kind: 'band', font: 'sans' },
    { re: /씨유|(^|[^A-Za-z])CU([^A-Za-z]|$)/, text: 'CU', bg: '#6d3a96', fg: '#ffffff', bands: ['#a5cd39'], kind: 'band', font: 'sans' },
    { re: /세븐일레븐|7-?ELEVEN/i, text: '세븐일레븐', bg: '#ffffff', fg: '#0f7a43', bands: ['#f58220', '#0f7a43', '#e31837'], kind: 'band', font: 'sans' },
    { re: /이마트\s?24|emart\s?24/i, text: 'emart24', bg: '#ffd200', fg: '#1f1f1f', bands: ['#1f1f1f'], kind: 'band', font: 'sans' },
    { re: /메가\s?(엠지씨|MGC)?\s?커피|메가커피/i, text: '메가MGC커피', bg: '#ffd200', fg: '#3b2314', kind: 'flex', font: 'heavy' },
    { re: /빽다방/, text: '빽다방', bg: '#ffd84a', fg: '#1d2c5e', kind: 'flex', font: 'heavy' },
    { re: /컴포즈/, text: 'COMPOSE COFFEE', bg: '#ffd84a', fg: '#1b1b1b', kind: 'flex', font: 'sans' },
    { re: /이디야/, text: 'EDIYA COFFEE', bg: '#1b2a5e', fg: '#ffffff', kind: 'channel', font: 'sans' },
    { re: /스타벅스/, text: 'STARBUCKS', bg: '#0b5b3c', fg: '#ffffff', kind: 'channel', font: 'sans' },
    { re: /투썸/, text: 'A TWOSOME PLACE', bg: '#1d1d1d', fg: '#ffffff', bands: ['#c8102e'], kind: 'channel', font: 'sans' },
    { re: /더벤티/, text: 'THE VENTI', bg: '#4b2a7b', fg: '#ffffff', kind: 'flex', font: 'sans' },
    { re: /공차/, text: '공차', bg: '#2a2a2a', fg: '#ffffff', bands: ['#b11f2d'], kind: 'flex', font: 'heavy' },
    { re: /맘스터치/, text: '맘스터치', bg: '#c8102e', fg: '#ffffff', kind: 'flex', font: 'heavy' },
    { re: /롯데리아/, text: '롯데리아', bg: '#d7182a', fg: '#ffffff', kind: 'flex', font: 'heavy' },
    { re: /써브웨이|서브웨이|SUBWAY/i, text: 'SUBWAY', bg: '#00843d', fg: '#ffc20e', kind: 'flex', font: 'sans' },
    { re: /교촌/, text: '교촌치킨', bg: '#1c1c1c', fg: '#c9a24a', kind: 'channel', font: 'myeongjo' },
    { re: /BBQ|비비큐/i, text: 'BBQ', bg: '#c8102e', fg: '#ffffff', kind: 'flex', font: 'sans' },
    { re: /BHC|비에이치씨/i, text: 'bhc', bg: '#d71f26', fg: '#ffffff', kind: 'flex', font: 'sans' },
    { re: /굽네/, text: '굽네치킨', bg: '#c8102e', fg: '#ffffff', kind: 'flex', font: 'heavy' },
    { re: /본죽/, text: '본죽', bg: '#6b3e26', fg: '#f3e2c0', kind: 'flex', font: 'myeongjo' },
    { re: /한솥/, text: '한솥도시락', bg: '#f47a20', fg: '#ffffff', kind: 'flex', font: 'heavy' },
    { re: /파리바게[뜨트]/, text: 'PARIS BAGUETTE', bg: '#13294b', fg: '#ffffff', kind: 'channel', font: 'myeongjo' },
  ];
  function brandOf(name) { return BRANDS.find((b) => b.re.test(name)) || null; }

  // ---------- 상호 나누기: 본 이름 + 지점(부제) ----------
  function splitName(name) {
    let n = String(name || '').trim();
    let branch = '';
    const paren = n.match(/^(.*?)\s*[(\[]([^)\]]+)[)\]]\s*(.*)$/);
    if (paren) {
      const inner = paren[2];
      if (/점$|캠퍼스|본점/.test(inner)) { branch = inner; n = (paren[1] + ' ' + paren[3]).trim(); }
      else n = (paren[1] + ' ' + paren[3]).trim() || inner; // 영문 병기 등은 본 이름만 남김
    }
    const parts = n.split(/\s+/);
    if (!branch && parts.length > 1 && /점$/.test(parts[parts.length - 1]) && parts[parts.length - 1].length >= 3) {
      branch = parts.pop(); n = parts.join(' ');
    }
    n = n.replace(/^(주식회사|\(주\)|㈜)\s*/, '');
    return { main: n || String(name || ''), branch };
  }

  // ---------- 부제(업종) ----------
  const SUBS = {
    korean: ['한식 전문', '집밥 · 정식', 'KOREAN FOOD', '맛있는 한 끼'],
    world: ['WORLD FOOD', '중화요리', '일식 · 덮밥', 'PASTA & STEAK'],
    snack: ['분식', '떡볶이 · 김밥', 'SNACK BAR', '포장 · 배달'],
    chicken: ['CHICKEN & BEER', '치킨 · 호프', '후라이드 · 양념'],
    bar: ['PUB & BAR', '술 · 안주', 'IZAKAYA', '포차'],
    cafe: ['COFFEE', 'CAFE & DESSERT', 'ROASTERS', 'BAKERY'],
    conv: ['24시 편의점', 'CONVENIENCE'],
    leisure: ['PC CAFE', '24H · 고사양', 'GAME ZONE'],
    beauty: ['HAIR', '헤어 살롱'],
    etc: ['음식점', 'FOOD', '포장 가능'],
  };
  function subFor(shop, r) {
    const n = shop.name || '';
    if (/라멘|스시|초밥|돈까스|돈가스|우동|규동|이자카야/.test(n)) return '일식';
    if (/짬뽕|짜장|반점|마라|양꼬치|훠궈/.test(n)) return '중화요리';
    if (/쌀국수|베트남|타이|태국|팟타이/.test(n)) return 'ASIAN FOOD';
    if (/파스타|피자|스테이크|브런치/.test(n)) return 'PASTA & PIZZA';
    if (/떡볶이/.test(n)) return '떡볶이 전문';
    if (/국밥|감자탕|해장/.test(n)) return '24시 국밥';
    if (/고기|삼겹|갈비|구이|돼지|소고기|막창|곱창/.test(n)) return '숯불 · 구이';
    return pick(r, SUBS[shop.cat] || SUBS.etc);
  }

  // ---------- 아이콘 (이모지 대신 캔버스 벡터) ----------
  function iconFor(shop) {
    const n = shop.name || '';
    if (shop.cat === 'leisure') return 'gamepad';
    if (shop.cat === 'conv') return 'shop';
    if (shop.cat === 'bar') return 'beer';
    if (shop.cat === 'chicken') return /호프|비어|맥주/.test(n) ? 'beer' : 'chicken';
    if (/케이크|케익|디저트|베이커리|제과|와플|빵|마카롱|도넛/.test(n)) return 'cake';
    if (shop.cat === 'cafe') return 'coffee';
    if (/버거|피자|샌드위치|서브웨이|써브웨이|토스트|핫도그/.test(n)) return 'burger';
    if (/면|국수|라멘|우동|짬뽕|짜장|쌀국수|냉면|칼국수|소바|파스타|마라/.test(n)) return 'noodle';
    if (shop.cat === 'snack') return 'noodle';
    return 'rice';
  }
  function drawIcon(g, type, x, y, s, col) {
    g.save(); g.translate(x, y); g.scale(s / 100, s / 100);
    g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round';
    const P = () => g.beginPath();
    switch (type) {
      case 'coffee':
        P(); g.moveTo(18, 40); g.lineTo(72, 40); g.lineTo(66, 86); g.quadraticCurveTo(45, 94, 24, 86); g.closePath(); g.fill();
        P(); g.arc(78, 58, 12, -Math.PI / 2, Math.PI / 2); g.stroke();
        [32, 46, 60].forEach((sx) => { P(); g.moveTo(sx, 30); g.bezierCurveTo(sx - 7, 22, sx + 7, 16, sx, 6); g.stroke(); });
        break;
      case 'cake':
        P(); g.rect(16, 52, 68, 34); g.fill();
        P(); g.moveTo(16, 52); g.quadraticCurveTo(50, 34, 84, 52); g.fill();
        g.globalCompositeOperation = 'destination-out'; P(); g.rect(16, 64, 68, 5); g.fill(); g.globalCompositeOperation = 'source-over';
        P(); g.moveTo(50, 36); g.lineTo(50, 20); g.stroke(); P(); g.ellipse(50, 12, 5, 8, 0, 0, Math.PI * 2); g.fill();
        break;
      case 'chicken':
        P(); g.ellipse(42, 42, 28, 24, -0.7, 0, Math.PI * 2); g.fill();
        g.lineWidth = 11; P(); g.moveTo(58, 58); g.lineTo(76, 78); g.stroke();
        P(); g.arc(80, 76, 8, 0, Math.PI * 2); g.fill(); P(); g.arc(74, 84, 8, 0, Math.PI * 2); g.fill();
        break;
      case 'noodle':
        P(); g.moveTo(10, 50); g.lineTo(90, 50); g.quadraticCurveTo(86, 88, 50, 90); g.quadraticCurveTo(14, 88, 10, 50); g.fill();
        g.lineWidth = 5; [30, 42, 54].forEach((sx) => { P(); g.moveTo(sx, 50); g.bezierCurveTo(sx - 6, 40, sx + 6, 34, sx, 24); g.stroke(); });
        g.lineWidth = 6; P(); g.moveTo(62, 46); g.lineTo(90, 8); g.stroke(); P(); g.moveTo(70, 48); g.lineTo(96, 16); g.stroke();
        break;
      case 'rice':
        P(); g.moveTo(10, 52); g.lineTo(90, 52); g.quadraticCurveTo(86, 90, 50, 90); g.quadraticCurveTo(14, 90, 10, 52); g.fill();
        P(); g.moveTo(16, 50); g.quadraticCurveTo(50, 14, 84, 50); g.closePath(); g.globalAlpha = 0.55; g.fill(); g.globalAlpha = 1;
        g.lineWidth = 6; P(); g.moveTo(30, 96); g.lineTo(70, 96); g.stroke();
        break;
      case 'beer':
        P(); g.rect(20, 30, 46, 62); g.fill();
        g.lineWidth = 8; P(); g.moveTo(66, 44); g.lineTo(80, 44); g.lineTo(80, 74); g.lineTo(66, 74); g.stroke();
        [24, 38, 52, 64].forEach((cx, i) => { P(); g.arc(cx, 26 - (i % 2) * 5, 10, 0, Math.PI * 2); g.fill(); });
        break;
      case 'burger':
        P(); g.moveTo(14, 46); g.quadraticCurveTo(50, 4, 86, 46); g.closePath(); g.fill();
        P(); g.rect(10, 52, 80, 9); g.fill(); P(); g.rect(14, 66, 72, 8); g.fill();
        P(); g.moveTo(14, 78); g.lineTo(86, 78); g.quadraticCurveTo(84, 92, 50, 92); g.quadraticCurveTo(16, 92, 14, 78); g.fill();
        break;
      case 'gamepad':
        P(); g.moveTo(22, 34); g.lineTo(78, 34); g.quadraticCurveTo(98, 34, 96, 66); g.quadraticCurveTo(94, 86, 78, 76); g.lineTo(66, 66);
        g.lineTo(34, 66); g.lineTo(22, 76); g.quadraticCurveTo(6, 86, 4, 66); g.quadraticCurveTo(2, 34, 22, 34); g.fill();
        g.globalCompositeOperation = 'destination-out';
        P(); g.rect(20, 46, 18, 6); g.fill(); P(); g.rect(26, 40, 6, 18); g.fill();
        P(); g.arc(70, 44, 4.5, 0, 7); g.fill(); P(); g.arc(80, 54, 4.5, 0, 7); g.fill();
        g.globalCompositeOperation = 'source-over';
        break;
      default: // shop
        P(); g.rect(16, 48, 68, 42); g.fill();
        P(); g.moveTo(8, 48); g.lineTo(18, 18); g.lineTo(82, 18); g.lineTo(92, 48); g.closePath(); g.fill();
        g.globalCompositeOperation = 'destination-out'; P(); g.rect(42, 62, 16, 28); g.fill(); g.globalCompositeOperation = 'source-over';
    }
    g.restore();
  }

  // ---------- 글자 맞추기 ----------
  function fitLines(g, text, f, maxW, maxH, weight) {
    let size = maxH;
    g.font = fontStr(f, size, weight);
    let w = g.measureText(text).width;
    if (w <= maxW) return { lines: [text], size };
    const one = Math.max(maxH * 0.42, maxH * maxW / w);
    // 너무 작아지면 두 줄로
    if (one < maxH * 0.62 && text.length >= 6) {
      const sp = text.indexOf(' ', Math.floor(text.length / 3));
      const cut = sp > 0 && sp < text.length - 1 ? sp : Math.ceil(text.length / 2);
      const lines = [text.slice(0, cut).trim(), text.slice(cut).trim()];
      let s2 = maxH * 0.5;
      g.font = fontStr(f, s2, weight);
      const lw = Math.max(...lines.map((l) => g.measureText(l).width));
      if (lw > maxW) s2 *= maxW / lw;
      return { lines, size: s2 };
    }
    return { lines: [text], size: one };
  }
  function drawText(g, fit, f, cx, cy, color, opts = {}) {
    g.font = fontStr(f, fit.size, opts.weight);
    g.textAlign = opts.align || 'center'; g.textBaseline = 'middle';
    const lh = fit.size * 1.05, y0 = cy - (lh * (fit.lines.length - 1)) / 2;
    fit.lines.forEach((l, i) => {
      const y = y0 + i * lh;
      if (opts.stroke) { g.lineWidth = opts.stroke.w; g.strokeStyle = opts.stroke.c; g.strokeText(l, cx, y); }
      if (opts.shadow) { g.fillStyle = opts.shadow; g.fillText(l, cx + fit.size * 0.05, y + fit.size * 0.06); }
      if (opts.glow) { g.shadowColor = opts.glow; g.shadowBlur = opts.glowBlur || fit.size * 0.5; }
      g.fillStyle = color; g.fillText(l, cx, y);
      g.shadowBlur = 0;
    });
  }

  // ---------- 질감 ----------
  function panelGradient(g, W, H, base, amount = 0.12) {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, mix(base, '#ffffff', amount)); gr.addColorStop(1, mix(base, '#000000', amount));
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  function frame(g, W, H, col, t) { g.strokeStyle = col; g.lineWidth = t; g.strokeRect(t / 2, t / 2, W - t, H - t); }
  function bolts(g, W, H, col, r) {
    g.fillStyle = col;
    [[r * 2.2, r * 2.2], [W - r * 2.2, r * 2.2], [r * 2.2, H - r * 2.2], [W - r * 2.2, H - r * 2.2]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); });
  }
  function weather(g, W, H, age, r) {
    const fade = Math.max(0, Math.min(0.32, (age - 6) / 40));
    if (fade > 0) { g.fillStyle = `rgba(236,226,206,${fade})`; g.fillRect(0, 0, W, H); }
    const n = Math.round(W * H / 900 * (0.3 + fade * 3));
    for (let i = 0; i < n; i++) { g.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.06})`; g.fillRect(r() * W, r() * H, 1 + r() * 1.5, 1 + r() * 1.5); }
    const grime = g.createLinearGradient(0, H * 0.6, 0, H);
    grime.addColorStop(0, 'rgba(0,0,0,0)'); grime.addColorStop(1, `rgba(40,30,20,${0.06 + fade * 0.35})`);
    g.fillStyle = grime; g.fillRect(0, 0, W, H);
  }

  // ---------- 간판 종류 결정 ----------
  function chooseKind(shop, brand, r) {
    if (shop.vacant) return 'vacant';
    if (brand) return brand.kind;
    const c = shop.cat, x = r();
    if (c === 'conv' || c === 'leisure') return x < 0.7 ? 'band' : 'channel';
    if (c === 'bar') return x < 0.7 ? 'neon' : 'channel';
    if (c === 'cafe') return x < 0.45 ? 'awning' : x < 0.75 ? 'channel' : 'flex';
    if (c === 'korean') return x < 0.35 ? 'traditional' : 'flex';
    if (c === 'world') return x < 0.5 ? 'flex' : x < 0.8 ? 'channel' : 'traditional';
    if (c === 'etc') return x < 0.6 ? 'flex' : 'channel';
    return 'flex';
  }
  function chooseFont(kind, shop, brand, r) {
    if (brand) return F[brand.font];
    if (kind === 'traditional') return pick(r, [F.myeongjo, F.batang, F.hand]);
    if (kind === 'neon') return pick(r, [F.round, F.hand, F.hyeon]);
    if (kind === 'channel') return pick(r, [F.sans, F.hyeon, F.heavy]);
    if (kind === 'awning') return pick(r, [F.round, F.batang, F.sans]);
    return pick(r, [F.heavy, F.hyeon, F.round, F.sans, F.heavy]);
  }

  // ---------- 그리기 ----------
  function paint(g, W, H, shop, opts, plan) {
    const { kind, brand, font, r0 } = plan;
    const r = rng(r0);
    const { main, branch } = splitName(shop.name);
    const title = brand ? brand.text : main;
    const sub = brand ? (branch || '') : (branch || subFor(shop, r));
    const night = !!opts.night;
    const age = shop.open ? Math.max(0, 2026 - parseInt(shop.open.slice(0, 4), 10)) : 3;
    const pad = H * 0.1;
    const fonts = [];
    const use = (f, px, text) => { fonts.push([fontStr(f, px), text]); };

    g.clearRect(0, 0, W, H);

    if (kind === 'vacant') {
      g.fillStyle = '#efefe9'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#d93a32'; g.fillRect(0, 0, W, H * 0.16); g.fillRect(0, H * 0.84, W, H * 0.16);
      const fit = fitLines(g, '임 대 문 의', F.heavy, W * 0.8, H * 0.46);
      drawText(g, fit, F.heavy, W / 2, H * 0.47, '#d93a32'); use(F.heavy, fit.size, '임대문의');
      g.font = fontStr(F.sans, H * 0.12); g.fillStyle = '#555'; g.textAlign = 'center';
      g.fillText('상가 임대 · 즉시 입주 가능', W / 2, H * 0.73); use(F.sans, H * 0.12, '상가임대즉시입주가능');
      weather(g, W, H, 8, r);
      return fonts;
    }

    // 면 색
    let bg = brand ? brand.bg : soften(pick(r, FACES));
    if (kind === 'traditional') bg = pick(r, ['#8a5a36', '#6e4527', '#a0703f', '#2f2a26']);
    if (kind === 'channel' && !brand) bg = pick(r, ['#2a2a2e', '#1f2a37', '#3a3430', '#f4f1ea', '#2f3b2f']);
    if (kind === 'neon') bg = pick(r, ['#15151c', '#1b1630', '#101e24']);
    let fg = brand ? brand.fg : ink(bg);
    if (kind === 'channel' && !brand && lum(bg) < 0.2) fg = pick(r, ['#ffffff', '#ffe08a', '#bfe6ff', '#ffd1c4']);
    if (kind === 'traditional') fg = lum(bg) < 0.1 ? '#f1d9a6' : '#fff6e6';
    const neonCol = pick(r, ['#ff4fa3', '#4ff0ff', '#ffe95c', '#9dff6a', '#c58bff']);

    // 배경
    if (kind === 'awning') {
      const stripe = soften(pick(r, ['#c8453b', '#2f6f8f', '#3f7d4f', '#d08a2c', '#5b4b8a']));
      const n = 8 + Math.floor(r() * 4), sw = W / n;
      for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? '#f6f2e8' : stripe; g.fillRect(i * sw, 0, sw + 1, H * 0.7); }
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, H * 0.62, W, H * 0.08);
      // 스캘럽 아래 끝
      g.fillStyle = stripe;
      for (let i = 0; i < n; i++) { g.beginPath(); g.arc(i * sw + sw / 2, H * 0.7, sw / 2, 0, Math.PI); g.fill(); }
      // 가운데 이름판
      const bw = W * 0.7, bh = H * 0.5, bx = (W - bw) / 2, by = H * 0.16;
      g.fillStyle = '#fbf8f0'; g.fillRect(bx, by, bw, bh); frame(g, W, H, 'rgba(0,0,0,0)', 0);
      g.strokeStyle = stripe; g.lineWidth = H * 0.025; g.strokeRect(bx, by, bw, bh);
      const fit = fitLines(g, title, font, bw * 0.86, bh * 0.62);
      drawText(g, fit, font, W / 2, by + bh * 0.46, mix(stripe, '#000', 0.25)); use(font, fit.size, title);
      if (sub) { const s = Math.min(H * 0.1, bh * 0.2); g.font = fontStr(F.sans, s, 600); g.fillStyle = '#6a6a6a'; g.textAlign = 'center'; g.fillText(sub, W / 2, by + bh * 0.86); use(F.sans, s, sub); }
      weather(g, W, H, age, r);
      return fonts;
    }

    if (kind === 'neon') {
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.strokeStyle = neonCol; g.lineWidth = H * 0.025; g.shadowColor = neonCol; g.shadowBlur = night ? H * 0.12 : H * 0.04;
      g.strokeRect(pad * 0.8, pad * 0.8, W - pad * 1.6, H - pad * 1.6); g.shadowBlur = 0;
      const fit = fitLines(g, title, font, W * 0.62, H * 0.5);
      drawText(g, fit, font, W * 0.56, H * 0.46, night ? '#ffffff' : mix(neonCol, '#ffffff', 0.35), { glow: neonCol, glowBlur: night ? fit.size * 0.7 : fit.size * 0.25 });
      use(font, fit.size, title);
      drawIcon(g, iconFor(shop), pad * 1.6, H / 2 - H * 0.28, H * 0.56, neonCol);
      if (sub) { const s = H * 0.1; g.font = fontStr(F.sans, s, 600); g.fillStyle = neonCol; g.textAlign = 'center'; g.fillText(sub, W * 0.56, H * 0.8); use(F.sans, s, sub); }
      return fonts;
    }

    if (kind === 'band') {
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      const bands = brand && brand.bands ? brand.bands : [soften(pick(r, ['#3b6fb6', '#2f8f9d', '#e8833a', '#3f9b6b'])), soften(pick(r, ['#23395d', '#d64541', '#f2c14e']))];
      const bh = H * 0.1;
      bands.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, H - bh * (bands.length - i), W, bh); });
      const area = H - bh * bands.length;
      // 오른쪽 22%는 부제(지점명·업종) 칸, 제목은 그 왼쪽 칸 안에서만 맞춘다
      const left = brand ? pad : pad * 1.5 + area * 0.6 + pad * 0.5, right = W * 0.76;
      const fit = fitLines(g, title, font, right - left - pad * 0.5, area * 0.62);
      drawText(g, fit, font, (left + right) / 2, area * 0.5, fg); use(font, fit.size, title);
      if (!brand) drawIcon(g, iconFor(shop), pad * 1.5, area / 2 - area * 0.3, area * 0.6, mix(bands[0], '#000', 0.1));
      if (sub || brand) {
        const t = brand ? (sub || '24시간 영업') : sub;
        let s = H * 0.11; g.font = fontStr(F.sans, s, 700);
        const tw = g.measureText(t).width, room = W - right - pad;
        if (tw > room) { s *= room / tw; g.font = fontStr(F.sans, s, 700); }
        g.fillStyle = fg; g.globalAlpha = 0.75; g.textBaseline = 'middle';
        g.textAlign = 'center'; g.fillText(t, (right + W - pad) / 2, area * 0.5); g.globalAlpha = 1; use(F.sans, s, t);
      }
      weather(g, W, H, Math.min(age, 6), r);
      return fonts;
    }

    if (kind === 'channel') {
      panelGradient(g, W, H, bg, 0.08);
      // 레이스웨이(글자 받침 막대)
      g.fillStyle = mix(bg, '#000', 0.25); g.fillRect(W * 0.08, H * 0.74, W * 0.84, H * 0.05);
      const fit = fitLines(g, title, font, W * 0.7, H * 0.58);
      const glow = night ? fg : null;
      drawText(g, fit, font, W * 0.55, H * 0.45, fg, { shadow: 'rgba(0,0,0,0.35)', glow, glowBlur: fit.size * 0.35 });
      use(font, fit.size, title);
      drawIcon(g, iconFor(shop), pad * 1.4, H / 2 - H * 0.26, H * 0.5, brand && brand.bands ? brand.bands[0] : mix(fg, bg, 0.2));
      if (sub) { const s = H * 0.1; g.font = fontStr(F.sans, s, 600); g.fillStyle = mix(fg, bg, 0.35); g.textAlign = 'center'; g.fillText(sub, W * 0.55, H * 0.88); use(F.sans, s, sub); }
      weather(g, W, H, age, r);
      return fonts;
    }

    if (kind === 'traditional') {
      panelGradient(g, W, H, bg, 0.1);
      g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2; // 나뭇결
      for (let y = 6; y < H; y += 7 + r() * 6) { g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(W * 0.3, y + r() * 4 - 2, W * 0.7, y + r() * 4 - 2, W, y); g.stroke(); }
      frame(g, W, H, mix(bg, '#000', 0.35), H * 0.06);
      frame(g, W, H, mix(fg, bg, 0.4), H * 0.015);
      const fit = fitLines(g, title, font, W * 0.72, H * 0.58);
      drawText(g, fit, font, W * 0.55, H * 0.47, fg, { shadow: 'rgba(0,0,0,0.3)' }); use(font, fit.size, title);
      // 낙관(빨간 도장)
      const ss = H * 0.2; g.fillStyle = '#b23a2e'; g.fillRect(W - pad * 1.2 - ss, H - pad * 1.1 - ss, ss, ss);
      drawIcon(g, iconFor(shop), pad * 1.3, H / 2 - H * 0.24, H * 0.48, mix(fg, bg, 0.15));
      if (sub) { const s = H * 0.1; g.font = fontStr(F.batang, s); g.fillStyle = mix(fg, bg, 0.3); g.textAlign = 'center'; g.fillText(sub, W * 0.55, H * 0.85); use(F.batang, s, sub); }
      weather(g, W, H, age + 4, r);
      return fonts;
    }

    // flex (기본 가로형 플렉스 간판)
    panelGradient(g, W, H, bg, 0.1);
    frame(g, W, H, mix(bg, '#000', 0.3), H * 0.05);
    const accent = brand && brand.bands ? brand.bands[0] : (lum(bg) > 0.5 ? soften(pick(r, ['#d64541', '#3b6fb6', '#3f9b6b', '#e8833a'])) : mix(bg, '#ffffff', 0.85));
    const hasIcon = !brand;
    const tx = hasIcon ? W * 0.57 : W * 0.5;
    const fit = fitLines(g, title, font, hasIcon ? W * 0.66 : W * 0.84, H * (sub ? 0.5 : 0.62));
    drawText(g, fit, font, tx, H * (sub ? 0.42 : 0.5), fg, { stroke: lum(bg) > 0.6 ? null : { w: fit.size * 0.06, c: mix(bg, '#000', 0.4) } });
    use(font, fit.size, title);
    if (hasIcon) {
      g.fillStyle = mix(bg, lum(bg) > 0.5 ? '#000' : '#fff', 0.12);
      g.beginPath(); g.arc(pad * 1.2 + H * 0.3, H / 2, H * 0.34, 0, 7); g.fill();
      drawIcon(g, iconFor(shop), pad * 1.2 + H * 0.04, H / 2 - H * 0.26, H * 0.52, accent);
    }
    if (sub) {
      const s = H * 0.11; g.font = fontStr(F.sans, s, 700);
      const tw = g.measureText(sub).width + s * 1.2;
      g.fillStyle = mix(bg, lum(bg) > 0.5 ? '#000' : '#fff', 0.15);
      g.fillRect(tx - tw / 2, H * 0.72, tw, s * 1.5);
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(sub, tx, H * 0.72 + s * 0.78); use(F.sans, s, sub);
    }
    bolts(g, W, H, mix(bg, '#000', 0.35), H * 0.025);
    weather(g, W, H, age, r);
    return fonts;
  }

  // ---------- 텍스처 ----------
  const cache = new Map();
  function makeTexture(THREE, canvas) {
    const t = new THREE.CanvasTexture(canvas);
    if (THREE.sRGBEncoding !== undefined) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    return t;
  }
  // 아직 안 내려받은 글자가 있으면 받은 뒤 다시 그린다(한글 웹폰트는 글자 범위별로 나뉘어 있음)
  function refreshWhenFontsArrive(fonts, redraw) {
    if (typeof document === 'undefined' || !document.fonts) return;
    const missing = fonts.filter(([f, t]) => { try { return !document.fonts.check(f, t); } catch (e) { return false; } });
    if (!missing.length) return;
    Promise.all(missing.map(([f, t]) => document.fonts.load(f, t).catch(() => null))).then(redraw);
  }

  // 로고 간판: 브랜드 바탕색 위에 로고(비율 유지) + 지점명
  function paintLogo(g, W, H, shop, L) {
    const { branch } = splitName(shop.name);
    panelGradient(g, W, H, L.bg, 0.06);
    frame(g, W, H, mix(L.bg, '#000', 0.25), H * 0.04);
    const pad = H * 0.14;
    const areaW = (branch ? W * 0.7 : W) - pad * 2, areaH = H - pad * 2;
    let iw = L.img.naturalWidth || L.img.width || 300, ih = L.img.naturalHeight || L.img.height || 100;
    const k = Math.min(areaW / iw, areaH / ih);
    const dw = iw * k, dh = ih * k;
    const cx = branch ? pad + areaW / 2 : W / 2;
    g.imageSmoothingQuality = 'high';
    g.drawImage(L.img, cx - dw / 2, H / 2 - dh / 2, dw, dh);
    const fonts = [];
    if (branch) {
      const x0 = W * 0.7, s = Math.min(H * 0.16, (W * 0.28) / Math.max(4, branch.length) * 1.6);
      g.fillStyle = mix(L.bg, L.fg, 0.25); g.fillRect(x0, H * 0.22, Math.max(1, H * 0.012), H * 0.56);
      g.font = fontStr(F.sans, s, 700); g.fillStyle = L.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(branch, x0 + (W - x0) / 2, H / 2); fonts.push([fontStr(F.sans, s, 700), branch]);
    }
    return fonts;
  }
  // 사진 간판: 이미 정면으로 펴진 사진을 간판 칸에 꽉 채운다(비율이 다르면 가운데 기준으로 잘라냄)
  function paintPhoto(g, W, H, img) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const k = Math.max(W / iw, H / ih), dw = iw * k, dh = ih * k;
    g.imageSmoothingQuality = 'high';
    g.clearRect(0, 0, W, H);
    g.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  function photoSource(id) {
    const s = PHOTO_SRC[id];
    if (s && typeof s !== 'string') return Promise.resolve(s);
    return loadImage(s || `${BASE}assets/signs/${id}.${PHOTO_EXT[id] || 'jpg'}`);
  }

  function texture(THREE, shop, opts = {}) {
    const wM = opts.width || 3, hM = opts.height || 0.9;
    const lod = opts.lod === 'lo' ? 'lo' : 'hi';
    const vacant = !!opts.vacant, night = !!opts.night;
    const key = [shop.id || shop.name, wM.toFixed(2), hM.toFixed(2), lod, vacant ? 1 : 0, night ? 1 : 0].join('|');
    if (cache.has(key)) return cache.get(key);

    const aspect = wM / hM;
    let W = 512, H = Math.round(512 / aspect);
    if (H > 256) { H = 256; W = Math.round(256 * aspect); }
    H = Math.max(64, H);
    if (lod === 'lo') { W = Math.round(W / 4); H = Math.round(H / 4); }
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');

    const s = Object.assign({}, shop, { vacant });
    const seed = hash(String(shop.id || shop.name));
    const r = rng(seed);
    const brand = vacant ? null : brandOf(shop.name || '');
    const kind = chooseKind(s, brand, r);
    const font = chooseFont(kind, s, brand, r);
    const plan = { kind, brand, font, r0: seed ^ 0x9e3779b9 };

    const id = String(shop.id || '');
    const photo = !vacant && id && PHOTO_IDS.has(id);
    const logo = !vacant && !photo ? logoOf(shop.name) : null;
    let override = null; // 로고나 사진이 준비되면 그 그리기 함수로 바뀐다

    // 저해상도는 큰 캔버스에 그린 뒤 줄여서 글자 모양을 지킨다
    const viaBig = (fn) => {
      if (lod !== 'lo') return fn(g, W, H);
      const big = document.createElement('canvas'); big.width = W * 4; big.height = H * 4;
      const fonts = fn(big.getContext('2d'), big.width, big.height);
      g.clearRect(0, 0, W, H); g.imageSmoothingQuality = 'high'; g.drawImage(big, 0, 0, W, H);
      return fonts;
    };
    const draw = () => viaBig(override || ((gg, w, h) => paint(gg, w, h, s, { night }, plan)));
    const fonts = draw();
    const tex = makeTexture(THREE, canvas);
    const out = { texture: tex, aspect, kind: brand ? 'brand-' + kind : kind, canvas };
    const redraw = () => { const f = draw() || []; tex.needsUpdate = true; return f; };
    refreshWhenFontsArrive(fonts, redraw);

    if (logo) {
      const useLogo = () => {
        if (logo.state !== 'ok') return;
        override = (gg, w, h) => paintLogo(gg, w, h, s, logo);
        out.kind = 'logo';
        refreshWhenFontsArrive(redraw(), redraw);
      };
      if (logo.state === 'ok') useLogo(); else if (logo.state === 'loading') logo.waiters.push(useLogo);
    }
    if (photo) {
      photoSource(id).then((img) => {
        override = (gg, w, h) => { paintPhoto(gg, w, h, img); return []; };
        out.kind = 'photo'; redraw();
      }, () => { /* 사진이 없거나 깨졌으면 절차적 간판 유지 */ });
    }

    cache.set(key, out);
    return out;
  }

  // ---------- 돌출 간판 (원형 또는 세로형, 양면) ----------
  const projGeo = {};
  function projecting(THREE, shop) {
    if (!shop || shop.close) return null;
    const allowed = ['cafe', 'korean', 'chicken', 'bar', 'world', 'snack', 'etc', 'leisure'];
    if (!allowed.includes(shop.cat)) return null;
    const r = rng(hash('proj' + (shop.id || shop.name)));
    if (r() > 0.3) return null;
    const brand = brandOf(shop.name || '');
    const round = r() < 0.4;
    const W = round ? 192 : 96, H = round ? 192 : 320;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const bg = brand ? brand.bg : soften(pick(r, ['#f7f7f2', '#d64541', '#23395d', '#2f8f9d', '#f2c14e', '#2a2a2e']));
    const fg = brand ? brand.fg : ink(bg);
    const fonts = [];
    const draw = () => {
      g.clearRect(0, 0, W, H);
      if (round) {
        g.fillStyle = bg; g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 4, 0, 7); g.fill();
        g.strokeStyle = mix(bg, '#000', 0.3); g.lineWidth = 8; g.stroke();
        drawIcon(g, iconFor(shop), W * 0.22, H * 0.2, W * 0.56, fg);
      } else {
        panelGradient(g, W, H, bg, 0.1); frame(g, W, H, mix(bg, '#000', 0.3), 6);
        const { main } = splitName(brand ? brand.text : shop.name);
        const chars = Array.from(main.replace(/\s+/g, '')).slice(0, 5);
        const f = brand ? F[brand.font] : F.heavy;
        const sz = Math.min(W * 0.66, (H - 24) / Math.max(3, chars.length));
        g.font = fontStr(f, sz); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
        const y0 = H / 2 - (sz * (chars.length - 1)) / 2;
        chars.forEach((ch, i) => g.fillText(ch, W / 2, y0 + i * sz));
        fonts.length = 0; fonts.push([fontStr(f, sz), chars.join('')]);
      }
    };
    draw();
    const tex = makeTexture(THREE, c);
    refreshWhenFontsArrive(fonts, () => { draw(); tex.needsUpdate = true; });

    const group = new THREE.Group();
    const faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, transparent: round, alphaTest: round ? 0.5 : 0 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: mix(bg, '#000', 0.3), roughness: 0.7 });
    const armMat = projGeo.armMat || (projGeo.armMat = new THREE.MeshStandardMaterial({ color: 0x55595f, metalness: 0.5, roughness: 0.4 }));
    if (!projGeo.arm) projGeo.arm = new THREE.BoxGeometry(0.05, 0.05, 0.75);
    const arm = new THREE.Mesh(projGeo.arm, armMat); arm.position.set(0, round ? 0.45 : 0.85, 0.375); group.add(arm);
    let panel;
    if (round) {
      if (!projGeo.disc) { projGeo.disc = new THREE.CylinderGeometry(0.4, 0.4, 0.08, 28); projGeo.disc.rotateZ(Math.PI / 2); }
      // 원기둥 옆면은 테두리색, 양쪽 원판은 간판 그림
      panel = new THREE.Mesh(projGeo.disc, [edgeMat, faceMat, faceMat]);
      panel.position.set(0, 0, 0.6);
    } else {
      if (!projGeo.box) projGeo.box = new THREE.BoxGeometry(0.1, 1.6, 0.5);
      panel = new THREE.Mesh(projGeo.box, [faceMat, faceMat, edgeMat, edgeMat, edgeMat, edgeMat]);
      panel.position.set(0, 0, 0.55);
    }
    panel.castShadow = true;
    group.add(panel);
    group.userData = { kind: round ? 'projecting-round' : 'projecting-vertical', shopId: shop.id };
    return group;
  }

  function clearCache() {
    cache.forEach((v) => v.texture.dispose());
    cache.clear();
  }

  window.Signs = { ready, texture, projecting, clearCache, setPhoto, brandOf, logoOf, splitName,
    hasPhoto: (id) => PHOTO_IDS.has(String(id)), _cache: cache, _logos: LOGOS };
})();
