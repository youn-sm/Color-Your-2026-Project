// 어궁동 10년 지도 (어궁동 가게 역사): 10년 변화 + 새내기 시뮬레이션, 로우폴리 3D 웹
// 데이터: data/osm.json (tools/build-osm.mjs), data/shops.json (없으면 shops.sample.json), data/questions.json
(async function () {
'use strict';
const $ = id => document.getElementById(id);
const getJSON = url => fetch(url, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });

let osm, shopsData, questions = {}, isSample = false, keepers = new Set(), geocode = {};
try {
  osm = await getJSON('data/osm.json');
  try { shopsData = await getJSON('data/shops.json'); } catch (e) { shopsData = await getJSON('data/shops.sample.json'); isSample = true; }
  isSample = isSample || !!shopsData.sample;
  questions = await getJSON('data/questions.json').catch(() => ({}));
  keepers = new Set(((await getJSON('data/keepers.json').catch(() => null)) || {}).ids || []); // 있으면 '10년 지킴이' 표시
  geocode = ((await getJSON('data/geocode_road.json').catch(() => null)) || {}).addr || {}; // 도로명주소 → 좌표 (브이월드 지오코더)
} catch (e) {
  $('loading').textContent = '데이터를 불러오지 못했어요: ' + e.message;
  return;
}

// ---------- 상수와 도우미 ----------
const GF = 3.6, FH = 3.2, YEAR_MS = 365.25 * 864e5;
const isTouch = matchMedia('(pointer: coarse)').matches;
const isMobile = Math.min(innerWidth, innerHeight) < 600;
if (isTouch) document.body.classList.add('touch');
const C = hex => new THREE.Color(hex);
const mix = (a, b, t) => a.clone().lerp(b, t);
const WHITE = C('#ffffff');
const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
let rseed = 7;
const rand = () => (rseed = (rseed * 16807) % 2147483647) / 2147483647;
const { origin: O, scale: S } = osm;
const toXZ = (lat, lon) => [(lon - O.lon) * S.kx, -(lat - O.lat) * S.kz];
const SCOPE = { minx: -1030, maxx: 40, minz: -380, maxz: 330 }; // data/scope_bbox.json 의 local 값과 같음
function inPoly([x, z], poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
function distSeg([px, pz], [ax, az], [bx, bz]) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}
function segX(a, b, c, d) { // 선분 교차점
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + r[0] * t, a[1] + r[1] * t] : null;
}
const signedArea = p => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
const fmtTime = sec => { sec = Math.round(sec); return sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분${sec % 60 ? ' ' + (sec % 60) + '초' : ''}`; };
const fmtMin = sec => sec < 60 ? '1분 미만' : `약 ${Math.round(sec / 60)}분`;

// 정점 색을 쓰는 단순 지오메트리 빌더 (인덱스 없음 → 면마다 평평한 음영)
class Builder {
  constructor() { this.pos = []; this.col = []; }
  get vcount() { return this.pos.length / 3; }
  tri(a, b, c, col) { this.pos.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) this.col.push(col.r, col.g, col.b); }
  flatTri(a, b, c, col) { // 윗면이 위를 보도록 감기 방향 보정
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    ny >= 0 ? this.tri(a, b, c, col) : this.tri(a, c, b, col);
  }
  wall(p, q, y0, y1, col) { // p→q 변의 바깥쪽을 보는 벽 (다각형은 시계 방향으로 정리되어 있어야 함)
    const a0 = [p[0], y0, p[1]], b0 = [q[0], y0, q[1]], b1 = [q[0], y1, q[1]], a1 = [p[0], y1, p[1]];
    this.tri(a0, b0, b1, col); this.tri(a0, b1, a1, col);
  }
  poly(pts, y, col) {
    const tris = THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(p[0], p[1])), []);
    for (const [i, j, k] of tris) this.flatTri([pts[i][0], y, pts[i][1]], [pts[j][0], y, pts[j][1]], [pts[k][0], y, pts[k][1]], col);
  }
  box(cx, cz, w, d, y0, y1, col, rot = 0, topCol = col) {
    const c = Math.cos(rot), s = Math.sin(rot);
    let pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => [cx + x * c - z * s, cz + x * s + z * c]);
    if (signedArea(pts) > 0) pts = pts.reverse();
    pts.forEach((p, i) => this.wall(p, pts[(i + 1) % 4], y0, y1, col));
    this.poly(pts, y1, topCol);
  }
  ribbon(pts, hw, y, col) { // 폴리라인을 바닥 띠로
    pts.forEach((p, i) => {
      if (i) {
        const q = pts[i - 1], dx = p[0] - q[0], dz = p[1] - q[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l * hw, nz = dx / l * hw;
        this.flatTri([q[0] + nx, y, q[1] + nz], [p[0] + nx, y, p[1] + nz], [p[0] - nx, y, p[1] - nz], col);
        this.flatTri([q[0] + nx, y, q[1] + nz], [p[0] - nx, y, p[1] - nz], [q[0] - nx, y, q[1] - nz], col);
      }
      if (i > 0 && i < pts.length - 1) for (let k = 0; k < 8; k++) {
        const a1 = k / 8 * Math.PI * 2, a2 = (k + 1) / 8 * Math.PI * 2;
        this.flatTri([p[0], y, p[1]], [p[0] + Math.cos(a1) * hw, y, p[1] + Math.sin(a1) * hw], [p[0] + Math.cos(a2) * hw, y, p[1] + Math.sin(a2) * hw], col);
      }
    });
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}
const lambert = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

const stage = async t => { const el = $('loadStep'); if (el) el.textContent = t; await new Promise(r => setTimeout(r, 0)); };
await stage('건물 짓는 중…');
// ---------- 렌더러와 씬 ----------
const BG = '#fbfaf5';
const SHOT = new URLSearchParams(location.search).get('shot');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !!SHOT });
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !isMobile;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // 카메라가 5m 넘게 움직이거나 장면이 바뀔 때만 그림자를 다시 그림
let needShadow = true;
$('scene').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = C(BG);
scene.fog = new THREE.Fog(BG, 120, 520);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 4000);
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 4; controls.maxDistance = 1400;

scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d2c0, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 0.5);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);
function placeSun(t, r) {
  sun.position.set(t.x - 110, 220, t.z + 80); sun.target.position.set(t.x, 0, t.z);
  const sc = sun.shadow.camera;
  if (sc.right !== r) { sc.left = sc.bottom = -r; sc.right = sc.top = r; sc.near = 1; sc.far = 600; sc.updateProjectionMatrix(); }
}

const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshLambertMaterial({ color: '#f1ece0' }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

// ---------- 면: 캠퍼스·공원·주차장·하천 ----------
const hanbit = osm.areas.find(a => a.kind === 'apartment' && a.name === '한빛아파트');
const campuses = osm.areas.filter(a => a.kind === 'campus');
{
  const AREA = { campus: ['#e2f0d3', 0.02], apartment: ['#efe8da', 0.025], school: ['#e8e6f4', 0.025], water: ['#9fd8f2', 0.03], parking: ['#dedbd3', 0.035], green: ['#bfe3a2', 0.045] };
  const b = new Builder();
  for (const a of osm.areas) { const [col, y] = AREA[a.kind] || []; if (col) b.poly(a.pts, y, C(col)); }
  const m = new THREE.Mesh(b.geometry(), lambert()); m.receiveShadow = true; scene.add(m);
}

// ---------- 도로 ----------
const ROADCOL = { primary: '#8b8e95', primary_link: '#8b8e95', secondary: '#979aa1', secondary_link: '#979aa1', tertiary: '#a0a2a8',
  tertiary_link: '#a0a2a8', unclassified: '#a9abb0', residential: '#a9abb0', living_street: '#b2b3b7', service: '#bcbdbf',
  pedestrian: '#f0e2c2', footway: '#ead9b8', steps: '#e2cfa8', path: '#ead9b8', cycleway: '#d7e8f2' };
const isFoot = t => ['footway', 'path', 'steps', 'cycleway', 'pedestrian'].includes(t);
{
  const b = new Builder();
  for (const r of [...osm.roads].sort((a, c) => isFoot(a.type) - isFoot(c.type))) {
    const y = isFoot(r.type) ? 0.075 : (r.type.startsWith('primary') ? 0.055 : 0.065);
    b.ribbon(r.pts, r.width / 2, y, C(ROADCOL[r.type] || '#c0c0c0'));
    if (['primary', 'secondary', 'tertiary'].includes(r.type) && !window.StreetDetails) { // 차도 중앙 점선 (거리 디테일이 있으면 그쪽 노란 중앙선을 씀)
      r.pts.forEach((p, i) => {
        if (!i) return; const q = r.pts[i - 1], dx = p[0] - q[0], dz = p[1] - q[1], l = Math.hypot(dx, dz);
        for (let s = 1; s + 3 < l; s += 7) b.ribbon([[q[0] + dx / l * s, q[1] + dz / l * s], [q[0] + dx / l * (s + 3), q[1] + dz / l * (s + 3)]], 0.08, y + 0.01, WHITE);
      });
    }
  }
  const m = new THREE.Mesh(b.geometry(), lambert()); m.receiveShadow = true; scene.add(m);
}

// 거리 디테일(횡단보도·중앙선·빨간 포장 등): web/streetdetails.js 가 있으면 붙임. 보도(y=0.075) 위 y=0.09
if (window.StreetDetails) StreetDetails.build(THREE, scene, { url: 'data/street_details.json', y: 0.09 }).catch(e => console.warn('거리 디테일 실패', e));

// ---------- 가게 데이터 ----------
const cats = shopsData.categories || {};
const catCol = k => C((cats[k] && cats[k].color) || '#999999');
const catName = k => (cats[k] && cats[k].name) || k;
const SNAP = (shopsData.snapshots && shopsData.snapshots.length ? shopsData.snapshots
  : (() => { const ys = shopsData.shops.map(s => +s.open.slice(0, 4)); const a = []; for (let y = Math.min(...ys); y <= 2026; y++) a.push(`${y}-12-31`); return a; })());
const SNAP_T = SNAP.map(d => Date.parse(d));
const LAST = SNAP.length - 1;
const BASE_T = SNAP_T[0];
function floorKind(f) {
  if (f == null || String(f).trim() === '') return 'ground';
  const s = String(f).trim();
  if (/지하|^b|^-/i.test(s)) return 'base'; // 지하: 1층 길가에 계단 입구 표시
  const n = parseInt(s.replace(/[^0-9]/g, ''), 10);
  return !Number.isFinite(n) || n <= 1 ? 'ground' : 'upper';
}
const shops = shopsData.shops.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon)).map(s => ({
  ...s, xz: toXZ(s.lat, s.lon), openT: Date.parse(s.open), closeT: s.close ? Date.parse(s.close) : Infinity, fk: floorKind(s.floor),
  fl: parseInt(String(s.floor || '').replace(/[^0-9]/g, ''), 10) || 1,
  keeper: keepers.has(s.id),
}));
for (const s of shops) {
  const g = s.road && geocode[`대전광역시 유성구 ${s.road} ${s.roadNo}`];
  if (!g) continue;
  const gx = toXZ(g[0], g[1]), d = Math.hypot(gx[0] - s.xz[0], gx[1] - s.xz[1]);
  s.geoGap = d;
  if (d > 30 && !(hanbit && inPoly(gx, hanbit.pts))) { s.licenceXZ = s.xz; s.xz = gx; } // 예: 더쉼(대학로 211, 유성구청 안)
}
const star = s => s.keeper ? '★ ' : '';
const activeAt = (s, t) => s.openT <= t && s.closeT > t;

// ---------- 건물 ----------
const PASTEL = ['#fff3c4', '#dcecf6', '#ffe3d6', '#e3f3de', '#ece6fb', '#f6f3ea', '#fbe6c6', '#e6eef0'].map(C);
const GLASS = C('#b4d5e8'), CAMPUS = C('#f5f4ef'), BASE = C('#8b8f96'), VACANT_STORE = C('#d3d3d1'), VACANT_SIGN = C('#a9a9a7');
const bld = [];
const bGrid = new Map(), CELL = 30;
const cellKey = (i, j) => i + ',' + j;
for (const ob of osm.buildings) {
  let pts = ob.pts.map(p => [p[0], p[1]]);
  if (pts.length < 3) continue;
  if (signedArea(pts) > 0) pts.reverse();
  const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
  const levels = Math.max(1, Math.round(ob.levels));
  const b = { id: ob.id, pts, c, levels, h: GF + (levels - 1) * FH, campus: ob.campus || campuses.some(cp => inPoly(c, cp.pts)), generated: !!ob.generated, gov: !!ob.gov, name: ob.name,
    wall: ob.campus ? CAMPUS : PASTEL[Math.floor(hash(ob.id) * PASTEL.length)], shops: [] };
  b.apt = !!(hanbit && inPoly(c, hanbit.pts)) && levels > 5; // 단지 안 낮은 건물(상가)은 가게 건물로 그림
  if (b.apt) b.wall = C('#f7efe2');
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  for (let i = Math.floor(Math.min(...xs) / CELL); i <= Math.floor(Math.max(...xs) / CELL); i++)
    for (let j = Math.floor(Math.min(...zs) / CELL); j <= Math.floor(Math.max(...zs) / CELL); j++) {
      const k = cellKey(i, j); if (!bGrid.has(k)) bGrid.set(k, []); bGrid.get(k).push(b);
    }
  bld.push(b);
}
function nearBuildings([x, z], r) {
  const out = new Set();
  for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++)
    for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) (bGrid.get(cellKey(i, j)) || []).forEach(b => out.add(b));
  return out;
}
function distToBuilding(p, b) {
  if (inPoly(p, b.pts)) return 0;
  let d = Infinity; b.pts.forEach((a, i) => { d = Math.min(d, distSeg(p, a, b.pts[(i + 1) % b.pts.length])); }); return d;
}
// 주소가 한 점으로 찍힌 상가(예: 한빛아파트 단지 상가) 주변에 OSM 건물이 없으면 작은 상가 건물을 추정해 세움
function addBuilding(id, pts, levels, extra) {
  if (signedArea(pts) > 0) pts.reverse();
  const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
  const b = { id, pts, c, levels, h: GF + (levels - 1) * FH, campus: false, generated: true, name: null, wall: PASTEL[Math.floor(hash(id) * PASTEL.length)], shops: [], apt: false, ...extra };
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  for (let i = Math.floor(Math.min(...xs) / CELL); i <= Math.floor(Math.max(...xs) / CELL); i++)
    for (let j = Math.floor(Math.min(...zs) / CELL); j <= Math.floor(Math.max(...zs) / CELL); j++) {
      const k = cellKey(i, j); if (!bGrid.has(k)) bGrid.set(k, []); bGrid.get(k).push(b);
    }
  bld.push(b); return b;
}
// 아파트 단지 주소 하나로 찍힌 가게(예: 한빛아파트 상가)는 단지 안 상가 건물로 보냄
const complexMall = hanbit && bld.filter(b => !b.campus && !b.apt && inPoly(b.c, hanbit.pts) && /plaza|상가|프라자/i.test(b.name || '')).sort((a, c) => /프라자|plaza/i.test(c.name) - /프라자|plaza/i.test(a.name))[0];
for (const s of shops) if (complexMall && inPoly(s.xz, hanbit.pts) && ![...nearBuildings(s.xz, 2)].some(b => !b.apt && inPoly(s.xz, b.pts))) s.mall = complexMall;
{
  const spots = new Map();
  for (const s of shops) {
    if (s.mall) continue;
    if ([...nearBuildings(s.xz, 25)].some(b => !b.campus && !b.apt && distToBuilding(s.xz, b) < 25)) continue;
    const k = Math.round(s.xz[0] / 4) + ',' + Math.round(s.xz[1] / 4); (spots.get(k) || spots.set(k, []).get(k)).push(s);
  }
  for (const [k, list] of spots) {
    if (list.length < 3) continue;
    const [x, z] = list[0].xz;
    addBuilding('mall' + k, [[x - 10, z - 6], [x + 10, z - 6], [x + 10, z + 6], [x - 10, z + 6]], 2, { name: '상가 (주소 기준 추정 위치)' });
  }
}
// 도로 이름별 선분 (도로명주소의 도로 = 출입구가 있는 도로)
const namedSegs = new Map();
osm.roads.forEach(r => {
  if (!r.name || isFoot(r.type)) return;
  if (!namedSegs.has(r.name)) namedSegs.set(r.name, []);
  r.pts.forEach((p, i) => { if (i) namedSegs.get(r.name).push([r.pts[i - 1], p, r.width / 2]); });
});
function roadGap(b, name) { // 건물 외곽에서 그 이름 도로 가장자리까지 거리
  const segs = namedSegs.get(name); if (!segs) return Infinity;
  let d = Infinity;
  for (const [a, c, hw] of segs) {
    if (Math.min(a[0], c[0]) - 60 > b.c[0] || Math.max(a[0], c[0]) + 60 < b.c[0] || Math.min(a[1], c[1]) - 60 > b.c[1] || Math.max(a[1], c[1]) + 60 < b.c[1]) continue;
    b.pts.forEach((p, i) => { const q = b.pts[(i + 1) % b.pts.length]; d = Math.min(d, distSeg(p, a, c) - hw, distSeg([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], a, c) - hw); });
  }
  return d;
}
// 가게 → 건물: 좌표가 건물 안이면 그 건물, 아니면 25m 안에서 같은 도로에 접한(6m 이내) 건물을 우선
let unplaced = 0;
for (const s of shops) {
  let best = s.mall || [...nearBuildings(s.xz, 2)].find(b => !b.campus && !b.apt && inPoly(s.xz, b.pts)) || null;
  if (!best) {
    let bs = Infinity;
    for (const b of nearBuildings(s.xz, 25)) {
      if (b.campus || b.apt) continue;
      const d = distToBuilding(s.xz, b); if (d > 25) continue;
      const score = d + (s.road && roadGap(b, s.road) > 6 ? 12 : 0);
      if (score < bs) { bs = score; best = b; }
    }
  }
  if (best) { best.shops.push(s); s.b = best; } else unplaced++;
}
for (const b of bld) {
  b.shops.sort((a, c) => a.openT - c.openT);
  const cnt = {}; b.shops.forEach(s => cnt[s.area] = (cnt[s.area] || 0) + 1);
  b.area = Object.keys(cnt).sort((a, c) => cnt[c] - cnt[a])[0] || null;
}
const gsB = [...nearBuildings([0, 0], 30)].filter(b => !b.campus).sort((a, c) => distToBuilding([0, 0], a) - distToBuilding([0, 0], c))[0];

// 건물 지오메트리: 1층 진열창·간판띠, 2층 창띠는 연도별로 색을 바꾸므로 정점 범위를 기록
const bb = new Builder();
for (const b of bld) {
  b.tri0 = bb.vcount / 3;
  const P = b.pts, edges = P.map((p, i) => [p, P[(i + 1) % P.length]]);
  const band = (y0, y1, col) => { const v0 = bb.vcount; edges.forEach(([p, q]) => bb.wall(p, q, y0, y1, col)); return [v0, bb.vcount - v0]; };
  const roofCol = mix(b.wall, C('#c9c3b5'), 0.35);
  band(0, 0.18, BASE);
  if (b.campus || b.apt) {
    band(0.18, b.h, b.wall);
    for (let f = 0; f < b.levels; f++) band(f * FH + 1.0, f * FH + 2.3, b.apt ? C('#c6dbe6') : GLASS);
  } else {
    b.rStore = band(0.18, 2.75, mix(b.wall, WHITE, 0.2));
    b.rSign = band(2.75, GF, b.wall);
    for (let f = 1; f < b.levels; f++) {
      const y = GF + (f - 1) * FH;
      band(y, y + 0.9, b.wall);
      const r = band(y + 0.9, y + 2.25, GLASS);
      if (f === 1) b.rF2 = r;
      band(y + 2.25, y + FH, b.wall);
    }
  }
  { const v0 = bb.vcount; bb.poly(P, b.h, roofCol); b.rRoof = [v0, bb.vcount - v0]; b.roofCol = roofCol; }
  const area = Math.abs(signedArea(P));
  if (!b.campus && area > 70 && hash(b.id + 'r') < 0.45) { // 옥상 물탱크·계단실
    const w = 2 + hash(b.id + 'w') * 1.5;
    bb.box(b.c[0], b.c[1], w, w, b.h, b.h + 2, mix(b.wall, WHITE, 0.3), hash(b.id) * Math.PI, C('#d8d4ca'));
  }
  b.tri1 = bb.vcount / 3;
}
const bGeom = bb.geometry();
const bMesh = new THREE.Mesh(bGeom, lambert());
bMesh.castShadow = bMesh.receiveShadow = true;
scene.add(bMesh);
const colAttr = bGeom.getAttribute('color');
function paint([v0, n], col) { for (let i = v0; i < v0 + n; i++) colAttr.setXYZ(i, col.r, col.g, col.b); }
function buildingAtTri(t) { let lo = 0, hi = bld.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bld[m].tri0 <= t) lo = m; else hi = m - 1; } return bld[lo]; }

// ---------- 도로망 그래프 (경로·도달 범위) ----------
// 한밭대로(간선), 한빛아파트 단지 안, 캠퍼스 안 길은 제외
const G = { x: [], z: [], adj: [] }, gKey = new Map(), gGrid = new Map();
function gNode(p) {
  const k = p[0] + ',' + p[1];
  if (gKey.has(k)) return gKey.get(k);
  const i = G.x.length; G.x.push(p[0]); G.z.push(p[1]); G.adj.push([]); gKey.set(k, i);
  const ck = cellKey(Math.floor(p[0] / CELL), Math.floor(p[1] / CELL)); if (!gGrid.has(ck)) gGrid.set(ck, []); gGrid.get(ck).push(i);
  return i;
}
// 한빛프라자(단지 상가) 앞 14m는 단지 안이어도 걸어갈 수 있음: 학생들이 실제로 가는 곳
const nearMall = (p, r) => complexMall && (inPoly(p, complexMall.pts) ? false : complexMall.pts.some((a, i) => distSeg(p, a, complexMall.pts[(i + 1) % complexMall.pts.length]) < r));
const blockedArea = p => (hanbit && inPoly(p, hanbit.pts) && !nearMall(p, 14)) || campuses.some(c => inPoly(p, c.pts));
for (const r of osm.roads) {
  if (['primary', 'primary_link'].includes(r.type)) continue;
  r.pts.forEach((p, i) => {
    if (!i) return; const q = r.pts[i - 1];
    if (blockedArea([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2])) return;
    const a = gNode(q), b = gNode(p), l = Math.hypot(p[0] - q[0], p[1] - q[1]);
    G.adj[a].push(b, l); G.adj[b].push(a, l);
  });
}
const GN = G.x.length;
function nearestNode(p) {
  let best = -1, bd = Infinity;
  for (let r = 1; r <= 8 && best < 0; r *= 2) {
    const i0 = Math.floor(p[0] / CELL), j0 = Math.floor(p[1] / CELL);
    for (let i = i0 - r; i <= i0 + r; i++) for (let j = j0 - r; j <= j0 + r; j++)
      for (const n of gGrid.get(cellKey(i, j)) || []) { if (!G.adj[n].length) continue; const d = Math.hypot(G.x[n] - p[0], G.z[n] - p[1]); if (d < bd) { bd = d; best = n; } }
  }
  return best;
}
function dijkstra(src, maxD = Infinity) {
  const dist = new Float64Array(GN).fill(Infinity), prev = new Int32Array(GN).fill(-1), heap = [];
  const push = (d, v) => { heap.push([d, v]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  dist[src] = 0; push(0, src);
  while (heap.length) {
    const [d, u] = pop(); if (d > dist[u]) continue; if (d > maxD) break;
    const a = G.adj[u];
    for (let k = 0; k < a.length; k += 2) { const v = a[k], nd = d + a[k + 1]; if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push(nd, v); } }
  }
  return { dist, prev };
}

// ---------- 소품: 나무·전봇대·차·사람 ----------
const occupied = p => [...nearBuildings(p, 3)].some(b => inPoly(p, b.pts));
function instanced(geo, color, list, castShadow = true) {
  const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const o = new THREE.Object3D();
  list.forEach((it, i) => {
    o.position.set(it.x, it.y || 0, it.z); o.rotation.set(0, it.ry || 0, 0); o.scale.set(it.sx || 1, it.sy || 1, it.sz || 1);
    o.updateMatrix(); m.setMatrixAt(i, o.matrix); if (it.color) m.setColorAt(i, C(it.color));
  });
  m.count = list.length; m.castShadow = castShadow; m.receiveShadow = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  scene.add(m); return m;
}

// 안내 경로: 쪽문 GS25 → 어은동 → 궁동 로데오 (도로 중심선에서 오른쪽으로 1.6m)
function offsetPath(P, off) {
  return P.map((p, i) => {
    const a = P[Math.max(0, i - 1)], c = P[Math.min(P.length - 1, i + 1)], dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return [p[0] - dz / l * off, p[1] + dx / l * off];
  });
}
function pathTool(P) {
  const L = []; P.forEach((p, i) => L.push(i ? L[i - 1] + Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]) : 0));
  const total = L[L.length - 1] || 0;
  const at = s => {
    s = Math.max(0, Math.min(total, s));
    let i = L.findIndex(v => v >= s); if (i <= 0) i = Math.min(1, P.length - 1);
    const t = (s - L[i - 1]) / ((L[i] - L[i - 1]) || 1), a = P[i - 1] || P[0], b = P[i];
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: b[0] - a[0], dz: b[1] - a[1] };
  };
  return { P, total, at };
}
const guide = pathTool(offsetPath(osm.walk, 1.6));
const walkAt = guide.at, WALK_TOTAL = guide.total;

// 나무: 공원·녹지, 쪽문 주변 캠퍼스, 큰길 가로수
const trees = [];
const nearRoad = (p, pad) => osm.roads.some(r => r.pts.some((q, i) => i && distSeg(p, r.pts[i - 1], q) < r.width / 2 + pad));
for (const a of osm.areas) {
  if (!['green', 'campus'].includes(a.kind)) continue;
  const xs = a.pts.map(p => p[0]), zs = a.pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const n = a.kind === 'campus' ? 260 : Math.min(40, Math.abs(signedArea(a.pts)) / 140);
  for (let k = 0, tries = 0; k < n && tries < n * 8; tries++) {
    const p = [x0 + rand() * (x1 - x0), z0 + rand() * (z1 - z0)];
    if (a.kind === 'campus' && Math.hypot(p[0] - 30, p[1] + 120) > 200 && Math.hypot(p[0] + 800, p[1] + 60) > 220) continue;
    if (!inPoly(p, a.pts) || occupied(p) || nearRoad(p, 1.2)) continue;
    trees.push(p); k++;
  }
}
for (const r of osm.roads) {
  if (!['secondary', 'tertiary'].includes(r.type)) continue;
  r.pts.forEach((p, i) => {
    if (!i) return; const q = r.pts[i - 1], dx = p[0] - q[0], dz = p[1] - q[1], l = Math.hypot(dx, dz);
    for (let s = 6; s < l; s += 16) for (const side of [1, -1]) {
      const t = [q[0] + dx / l * s - dz / l * (r.width / 2 + 0.9) * side, q[1] + dz / l * s + dx / l * (r.width / 2 + 0.9) * side];
      if (!occupied(t) && t[0] > -1100 && t[0] < 150 && t[1] > -400 && t[1] < 420) trees.push(t);
    }
  });
}
const treeList = trees.map(([x, z], i) => ({ x, z, sy: 0.8 + hash('t' + i) * 0.6, color: ['#7cc36a', '#62b25a', '#94cf6f', '#58a85c'][i % 4] }));
instanced(new THREE.CylinderGeometry(0.14, 0.2, 2.2, 6).translate(0, 1.1, 0), '#8a6a4a', treeList.map(t => ({ ...t, color: null })));
instanced(new THREE.IcosahedronGeometry(1.7, 0).translate(0, 3.4, 0), '#7cc36a', treeList);

// 전봇대와 전깃줄 (거리뷰 참고: 골목마다 전선이 많음)
const poles = [];
let wires = null;
for (let s = 4; s < WALK_TOTAL; s += 26) {
  const p = walkAt(s), l = Math.hypot(p.dx, p.dz) || 1;
  const x = p.x - p.dz / l * 2.0, z = p.z + p.dx / l * 2.0;
  if (!occupied([x, z])) poles.push({ x, z, ry: Math.atan2(p.dx, p.dz) });
}
instanced(new THREE.CylinderGeometry(0.13, 0.17, 9, 6).translate(0, 4.5, 0), '#9a958c', poles);
instanced(new THREE.BoxGeometry(1.6, 0.12, 0.12).translate(0, 8.3, 0), '#77726a', poles);
instanced(new THREE.BoxGeometry(0.12, 0.12, 1.6).translate(0, 6.6, 0.8), '#5d6168', poles.filter((_, i) => i % 2 === 0)); // 가로등 팔
{
  const segs = [];
  for (let i = 1; i < poles.length; i++) {
    const a = poles[i - 1], b = poles[i];
    if (Math.hypot(a.x - b.x, a.z - b.z) > 40) continue;
    for (const [h, off] of [[8.3, -0.7], [8.3, 0.7], [7.6, 0]]) {
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, sag = 0.6, ox = Math.cos(a.ry) * off, oz = -Math.sin(a.ry) * off;
      segs.push(a.x + ox, h, a.z + oz, mx + ox, h - sag, mz + oz, mx + ox, h - sag, mz + oz, b.x + ox, h, b.z + oz);
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
  wires = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#3d3f44' }));
  scene.add(wires);
}

// 주차된 차: 쪽문 앞 골목(거리뷰처럼 한쪽에 줄지어 주차)과 궁동 골목. 시뮬레이션할 때 부딪히는 장애물이기도 함
const CARCOL = ['#f4f4f4', '#c9ccd1', '#2d2f33', '#8a8f96', '#f4f4f4', '#c9ccd1', '#3c5a9a', '#ffd400'];
const cars = [];
for (let s = 10; s < WALK_TOTAL; s += (s < 200 ? 6.5 : 30 + rand() * 30)) {
  if (rand() < 0.25) continue;
  const p = walkAt(s), l = Math.hypot(p.dx, p.dz) || 1, x = p.x + p.dz / l * 3.8, z = p.z - p.dx / l * 3.8;
  if (!occupied([x, z])) cars.push({ x, z, ry: Math.atan2(p.dx, p.dz), color: CARCOL[Math.floor(rand() * CARCOL.length)] });
}
for (const r of osm.roads) {
  if (!['residential', 'living_street', 'unclassified'].includes(r.type) || rand() < 0.5) continue;
  const i = 1 + Math.floor(rand() * (r.pts.length - 1)), q = r.pts[i - 1], p = r.pts[i], dx = p[0] - q[0], dz = p[1] - q[1], l = Math.hypot(dx, dz);
  if (l < 12) continue;
  const t = 0.2 + rand() * 0.6, side = rand() < 0.5 ? 1 : -1, off = r.width / 2 - 1.0;
  const x = q[0] + dx * t - dz / l * off * side, z = q[1] + dz * t + dx / l * off * side;
  if (!occupied([x, z])) cars.push({ x, z, ry: Math.atan2(dx, dz), color: CARCOL[Math.floor(rand() * CARCOL.length)] });
}
instanced(new THREE.BoxGeometry(1.75, 0.75, 4.3).translate(0, 0.55, 0), '#ffffff', cars);
instanced(new THREE.BoxGeometry(1.55, 0.6, 2.3).translate(0, 1.2, -0.2), '#ffffff', cars.map(c => ({ ...c, color: mix(C(c.color), C('#223344'), 0.35).getStyle() })));

// 사람: 포스터 속 인물 색 (노랑 상의·초록 바지, 검정 상의·주황 바지, 초록 상의·파랑 바지)
const OUTFIT = [['#ffd400', '#1fa34a'], ['#222222', '#ff5a2a'], ['#2fae4f', '#2453b8'], ['#ff8ac0', '#2a2a2a'], ['#8fd3ff', '#3a3a3a']];
const people = [];
const gate = osm.gate;
for (let k = 0; k < 12; k++) {
  const p = { x: gate[0] + (rand() - 0.5) * 10, z: gate[1] + 4 + rand() * 24, ry: rand() * 6.28 };
  if (Math.hypot(p.x - walkAt(0).x, p.z - walkAt(0).z) > 10 && Math.hypot(p.x - walkAt(22).x, p.z - walkAt(22).z) > 10 && !occupied([p.x, p.z])) people.push(p); // 시뮬레이션 시작 자리 앞은 비워 둠
}
for (let s = 30; s < WALK_TOTAL; s += 22 + rand() * 25) {
  const p = walkAt(s), l = Math.hypot(p.dx, p.dz) || 1, side = rand() < 0.5 ? -3.0 : 3.4;
  people.push({ x: p.x - p.dz / l * side, z: p.z + p.dx / l * side, ry: Math.atan2(p.dx, p.dz) + (rand() < 0.5 ? Math.PI : 0) });
}
people.forEach((p, i) => { p.o = OUTFIT[i % OUTFIT.length]; });
// 사람은 시뮬레이션할 때 부딪히는 장애물 (solids는 쪽문 디테일에서 선언되므로 나중에 추가)
instanced(new THREE.CylinderGeometry(0.17, 0.2, 0.85, 6).translate(0, 0.43, 0), '#ffffff', people.map(p => ({ ...p, color: p.o[1] })));
instanced(new THREE.CylinderGeometry(0.24, 0.2, 0.65, 6).translate(0, 1.18, 0), '#ffffff', people.map(p => ({ ...p, color: p.o[0] })));
instanced(new THREE.IcosahedronGeometry(0.17, 1).translate(0, 1.66, 0), '#f2c9a6', people);

// 간판 (캔버스 글씨)
function signPlane(text, bg, fg, w, h, sub) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = Math.round(512 * h / w);
  const g = cv.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 ${cv.height * (sub ? 0.5 : 0.62)}px -apple-system, "Apple SD Gothic Neo", sans-serif`;
  g.fillText(text, cv.width / 2, cv.height * (sub ? 0.4 : 0.52));
  if (sub) { g.font = `600 ${cv.height * 0.22}px -apple-system, "Apple SD Gothic Neo", sans-serif`; g.fillText(sub, cv.width / 2, cv.height * 0.8); }
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
}
function facadeSign(b, toward, mesh, y) {
  let best = null, bd = Infinity;
  b.pts.forEach((p, i) => { const q = b.pts[(i + 1) % b.pts.length], d = distSeg(toward, p, q); if (d < bd) { bd = d; best = [p, q]; } });
  const [p, q] = best, dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz), nx = -dz / l, nz = dx / l;
  mesh.position.set((p[0] + q[0]) / 2 + nx * 0.08, y, (p[1] + q[1]) / 2 + nz * 0.08);
  mesh.rotation.y = Math.atan2(nx, nz);
  scene.add(mesh);
}

// ---------- 쪽문 디테일 (거리뷰 참고) ----------
const kaist = campuses.find(a => a.name === '한국과학기술원');
const solids = []; // 시뮬레이션 충돌용 작은 장애물 [x, z, 반경]
{
  const b = new Builder();
  let best = null, bd = Infinity;
  for (const r of osm.roads) r.pts.forEach((p, i) => { if (i) { const d = distSeg(gate, r.pts[i - 1], p); if (d < bd) { bd = d; best = [r.pts[i - 1], p, r]; } } });
  const [q, p] = best, dx = p[0] - q[0], dz = p[1] - q[1], l = Math.hypot(dx, dz), nx = -dz / l, nz = dx / l, half = Math.max(3.2, best[2].width / 2 + 1);
  const ry = Math.atan2(dx, dz);
  for (const s of [1, -1]) { b.box(gate[0] + nx * half * s, gate[1] + nz * half * s, 0.9, 0.9, 0, 3.2, C('#6b717b'), ry, C('#ffd400')); solids.push([gate[0] + nx * half * s, gate[1] + nz * half * s, 0.7]); }
  b.box(gate[0] + nx * (half - 0.2), gate[1] + nz * (half - 0.2), 0.5, 0.5, 0, 1.1, C('#f2f2f2'), ry); // 차단기 기둥
  for (let k = 0; k < 6; k++) { // 빨강·흰색 차단기 막대
    const t = half - 0.7 - k * half * 0.3;
    b.box(gate[0] + nx * t, gate[1] + nz * t, 0.12, half * 0.3, 0.95, 1.07, k % 2 ? WHITE : C('#e5322d'), ry);
  }
  if (kaist) kaist.pts.forEach((a, i) => { // 캠퍼스 경계 화단(쪽문 양옆 90m), 길이 지나는 곳은 비움
    const c = kaist.pts[(i + 1) % kaist.pts.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    for (let s = 0; s < L; s += 2) {
      const pt = [a[0] + (c[0] - a[0]) * s / L, a[1] + (c[1] - a[1]) * s / L], dg = Math.hypot(pt[0] - gate[0], pt[1] - gate[1]);
      if (dg > 90 || dg < half + 1 || nearRoad(pt, 0.6) || occupied(pt)) continue;
      b.box(pt[0], pt[1], 2.05, 0.9, 0, 1.1, C('#5fae4e'), Math.atan2(c[0] - a[0], c[1] - a[1]) + Math.PI / 2, C('#74c35f'));
    }
  });
  // 한빛아파트: 담장과 단지 입구. 단지 안으로는 들어갈 수 없음 (충돌·경로에서 제외)
  if (hanbit) {
    const H = hanbit.pts, entrances = [];
    for (const r of osm.roads) r.pts.forEach((p2, i) => {
      if (!i) return;
      H.forEach((a, k) => { const x = segX(r.pts[i - 1], p2, a, H[(k + 1) % H.length]); if (x && !entrances.some(e => Math.hypot(e[0] - x[0], e[1] - x[1]) < 12)) entrances.push(x); });
    });
    H.forEach((a, k) => {
      const c = H[(k + 1) % H.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]), rot = Math.atan2(c[0] - a[0], c[1] - a[1]) + Math.PI / 2;
      for (let s = 0; s < L; s += 2.5) {
        const pt = [a[0] + (c[0] - a[0]) * (s + 1.25) / L, a[1] + (c[1] - a[1]) * (s + 1.25) / L];
        if (entrances.some(e => Math.hypot(e[0] - pt[0], e[1] - pt[1]) < 5) || nearMall(pt, 16)) continue; // 상가 앞은 담장 없음
        b.box(pt[0], pt[1], Math.min(2.5, L - s), 0.12, 0, 1.6, C('#7d8a7a'), rot, C('#5b6658')); // 담장
        b.box(pt[0], pt[1], 0.18, 0.18, 0, 1.8, C('#4e5a4c'), rot); // 기둥
      }
    });
    entrances.forEach(e => { // 입구: 기둥 두 개 + 닫힌 차단기 + 이름판
      let bestK = 0, bd2 = Infinity;
      H.forEach((a, k) => { const d = distSeg(e, a, H[(k + 1) % H.length]); if (d < bd2) { bd2 = d; bestK = k; } });
      const a = H[bestK], c = H[(bestK + 1) % H.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]), ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L;
      for (const s of [-1, 1]) b.box(e[0] + ux * 4.6 * s, e[1] + uz * 4.6 * s, 0.7, 0.7, 0, 2.6, C('#b9a98f'), Math.atan2(ux, uz), C('#8f7f66'));
      b.box(e[0], e[1], 8.6, 0.12, 0.9, 1.05, C('#ffd400'), Math.atan2(ux, uz) + Math.PI / 2);
      const sg = signPlane('한빛아파트', '#ffffff', '#4e5a4c', 3, 0.7);
      sg.position.set(e[0] + ux * 4.6, 2.2, e[1] + uz * 4.6); sg.rotation.y = Math.atan2(-uz, ux); scene.add(sg);
    });
  }
  const m = new THREE.Mesh(b.geometry(), lambert()); m.castShadow = m.receiveShadow = true; scene.add(m);
}
cars.forEach(c => solids.push([c.x, c.z, 1.4]));
people.forEach(p => solids.push([p.x, p.z, 0.35]));
if (gsB) {
  facadeSign(gsB, walkAt(0) && [walkAt(0).x, walkAt(0).z], signPlane('GS25', '#1a6dff', '#ffffff', 5, 0.9), GF - 0.43);
  gsB.fixed = { store: C('#d9ecff'), sign: C('#1a6dff') };
}
{
  const plate = signPlane('KAIST', '#ffffff', '#1d3c8f', 2.4, 1, '쪽문 · West Gate');
  plate.position.set(gate[0], 2.4, gate[1] + 0.6); scene.add(plate);
}

// ---------- 상태 ----------
let appMode = 'survival', snapIdx = LAST, area = 'all', showLabels = true;
let colorMode = 'change';  // 'change' = 그해 개업(초록)·폐업(빨강)만 선명하게, 'cat' = 업종 색
let focus = null;          // null | 'new' | 'closed' (그해 개업/폐업 카드) — colorMode 'change'에서 하나만 강조
let catFocus = null;       // 업종 하나만 보기 (colorMode 'cat')
function inArea(s) { return area === 'all' || s.area === area; }
function fmtSnap(i) { const d = SNAP[i]; return d.slice(5) === '12-31' ? d.slice(0, 4) : d.slice(0, 4) + '.' + d.slice(5, 7); }
const prevT = i => i ? SNAP_T[i - 1] : Date.parse(`${+SNAP[0].slice(0, 4) - 1}-12-31`);
function tenure(s, t) {
  const y = (t - s.openT) / YEAR_MS;
  if (s.openBefore) { const n = Math.floor((t - BASE_T) / YEAR_MS); return n >= 1 ? `${n}년 이상` : '기록 시작 전부터'; }
  return y < 1 ? '1년 미만' : `${Math.floor(y)}년째`;
}
function primaryShop(b, t, kind) {
  const act = b.shops.filter(s => (s.fk === kind || (kind === 'ground' && s.fk === 'base')) && activeAt(s, t) && inArea(s));
  return { top: act.sort((a, c) => c.openT - a.openT)[0] || null, n: act.length };
}
const NEW_COL = C('#16b75c'), CLOSED_COL = C('#e8402a'), CLOSED_STORE = C('#4a4a4e');
const dim = c => mix(c, WHITE, 0.75);

function updateColors() {
  const t = SNAP_T[snapIdx], t0 = prevT(snapIdx), changeView = appMode === 'survival' && colorMode === 'change';
  for (const b of bld) {
    if (!b.rStore) continue;
    const g = primaryShop(b, t, 'ground'), u = primaryShop(b, t, 'upper');
    const everHere = b.shops.some(s => s.openT <= t && inArea(s));
    const top = g.top || u.top;
    let store, sign, roof;
    if (b.fixed && snapIdx === LAST && area !== '궁동') { store = b.fixed.store; sign = b.fixed.sign; roof = b.roofCol; }
    else if (g.top) { const c = catCol(g.top.cat); store = mix(c, WHITE, 0.5); sign = c; }
    else if (everHere) { store = VACANT_STORE; sign = VACANT_SIGN; }
    else { store = mix(b.wall, WHITE, 0.2); sign = b.wall; }
    // 지붕도 업종 색으로 물들여 위에서 볼 때 업종 지도가 되게 함
    roof = roof || (top ? mix(catCol(top.cat), WHITE, 0.3) : everHere ? C('#9d9d9b') : b.roofCol);
    let f2 = u.top ? mix(catCol(u.top.cat), WHITE, 0.25) : GLASS;
    const opened = b.shops.some(s => inArea(s) && !s.openBefore && s.openT > t0 && s.openT <= t);
    const closed = b.shops.some(s => inArea(s) && s.closeT > t0 && s.closeT <= t);
    b.change = opened ? 'new' : closed ? 'closed' : null;
    if (changeView) { // 그해 변화: 연 곳은 초록, 닫은 곳은 빨강/진회색, 나머지는 흐리게
      const show = focus ? b.change === focus : !!b.change;
      if (show && b.change === 'new') { store = mix(NEW_COL, WHITE, 0.35); sign = NEW_COL; roof = NEW_COL; }
      else if (show && b.change === 'closed') { store = CLOSED_STORE; sign = CLOSED_COL; roof = CLOSED_COL; }
      else { store = dim(store); sign = dim(sign); roof = dim(roof); f2 = dim(f2); }
    } else if (catFocus && !(top && top.cat === catFocus)) { store = dim(store); sign = dim(sign); roof = dim(roof); f2 = dim(f2); }
    paint(b.rStore, store); paint(b.rSign, sign); paint(b.rRoof, roof);
    if (b.rF2) paint(b.rF2, f2);
    b.now = { g, u, t };
  }
  colAttr.needsUpdate = true;
  needShadow = true;
}

// 질문 문구의 괄호 속 정답은 「정답 보기」 뒤에 숨김
function splitAnswer(q) {
  const ans = []; const text = q.replace(/\s*\(([^()]*)\)/g, (m, inner) => { ans.push(inner.replace(/^정답:\s*/, '')); return ''; }).trim();
  return { text, ans: ans.join(' / ') };
}
let lastQ = null;
function updateStats() {
  const t = SNAP_T[snapIdx], t0 = prevT(snapIdx), list = shops.filter(inArea);
  const act = list.filter(s => activeAt(s, t));
  $('statYear').textContent = fmtSnap(snapIdx);
  $('statArea').textContent = area === 'all' ? '어궁동' : area;
  $('kOpen').textContent = act.length;
  $('kNew').textContent = list.filter(s => !s.openBefore && s.openT > t0 && s.openT <= t).length;
  $('kClosed').textContent = list.filter(s => s.closeT > t0 && s.closeT <= t).length;
  $('kNewBtn').classList.toggle('on', colorMode === 'change' && focus === 'new');
  $('kClosedBtn').classList.toggle('on', colorMode === 'change' && focus === 'closed');
  // 업종 구성 = 범례 겸 필터
  const cnt = {}; act.forEach(s => cnt[s.cat] = (cnt[s.cat] || 0) + 1);
  const keys = usedCats.slice().sort((a, c) => (cnt[c] || 0) - (cnt[a] || 0));
  $('mix').innerHTML = keys.filter(k => cnt[k]).map(k => `<i style="width:${cnt[k] / act.length * 100}%;background:${catCol(k).getStyle()}" title="${catName(k)} ${cnt[k]}곳"></i>`).join('');
  $('catList').innerHTML = keys.map(k => `<button data-cat="${k}" class="${catFocus === k ? 'on' : ''}"><s style="background:${catCol(k).getStyle()}"></s>${catName(k)}<em>${cnt[k] || 0}</em></button>`).join('');
  $('catList').classList.toggle('focusing', !!catFocus);
  // 업종별 3년 생존율: 2010년 이후 문 열고 그 시점까지 3년이 지난 가게 중 3년 넘게 영업한 비율 (data/findings.md와 같은 기준)
  const T3 = 3 * YEAR_MS, FROM = Date.parse('2010-01-01'), sv = {};
  list.filter(s => s.openT >= FROM && s.openT + T3 <= t).forEach(s => { const v = sv[s.cat] = sv[s.cat] || [0, 0]; v[1]++; if (Math.min(s.closeT, t) - s.openT >= T3) v[0]++; });
  const rate = k => sv[k][0] / sv[k][1];
  const ks = Object.keys(sv).filter(k => sv[k][1] >= 10).sort((a, c) => rate(c) - rate(a));
  const all = Object.values(sv).reduce((a, v) => [a[0] + v[0], a[1] + v[1]], [0, 0]);
  $('survTotal').textContent = all[1] ? `전체 ${Math.round(all[0] / all[1] * 100)}% (${all[1]}곳)` : '';
  $('survival').innerHTML = ks.length ? ks.map(k => `<div class="row"><span>${catName(k)}</span><div class="bar"><i style="width:${rate(k) * 100}%;background:${catCol(k).getStyle()}"></i></div><em>${Math.round(rate(k) * 100)}%</em></div>`).join('')
    : '<p class="small">아직 계산할 만큼 기록이 쌓이지 않았어요</p>';
  const y = +SNAP[snapIdx].slice(0, 4), qk = Object.keys(questions).filter(k => /^\d{4}$/.test(k)).map(Number).sort((a, b) => a - b);
  const qy = qk.filter(k => k <= y).pop() ?? qk[0]; // 2010처럼 슬라이더보다 이른 키는 첫 해부터 보임
  if (qy !== lastQ) {
    const { text, ans } = splitAnswer(qy != null ? questions[qy] : '');
    $('qText').textContent = text; $('qAns').textContent = ans; $('qAns').hidden = true; $('qAnsBtn').hidden = !ans;
    if (lastQ != null && playing) { $('qcard').classList.remove('shake'); void $('qcard').offsetWidth; $('qcard').classList.add('shake'); }
    lastQ = qy;
  }
  $('year').textContent = fmtSnap(snapIdx);
  $('yearNote').textContent = snapIdx === LAST ? `${SNAP[LAST].replace(/-/g, '.')} 기준 · 인허가 자료` : '그해 12월 31일 기준 · 인허가 자료';
}
$('qAnsBtn').onclick = () => { $('qAns').hidden = false; $('qAnsBtn').hidden = true; };
function update() { updateColors(); updateStats(); refreshLabels(true); refreshSigns(true); if (placeB) showPlace(placeB); }

await stage('이름표 붙이는 중…');
// ---------- 라벨 (DOM). 위치는 transform만 바꾸고, 겹침은 실제 크기로 판정 ----------
const labelBox = $('labels'), pool = [];
for (let i = 0; i < 28; i++) { const d = document.createElement('div'); d.className = 'lbl'; d.style.display = 'none'; labelBox.appendChild(d); pool.push(d); }
const fixedLabels = [];
function addFixedLabel(html, x, y, z, cls) {
  const d = document.createElement('div'); d.className = cls; d.innerHTML = html; labelBox.appendChild(d);
  const f = { d, v: new THREE.Vector3(x, y, z) }; fixedLabels.push(f); return f;
}
if (gsB) addFixedLabel('📍 GS25 <small>여기서 출발</small>', gsB.c[0], gsB.h + 2.5, gsB.c[1], 'lbl gs');
addFixedLabel('KAIST 쪽문', gate[0], 5.2, gate[1], 'lbl gs');
const luminance = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
let shown = [], lastLabelT = 0;
function refreshLabels(force) {
  const now = performance.now();
  if (!force && now - lastLabelT < 250) return;
  lastLabelT = now;
  shown = [];
  const on = appMode === 'survival' ? showLabels : shopLbl && !topView;
  if (on) {
    const t = SNAP_T[snapIdx], fp = appMode === 'explore';
    const ref = fp ? { x: player.x, z: player.z } : controls.target;
    const R = fp ? 45 : Math.max(60, Math.min(260, camera.position.distanceTo(controls.target) * 0.55));
    const near = fp ? 22 : Math.max(40, R * 0.3); // 이보다 가까우면 부제까지
    const cand = [];
    for (const b of nearBuildings([ref.x, ref.z], R)) {
      if (!b.now || b.campus) continue;
      const top = b.now.g.top || b.now.u.top; if (!top) continue;
      const d = Math.hypot(b.c[0] - ref.x, b.c[1] - ref.z); if (d > R) continue;
      if (appMode === 'survival' && colorMode === 'change' && !(focus ? b.change === focus : b.change) && d > near) continue;
      if (catFocus && top.cat !== catFocus) continue;
      // 우선순위: 선택한 건물, 10년 지킴이, 그해 변화, 가까운 순
      const pri = (b === placeB ? -1e4 : 0) + (top.keeper ? -500 : 0) + (b.change ? -200 : 0) + d;
      cand.push([pri, b, top, d]);
    }
    cand.sort((a, c) => a[0] - c[0]);
    for (const [, b, top, d] of cand.slice(0, fp ? 10 : 22)) { const e = entranceOf(top); shown.push({ b, top, d, v: new THREE.Vector3(e[0], fp ? GF + 1.6 : b.h + 1.2, e[1]) }); }
    shown.forEach((s, i) => {
      const d = pool[i], n = s.b.now.g.n + s.b.now.u.n, past = s.b.shops.filter(x => x.openT <= t && inArea(x)).length;
      const up = s.top.fk === 'upper' ? ' · 2층 이상' : '';
      const name = `${star(s.top)}${s.top.name}${n > 1 ? ` 외 ${n - 1}곳` : ''}`;
      const detail = s.d < near || s.b === placeB;
      const html = !detail ? name : fp ? `${name}<small>${catName(s.top.cat)}${up}</small>`
        : `${name}<small>${s.top.keeper ? '10년 지킴이 · ' : ''}${catName(s.top.cat)}${up} · ${tenure(s.top, t)} · 이 자리 ${past}번째</small>`;
      if (d._html !== html) { d.innerHTML = html; d._html = html; d._w = 0; }
      const col = catCol(s.top.cat);
      d.style.background = col.getStyle(); d.classList.toggle('dark', luminance(col) > 0.6);
    });
  }
  pool.forEach((d, i) => { if (i >= shown.length) d.style.display = 'none'; });
  if (appMode === 'explore') refreshPins();
}
const v3 = new THREE.Vector3();
let placed = [];
function put(d, v, avoid) { // avoid: 이미 놓인 라벨과 겹치면 숨김 (우선순위 높은 것부터 놓음)
  v3.copy(v).project(camera);
  if (v3.z > 1 || v3.x < -1.05 || v3.x > 1.05 || v3.y < -1.05 || v3.y > 1.05) { if (d.style.display !== 'none') d.style.display = 'none'; return false; }
  const x = (v3.x + 1) / 2 * innerWidth, y = (1 - v3.y) / 2 * innerHeight;
  if (d.style.display === 'none') { d.style.display = 'block'; d._w = 0; }
  if (!d._w) { d._w = d.offsetWidth; d._h = d.offsetHeight; }
  const r = [x - d._w / 2, y - d._h, x + d._w / 2, y];
  if (avoid && placed.some(p => r[0] < p[2] + 4 && r[2] + 4 > p[0] && r[1] < p[3] + 3 && r[3] + 3 > p[1])) { d.style.display = 'none'; return false; }
  placed.push(r);
  d.style.transform = `translate3d(${(x - d._w / 2).toFixed(1)}px, ${(y - d._h).toFixed(1)}px, 0)`;
  return true;
}
function placeLabels() {
  placed = [];
  fixedLabels.forEach(f => f.d.dataset.hide ? (f.d.style.display = 'none') : put(f.d, f.v));
  shown.forEach((s, i) => put(pool[i], s.v, true));
  pinShown.forEach(p => put(p.d, p.v, true));
}

// 가게 출입구 자리: 도로명주소의 도로 쪽 벽에 가게 좌표를 투영하고 1m 바깥 (라벨·길 찾기 목적지)
function entranceOf(s) {
  if (!s.b) return s.xz;
  const f = facadeFor(s.b, s.road), t = Math.max(0.5, Math.min(f.L - 0.5, (s.xz[0] - f.p[0]) * f.ux + (s.xz[1] - f.p[1]) * f.uz));
  return [f.p[0] + f.ux * t + f.nx, f.p[1] + f.uz * t + f.nz];
}
// ---------- 이 자리의 역사 (통계 패널의 두 번째 탭) ----------
let placeB = null;
function setTab(tab) {
  $('tabStats').classList.toggle('on', tab === 'stats'); $('tabPlace').classList.toggle('on', tab === 'place');
  $('paneStats').hidden = tab !== 'stats'; $('panePlace').hidden = tab !== 'place';
  if ($('stats').classList.contains('folded')) $('statsFold').click();
}
$('tabStats').onclick = () => setTab('stats');
$('tabPlace').onclick = () => setTab('place');
function showPlace(b) {
  placeB = b;
  if (!b.shops.length) { $('tabPlace').disabled = true; setTab('stats'); return; }
  const t = SNAP_T[snapIdx];
  const title = b.now && (b.now.g.top || b.now.u.top);
  $('placeList').innerHTML = `<h2 style="margin-bottom:6px">${title ? star(title) + title.name : '빈 자리'}</h2><p class="small" style="margin:0 0 6px">이 자리를 거쳐 간 가게 ${b.shops.length}곳</p>` + b.shops.map(s => {
    const period = `${s.openBefore ? '기록 이전' : s.open.slice(0, 7).replace('-', '.')} ~ ${s.close ? s.close.slice(0, 7).replace('-', '.') : '영업 중'}`;
    const yrs = s.close && !s.openBefore ? ` (약 ${Math.max(1, Math.round((s.closeT - s.openT) / YEAR_MS))}년)` : '';
    const now = activeAt(s, t) ? ' · <b>이 시점 영업 중</b>' : '';
    const fl = s.floor ? ` · ${/층/.test(s.floor) ? s.floor : s.floor + '층'}` : '';
    return `<div class="hist"><s style="background:${catCol(s.cat).getStyle()}"></s><div>${star(s)}${s.name}<small>${s.keeper ? '<b>10년 지킴이</b> · ' : ''}${s.sub && s.sub !== '기타' ? s.sub : catName(s.cat)}${fl} · ${period}${yrs}${now}</small></div></div>`;
  }).join('') + '<p class="small">기간은 같은 영업 허가 기준이에요. 상호·주인은 중간에 바뀌었을 수 있어요.</p>' +
    (b.generated ? '<p class="small">건물 모양은 지도에 외곽선이 없어 도로를 따라 추정한 것이에요.</p>' : '');
  $('tabPlace').disabled = false; setTab('place');
  refreshLabels(true);
}

// ---------- 카메라: 10년 변화 ----------
let fly = null;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function flyTo(pos, target, dur = 1400) {
  if (reduceMotion) { fly = null; camera.position.copy(pos); controls.target.copy(target); return; }
  fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, start: performance.now(), dur };
}
// 쪽문 앞 갈림길 동쪽(캠퍼스 쪽)에서 서쪽을 보면 오른쪽에 쪽문, 왼쪽에 GS25가 함께 보임
const START_LOOK = new THREE.Vector3(-4, 2, -6);
function startCamPos() { return new THREE.Vector3(34, 13, -2); }
function goStart() { flyTo(startCamPos(), START_LOOK.clone()); scene.fog.near = 150; scene.fog.far = 700; placeSun(START_LOOK, 140); }
function goBird(target) {
  const t = target || new THREE.Vector3(-470, 0, 40);
  const dist = target ? 330 : 760;
  flyTo(new THREE.Vector3(t.x + dist * 0.25, dist * 0.75, t.z + dist * 0.75), t);
  scene.fog.near = 900; scene.fog.far = 3200; placeSun(t, target ? 260 : 600);
}
$('btnBird').onclick = () => goBird();
$('btnStart').onclick = goStart;
// 사용자가 직접 조작하면 자동 회전·자동 재생을 멈추고 제목을 칩으로 접음
function userTook() { $('intro').hidden = true; controls.autoRotate = false; if (playing && autoPlaying) stopPlay(); collapseTitle(); }
controls.addEventListener('start', () => { fly = null; userTook(); });
function collapseTitle() { $('title').classList.add('chip'); }
$('titleChip').onclick = () => $('title').classList.remove('chip');

// ---------- 10년 변화 컨트롤 ----------
const slider = $('slider');
slider.min = 0; slider.max = LAST; slider.value = snapIdx;
$('ticks').innerHTML = SNAP.map((d, i) => `<span>${i === LAST ? fmtSnap(i).slice(2) : "'" + d.slice(2, 4)}</span>`).join('');
function setColorMode(m) { colorMode = m; if (m === 'change') catFocus = null; else focus = null; document.querySelectorAll('#colorSeg button').forEach(b => b.classList.toggle('on', b.dataset.color === m)); }
document.querySelectorAll('#colorSeg button').forEach(b => b.onclick = () => { setColorMode(b.dataset.color); update(); });
slider.oninput = () => { snapIdx = +slider.value; userTook(); update(); };
let playing = null, autoPlaying = false;
function stopPlay() { clearInterval(playing); playing = null; autoPlaying = false; $('btnPlay').textContent = '▶ 10년 재생'; $('btnPlay').classList.remove('on'); }
function play(auto) {
  if (playing) stopPlay();
  autoPlaying = !!auto; setColorMode('change'); focus = null;
  snapIdx = 0; slider.value = 0; update(); $('btnPlay').textContent = '■ 정지'; $('btnPlay').classList.add('on');
  playing = setInterval(() => { if (snapIdx >= LAST) return stopPlay(); snapIdx++; slider.value = snapIdx; update(); }, 1000);
}
$('btnPlay').onclick = () => { if (playing) { stopPlay(); return; } collapseTitle(); play(false); };
$('kNewBtn').onclick = () => { setColorMode('change'); focus = focus === 'new' ? null : 'new'; update(); };
$('kClosedBtn').onclick = () => { setColorMode('change'); focus = focus === 'closed' ? null : 'closed'; update(); };
$('catList').onclick = e => {
  const btn = e.target.closest('button[data-cat]'); if (!btn) return;
  setColorMode('cat'); catFocus = catFocus === btn.dataset.cat ? null : btn.dataset.cat; update();
};
$('btnLabels').onclick = () => { showLabels = !showLabels; $('btnLabels').classList.toggle('on', showLabels); refreshLabels(true); };
document.querySelectorAll('#areaSeg button').forEach(btn => btn.onclick = () => {
  area = btn.dataset.area;
  document.querySelectorAll('#areaSeg button').forEach(b => b.classList.toggle('on', b === btn));
  update(); userTook(); // 카메라는 움직이지 않음 (이동은 '전체 보기'·'쪽문 GS25' 버튼이나 직접 조작으로)
});
$('statsFold').onclick = () => { $('stats').classList.toggle('folded'); $('statsFold').textContent = $('stats').classList.contains('folded') ? '+' : '–'; };
if (isMobile) { $('stats').classList.add('folded'); $('statsFold').textContent = '+'; }
$('exploreFold').onclick = () => { $('explore').classList.toggle('folded'); $('exploreFold').textContent = $('explore').classList.contains('folded') ? '+' : '–'; };
if (isMobile) { $('explore').classList.add('folded'); $('exploreFold').textContent = '+'; }
$('infoBtn').onclick = () => { $('credit').hidden = !$('credit').hidden; };
const usedCats = Object.keys(cats).filter(k => shops.some(s => s.cat === k)); // 0곳인 업종은 숨김

// ---------- 간판: 가까운 건물의 도로 쪽 1층에 그해 영업 중인 가게 이름 ----------
// 성능: 가까운 건물(최대 90동)만 간판을 만들고, 글씨 텍스처는 문구별로 캐시. 높이 올라가면 모두 숨김
const roadSegs = new Map();
osm.roads.forEach(r => {
  if (isFoot(r.type)) return;
  r.pts.forEach((p, i) => {
    if (!i) return; const q = r.pts[i - 1], k = cellKey(Math.floor((p[0] + q[0]) / 2 / CELL), Math.floor((p[1] + q[1]) / 2 / CELL));
    (roadSegs.get(k) || roadSegs.set(k, []).get(k)).push([q, p]);
  });
});
// 벽이 '향하는' 도로: 벽 가운데에서 바깥쪽으로 40m 광선을 쏴 처음 만나는 이름 있는 도로
const allNamed = [...namedSegs].flatMap(([name, segs]) => segs.map(([p, q, hw]) => ({ name, p, q, hw })));
function rayHits(m, nx, nz, maxT = 80) { // 광선이 지나는 이름 있는 도로들 (가까운 순)
  const hits = [];
  for (const r of allNamed) {
    if (Math.min(r.p[0], r.q[0]) > m[0] + 85 || Math.max(r.p[0], r.q[0]) < m[0] - 85 || Math.min(r.p[1], r.q[1]) > m[1] + 85 || Math.max(r.p[1], r.q[1]) < m[1] - 85) continue;
    const ex = r.q[0] - r.p[0], ez = r.q[1] - r.p[1], den = nx * ez - nz * ex; if (Math.abs(den) < 1e-6) continue;
    const t = ((r.p[0] - m[0]) * ez - (r.p[1] - m[1]) * ex) / den, u = ((r.p[0] - m[0]) * nz - (r.p[1] - m[1]) * nx) / den;
    if (t > 0 && t < maxT && u >= -0.02 && u <= 1.02) hits.push({ name: r.name, t });
  }
  return hits.sort((a, c) => a.t - c.t);
}
function rayRoad(m, nx, nz) {
  let best = null, bt = 80;
  for (const r of allNamed) {
    if (Math.min(r.p[0], r.q[0]) > m[0] + 85 || Math.max(r.p[0], r.q[0]) < m[0] - 85 || Math.min(r.p[1], r.q[1]) > m[1] + 85 || Math.max(r.p[1], r.q[1]) < m[1] - 85) continue;
    const ex = r.q[0] - r.p[0], ez = r.q[1] - r.p[1], den = nx * ez - nz * ex; if (Math.abs(den) < 1e-6) continue;
    const t = ((r.p[0] - m[0]) * ez - (r.p[1] - m[1]) * ex) / den, u = ((r.p[0] - m[0]) * nz - (r.p[1] - m[1]) * nx) / den;
    if (t > 0 && u >= -0.02 && u <= 1.02 && t < bt) { bt = t; best = r.name; }
  }
  return best ? { name: best, t: bt } : null;
}
function faceFrom(p, q) { const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, ux = (q[0] - p[0]) / L, uz = (q[1] - p[1]) / L; return { p, q, L, ux, uz, nx: -uz, nz: ux }; }
function facadeFor(b, road) { // 도로명주소의 도로(출입구 쪽)를 '향하는' 벽. 없으면 그 도로에 가장 가까운 벽, 이름이 없으면 가장 가까운 도로 쪽
  if (b === complexMall) return facadeOf(b); // 단지 상가는 단지 주소 도로가 아니라 상가 앞길 쪽
  const segs = road && namedSegs.get(road);
  if (!segs) return facadeOf(b);
  b.faces = b.faces || {};
  if (b.faces[road]) return b.faces[road];
  let hit = null, ht = Infinity, cross = null, ct = Infinity, near = null, nd = Infinity;
  wallsOf(b).forEach(f => {
    if (f.L < 2) return;
    // 광선은 벽 4m 안쪽에서 시작: OSM 도로 중심선과 국토부 외곽선이 몇 m 어긋나 도로가 벽에 걸친 경우도 잡기 위해
    const m = [(f.p[0] + f.q[0]) / 2 - f.nx * 4, (f.p[1] + f.q[1]) / 2 - f.nz * 4];
    const hits = rayHits(m, f.nx, f.nz), r = hits[0];
    if (r && r.name === road && r.t - Math.min(f.L, 12) * 0.05 < ht) { ht = r.t - Math.min(f.L, 12) * 0.05; hit = f; }
    const h2 = hits.find(h => h.name === road); // 교차로 너머로 그 도로가 보이는 벽 (차선책)
    if (h2 && h2.t < 34 && h2.t < ct) { ct = h2.t; cross = f; }
    let d = Infinity; for (const [a, c] of segs) d = Math.min(d, distSeg(m, a, c));
    if (d < nd) { nd = d; near = f; }
  });
  return (b.faces[road] = hit || cross || (near && nd < 40 ? near : facadeOf(b)));
}
function wallsOf(b) { // 방향이 25° 안쪽으로 이어지는 변들을 한 벽으로 합침
  if (b.walls) return b.walls;
  const P = b.pts, n = P.length, dir = i => { const q = P[(i + 1) % n], p = P[i]; return Math.atan2(q[1] - p[1], q[0] - p[0]); };
  const same = (a, c) => Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c))) < 0.44;
  let start = 0; for (let i = 0; i < n; i++) if (!same(dir((i - 1 + n) % n), dir(i))) { start = i; break; }
  const walls = []; let i0 = start;
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (k === n || !same(dir((i - 1 + n) % n), dir(i)) || !same(dir(i0), dir(i))) {
      const p = P[i0], q = P[i], f = faceFrom(p, q); if (f.L > 0.5) walls.push(f); i0 = i;
    }
  }
  return (b.walls = walls.length ? walls : P.map((p, i) => faceFrom(p, P[(i + 1) % n])));
}
function facadeOf(b) { // 도로에 가장 가까운 변 = 정면
  if (b.face) return b.face;
  const segs = [], i0 = Math.floor(b.c[0] / CELL), j0 = Math.floor(b.c[1] / CELL);
  for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) segs.push(...(roadSegs.get(cellKey(i, j)) || []));
  let best = null, bd = Infinity;
  for (const f of wallsOf(b)) {
    if (f.L < 2.5) continue;
    const m = [(f.p[0] + f.q[0]) / 2, (f.p[1] + f.q[1]) / 2]; let d = Infinity;
    for (const [a, c] of segs) d = Math.min(d, distSeg(m, a, c));
    if (d - Math.min(f.L, 12) * 0.05 < bd) { bd = d - Math.min(f.L, 12) * 0.05; best = f; }
  }
  return b.face = best || wallsOf(b)[0];
}
const texCache = new Map();
function signTexture(text, bg, fg, aspect) {
  const key = `${text}|${bg}|${fg}|${Math.round(aspect * 2)}`;
  const hit = texCache.get(key); if (hit) { hit.t = performance.now(); return hit.tex; }
  const W = 512, H = Math.max(40, Math.min(200, Math.round(W / aspect)));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(0, 0, W, H * 0.1);
  g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, H * 0.9, W, H * 0.1);
  const font = sz => `700 ${sz}px "IBM Plex Sans KR", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
  let size = H * 0.6, s = text; g.font = font(size);
  while (g.measureText(s).width > W * 0.9 && size > H * 0.34) { size *= 0.92; g.font = font(size); } // 긴 이름은 먼저 글씨를 줄이고
  if (g.measureText(s).width > W * 0.9) { while (s.length > 1 && g.measureText(s + '…').width > W * 0.9) s = s.slice(0, -1); s += '…'; } // 그래도 길면 자름
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, W / 2, H * 0.54);
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
  texCache.set(key, { tex, t: performance.now() });
  if (texCache.size > 280) [...texCache.entries()].sort((a, c) => a[1].t - c[1].t).slice(0, 80).forEach(([k, v]) => { v.tex.dispose(); texCache.delete(k); });
  return tex;
}
let signsLib = null; // web/signs.js (있을 때만)
if (window.Signs && window.Signs.texture) { try { await (window.Signs.ready ? window.Signs.ready() : null); signsLib = window.Signs; } catch (e) { console.warn('signs.js 준비 실패, 글씨 간판으로 대신함', e); } }
const signGroup = new THREE.Group(); scene.add(signGroup);
const signsOf = new Map(), PLANE = new THREE.PlaneGeometry(1, 1), BOX = new THREE.BoxGeometry(1, 1, 1);
const SIGN_BACK = new THREE.MeshLambertMaterial({ color: '#3b3b40' });
let lastSignT = 0, signRange = 1;
function dropSigns(b) { // 텍스처는 signs.js와 글씨 간판 캐시가 관리하므로 머티리얼만 정리
  const e = signsOf.get(b); if (!e) return;
  e.meshes.forEach(m => { signGroup.remove(m); if (m.material && m.material !== SIGN_BACK && m.material.dispose) m.material.dispose(); });
  signsOf.delete(b);
}
function refreshSigns(force) {
  const now = performance.now();
  if (!force && now - lastSignT < 350) return;
  lastSignT = now;
  const ex = appMode === 'explore', rx = ex ? player.x : controls.target.x, rz = ex ? player.z : controls.target.z;
  const high = (ex && topView) || camera.position.y > 150;
  const R = high ? 0 : (camera.position.y < 25 ? 75 : 140) * signRange;
  const want = new Set();
  if (R) [...nearBuildings([rx, rz], R)].filter(b => b.rStore && b.shops.length && b !== gsB)
    .map(b => [Math.hypot(b.c[0] - rx, b.c[1] - rz), b]).filter(([d]) => d < R).sort((a, c) => a[0] - c[0]).slice(0, 90).forEach(([, b]) => want.add(b));
  for (const b of [...signsOf.keys()]) if (!want.has(b)) dropSigns(b);
  const t = SNAP_T[snapIdx];
  for (const b of want) {
    const act = b.shops.filter(s => activeAt(s, t) && inArea(s));
    const ever = b.shops.some(s => s.openT <= t && inArea(s));
    const key = act.map(s => s.id).join(',') || (ever ? 'vacant' : 'none');
    if (signsOf.has(b) && signsOf.get(b).key === key) continue;
    dropSigns(b);
    const meshes = [], dist = Math.hypot(b.c[0] - rx, b.c[1] - rz);
    const place = (f, m, cx, y, out) => { m.rotation.y = Math.atan2(f.nx, f.nz); m.position.set(f.p[0] + f.ux * cx + f.nx * out, y, f.p[1] + f.uz * cx + f.nz * out); signGroup.add(m); meshes.push(m); };
    // web/signs.js(절차적 간판)가 있으면 그걸 쓰고, 없으면 글씨 간판으로 대신함
    const add = (f, shop, opts, fallback, cx, w, y, h) => {
      let tex = null;
      if (signsLib && !opts.plain) try { tex = signsLib.texture(THREE, shop, { width: +w.toFixed(1), height: +h.toFixed(2), lod: dist < 30 ? 'hi' : 'lo', ...opts }).texture; } catch (e) { console.warn('signs.js 간판 실패, 글씨 간판으로 대신함', e); }
      const back = new THREE.Mesh(BOX, SIGN_BACK); back.scale.set(w + 0.06, h + 0.06, 0.08); place(f, back, cx, y, 0.04); // 벽에서 0.08m 튀어나온 간판 몸통
      const m = new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({ map: tex || signTexture(...fallback, w / h), transparent: !!tex }));
      m.scale.set(w, h, 1); place(f, m, cx, y, 0.085);
      if (signsLib && shop && !opts.vacant && !opts.plain && dist < 45) { // 돌출 간판 (가까운 건물만, +Z가 도로 쪽)
        try { const pm = signsLib.projecting(THREE, shop); if (pm) place(f, pm, Math.min(cx + w / 2 + 0.2, f.L - 0.3), GF + 0.8, 0.02); } catch (e) { /* 없어도 됨 */ }
      }
    };
    // 가게마다 도로명주소의 도로 쪽 벽을 고르고, 같은 벽의 가게는 좌표를 벽에 투영한 순서대로 칸을 나눔
    const walls = new Map();
    for (const s of act) {
      const f = facadeFor(b, s.road), k = f.p.join() + f.q.join() + s.fk + (s.fk === 'upper' ? s.fl : '');
      if (!walls.has(k)) walls.set(k, { f, kind: s.fk, fl: s.fl, list: [] });
      walls.get(k).list.push({ s, t: Math.max(0, Math.min(f.L, (s.xz[0] - f.p[0]) * f.ux + (s.xz[1] - f.p[1]) * f.uz)) });
    }
    for (const { f, kind, fl, list } of walls.values()) {
      list.sort((a, c) => a.t - c.t);
      const items = list.slice(0, kind === 'ground' ? 3 : 2), n = items.length;
      const w = kind === 'ground' ? Math.min(4.4, f.L / n * 0.92) : kind === 'upper' ? Math.min(3.6, f.L / n * 0.8) : Math.min(1.8, f.L / n * 0.8);
      // 투영한 자리 그대로 두되, 겹치면 최소 간격만큼 밀어냄
      let xs = items.map(it => Math.max(w / 2, Math.min(f.L - w / 2, it.t)));
      for (let i = 1; i < n; i++) xs[i] = Math.max(xs[i], xs[i - 1] + w + 0.12);
      const over = n ? xs[n - 1] - (f.L - w / 2) : 0;
      if (over > 0) xs = xs.map(x => x - over);
      if (n && xs[0] < w / 2 - 0.01) xs = items.map((_, i) => f.L / n * (i + 0.5)); // 그래도 넘치면 고르게
      items.forEach(({ s }, i) => {
        if (kind === 'ground') add(f, s, {}, [star(s) + s.name, catCol(s.cat).getStyle(), '#ffffff'], xs[i], w, 3.6, Math.min(0.8, Math.max(0.55, w / 4)));
        else if (kind === 'upper') { const y = Math.min(b.h - 0.6, GF + (fl - 2) * FH + 1.6); add(f, s, {}, [fl + '층 ' + s.name, '#ffffff', catCol(s.cat).getStyle()], xs[i], w, y, 0.6); }
        else { // 지하: 길가에 계단 입구와 작은 안내판
          const door = new THREE.Mesh(BOX, SIGN_BACK); door.scale.set(1.1, 2.1, 0.12); place(f, door, xs[i], 1.05, 0.06);
          add(f, s, { plain: true }, ['⬇ B1 ' + s.name, '#16161a', '#ffd400'], xs[i], Math.max(w, 1.6), 2.45, 0.42);
        }
      });
    }
    if (!act.length && ever) {
      const last = b.shops.filter(s => s.openT <= t && inArea(s)).pop(), f = facadeFor(b, last && last.road);
      add(f, last, { vacant: true }, ['임대 문의', '#ffffff', '#d4321f'], f.L / 2, Math.min(f.L * 0.6, 3.2), 3.6, 0.7);
    }
    signsOf.set(b, { key, meshes });
  }
}

// ================= 새내기 시뮬레이션 =================
// 속도는 실제 축척(m/s). 화면 배속(mul)은 화면에서만 빠르게 보여 주고, 거리·시간 표시는 실제 속도로 계산
const VEH = {
  walk: { name: '도보', icon: '🚶', kmh: 4.5, run: 9, eye: 1.65, cam: [5.5, 2.4], acc: 6 },
  bike: { name: '자전거', icon: '🚲', kmh: 15, run: 25, eye: 1.8, cam: [7, 2.8], acc: 2.5 },
  kick: { name: '전동킥보드', icon: '🛴', kmh: 20, run: 25, eye: 1.85, cam: [7, 2.8], acc: 3,
    note: '전동킥보드 법정 최고속도는 25km/h예요. 헬멧은 꼭 쓰고, 인도에서는 타면 안 돼요. 평소 20km/h, 달리면 25km/h로 계산해요.' },
};
const ms = k => VEH[k].kmh / 3.6;
let veh = 'walk', mul = 1, rings = false, pinsOn = true, shopLbl = true, view = 'third';
const player = { x: 0, z: 0, yaw: 0, pitch: 0.04, lift: 0.5, boom: 6, dist: 0, time: 0, v: 0, running: false, turn: 0 };
const TOP_BOOM = 45; // 붐이 이보다 길면 위에서 보기
let auto = null; // 자동 이동 { tool, s }
function resetPlayer() {
  // GS25 북쪽 공터(벽에서 7m): 오른쪽 앞에 GS25 간판, 정면 너머로 대학로291번가길 빨간 포장·횡단보도
  // (간판이 보이는 쪽·벽과의 거리·두 대상이 한 화면에 드는지를 격자로 따져 고른 자리)
  player.x = -6; player.z = -11; auto = null; player.pitch = -0.05; player.v = 0; player.yaw = 1.18;
}
resetPlayer();
function blocked(x, z) {
  if (x < SCOPE.minx - 40 || x > SCOPE.maxx + 40 || z < SCOPE.minz || z > SCOPE.maxz + 40) return true;
  if (blockedArea([x, z])) return true;
  for (const b of nearBuildings([x, z], 2)) if (distToBuilding([x, z], b) < 0.35) return true;
  for (const s of solids) if (Math.hypot(s[0] - x, s[1] - z) < s[2]) return true;
  return false;
}
function tryMove(dx, dz, realV) {
  const nx = player.x + dx, nz = player.z + dz;
  let moved = 0;
  if (!blocked(nx, nz)) { player.x = nx; player.z = nz; moved = Math.hypot(dx, dz); }
  else if (!blocked(player.x + dx, player.z)) { player.x += dx; moved = Math.abs(dx); }
  else if (!blocked(player.x, player.z + dz)) { player.z += dz; moved = Math.abs(dz); }
  if (moved) { player.dist += moved; player.time += moved / Math.max(0.3, realV); }
  return moved;
}
function updateHud() {
  $('hDist').textContent = player.dist < 1000 ? `${Math.round(player.dist)} m` : `${(player.dist / 1000).toFixed(2)} km`;
  $('hTime').textContent = fmtTime(player.time);
  const kmh = Math.abs(player.v) * 3.6;
  $('hSpeed').textContent = `${VEH[veh].icon} ${(kmh < 0.05 ? 0 : kmh).toFixed(1)}km/h`;
  $('hRun').hidden = !player.running;
  $('hMul').textContent = mul > 1 ? `화면 ${mul}배속` : '실제 속도';
}

// 입력: 키보드. e.code로 받아서 한글 입력 상태에서도 WASD가 동작
const KEY = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
  KeyQ: 'l', KeyE: 'r', ShiftLeft: 'run', ShiftRight: 'run' };
const keys = new Set();
let fwdSince = 0, joyFullSince = 0;
addEventListener('keydown', e => {
  if (appMode !== 'explore' || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const k = KEY[e.code]; if (!k) return;
  if (k === 'f' && !keys.has('f')) fwdSince = performance.now();
  keys.add(k); auto = null; e.preventDefault();
});
addEventListener('keyup', e => { const k = KEY[e.code]; if (k) keys.delete(k); });
addEventListener('blur', () => keys.clear());
// 입력: 조이스틱 (터치)
const joy = { x: 0, y: 0, id: null };
{
  const el = $('joy'), knob = $('joyKnob');
  const set = e => {
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let x = (e.clientX - cx) / (r.width / 2), y = (e.clientY - cy) / (r.height / 2); const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    if (l < 0.95) joyFullSince = 0; else if (!joyFullSince) joyFullSince = performance.now();
    joy.x = x; joy.y = y; knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
  };
  el.addEventListener('pointerdown', e => { joy.id = e.pointerId; el.setPointerCapture(e.pointerId); set(e); auto = null; e.stopPropagation(); });
  el.addEventListener('pointermove', e => { if (e.pointerId === joy.id) set(e); });
  const end = e => { if (e.pointerId !== joy.id) return; joy.id = null; joy.x = joy.y = 0; joyFullSince = 0; knob.style.transform = ''; };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
// 입력: 드래그로 둘러보기, 짧게 누르면 선택
let drag = null;
renderer.domElement.addEventListener('pointerdown', e => { $('intro').hidden = true; drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, id: e.pointerId }; });
addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id || appMode !== 'explore') return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  player.yaw -= dx * 0.005;
  player.pitch = Math.max(-0.7, Math.min(0.6, player.pitch - dy * 0.004));
  drag.x = e.clientX; drag.y = e.clientY;
});
addEventListener('pointerup', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const click = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6; drag = null;
  if (click && e.target === renderer.domElement) pick(e.clientX, e.clientY);
});

// 선택: 10년 변화에서는 이 자리의 역사, 시뮬레이션에서는 경로와 시간
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
function pick(cx, cy) {
  mouse.set(cx / innerWidth * 2 - 1, -cy / innerHeight * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObject(bMesh)[0];
  if (appMode === 'survival') { if (hit) showPlace(buildingAtTri(hit.faceIndex)); return; }
  if (hit) {
    const b = buildingAtTri(hit.faceIndex);
    if (b.apt) return routeTo([hit.point.x, hit.point.z], '한빛아파트 (단지 안은 들어갈 수 없어요)');
    const top = b.now && (b.now.g.top || b.now.u.top);
    return routeTo(top ? entranceOf(top) : b.c, top ? `${star(top)}${top.name} <small>(${catName(top.cat)})</small>` : (b.name || '이 건물'));
  }
  const g = ray.intersectObject(ground)[0];
  if (g) routeTo([g.point.x, g.point.z], '이 지점');
}

// "여기까지 얼마나 걸릴까?": 얇게 떠 있는 선 + 끝점 핀 + 천천히 흐르는 점
let route = null, routePath = null, destLabel = null;
const ROUTE_COL = '#1a6dff';
function clearRoute() {
  if (route) { scene.remove(route.group); route.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); route = null; }
  routePath = null; $('routeBox').hidden = true; if (!overview) $('btnTop').textContent = '🗺 한눈에 보기'; document.body.classList.remove('route-open'); if (destLabel) destLabel.d.dataset.hide = '1';
}
function routeTo(target, name) {
  const s = nearestNode([player.x, player.z]), g = nearestNode(target);
  if (s < 0 || g < 0) return;
  const { dist, prev } = dijkstra(s);
  if (!Number.isFinite(dist[g])) return;
  const nodes = []; for (let v = g; v >= 0; v = prev[v]) nodes.unshift([G.x[v], G.z[v]]);
  const pts = [[player.x, player.z], ...nodes, [target[0], target[1]]];
  const len = pts.reduce((a, p, i) => i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0, 0);
  if (route) clearRoute();
  const group = new THREE.Group();
  const b = new Builder(); b.ribbon(pts, 0.7, 0.32, C(ROUTE_COL));
  group.add(new THREE.Mesh(b.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false })));
  const wide = new Builder(); wide.ribbon(pts, 4, 0.4, C(ROUTE_COL)); // 한눈에 보기용 굵은 선
  const wideMesh = new THREE.Mesh(wide.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
  wideMesh.visible = !!overview; wideMesh.name = 'wide'; group.add(wideMesh);
  const tool = pathTool(pts), n = Math.max(1, Math.floor(tool.total / 9));
  const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.05, 1.4), new THREE.MeshBasicMaterial({ color: '#ffffff' }), n);
  group.add(dashes);
  const pin = new THREE.Group();
  pin.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3, 6).translate(0, 1.5, 0), new THREE.MeshBasicMaterial({ color: '#17171a' })));
  pin.add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8).translate(0, 3.3, 0), new THREE.MeshLambertMaterial({ color: ROUTE_COL })));
  pin.position.set(target[0], 0, target[1]); group.add(pin);
  scene.add(group);
  route = { group, dashes, tool, n, phase: 0, dest: target, len };
  if (!overview) $('btnTop').textContent = '🗺 경로 한눈에';
  placeDashes(0);
  routePath = pts;
  if (!destLabel) destLabel = addFixedLabel('', 0, 0, 0, 'dest');
  destLabel.d.innerHTML = name.replace(/<small>.*<\/small>/, ''); destLabel.v.set(target[0], 4.6, target[1]); delete destLabel.d.dataset.hide;
  $('routeInfo').innerHTML = `<div class="rname">${name}</div><div class="rdist">지금 위치에서 길을 따라 <b>${Math.round(len)} m</b></div>
    <div class="rt">${Object.keys(VEH).map(k => `<div class="${k === veh ? 'cur' : ''}">${VEH[k].icon} ${VEH[k].name}<b>${fmtMin(len / ms(k))}</b></div>`).join('')}</div>`;
  $('routeBox').hidden = false; document.body.classList.add('route-open');
}
function routeRemain() { // 경로에서 지금 위치와 가장 가까운 점부터 끝까지
  const P = route.tool.P; let best = Infinity, bs = 0, acc = 0;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-6;
    const t = Math.max(0, Math.min(1, ((player.x - a[0]) * (b[0] - a[0]) + (player.z - a[1]) * (b[1] - a[1])) / (l * l)));
    const d = Math.hypot(player.x - a[0] - (b[0] - a[0]) * t, player.z - a[1] - (b[1] - a[1]) * t);
    if (d < best) { best = d; bs = acc + l * t; }
    acc += l;
  }
  return Math.max(0, route.tool.total - bs) + (best > 15 ? best : 0);
}
const dummy = new THREE.Object3D();
function placeDashes(dt) {
  if (!route) return;
  if (!reduceMotion) route.phase = (route.phase + dt * 4) % 9;
  for (let i = 0; i < route.n; i++) {
    const p = route.tool.at((i * 9 + route.phase) % route.tool.total);
    dummy.position.set(p.x, 0.36, p.z); dummy.rotation.set(0, Math.atan2(p.dx, p.dz), 0); dummy.updateMatrix();
    route.dashes.setMatrixAt(i, dummy.matrix);
  }
  route.dashes.instanceMatrix.needsUpdate = true;
}
$('routeClose').onclick = clearRoute;
$('btnGoRoute').onclick = () => { if (routePath) auto = { tool: pathTool(routePath), s: 0, end: 'route' }; };

// 거리 감각: 5·10·15분 도달 범위. 길 위에 가는 색 선으로만 표시 (구간마다 시간대 색)
const RING = [[5, '#ffc400'], [10, '#ff8a1c'], [15, '#ff4d2e']];
let ringMesh = null, ringAt = null;
function drawRings() {
  if (ringMesh) { scene.remove(ringMesh); ringMesh.geometry.dispose(); ringMesh = null; }
  $('ringLegend').hidden = !rings;
  if (!rings) return;
  const s = nearestNode([player.x, player.z]); if (s < 0) return;
  const v = ms(veh), T = RING.map(([m]) => m * 60 * v), { dist } = dijkstra(s, T[2] + 1);
  const cols = RING.map(([, c]) => C(c)), b = new Builder();
  for (let u = 0; u < GN; u++) {
    const a = G.adj[u];
    for (let j = 0; j < a.length; j += 2) {
      const w = a[j]; if (w < u) continue;
      const du = dist[u], dw = dist[w], l = a[j + 1];
      if (Math.min(du, dw) > T[2] || !l) continue;
      const n = Math.max(1, Math.ceil(l / 6));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n, d = Math.min(du + l * (t0 + t1) / 2, dw + l * (1 - (t0 + t1) / 2));
        const band = d <= T[0] ? 0 : d <= T[1] ? 1 : d <= T[2] ? 2 : -1; if (band < 0) continue;
        const p = [G.x[u] + (G.x[w] - G.x[u]) * t0, G.z[u] + (G.z[w] - G.z[u]) * t0], q = [G.x[u] + (G.x[w] - G.x[u]) * t1, G.z[u] + (G.z[w] - G.z[u]) * t1];
        b.ribbon([p, q], 0.85, 0.24, cols[band]);
      }
    }
  }
  ringMesh = new THREE.Mesh(b.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
  ringMesh.visible = appMode === 'explore';
  scene.add(ringMesh);
  $('ringLegend').innerHTML = `${VEH[veh].icon} ${VEH[veh].name}로 지금 위치에서 길을 따라` +
    RING.map(([min, col], i) => `<span><s style="background:${col}"></s>${min}분 · ${Math.round(T[i])}m</span>`).join('');
  ringAt = [player.x, player.z];
}

// 새내기 생활 지도: 필수 장소 핀 + 랜드마크
const PIN = [
  { k: 'conv', icon: '🏪', name: '편의점', shop: s => s.cat === 'conv' || /편의점/.test(s.sub || ''), osm: ['convenience'] },
  { k: 'cafe', icon: '☕', name: '카페', shop: s => s.cat === 'cafe' && !/제과|과자|아이스크림/.test(s.sub || ''), osm: ['cafe'] },
  { k: 'copy', icon: '🖨️', name: '복사·제본', shop: null, osm: ['copyshop'] }, // 인허가 자료에 없는 업종은 OSM 장소만
  { k: 'laundry', icon: '🧺', name: '코인세탁', shop: null, osm: ['laundry', 'dry_cleaning'] },
  { k: 'health', icon: '💊', name: '약국·의원', shop: null, osm: ['pharmacy', 'clinic', 'doctors', 'dentist', 'hospital'] },
  { k: 'bank', icon: '🏦', name: '은행·ATM', shop: null, osm: ['bank', 'atm', 'post_office'] },
];
const pinOn = new Set(PIN.map(p => p.k));
const pinList = [];
{
  const t = SNAP_T[LAST];
  const inScope = p => p[0] >= SCOPE.minx && p[0] <= SCOPE.maxx && p[1] >= SCOPE.minz && p[1] <= SCOPE.maxz;
  for (const P of PIN) {
    const mine = [];
    if (P.shop) shops.filter(s => activeAt(s, t) && P.shop(s) && inScope(s.xz)).forEach(s => mine.push({ k: P.k, icon: P.icon, name: s.name, xz: s.xz }));
    osm.pois.filter(p => P.osm.includes(p.kind) && inScope(p.xz)).forEach(p => {
      if (!mine.some(m => Math.hypot(m.xz[0] - p.xz[0], m.xz[1] - p.xz[1]) < 12)) mine.push({ k: P.k, icon: P.icon, name: p.name || P.name, xz: p.xz });
    });
    pinList.push(...mine);
  }
  pinList.forEach(p => {
    const d = document.createElement('div'); d.className = 'pin'; d.innerHTML = `${p.icon} <small>${p.name}</small>`; d.style.display = 'none';
    d.onclick = () => routeTo(p.xz, `${p.icon} ${p.name}`);
    labelBox.appendChild(d); p.d = d; p.v = new THREE.Vector3(p.xz[0], 3.2, p.xz[1]);
  });
  $('pinSeg').innerHTML = PIN.filter(P => pinList.some(p => p.k === P.k)).map(P => `<button data-pin="${P.k}" class="on">${P.icon} ${P.name} ${pinList.filter(p => p.k === P.k).length}</button>`).join('');
  document.querySelectorAll('#pinSeg button').forEach(btn => btn.onclick = () => {
    const k = btn.dataset.pin; pinOn.has(k) ? pinOn.delete(k) : pinOn.add(k); btn.classList.toggle('on', pinOn.has(k)); refreshPins();
  });
}
// 랜드마크: 버스정류장(이름이 같은 가까운 정류장은 하나로), 출입구, 단지·캠퍼스 이름
const landmarks = [];
{
  const inNear = p => p[0] >= SCOPE.minx - 60 && p[0] <= SCOPE.maxx + 60 && p[1] >= SCOPE.minz - 30 && p[1] <= SCOPE.maxz + 60;
  osm.pois.filter(p => p.kind === 'bus_stop' && p.name && inNear(p.xz)).forEach(p => {
    if (!landmarks.some(l => l.name === '🚌 ' + p.name && Math.hypot(l.xz[0] - p.xz[0], l.xz[1] - p.xz[1]) < 80)) landmarks.push({ name: '🚌 ' + p.name, xz: p.xz });
  });
  osm.pois.filter(p => p.kind === 'entrance' && p.name && p.name !== '쪽문' && inNear(p.xz)).forEach(p => {
    if (!landmarks.some(l => l.name === '🚪 ' + p.name && Math.hypot(l.xz[0] - p.xz[0], l.xz[1] - p.xz[1]) < 80)) landmarks.push({ name: '🚪 ' + p.name, xz: p.xz });
  });
  if (hanbit) { const c = hanbit.pts.reduce((a, p) => [a[0] + p[0] / hanbit.pts.length, a[1] + p[1] / hanbit.pts.length], [0, 0]); landmarks.push({ name: '🏢 한빛아파트', xz: c, y: 62 }); }
  const cnu = campuses.find(c => c.name === '충남대학교');
  if (cnu) { let best = cnu.pts[0]; cnu.pts.forEach(p => { if (Math.hypot(p[0] + 800, p[1] - 40) < Math.hypot(best[0] + 800, best[1] - 40)) best = p; }); landmarks.push({ name: '🎓 충남대학교', xz: best, y: 14 }); }
  landmarks.forEach(l => { const f = addFixedLabel(l.name, l.xz[0], l.y || 4, l.xz[1], 'lm'); f.d.dataset.hide = '1'; l.f = f; });
}
let pinShown = [];
function refreshPins() {
  pinShown.forEach(p => { p.d.style.display = 'none'; }); pinShown = [];
  const show = appMode === 'explore' && pinsOn;
  const ref = { x: player.x, z: player.z };
  landmarks.forEach(l => { if (show && (l.y || Math.hypot(l.xz[0] - ref.x, l.xz[1] - ref.z) < 260)) delete l.f.d.dataset.hide; else l.f.d.dataset.hide = '1'; });
  if (!show) return;
  pinShown = pinList.filter(p => pinOn.has(p.k)).map(p => [Math.hypot(p.xz[0] - ref.x, p.xz[1] - ref.z), p])
    .filter(([d]) => d < (topView ? 260 : 160)).sort((a, b) => a[0] - b[0]).slice(0, 24).map(([, p]) => p);
}

// 시뮬레이션 UI
function setVeh(k) {
  veh = k;
  document.querySelectorAll('#vehSeg button').forEach(b => b.classList.toggle('on', b.dataset.veh === k));
  $('vehNote').textContent = VEH[k].note || '';
  buildViewModel(k);
  if (rings) drawRings();
  if (routePath && !$('routeBox').hidden) document.querySelectorAll('.rt div').forEach((d, i) => d.classList.toggle('cur', Object.keys(VEH)[i] === k));
  updateHud();
}
document.querySelectorAll('#vehSeg button').forEach(b => b.onclick = () => setVeh(b.dataset.veh));
document.querySelectorAll('#mulSeg button').forEach(b => b.onclick = () => {
  mul = +b.dataset.mul; document.querySelectorAll('#mulSeg button').forEach(x => x.classList.toggle('on', x === b)); updateHud();
});
$('btnRings').onclick = () => { rings = !rings; $('btnRings').classList.toggle('on', rings); drawRings(); };
$('btnPins').onclick = () => { pinsOn = !pinsOn; $('btnPins').classList.toggle('on', pinsOn); $('pinSeg').hidden = !pinsOn; refreshPins(); };
$('btnShopLbl').onclick = () => { shopLbl = !shopLbl; $('btnShopLbl').classList.toggle('on', shopLbl); refreshLabels(true); };
// 위에서 보기: 거리 감각 범위와 경로를 한눈에. 내 위치는 노란 화살표
let topView = false;
const me = new THREE.Mesh(new THREE.ConeGeometry(2.2, 6, 4).rotateX(Math.PI / 2).translate(0, 2, 0), new THREE.MeshLambertMaterial({ color: '#ffd400', emissive: '#6a5600' }));
me.visible = false; scene.add(me);
// 한눈에 보기: 누를 때만 위에서 경로(없으면 내 주변)를 보여 주고, 다시 누르면 원래 1인칭으로 돌아감
let overview = null;
function setOverview(on) {
  if (on) {
    const pts = route ? route.tool.P : [[player.x - 300, player.z - 300], [player.x + 300, player.z + 300]];
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 80);
    overview = { pos: new THREE.Vector3(cx + size * 0.12, size * 1.05 + 40, cz + size * 0.6), look: new THREE.Vector3(cx, 0, cz) };
  } else overview = null;
  topView = !!overview; me.visible = !!overview && appMode === 'explore';
  if (route) route.group.getObjectByName('wide').visible = !!overview;
  $('btnTop').classList.toggle('on', !!overview); $('btnTop').textContent = overview ? '↩ 돌아가기' : (route ? '🗺 경로 한눈에' : '🗺 한눈에 보기');
  refreshSigns(true); refreshLabels(true);
}
function setTop(on) { setOverview(on); }
$('btnTop').onclick = () => setOverview(!overview);
$('btnAuto').onclick = () => { if (auto && auto.end === 'guide') { auto = null; return; } resetPlayer(); auto = { tool: guide, s: 0, end: 'guide' }; };
$('btnHome').onclick = () => { resetPlayer(); if (rings) drawRings(); };
$('btnResetHud').onclick = () => { player.dist = 0; player.time = 0; updateHud(); };

// 1인칭 탈것(화면 아래): 자전거는 핸들바와 앞바퀴 일부, 킥보드는 스템과 핸들, 걷기는 없음
scene.add(camera);
const vm = new THREE.Group(); vm.visible = false; vm.scale.setScalar(0.85); camera.add(vm);
let vmPhase = 0, roll = 0;
function buildViewModel(kind) {
  while (vm.children.length) vm.remove(vm.children[0]);
  const mat = c => { const m = new THREE.MeshLambertMaterial({ color: c, flatShading: true }); m.depthTest = false; return m; };
  const part = (geo, c, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat(c)); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.renderOrder = 999; vm.add(m); return m; };
  if (kind === 'bike') {
    part(new THREE.CylinderGeometry(0.016, 0.016, 0.62, 8), '#2b2d33', 0, -0.25, -0.68, 0, 0, Math.PI / 2);   // 핸들바
    for (const sx of [-1, 1]) part(new THREE.CylinderGeometry(0.024, 0.024, 0.12, 8), '#16161a', sx * 0.29, -0.25, -0.68, 0, 0, Math.PI / 2); // 손잡이
    part(new THREE.CylinderGeometry(0.02, 0.02, 0.28, 8), '#1a6dff', 0, -0.38, -0.74, -0.3);                   // 스템
    for (const sx of [-1, 1]) part(new THREE.CylinderGeometry(0.014, 0.014, 0.55, 6), '#1a6dff', sx * 0.06, -0.68, -0.92, -0.3); // 포크
    part(new THREE.TorusGeometry(0.34, 0.03, 6, 28), '#222', 0, -0.98, -1.08, 0, Math.PI / 2);               // 앞바퀴(위쪽만 보임)
  } else if (kind === 'kick') {
    part(new THREE.CylinderGeometry(0.022, 0.022, 0.9, 8), '#2b2d33', 0, -0.7, -0.66, -0.18);                 // 스템
    part(new THREE.CylinderGeometry(0.016, 0.016, 0.5, 8), '#2b2d33', 0, -0.26, -0.6, 0, 0, Math.PI / 2);    // 핸들
    for (const sx of [-1, 1]) part(new THREE.CylinderGeometry(0.024, 0.024, 0.1, 8), '#16161a', sx * 0.25, -0.26, -0.6, 0, 0, Math.PI / 2);
    part(new THREE.BoxGeometry(0.1, 0.02, 0.06), '#20b26b', 0, -0.25, -0.62);                                 // 속도 표시 창
  }
}
function updateViewModel(dt, turn) {
  vm.visible = appMode === 'explore' && !overview && veh !== 'walk';
  if (!vm.visible) return;
  vmPhase += dt * Math.abs(player.v) * mul * (veh === 'bike' ? 2.2 : 1.2);
  vm.position.set(0, -0.04 + (reduceMotion ? 0 : Math.sin(vmPhase) * 0.006), -0.15);
  vm.rotation.set(0, turn * 0.04, -turn * 0.06);
}
// 어디 갈까요?: 지금 위치에서 가까운 필수 장소로 바로 길 찾기
function quickTargets() {
  const near = (list, name) => { let best = null, bd = Infinity; list.forEach(p => { const d = Math.hypot(p.xz[0] - player.x, p.xz[1] - player.z); if (d < bd) { bd = d; best = p; } }); return best && { name, xz: best.xz, label: best.name }; };
  return [
    near(pinList.filter(p => p.k === 'conv'), '🏪 가까운 편의점'),
    near(pinList.filter(p => p.k === 'cafe'), '☕ 가까운 카페'),
    near(landmarks.filter(l => l.name.startsWith('🚌')).map(l => ({ xz: l.xz, name: l.name.slice(3) })), '🚌 버스정류장'),
    { name: '🛍 궁동 로데오거리', xz: osm.walk[osm.walk.length - 1], label: '궁동 로데오거리' },
    near(landmarks.filter(l => l.name.includes('충남대')).map(l => ({ xz: l.xz, name: '충남대학교' })), '🎓 충남대'),
  ];
}
$('quickSeg').innerHTML = ['🏪 가까운 편의점', '☕ 가까운 카페', '🚌 버스정류장', '🛍 궁동 로데오거리', '🎓 충남대'].map((n, i) => `<button data-i="${i}">${n}</button>`).join('');
$('quickSeg').onclick = e => {
  const btn = e.target.closest('button'); if (!btn) return;
  const q = quickTargets()[+btn.dataset.i]; if (q) routeTo(q.xz, q.label ? q.name.split(' ')[0] + ' ' + q.label : q.name);
};

// ---------- 모드 전환 ----------
function setMode(m) {
  appMode = m; $('intro').hidden = true;
  document.body.classList.toggle('m-survival', m === 'survival');
  document.body.classList.toggle('m-explore', m === 'explore');
  document.querySelectorAll('#modeSwitch button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('modeName').textContent = $('modeChip').textContent = m === 'survival' ? '10년 변화' : '새내기 시뮬레이션';
  controls.autoRotate = false; if (m === 'explore') collapseTitle();
  stopPlay();
  update(); // 시뮬레이션에서는 '그해 변화' 흐림을 풀고 업종 색으로
  if (m === 'explore') {
    if (snapIdx !== LAST || area !== 'all') { snapIdx = LAST; slider.value = LAST; area = 'all'; document.querySelectorAll('#areaSeg button').forEach(b => b.classList.toggle('on', b.dataset.area === 'all')); update(); }
    controls.enabled = false; fly = null; scene.fog.near = 80; scene.fog.far = 420;
    placeB = null;
    buildViewModel(veh);
    if (rings) drawRings();
    showHint();
    if (!keycapsShown) { keycapsShown = true; $('keycaps').hidden = false; }
  } else {
    controls.enabled = true; clearRoute(); auto = null; setOverview(false);
    camera.rotation.z = 0; camera.position.copy(startCamPos()); controls.target.copy(START_LOOK); camera.fov = 55; camera.updateProjectionMatrix(); controls.update();
    scene.fog.near = 150; scene.fog.far = 700; placeSun(START_LOOK, 140);
  }
  if (ringMesh) ringMesh.visible = m === 'explore';
  me.visible = !!overview && m === 'explore'; vm.visible = false;
  refreshLabels(true); refreshSigns(true);
  updateHud();
}
document.querySelectorAll('#modeSwitch button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
let hintTimer = null, keycapsShown = false;
function showHint() { $('hint').classList.remove('dim'); clearTimeout(hintTimer); hintTimer = setTimeout(() => $('hint').classList.add('dim'), 7000); }

// 출처·주의 (ⓘ)
$('credit').innerHTML = `<b>어궁동 10년 지도</b> · 어궁동 가게 역사<br><b>가게</b> ${(shopsData.sources || []).join(', ')}${shopsData.note ? '<br>' + shopsData.note : ''}<br>` +
  '기간은 같은 영업 허가 기준이라 상호·주인이 중간에 바뀌었을 수 있어요.<br>' +
  (osm.buildings.some(b => b.gov) ? '<b>건물</b> 국토교통부 GIS건물통합정보(브이월드, 2025.06) · ' : '') +
  `<b>지도</b> ${osm.attribution}${osm.buildings.some(b => b.generated) ? ' · 상권 블록 일부 건물은 OSM에 외곽선이 없어 도로를 따라 추정 배치했어요' : ''}.<br>` +
  '회색 = 예전에 가게가 있던 빈 자리' + (keepers.size ? ' · ★ = 같은 이름으로 10년 넘게 지킨 가게' : '');
if (isSample) { $('dataTag').textContent = '더미 데이터 · 실제 데이터 반영 전'; $('dataTag').classList.add('sample'); }

// 처음 안내: 무엇을 할 수 있는지 두 갈래로
$('intro').innerHTML = `<p class="kicker">📍 KAIST 쪽문 GS25에서 출발</p>
  <h2>충남대와 KAIST 사이,<br>어궁동(어은동·궁동)을 3D로 옮겼어요</h2>
  <div class="choices">
    <button class="choice main" id="introSurv"><b>🗺 10년 변화 보기</b><span>지금 재생 중이에요. 초록은 그해 문 연 가게, 빨강은 문 닫은 가게예요</span></button>
    <button class="choice sub" id="introExp"><b>🎒 새내기 시뮬레이션</b><span>걷거나 자전거·킥보드로 동네를 돌아다니며 거리와 시간을 익혀요</span></button>
  </div>
  <p class="foot">위쪽 버튼으로 언제든 바꿀 수 있어요</p>`;
$('intro').hidden = false;
$('introSurv').onclick = () => { $('intro').hidden = true; collapseTitle(); };
$('introExp').onclick = () => { $('intro').hidden = true; setMode('explore'); };

// ---------- 시작 ----------
setVeh('walk');
update();
$('loading').remove();
if (!SHOT) { // 첫 10초: 동네 전체를 천천히 돌면서 10년을 한 번 재생
  camera.position.set(-280, 560, 640); controls.target.set(-470, 0, 40);
  scene.fog.near = 900; scene.fog.far = 3200; placeSun(controls.target, 600);
  controls.autoRotate = !reduceMotion; controls.autoRotateSpeed = 0.4;
  play(true);
} else { camera.position.copy(startCamPos()); controls.target.copy(START_LOOK); placeSun(START_LOOK, 140); scene.fog.near = 150; scene.fog.far = 700; }

let lastT = performance.now(), fpsN = 0, fpsT = 0;
const shadowAt = new THREE.Vector3(1e9, 0, 0);
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const tmp = new THREE.Vector3(), look = new THREE.Vector3();
function camInsideBuilding(x, z) { return [...nearBuildings([x, z], 1)].some(b => inPoly([x, z], b.pts)); }
function stepExplore(dt, now) {
  let turn = 0;
  if (player.hold) { /* 스크린샷 장면: 제자리에서 속도 표시만 유지 */ } else if (auto) {
    const v = ms(veh);
    auto.s += v * mul * dt;
    const p = auto.tool.at(auto.s), a = auto.tool.at(auto.s + 6);
    const d = Math.hypot(p.x - player.x, p.z - player.z);
    player.x = p.x; player.z = p.z; player.dist += d; player.time += d / v; player.v = v; player.running = false;
    const want = Math.atan2(a.x - p.x, a.z - p.z);
    if (Math.hypot(a.x - p.x, a.z - p.z) > 0.5) { let dy = want - player.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); turn = Math.sign(dy); player.yaw += dy * Math.min(1, dt * 3); }
    if (auto.s >= auto.tool.total) { auto = null; player.v = 0; }
  } else {
    let f = 0;
    if (keys.has('f')) f += 1;
    if (keys.has('b')) f -= 1;
    if (keys.has('l')) turn += 1;
    if (keys.has('r')) turn -= 1;
    f += -joy.y; turn += -joy.x * 1.2;
    f = Math.max(-1, Math.min(1, f));
    // 달리기: Shift, 또는 앞으로 키를 0.6초 넘게 꾹 누름 (조이스틱은 끝까지 밀고 0.6초)
    const run = keys.has('run') || (keys.has('f') && now - fwdSince > 600) || (joyFullSince && now - joyFullSince > 600 && joy.y < -0.7);
    const target = f > 0 ? (run ? VEH[veh].run : VEH[veh].kmh) / 3.6 * f : f < 0 ? ms(veh) * 0.5 * f : 0;
    const dv = target - player.v, acc = VEH[veh].acc * (target === 0 ? 2 : 1);
    player.v += Math.sign(dv) * Math.min(Math.abs(dv), acc * dt);
    player.running = run && f > 0 && player.v > ms(veh) * 1.04;
    player.yaw += turn * dt * (veh === 'walk' ? 1.9 : 1.4);
    if (Math.abs(player.v) > 0.02) {
      const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw), step = player.v * mul * dt, n = Math.ceil(Math.abs(step) / 0.5); // 빠를 때 벽을 뚫지 않도록 잘게 나눠 이동
      let movedAll = 0;
      for (let i = 0; i < n; i++) movedAll += tryMove(fx * step / n, fz * step / n, Math.abs(player.v));
      if (!movedAll) player.v *= 0.5; // 벽에 막히면 속도를 줄임
    }
  }
  player.turn = turn;
  const fogFar = overview ? 4000 : 420, fogNear = overview ? 1500 : 80;
  if (scene.fog.far !== fogFar) { scene.fog.far = fogFar; scene.fog.near = fogNear; }
  if (!$('keycaps').hidden && (player.dist > 1 || auto)) $('keycaps').hidden = true;
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw), k = 1 - Math.exp(-dt * 6);
  if (overview) { // 한눈에 보기: 정해 둔 높은 시점에 멈춰 있음. 내 위치는 노란 화살표
    me.position.set(player.x, 0, player.z); me.rotation.y = player.yaw;
    camera.position.copy(overview.pos); camera.lookAt(overview.look); placeSun(overview.look, 400);
  } else {
    const fov = 60 + 5 * Math.min(1, Math.abs(player.v) / (25 / 3.6)); // 빠를수록 시야를 조금 넓힘
    if (Math.abs(camera.fov - fov) > 0.1) { camera.fov += (fov - camera.fov) * k; camera.updateProjectionMatrix(); }
    const eye = VEH[veh].eye + (!reduceMotion && Math.abs(player.v) > 0.1 && veh === 'walk' ? Math.sin(player.dist * 4) * 0.03 : 0);
    camera.position.set(player.x, eye, player.z);
    look.set(player.x + fx * Math.cos(player.pitch), eye + Math.sin(player.pitch), player.z + fz * Math.cos(player.pitch)); camera.lookAt(look);
    roll += ((reduceMotion ? 0 : turn * Math.min(1, Math.abs(player.v) / 3) * 0.05) - roll) * k; // 돌 때 살짝 기울기
    camera.rotateZ(roll);
    placeSun(camera.position, 90);
  }
  updateViewModel(dt, turn);
  if (rings && ringAt && Math.hypot(player.x - ringAt[0], player.z - ringAt[1]) > 30) drawRings();
  placeDashes(dt);
  updateHud();
  // 경로를 따라가는 중: 남은 거리·시간, 목적지가 화면 밖이면 가장자리 화살표
  const arrow = $('edgeArrow');
  if (route) {
    const rem = routeRemain();
    $('hRoute').hidden = false;
    $('hRoute').textContent = rem < 8 ? '🏁 도착했어요' : `🏁 남은 ${Math.round(rem)}m · ${VEH[veh].icon} ${fmtMin(rem / ms(veh))}`;
    v3.set(route.dest[0], 2, route.dest[1]).project(camera);
    const off = v3.z > 1 || Math.abs(v3.x) > 0.95 || Math.abs(v3.y) > 0.95;
    arrow.hidden = !off;
    if (off) {
      let x = v3.x, y = v3.y; if (v3.z > 1) { x = -x; y = -y; }
      const m = Math.max(Math.abs(x), Math.abs(y)) || 1; x /= m; y /= m;
      const px = (x * 0.9 + 1) / 2 * innerWidth, py = (1 - y * 0.85) / 2 * innerHeight;
      arrow.style.transform = `translate3d(${px - 17}px, ${py - 17}px, 0) rotate(${Math.atan2(-y, x)}rad)`;
    }
  } else { $('hRoute').hidden = true; arrow.hidden = true; }
}
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.25, (now - lastT) / 1000); lastT = now;
  if (appMode === 'explore') stepExplore(dt, now);
  else {
    if (fly) {
      const k = Math.min(1, (now - fly.start) / fly.dur), e = ease(k);
      camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.t0, fly.t1, e);
      if (k >= 1) fly = null;
    }
    controls.update();
  }
  if (wires) wires.visible = camera.position.y < 70; // 위에서 볼 때는 전깃줄이 경로선처럼 보여서 숨김
  if (needShadow || camera.position.distanceTo(shadowAt) > 5) { renderer.shadowMap.needsUpdate = true; shadowAt.copy(camera.position); needShadow = false; }
  fpsN++; fpsT += dt;
  if (fpsT > 2 && !document.hidden) { // 느리면 1) 해상도를 1배로 2) 그래도 느리면 그림자를 끄고 간판 범위를 줄임
    const fps = fpsN / fpsT;
    if (fps < 45 && renderer.getPixelRatio() > 1) renderer.setPixelRatio(1);
    else if (fps < 40 && renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; sun.castShadow = false; scene.traverse(o => { if (o.material) [].concat(o.material).forEach(mm => { mm.needsUpdate = true; }); }); signRange = 0.6; }
    fpsN = 0; fpsT = 0;
  }
  refreshLabels(false);
  refreshSigns(false);
  placeLabels();
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------- 스크린샷용 장면 (?shot=이름) : tools/shots.sh 가 헤드리스 크롬으로 찍음 ----------
if (SHOT) {
  $('intro').hidden = true;
  const cam = (p, t) => { fly = null; camera.position.set(...p); controls.target.set(...t); controls.update(); };
  const fogFar = () => { scene.fog.near = 900; scene.fog.far = 3200; };
  const qs = new URLSearchParams(location.search);
  const snapOf = y => Math.max(0, SNAP.findIndex(d => d.startsWith(String(y))));
  const walkTo = (s0, s1) => { const p = walkAt(s0), q = walkAt(s1); player.x = p.x; player.z = p.z; player.yaw = Math.atan2(q.x - p.x, q.z - p.z); player.dist = s0; player.time = s0 / ms(veh); $('keycaps').hidden = true; };
  const SH = {
    start: () => { setColorMode('cat'); update(); },
    bird: () => { setColorMode('cat'); update(); cam([-280, 560, 640], [-470, 0, 40]); fogFar(); placeSun(controls.target, 600); },
    eeun: () => { setColorMode('cat'); update(); cam([-60, 150, 260], [-150, 0, 110]); fogFar(); placeSun(controls.target, 260); },
    gungdong: () => { setColorMode('cat'); update(); cam([-640, 170, 380], [-800, 0, 160]); fogFar(); placeSun(controls.target, 260); },
    past: () => { snapIdx = snapOf(qs.get('year') || 2016); slider.value = snapIdx; setColorMode(qs.get('color') || 'change'); update(); cam([-640, 170, 380], [-800, 0, 160]); fogFar(); placeSun(controls.target, 260); },
    place: () => { SH.gungdong(); const b = bld.filter(x => x.shops.length >= 4 && x.c[0] < -700).sort((a, c) => c.shops.length - a.shops.length)[0]; if (b) showPlace(b); },
    signs: () => { setMode('explore'); walkTo(112, 124); player.pitch = 0.1; $('exploreFold').click(); $('hint').classList.add('dim'); },
    block: () => { const cx = +qs.get('cx'), cz = +qs.get('cz'), d = +qs.get('d') || 220; setColorMode('cat'); update(); cam([cx, d, cz + d * 0.05], [cx, 0, cz]); fogFar(); placeSun(controls.target, d * 1.5); $('stats').classList.add('folded'); },
    hanbit: () => { setColorMode('cat'); update(); cam([-240, 70, 190], [-330, 0, 110]); fogFar(); placeSun(controls.target, 200); },
    intro: () => { $('intro').hidden = false; SH.bird(); setColorMode('change'); update(); },
    'explore-start': () => { setMode('explore'); $('keycaps').hidden = false; },
    'explore-walk': () => { setMode('explore'); walkTo(260, 272); },
    'explore-first': () => { setMode('explore'); setVeh('bike'); walkTo(300, 312); player.v = 15 / 3.6; player.hold = true; },
    'explore-route': () => { setMode('explore'); walkTo(20, 30); routeTo(osm.walk[osm.walk.length - 1], '🛍 궁동 로데오거리'); setOverview(true); },
    'explore-rings': () => { setMode('explore'); walkTo(0, 10); $('btnRings').click(); setOverview(true); },
    'explore-kick': () => { setMode('explore'); setVeh('kick'); walkTo(120, 130); player.v = 25 / 3.6; player.running = true; player.hold = true; },
  };
  (SH[SHOT] || SH.start)();
}

// 스크린샷·점검용
window.__map = { goStart, goBird, setMode, setVeh, routeTo, drawRings, player, SNAP, bld, shops, unplaced, gsB, pinList, landmarks,
  setSnap: i => { snapIdx = i; slider.value = i; update(); }, setArea: a => document.querySelector(`#areaSeg button[data-area="${a}"]`).click(),
  showPlace, camera, controls, toggleRings: () => $('btnRings').click(), graphSize: GN, blocked, solids, blockedArea,
  // 창이 숨겨져 requestAnimationFrame이 멈출 때 점검용으로 프레임을 직접 진행
  tick: (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) { if (appMode === 'explore') stepExplore(dt, performance.now()); else { if (fly) { fly.start -= dt * 1000; } controls.update(); } } refreshLabels(true); refreshSigns(true); placeLabels(); renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); },
  keys, facadeFor, entranceOf, namedSegs, roadGap, rayRoad, rayHits };
})();
