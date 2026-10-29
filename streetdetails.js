// 거리 디테일(횡단보도·보행 신호등·정지선·중앙선·차선·과속방지턱·연석·붉은 포장)을 그린다.
// 데이터: data/street_details.json (tools/build-street.py가 만든 로컬 좌표, x=동 z=남, m)
// 사용: const sd = await StreetDetails.build(THREE, scene, { url: 'data/street_details.json', y: 0.09 }); sd.dispose();
(function () {
  const COL = { white: '#f4f4f0', yellow: '#f2c94c', red: '#b05a4f', curb: '#d9d5cc', pole: '#5b5f66', head: '#2b2d31', walk: '#4cd07d', stop: '#e2574c' };

  // 정점 버퍼에 사각형(바닥 평면)을 쌓는 도우미
  class Flat {
    constructor() { this.p = []; }
    quad(a, b, c, d, y) { // 네 꼭짓점 [x,z] (둘레 순서)
      const P = this.p;
      P.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1], a[0], y, a[1], c[0], y, c[1], d[0], y, d[1]);
    }
    rect(c, u, v, hu, hv, y) { // 중심 c, 축 u(반길이 hu), v(반폭 hv)
      const p = (su, sv) => [c[0] + u[0] * hu * su + v[0] * hv * sv, c[1] + u[1] * hu * su + v[1] * hv * sv];
      this.quad(p(-1, -1), p(1, -1), p(1, 1), p(-1, 1), y);
    }
    line(pts, hw, y) { // 폴리라인을 폭 2*hw 띠로
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
        if (l < 1e-6) continue;
        const nx = -dz / l * hw, nz = dx / l * hw;
        this.quad([a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz], y);
      }
    }
    dashed(pts, hw, y, on, off) { // 점선: 누적 길이로 on/off
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
        if (l < 1e-6) continue;
        for (let s = 0; s < l;) {
          const ph = (acc + s) % (on + off), left = ph < on ? on - ph : on + off - ph, e = Math.min(l, s + left);
          if (ph < on) this.line([[a[0] + dx / l * s, a[1] + dz / l * s], [a[0] + dx / l * e, a[1] + dz / l * e]], hw, y);
          s = e + 1e-4;
        }
        acc += l;
      }
    }
    geometry() {
      const g = new THREE_.BufferGeometry();
      g.setAttribute('position', new THREE_.Float32BufferAttribute(this.p, 3));
      const n = new Float32Array(this.p.length); for (let i = 1; i < n.length; i += 3) n[i] = 1; // 모두 위를 향함
      g.setAttribute('normal', new THREE_.BufferAttribute(n, 3));
      return g;
    }
  }
  let THREE_ = null;

  // 상자들을 정점 색으로 합쳐 한 메시로 (신호등)
  function mergeColored(parts) {
    const pos = [], nor = [], col = [];
    for (const { geo, color, matrix } of parts) {
      const g = geo.clone().toNonIndexed(); g.applyMatrix4(matrix);
      const c = new THREE_.Color(color), P = g.attributes.position.array, N = g.attributes.normal.array;
      for (let i = 0; i < P.length; i++) { pos.push(P[i]); nor.push(N[i]); }
      for (let i = 0; i < P.length / 3; i++) col.push(c.r, c.g, c.b);
      g.dispose();
    }
    const g = new THREE_.BufferGeometry();
    g.setAttribute('position', new THREE_.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE_.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE_.Float32BufferAttribute(col, 3));
    return g;
  }

  function mat(color, order) {
    const m = new THREE_.MeshLambertMaterial({ color: new THREE_.Color(color), side: THREE_.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 - order, polygonOffsetUnits: -2 - order * 2 });
    return m;
  }

  async function build(THREE, scene, opts = {}) {
    THREE_ = THREE;
    const url = opts.url || 'data/street_details.json', Y = opts.y == null ? 0.09 : opts.y;
    const d = await (await fetch(url)).json();
    const group = new THREE.Group(); group.name = 'streetDetails';
    const white = new Flat(), yellow = new Flat(), red = new Flat(), curb = new Flat();

    // 붉은 포장 (가장 아래)
    for (const a of d.redAreas || []) {
      for (let i = 1; i < a.left.length; i++) red.quad(a.left[i - 1], a.left[i], a.right[i], a.right[i - 1], Y);
    }
    // 연석선
    if (opts.curbs !== false) for (const c of d.curbs || []) curb.line(c, 0.11, Y + 0.002);
    // 횡단보도: 도로 방향(tan)과 나란한 굵은 줄을 도로를 가로질러 0.5m 간격으로
    const SW = 0.45, GAP = 0.5;
    for (const x of d.crosswalks || []) {
      const ax = x.axis, tn = [-ax[1], ax[0]], n = Math.max(2, Math.floor(x.len / (SW + GAP)));
      const start = -((n - 1) * (SW + GAP)) / 2;
      for (let k = 0; k < n; k++) {
        const o = start + k * (SW + GAP);
        white.rect([x.c[0] + ax[0] * o, x.c[1] + ax[1] * o], tn, ax, x.band / 2, SW / 2, Y + 0.006);
      }
    }
    // 정지선
    for (const s of d.stopLines || []) white.line([s.a, s.b], 0.2, Y + 0.006);
    // 중앙선(노란 겹선)·차선(흰 점선)
    for (const c of d.centerLines || []) { yellow.line(offset(c, 0.16), 0.07, Y + 0.004); yellow.line(offset(c, -0.16), 0.07, Y + 0.004); }
    for (const l of d.laneLines || []) white.dashed(l, 0.075, Y + 0.004, 3, 5);
    // 과속방지턱: 노란 바탕에 흰 빗금
    for (const h of d.humps || []) {
      const t = h.tan, n = [-t[1], t[0]], half = h.W / 2;
      yellow.rect(h.c, n, t, half, h.depth / 2, Y + 0.005);
      for (let o = -half + 0.6; o < half - 0.3; o += 1.2) { // 흰 평행사변형
        const p = (s, a) => [h.c[0] + n[0] * (o + s) + t[0] * a, h.c[1] + n[1] * (o + s) + t[1] * a];
        white.quad(p(-0.25 - 0.5, -h.depth / 2), p(0.25 - 0.5, -h.depth / 2), p(0.25 + 0.5, h.depth / 2), p(-0.25 + 0.5, h.depth / 2), Y + 0.007);
      }
    }

    const add = (flat, color, order) => { if (!flat.p.length) return; const m = new THREE.Mesh(flat.geometry(), mat(color, order)); m.receiveShadow = true; m.renderOrder = order; group.add(m); };
    add(red, COL.red, 0); add(curb, COL.curb, 1); add(yellow, COL.yellow, 2); add(white, COL.white, 3);

    // 보행 신호등 (기둥 + 신호 상자, 한 메시)
    if ((d.signals || []).length) {
      const pole = new THREE.CylinderGeometry(0.06, 0.07, 2.9, 6), box = new THREE.BoxGeometry(0.34, 0.62, 0.22), lamp = new THREE.BoxGeometry(0.24, 0.22, 0.02);
      const parts = [];
      for (const s of d.signals) {
        const yaw = Math.atan2(s.face[0], s.face[1]);
        const base = new THREE.Matrix4().makeRotationY(yaw).setPosition(s.p[0], Y, s.p[1]);
        const at = (geo, color, x, y, z) => parts.push({ geo, color, matrix: base.clone().multiply(new THREE.Matrix4().makeTranslation(x, y, z)) });
        at(pole, COL.pole, 0, 1.45, 0);
        at(box, COL.head, 0, 2.6, 0.14);
        at(lamp, COL.stop, 0, 2.74, 0.26);
        at(lamp, COL.walk, 0, 2.47, 0.26);
      }
      const m = new THREE.Mesh(mergeColored(parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
      m.castShadow = true; group.add(m);
      pole.dispose(); box.dispose(); lamp.dispose();
    }

    scene.add(group);
    return {
      group, data: d,
      dispose() { scene.remove(group); group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); },
    };
  }

  function offset(pts, o) {
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      return [p[0] - dz / l * o, p[1] + dx / l * o];
    });
  }

  window.StreetDetails = { build };
})();
