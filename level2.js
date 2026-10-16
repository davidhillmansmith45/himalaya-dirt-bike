// LEVEL 2 — The Great Wall (Jinshanling ridge, real SRTM DEM). Self-contained scene: Apache fly-in, landing,
// walk to the parked bikes, race on top of the wall with gap jumps, towers, checkpoints, AI racers.
import { buildApacheKit } from './apache.js?v=1';
import { makeRider, makeGearMaterial } from './rider.js?v=m5';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createZombies } from './zombies.js?v=1';

export function createLevel2(C) {
  const { THREE, renderer, camera, keys, IS_MOBILE, toast, mergeGeometries } = C;
  const V3 = THREE.Vector3, clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const W = 8, HW = W / 2, PAR = 0.6, LATMAX = HW - 0.6, GRAV = 24;
  const scene = new THREE.Scene();
  let active = false, phase = 'off', clock = 0, built = false, D = null, TG = null, raceT = 0, results = null;
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------ data
  async function loadData() {
    const D = await (await fetch('./assets/l2/wall.json?v=1')).json();
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = './assets/l2/height.png?v=1'; });
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, img.width, img.height).data;
    const n = img.width, h = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) h[i] = D.terrain.hmin + (px[i * 4] * 256 + px[i * 4 + 1]) * D.terrain.scale;
    TG = { n, h, size: D.terrain.size, half: D.terrain.size / 2, cell: D.terrain.size / n };
    D.n = D.x.length;
    return D;
  }
  function TH(x, z) {
    const { n, h, half, cell } = TG;
    const fx = clamp((x + half) / cell, 0, n - 1.001), fz = clamp((z + half) / cell, 0, n - 1.001);
    const ix = fx | 0, iz = fz | 0, ax = fx - ix, az = fz - iz;
    const a = h[iz * n + ix], b = h[iz * n + ix + 1], c = h[(iz + 1) * n + ix], d = h[(iz + 1) * n + ix + 1];
    return (a * (1 - ax) + b * ax) * (1 - az) + (c * (1 - ax) + d * ax) * az;
  }
  // track frame at arc length s: centre, tangent t=(tx,tz), right r=(-tz,tx), deck y
  const _f = { x: 0, z: 0, y: 0, tx: 0, tz: 1, rx: 0, rz: 0, g: 0 };
  function frame(s, o = _f) {
    const f = clamp(s / D.ds, 0, D.n - 1.001), i = f | 0, a = f - i;
    o.x = D.x[i] + (D.x[i + 1] - D.x[i]) * a; o.z = D.z[i] + (D.z[i + 1] - D.z[i]) * a; o.y = D.y[i] + (D.y[i + 1] - D.y[i]) * a;
    const i0 = Math.max(0, i - 1), i1 = Math.min(D.n - 1, i + 2);
    let tx = D.x[i1] - D.x[i0], tz = D.z[i1] - D.z[i0]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    o.tx = tx; o.tz = tz; o.rx = -tz; o.rz = tx; o.g = (D.y[i1] - D.y[i0]) / ((i1 - i0) * D.ds);
    return o;
  }
  const inGap = (s) => { for (const g of D.gaps) if (s > g[0] && s < g[1]) return true; return false; };
  function rampH(s) { for (const r of D.ramps) if (s >= r[0] && s <= r[1]) { const u = (s - r[0]) / (r[1] - r[0]); return r[2] * u; } return 0; }
  // walkable surface (null over a broken section)
  function surf(s) { if (inGap(s)) return null; return frame(s, _sf).y + rampH(s); }
  const _sf = { ..._f };
  function project(x, z, hint) {
    let best = 1e9, bi = 0; const i0 = Math.max(0, Math.round(hint / D.ds) - 14), i1 = Math.min(D.n - 2, Math.round(hint / D.ds) + 14);
    for (let i = i0; i <= i1; i++) { const d = (D.x[i] - x) ** 2 + (D.z[i] - z) ** 2; if (d < best) { best = d; bi = i; } }
    let s = bi * D.ds;
    for (let k = 0; k < 2; k++) { const f = frame(s); s += (x - f.x) * f.tx + (z - f.z) * f.tz; }
    s = clamp(s, 0, D.len - 0.1); const f = frame(s);
    return { s, lat: (x - f.x) * f.rx + (z - f.z) * f.rz };
  }
  const yawOf = (f) => Math.atan2(f.tx, -f.tz);   // main game convention: forward = (sin yaw, 0, -cos yaw)

  // ------------------------------------------------------------------ materials (Poly Haven CC0)
  const TL = new THREE.TextureLoader();
  const aniso = Math.min(IS_MOBILE ? 4 : 8, renderer.capabilities.getMaxAnisotropy());
  function tx(name, srgb, rep) { const t = TL.load('./assets/l2/' + name + '.jpg'); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; if (rep) t.repeat.set(rep, rep); return t; }
  let M = null;
  function weather(mat, opt = {}) {
    // grime streaks, moss on up-facing / low surfaces, per-block tone variation (world-space, no extra uvs)
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.tNoise = { value: NOISE };
      sh.vertexShader = 'varying vec3 vWp; varying vec3 vWn;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed,1.0)).xyz; vWn = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = 'uniform sampler2D tNoise; varying vec3 vWp; varying vec3 vWn;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec2 hp = abs(vWn.x) > abs(vWn.z) ? vWp.zy : vWp.xy;
          if (abs(vWn.y) > 0.6) hp = vWp.xz;
          float n1 = texture2D(tNoise, hp * 0.031).r, n2 = texture2D(tNoise, hp * 0.17 + 0.37).g, n3 = texture2D(tNoise, vec2(hp.x * 0.35, vWp.y * 0.018)).b;
          float streak = smoothstep(0.45, 0.85, n3) * (1.0 - abs(vWn.y));
          diffuseColor.rgb *= mix(0.85, 1.15, n1) * (1.0 - 0.22 * streak) * ${(opt.gain ?? 1).toFixed(3)};
          float moss = smoothstep(0.55, 0.8, n1 * 0.7 + n2 * 0.5) * (${(opt.moss ?? 0.6).toFixed(3)} * max(vWn.y, 0.0) + ${(opt.mossV ?? 0.25).toFixed(3)} * (1.0 - abs(vWn.y)) * smoothstep(0.62, 0.9, n2));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.19, 0.08) * (0.7 + 0.6 * n2), clamp(moss, 0.0, 0.85));
        }`);
    };
    mat.customProgramCacheKey = () => 'l2w' + (opt.moss ?? 0.6) + (opt.mossV ?? 0.25) + (opt.gain ?? 1);
    return mat;
  }
  let NOISE = null;
  function noiseTex() {
    const n = 256, cv = document.createElement('canvas'); cv.width = cv.height = n; const g = cv.getContext('2d'), id = g.createImageData(n, n);
    const oct = (k) => { const a = new Float32Array(n * n); for (let o = 0, amp = 1, f = 4; o < 5; o++, amp *= 0.5, f *= 2) { const gr = []; for (let i = 0; i < f * f; i++) gr.push(Math.random());
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const fx = x / n * f, fy = y / n * f, ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy, sx = ax * ax * (3 - 2 * ax), sy = ay * ay * (3 - 2 * ay);
        const G = (i, j) => gr[((j % f) * f) + (i % f)]; a[y * n + x] += amp * ((G(ix, iy) * (1 - sx) + G(ix + 1, iy) * sx) * (1 - sy) + (G(ix, iy + 1) * (1 - sx) + G(ix + 1, iy + 1) * sx) * sy); } } return a; };
    const A = oct(), B = oct(), Cc = oct();
    for (let i = 0; i < n * n; i++) { id.data[i * 4] = A[i] / 1.94 * 255; id.data[i * 4 + 1] = B[i] / 1.94 * 255; id.data[i * 4 + 2] = Cc[i] / 1.94 * 255; id.data[i * 4 + 3] = 255; }
    g.putImageData(id, 0, 0); const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  function mats() {
    if (M) return M;
    NOISE = noiseTex();
    const arm = tx('mossy_brick_arm'), farm = tx('monastery_stone_floor_arm');
    const brick = weather(new THREE.MeshStandardMaterial({ map: tx('mossy_brick_Diffuse', true), normalMap: tx('mossy_brick_nor_gl'), roughnessMap: arm, aoMap: arm, aoMapIntensity: 0.7, roughness: 1, color: 0xffffff }), { moss: 0.5, mossV: 0.18, gain: 1.45 });
    brick.normalScale.set(1.4, 1.4);
    const floor = weather(new THREE.MeshStandardMaterial({ map: tx('monastery_stone_floor_Diffuse', true), normalMap: tx('monastery_stone_floor_nor_gl'), roughnessMap: farm, aoMap: farm, roughness: 1, color: 0xc4beb2 }), { moss: 0.35, mossV: 0 });
    floor.normalScale.set(1.3, 1.3);
    const cap = weather(new THREE.MeshStandardMaterial({ map: tx('monastery_stone_floor_Diffuse', true), normalMap: tx('monastery_stone_floor_nor_gl'), roughness: 0.95, color: 0x8c8880 }), { moss: 0.12, mossV: 0.05, gain: 1.05 });
    // timber kicker ramps: procedural planks
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256; const g = cv.getContext('2d');
    for (let i = 0; i < 8; i++) { const v = 80 + Math.random() * 35; g.fillStyle = `rgb(${v + 28},${v + 4},${v * 0.6})`; g.fillRect(0, i * 32, 256, 30); g.fillStyle = 'rgba(25,15,6,.9)'; g.fillRect(0, i * 32 + 30, 256, 2);
      for (let k = 0; k < 60; k++) { g.fillStyle = `rgba(40,25,10,${Math.random() * 0.3})`; g.fillRect(Math.random() * 256, i * 32 + Math.random() * 30, 30 + Math.random() * 90, 1); } }
    const wt = new THREE.CanvasTexture(cv); wt.wrapS = wt.wrapT = THREE.RepeatWrapping; wt.colorSpace = THREE.SRGBColorSpace;
    const wood = weather(new THREE.MeshStandardMaterial({ map: wt, roughness: 0.85 }), { moss: 0.15, mossV: 0 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0c0b09, roughness: 1 });
    const tile = new THREE.MeshStandardMaterial({ color: 0x3a3e42, roughness: 0.65, metalness: 0.05 });
    const red = new THREE.MeshStandardMaterial({ color: 0x8a1c12, roughness: 0.55 });
    const bark = new THREE.MeshStandardMaterial({ map: tx('pine_bark_Diffuse', true), normalMap: tx('pine_bark_nor_gl'), roughness: 1 });
    M = { brick, floor, cap, wood, dark, tile, red, bark };
    return M;
  }

  // ------------------------------------------------------------------ geometry builder
  function GB() { const p = [], u = [], idx = []; return {
    p, u, idx,
    quad(a, b, c, d, ua, ub, uc, ud) { const k = p.length / 3; p.push(...a, ...b, ...c, ...d); u.push(...ua, ...ub, ...uc, ...ud); idx.push(k, k + 1, k + 2, k, k + 2, k + 3); },
    geo() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2)); g.setIndex(idx); g.computeVertexNormals(); return g; }
  }; }
  const towerAt = (s) => D.towers.some(t => Math.abs(s - t) < 6.5);
  const gateAt = (s) => s > 18 && s < 30;   // opening in the right parapet to the landing terrace

  function buildWall() {
    const m = mats();
    const top = GB(), side = GB();
    const f0 = { ..._f }, f1 = { ..._f };
    const P = (f, lat, y) => [f.x + f.rx * lat, y, f.z + f.rz * lat];
    const DS = D.ds;
    for (let i = 0; i < D.n - 1; i++) {
      const s0 = i * DS, s1 = s0 + DS;
      if (inGap(s0 + DS * 0.5)) continue;
      frame(s0, f0); frame(s1, f1);
      const y0 = f0.y, y1 = f1.y;
      // walkway
      top.quad(P(f0, -HW, y0), P(f0, HW, y0), P(f1, HW, y1), P(f1, -HW, y1), [-HW / 2, s0 / 2], [HW / 2, s0 / 2], [HW / 2, s1 / 2], [-HW / 2, s1 / 2]);
      for (const sd of [-1, 1]) {
        const ph = 1.05;
        const open = sd > 0 && gateAt(s0);
        const g0 = TH(...[f0.x + f0.rx * sd * (HW + PAR), f0.z + f0.rz * sd * (HW + PAR)]) - 3, g1 = TH(f1.x + f1.rx * sd * (HW + PAR), f1.z + f1.rz * sd * (HW + PAR)) - 3;
        const a = sd * HW, b = sd * (HW + PAR), bat0 = sd * (HW + PAR + Math.max(0, y0 - g0) * 0.07), bat1 = sd * (HW + PAR + Math.max(0, y1 - g1) * 0.07);
        const pt = open ? 0 : ph;
        const q = sd > 0 ? (A, B, Cc, Dd, ua, ub, uc, ud) => side.quad(A, B, Cc, Dd, ua, ub, uc, ud) : (A, B, Cc, Dd, ua, ub, uc, ud) => side.quad(B, A, Dd, Cc, ub, ua, ud, uc);
        if (!open) {
          // inner parapet face, parapet top
          q(P(f0, a, y0 + pt), P(f0, a, y0), P(f1, a, y1), P(f1, a, y1 + pt), [s0 / 1.6, (y0 + pt) / 1.6], [s0 / 1.6, y0 / 1.6], [s1 / 1.6, y1 / 1.6], [s1 / 1.6, (y1 + pt) / 1.6]);
          q(P(f0, b, y0 + pt), P(f0, a, y0 + pt), P(f1, a, y1 + pt), P(f1, b, y1 + pt), [s0 / 1.6, 0], [s0 / 1.6, 0.35], [s1 / 1.6, 0.35], [s1 / 1.6, 0]);
        }
        // outer face down to the ground (battered)
        q(P(f0, bat0, g0), P(f0, b, y0 + pt), P(f1, b, y1 + pt), P(f1, bat1, g1), [s0 / 1.6, g0 / 1.6], [s0 / 1.6, (y0 + pt) / 1.6], [s1 / 1.6, (y1 + pt) / 1.6], [s1 / 1.6, g1 / 1.6]);
        if (open) q(P(f0, b, y0), P(f0, a, y0), P(f1, a, y1), P(f1, b, y1), [0, 0], [0, 0.4], [1, 0.4], [1, 0]);
      }
    }
    // broken ends at each gap: section faces + rubble
    const rub = [];
    for (const g of D.gaps) for (const [s, dir] of [[g[0], 1], [g[1], -1]]) {
      const f = frame(s, { ..._f });
      const gy = Math.min(TH(f.x, f.z), f.y - 4) - 3;
      for (let k = 0; k < 6; k++) {
        const l0 = -HW - PAR + k * (W + 2 * PAR) / 6, l1 = l0 + (W + 2 * PAR) / 6;
        const jag = 0.4 + Math.random() * 1.2, yt = f.y - (k % 2 ? 0 : jag * 0.5);
        const A = P(f, l0, gy), B = P(f, l1, gy), Cc = P(f, l1, yt), Dd = P(f, l0, yt);
        if (dir > 0) side.quad(A, B, Cc, Dd, [l0 / 1.6, gy / 1.6], [l1 / 1.6, gy / 1.6], [l1 / 1.6, yt / 1.6], [l0 / 1.6, yt / 1.6]);
        else side.quad(B, A, Dd, Cc, [l1 / 1.6, gy / 1.6], [l0 / 1.6, gy / 1.6], [l0 / 1.6, yt / 1.6], [l1 / 1.6, yt / 1.6]);
      }
      for (let k = 0; k < 26; k++) { const ss = s + dir * Math.random() * 4 * -1 + (dir > 0 ? Math.random() * 6 : -Math.random() * 6); const ff = frame(ss, { ..._f }); const lat = (Math.random() - 0.5) * (W + 4);
        rub.push([ff.x + ff.rx * lat, TH(ff.x + ff.rx * lat, ff.z + ff.rz * lat) + 0.3, ff.z + ff.rz * lat, 0.5 + Math.random() * 1.3]); }
    }
    const wTop = new THREE.Mesh(top.geo(), m.floor), wSide = new THREE.Mesh(side.geo(), m.brick);
    wTop.receiveShadow = wSide.receiveShadow = true; wSide.castShadow = !IS_MOBILE;
    scene.add(wTop, wSide);
    // crenellations (merlons) on the outer (left) parapet, low merlons on the right
    const mer = [];
    for (let s = 2; s < D.len - 2; s += 1.9) {
      if (inGap(s) || inGap(s + 1) || inGap(s - 1) || towerAt(s)) continue;
      const f = frame(s, { ..._f }); const yaw = Math.atan2(f.tx, f.tz);
      mer.push([f.x - f.rx * (HW + PAR / 2), f.y + 1.05 + 0.48, f.z - f.rz * (HW + PAR / 2), yaw, 1]);
    }
    const mg = new THREE.BoxGeometry(PAR, 0.96, 1.05);
    const mi = new THREE.InstancedMesh(mg, m.brick, mer.length), mt = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new V3(1, 1, 1);
    mer.forEach((e, i) => { q.setFromAxisAngle(new V3(0, 1, 0), e[3]); mt.compose(new V3(e[0], e[1], e[2]), q, sc); mi.setMatrixAt(i, mt); });
    mi.castShadow = !IS_MOBILE; mi.receiveShadow = true; scene.add(mi);
    mi.castShadow = true;
    // stone coping on parapets & merlon caps, loopholes in the merlons, kerb stones along the walkway edges
    {
      const capG = new THREE.BoxGeometry(PAR + 0.16, 0.12, 1.02), cps = [], kb = [], lp = [];
      for (let s = 1; s < D.len - 1; s += 1.0) { if (inGap(s) || inGap(s + 0.6) || inGap(s - 0.6) || towerAt(s)) continue; const f = frame(s, { ..._f }), yaw = Math.atan2(f.tx, f.tz);
        for (const sd of [-1, 1]) { if (sd > 0 && gateAt(s)) continue; cps.push([f.x + f.rx * sd * (HW + PAR / 2), f.y + 1.11, f.z + f.rz * sd * (HW + PAR / 2), yaw, 1, f.g]);
          kb.push([f.x + f.rx * sd * (HW - 0.17), f.y + 0.06, f.z + f.rz * sd * (HW - 0.17), yaw, 1, f.g]); } }
      mer.forEach((e, i) => { cps.push([e[0], e[1] + 0.54, e[2], e[3], 1.15, 0]); if (i % 2 === 0) { const f = frame(0, { ..._f }); lp.push([e[0] + Math.cos(e[3]) * 0.31, e[1] - 0.05, e[2] - Math.sin(e[3]) * 0.31, e[3]]); } });
      const inst = (geo, mat, arr, cast) => { const im = new THREE.InstancedMesh(geo, mat, arr.length), e3 = new THREE.Euler(0, 0, 0, 'YXZ');
        arr.forEach((e, i) => { e3.set(-Math.atan(e[5] || 0), e[3], 0); q.setFromEuler(e3); mt.compose(new V3(e[0], e[1], e[2]), q, sc.set(1, 1, e[4] || 1)); im.setMatrixAt(i, mt); }); sc.set(1, 1, 1);
        im.castShadow = cast; im.receiveShadow = true; scene.add(im); return im; };
      inst(capG, m.cap, cps, !IS_MOBILE);
      inst(new THREE.BoxGeometry(0.34, 0.14, 1.0), m.cap, kb, false);
      inst(new THREE.BoxGeometry(0.06, 0.32, 0.18), m.dark, lp, false);
    }
    // stair treads on the steep pitches (visual steps, ridden as an incline)
    const st = [];
    for (let s = 3; s < D.len - 3; s += 0.75) { const f = frame(s, { ..._f }); if (Math.abs(f.g) > 0.15 && !inGap(s) && !towerAt(s) && !rampH(s)) st.push([f.x, f.y + 0.02, f.z, Math.atan2(f.tx, f.tz)]); }
    if (st.length) {
      const tg = new THREE.BoxGeometry(W - 0.1, 0.1, 0.16); tg.translate(0, 0, 0.3);
      const ti = new THREE.InstancedMesh(tg, m.dark, st.length);
      st.forEach((e, i) => { q.setFromAxisAngle(new V3(0, 1, 0), e[3]); mt.compose(new V3(e[0], e[1], e[2]), q, sc); ti.setMatrixAt(i, mt); });
      ti.material = new THREE.MeshStandardMaterial({ color: 0x77706a, roughness: 0.95 }); ti.receiveShadow = true; scene.add(ti);
    }
    // rubble
    const rg = new THREE.DodecahedronGeometry(1, 0);
    const ri = new THREE.InstancedMesh(rg, m.brick, rub.length);
    rub.forEach((e, i) => { q.setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3)); mt.compose(new V3(e[0], e[1], e[2]), q, sc.set(e[3], e[3] * 0.6, e[3] * 0.9)); ri.setMatrixAt(i, mt); });
    sc.set(1, 1, 1); ri.castShadow = !IS_MOBILE; scene.add(ri);
  }

  function buildTowers() {
    const m = mats();
    const parts = [], roofs = [], darks = [], caps = [], reds = [];
    const place = (g, f, yaw) => { g.rotateY(yaw); g.translate(f.x, 0, f.z); return g; };
    const scaleUV = (g, k = 1 / 1.6) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k); return g; };
    const box = (arr, w, h, l, x, y, z, f, yaw) => {
      const g = new THREE.BoxGeometry(w, h, l);
      const uv = g.attributes.uv, pos = g.attributes.position, nrm = g.attributes.normal;
      for (let k = 0; k < uv.count; k++) { const px = pos.getX(k) + x, py = pos.getY(k) + y, pz = pos.getZ(k) + z, nx = Math.abs(nrm.getX(k));
        uv.setXY(k, (nx > 0.5 ? pz : px) / 1.6, (Math.abs(nrm.getY(k)) > 0.5 ? pz : py) / 1.6); }
      g.translate(x, y, z); arr.push(place(g, f, yaw));
    };
    const arch = (sh, cx, y0, w, hSpring) => { const p = new THREE.Path(); const r = w / 2;
      p.moveTo(cx - r, y0); p.lineTo(cx + r, y0); p.lineTo(cx + r, y0 + hSpring); p.absarc(cx, y0 + hSpring, r, 0, Math.PI, false); p.lineTo(cx - r, y0); sh.holes.push(p); };
    for (const ts of D.towers) {
      const f = frame(ts, { ..._f }); const yaw = Math.atan2(f.tx, f.tz), y = f.y;
      const L = 11.5, side = 1.9, Wt = W + 2 * side, H2 = 10.2, T = 1.1;
      const gy = Math.min(TH(f.x + f.rx * Wt / 2, f.z + f.rz * Wt / 2), TH(f.x - f.rx * Wt / 2, f.z - f.rz * Wt / 2), y) - 4;
      // plinth under the walkway
      box(parts, Wt, y - 0.05 - gy, L, 0, (gy + y - 0.05) / 2, 0, f, yaw);
      // end walls (across the walkway) with the arched passage
      for (const e of [-1, 1]) {
        const sh = new THREE.Shape(); sh.moveTo(-Wt / 2, 0); sh.lineTo(Wt / 2, 0); sh.lineTo(Wt / 2, H2); sh.lineTo(-Wt / 2, H2); sh.lineTo(-Wt / 2, 0);
        arch(sh, 0, 0, W, 4.3);
        // small arrow windows above the passage
        for (const xx of [-3.6, 3.6]) arch(sh, xx * 1.15, 6.1, 0.8, 0.9);
        const g = scaleUV(new THREE.ExtrudeGeometry(sh, { depth: T, bevelEnabled: false, curveSegments: 10 }));
        g.translate(0, y, e > 0 ? L / 2 - T : -L / 2); parts.push(place(g, f, yaw));
      }
      // side walls with two arched windows each
      for (const sd of [-1, 1]) {
        const sh = new THREE.Shape(); sh.moveTo(-L / 2, 0); sh.lineTo(L / 2, 0); sh.lineTo(L / 2, H2); sh.lineTo(-L / 2, H2); sh.lineTo(-L / 2, 0);
        for (const zz of [-2.6, 2.6]) arch(sh, zz, 5.4, 1.3, 1.6);
        const g = scaleUV(new THREE.ExtrudeGeometry(sh, { depth: side, bevelEnabled: false, curveSegments: 8 }));
        g.rotateY(Math.PI / 2); g.translate(sd > 0 ? HW : -HW - side, y, 0); parts.push(place(g, f, yaw));
        // dark interior behind the windows
        box(darks, 0.1, 3.2, L - 2.4, sd * (HW + 0.06), y + 6.6, 0, f, yaw);
      }
      // barrel vault over the passage + floor of the upper room
      { const v = new THREE.CylinderGeometry(HW, HW, L - 2 * T + 0.02, 18, 1, true, Math.PI / 2, Math.PI); v.rotateX(Math.PI / 2); v.scale(-1, 1, 1); scaleUV(v, 3);
        v.translate(0, y + 4.3, 0); parts.push(place(v, f, yaw)); }
      box(parts, W, H2 - 8.3, L - 2 * T, 0, y + 8.3 + (H2 - 8.3) / 2, 0, f, yaw);
      // cornice, parapet with merlons and loopholes
      box(caps, Wt + 0.5, 0.32, L + 0.5, 0, y + H2 + 0.16, 0, f, yaw);
      const nm = 6;
      for (let k = 0; k < nm; k++) for (const sd of [-1, 1]) {
        const zz = -L / 2 + 0.8 + k * (L - 1.6) / (nm - 1), xx = -Wt / 2 + 0.8 + k * (Wt - 1.6) / (nm - 1);
        box(parts, 0.55, 1.15, 1.0, sd * (Wt / 2 - 0.05), y + H2 + 0.9, zz, f, yaw); box(caps, 0.7, 0.12, 1.12, sd * (Wt / 2 - 0.05), y + H2 + 1.52, zz, f, yaw);
        box(parts, 1.0, 1.15, 0.55, xx, y + H2 + 0.9, sd * (L / 2 - 0.05), f, yaw); box(caps, 1.12, 0.12, 0.7, xx, y + H2 + 1.52, sd * (L / 2 - 0.05), f, yaw);
      }
      box(parts, 0.55, 0.6, L, -(Wt / 2 - 0.05), y + H2 + 0.6, 0, f, yaw); box(parts, 0.55, 0.6, L, Wt / 2 - 0.05, y + H2 + 0.6, 0, f, yaw);
      box(parts, Wt, 0.6, 0.55, 0, y + H2 + 0.6, -(L / 2 - 0.05), f, yaw); box(parts, Wt, 0.6, 0.55, 0, y + H2 + 0.6, L / 2 - 0.05, f, yaw);
      // watch-room pavilion: red timber posts, grey hip roof with flared eaves (alternate towers)
      if (Math.round(ts / 10) % 2 === 0) {
        box(parts, 5.6, 2.7, 5.6, 0, y + H2 + 1.6, 0, f, yaw);
        for (const a of [-1, 1]) for (const b of [-1, 1]) box(reds, 0.3, 2.8, 0.3, a * 2.95, y + H2 + 1.65, b * 2.95, f, yaw);
        for (const sd of [-1, 1]) { box(darks, 0.08, 1.5, 1.1, sd * 2.82, y + H2 + 1.8, 0, f, yaw); box(darks, 1.1, 1.5, 0.08, 0, y + H2 + 1.8, sd * 2.82, f, yaw); }
        const r1 = new THREE.CylinderGeometry(0.4, 4.9, 2.3, 4, 1); r1.rotateY(Math.PI / 4); r1.translate(0, y + H2 + 4.1, 0); roofs.push(place(r1, f, yaw));
        const r2 = new THREE.CylinderGeometry(4.9, 5.4, 0.25, 4, 1); r2.rotateY(Math.PI / 4); r2.translate(0, y + H2 + 2.9, 0); roofs.push(place(r2, f, yaw));
        const r3 = new THREE.BoxGeometry(0.35, 0.35, 1.6); r3.translate(0, y + H2 + 5.3, 0); roofs.push(place(r3, f, yaw));
      }
    }
    const add = (arr, mat, cast) => { if (!arr.length) return; const g = mergeGeometries(arr.map(g => g.index ? g.toNonIndexed() : g)); g.computeVertexNormals(); const o = new THREE.Mesh(g, mat); o.castShadow = cast; o.receiveShadow = true; scene.add(o); };
    add(parts, m.brick, true); add(roofs, m.tile, true); add(darks, m.dark, false); add(caps, m.cap, !IS_MOBILE); add(reds, m.red, false);
  }


  // ------------------------------------------------------------------ nitro pads on the steep climbs
  const PADS = [];   // { s, mesh }
  const BOOST_T = 2.6;
  function findPads() {
    PADS.length = 0;
    const g = (x) => frame(x, { ..._f }).g, near = (x, arr, a, b) => arr.some(v => x > v - a && x < v + b);
    const twr = D.towers || [];
    let runStart = -1;
    const segs = [];
    for (let x = D.start + 30; x < D.finish - 40; x += 2) {
      const up = g(x) > 0.13;
      if (up && runStart < 0) runStart = x;
      if (!up && runStart >= 0) { if (x - runStart >= 34) segs.push([runStart, x]); runStart = -1; }
    }
    const ok = (x) => !inGap(x) && !near(x, twr, 16, 16) && !D.ramps.some(r => x > r[0] - 90 && x < r[1] + 25) && !D.gaps.some(q => x > q[0] - 90 && x < q[1] + 25) && Math.abs(x - D.finish) > 60;
    for (const [a, b] of segs) {
      const want = [a + 6]; if (b - a > 110) want.push(a + (b - a) * 0.55);
      for (let w of want) { let x = w; while (x < b - 8 && !ok(x)) x += 2; if (x < b - 8 && !PADS.some(P => Math.abs(P.s - x) < 45)) PADS.push({ s: x, climb: [a, b] }); }
    }
  }
  function padTex() {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256; const g = cv.getContext('2d');
    g.fillStyle = 'rgba(10,40,90,0.85)'; g.fillRect(0, 0, 128, 256);
    g.strokeStyle = '#7fe3ff'; g.lineWidth = 6; g.strokeRect(5, 5, 118, 246);
    for (let k = 0; k < 3; k++) { const y = 200 - k * 70; g.fillStyle = k === 1 ? '#bff4ff' : '#33bbff';
      g.beginPath(); g.moveTo(14, y); g.lineTo(64, y - 46); g.lineTo(114, y); g.lineTo(114, y + 22); g.lineTo(64, y - 24); g.lineTo(14, y + 22); g.closePath(); g.fill(); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  let padMat = null, padGlow = null;
  function buildNitro() {
    findPads();
    padMat = new THREE.MeshBasicMaterial({ map: padTex(), transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
    padGlow = new THREE.MeshBasicMaterial({ color: 0x46c8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const PLEN = 7, PW = Math.min(HW - 0.3, 2.6);
    for (const P of PADS) {
      const gb = GB(), n = 4, gl = GB();
      for (let k = 0; k < n; k++) {
        const s0 = P.s - PLEN / 2 + PLEN * k / n, s1 = P.s - PLEN / 2 + PLEN * (k + 1) / n;
        const f0 = frame(s0, { ..._f }), f1 = frame(s1, { ..._f });
        const Q = (f, l, dy) => [f.x + f.rx * l, f.y + 0.06 + dy, f.z + f.rz * l];
        gb.quad(Q(f0, -PW, 0), Q(f0, PW, 0), Q(f1, PW, 0), Q(f1, -PW, 0), [0, k / n], [1, k / n], [1, (k + 1) / n], [0, (k + 1) / n]);
        for (const sd of [-1, 1]) gl.quad(Q(f0, sd * PW, 0), Q(f0, sd * PW, 1.1), Q(f1, sd * PW, 1.1), Q(f1, sd * PW, 0), [0, 0], [0, 1], [1, 1], [1, 0]);
      }
      const m = new THREE.Mesh(gb.geo(), padMat); m.renderOrder = 2; scene.add(m);
      const gm = new THREE.Mesh(gl.geo(), padGlow); gm.renderOrder = 3; scene.add(gm);
      const f = frame(P.s, { ..._f }); const lt = new THREE.PointLight(0x55ccff, IS_MOBILE ? 0 : 6, 14, 2); lt.position.set(f.x, f.y + 1.2, f.z); if (!IS_MOBILE) scene.add(lt);
      P.mesh = m;
    }
    console.log('[l2] nitro pads', PADS.map(p => Math.round(p.s - D.start)));
  }
  // FX: blue exhaust flame, speed lines, whoosh
  function makeFlame() {
    const g = new THREE.Group();
    const m1 = new THREE.MeshBasicMaterial({ color: 0x4fb8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const m2 = new THREE.MeshBasicMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const c1 = new THREE.Mesh(new THREE.ConeGeometry(0.13, 1.1, 10, 1, true), m1); c1.rotation.z = Math.PI / 2; c1.position.x = -0.55;
    const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.55, 8, 1, true), m2); c2.rotation.z = Math.PI / 2; c2.position.x = -0.28;
    g.add(c1, c2); g.visible = false; g.userData.c = [c1, c2]; return g;
  }
  function attachFlame(root) {
    if (!root || root.userData.nitroFlame) return root && root.userData.nitroFlame;
    let anc = root.userData.exhaustAnchor; if (!anc) root.traverse(o => { if (!anc && o.userData && o.userData.exhaustAnchor) anc = o.userData.exhaustAnchor; });
    const fl = makeFlame(); (anc || root).add(fl); if (!anc) fl.position.set(0, 0.4, 1.0);
    root.userData.nitroFlame = fl; return fl;
  }
  function flameFx(fl, on, dt) {
    if (!fl) return; fl.visible = on; if (!on) return;
    const k = 1.5 + Math.random() * 0.7; fl.scale.set(k, 1.5 + Math.random() * 0.4, 1.5 + Math.random() * 0.4);
  }
  let lines = null;
  function speedLines(a) {
    if (!lines) { lines = document.createElement('div'); lines.id = 'l2Nitro';
      lines.style.cssText = 'position:fixed;inset:-20%;pointer-events:none;z-index:15;opacity:0;transition:opacity .25s;background:repeating-conic-gradient(from 0deg at 50% 50%,rgba(200,240,255,.0) 0deg 3.2deg,rgba(200,240,255,.55) 3.4deg 3.7deg,rgba(200,240,255,0) 3.9deg 7deg);-webkit-mask-image:radial-gradient(circle at 50% 50%,transparent 32%,#000 62%);mask-image:radial-gradient(circle at 50% 50%,transparent 32%,#000 62%)';
      document.body.appendChild(lines); }
    lines.style.opacity = a.toFixed(2); if (a > 0) lines.style.transform = 'rotate(' + (Math.random() * 6).toFixed(1) + 'deg) scale(' + (1 + Math.random() * 0.04).toFixed(3) + ')';
  }
  function whoosh(vol = 0.7) {
    const S = C.SFX; if (!S || S.muted) return; const ac = S.ctx, bus = S.bus; if (!ac || !bus) return;
    try {
      const t = ac.currentTime, len = 1.6, b = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource(); src.buffer = b;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4; bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(3200, t + 0.35); bp.frequency.exponentialRampToValueAtTime(700, t + len);
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(240, t + 0.5); const og = ac.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(vol * 0.25, t + 0.1); og.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      src.connect(bp).connect(g).connect(bus); o.connect(og).connect(bus); src.start(t); src.stop(t + len); o.start(t); o.stop(t + 1.2);
    } catch (e) {}
  }
  const NITRO = { pads: PADS, hits: 0, aiHits: 0 };
  // ---- zombies (zombies.js): racer views + grab / knock handling
  let ZM = null, ZV = null;
  function zViews() {
    if (ZV) return ZV;
    ZV = RACERS.map(R => R.player ? { player: true, R, grabbedBy: null, get s() { return PL.s; }, get lat() { return PL.lat; }, get speed() { return PL.speed; }, get boost() { return PL.boost || 0; }, get grounded() { return PL.grounded && !(PL.falling > 0); }, get y() { return PL.y; }, get finished() { return R.finished; } }
      : { player: false, R, grabbedBy: null, get s() { return R.s; }, get lat() { return R.lat; }, get speed() { return R.spd; }, get boost() { return R.boost || 0; }, get grounded() { return R.grounded; }, get y() { return R.y; }, get finished() { return R.finished; } });
    return ZV;
  }
  function zOnHit(V, kind) {
    if (kind === 'knock') { if (V.player) { C.state.shake = 0.3; PL.speed *= 0.93; toast(PL.boost > 0 ? 'NITRO SMASH!' : 'ZOMBIE SMASHED!', 900); } else V.R.spd *= 0.93; }
    else if (kind === 'grab') { if (V.player) { PL.zg = { t: 0, n: 0, last: 0 }; C.state.shake = 0.35; toast(IS_TOUCH ? 'ZOMBIE GRAB! Tap ← → fast to shake it off' : 'ZOMBIE GRAB! Mash A/D (← →) to shake it off', 1800); } else V.R.zgT = 0; }
  }
  const IS_TOUCH = matchMedia('(hover:none)').matches;

  function buildRamps() {
    const m = mats();
    for (const r of D.ramps) {
      const gb = GB();
      const n = 10;
      for (let k = 0; k < n; k++) {
        const s0 = r[0] + (r[1] - r[0]) * k / n, s1 = r[0] + (r[1] - r[0]) * (k + 1) / n;
        const f0 = frame(s0, { ..._f }), f1 = frame(s1, { ..._f });
        const h0 = f0.y + rampH(s0) + 0.03, h1 = f1.y + rampH(s1) + 0.03;
        const P = (f, l, y) => [f.x + f.rx * l, y, f.z + f.rz * l];
        gb.quad(P(f0, -HW + 0.05, h0), P(f0, HW - 0.05, h0), P(f1, HW - 0.05, h1), P(f1, -HW + 0.05, h1), [0, s0 / 2], [2, s0 / 2], [2, s1 / 2], [0, s1 / 2]);
        for (const sd of [-1, 1]) { const l = sd * (HW - 0.05);
          const A = P(f0, l, f0.y), B = P(f0, l, h0), Cc = P(f1, l, h1), Dd = P(f1, l, f1.y);
          if (sd > 0) gb.quad(A, B, Cc, Dd, [0, 0], [0, 0.3], [1, 0.3], [1, 0]); else gb.quad(B, A, Dd, Cc, [0, 0.3], [0, 0], [1, 0], [1, 0.3]); }
      }
      const fe = frame(r[1], { ..._f }), P = (l, y) => [fe.x + fe.rx * l, y, fe.z + fe.rz * l];
      gb.quad(P(HW - 0.05, fe.y), P(-HW + 0.05, fe.y), P(-HW + 0.05, fe.y + r[2] + 0.03), P(HW - 0.05, fe.y + r[2] + 0.03), [0, 0], [2, 0], [2, 0.5], [0, 0.5]);
      const o = new THREE.Mesh(gb.geo(), m.wood); o.castShadow = !IS_MOBILE; o.receiveShadow = true; scene.add(o);
      // warning chevrons on the parapets
      for (const sd of [-1, 1]) { const f = frame(r[0] - 6, { ..._f }); const sg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 1.4), new THREE.MeshBasicMaterial({ color: 0xffb020 }));
        sg.position.set(f.x + f.rx * sd * (HW - 0.05), f.y + 1.45, f.z + f.rz * sd * (HW - 0.05)); sg.rotation.y = Math.atan2(f.tx, f.tz); scene.add(sg); }
    }
  }

  function banner(s, text, col) {
    const f = frame(s, { ..._f }), yaw = Math.atan2(f.tx, f.tz);
    const g = new THREE.Group(); g.position.set(f.x, f.y, f.z); g.rotation.y = yaw;
    const pm = new THREE.MeshStandardMaterial({ color: 0x8a1a12, roughness: 0.6 });
    for (const sd of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 5.4, 10), pm); p.position.set(sd * (HW - 0.3), 2.7, 0); p.castShadow = true; g.add(p); }
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 128; const c = cv.getContext('2d');
    for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { c.fillStyle = (i + j) % 2 ? '#111' : '#eee'; c.fillRect(i * 32, j * 32, 32, 32); }
    c.fillStyle = col; c.fillRect(160, 14, 704, 100); c.fillStyle = '#fff'; c.font = 'bold 76px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 512, 66);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    const b = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.6, 1.1), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.8 }));
    b.position.y = 4.8; g.add(b);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.6), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 })); line.rotation.x = -Math.PI / 2; line.position.y = 0.03; g.add(line);
    scene.add(g);
  }

  function buildTerrain() {
    const n = IS_MOBILE ? 220 : 330, size = TG.size * 0.999, half = size / 2;
    const g = new THREE.PlaneGeometry(size, size, n - 1, n - 1); g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, cols = new Float32Array(pos.count * 4);
    const hash = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };
    const vn = (x, z) => { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
      return lerp(lerp(hash(ix, iz), hash(ix + 1, iz), sx), lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), sx), sz); };
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); pos.setY(i, TH(x, z)); }
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
      // baked horizon ambient occlusion (8 directions, 3 radii)
      let occ = 0;
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, cx = Math.cos(a), cz = Math.sin(a); let mx = 0;
        for (const r of [25, 70, 180]) mx = Math.max(mx, (TH(x + cx * r, z + cz * r) - y) / r); occ += clamp(mx, 0, 1); }
      const ao = clamp(1 - occ / 8 * 1.6, 0.35, 1);
      const sl = Math.hypot(TH(x + 8, z) - TH(x - 8, z), TH(x, z + 8) - TH(x, z - 8)) / 16;
      const autumn = clamp(sstep(0.42, 0.78, vn(x / 260, z / 260) * 0.65 + vn(x / 60 + 7, z / 60) * 0.35), 0, 1);
      cols[i * 4] = ao; cols[i * 4 + 1] = sstep(0.45, 0.85, sl); cols[i * 4 + 2] = 0; cols[i * 4 + 3] = autumn;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 4));
    g.computeVertexNormals();
    const sat = TL.load('./assets/l2/sat.jpg?v=1'); sat.colorSpace = THREE.SRGBColorSpace; sat.anisotropy = aniso;
    const fg = tx('leaves_forest_ground_Diffuse', true), fgn = tx('leaves_forest_ground_nor_gl'), rk = tx('rocky_terrain_02_Diffuse', true), rkn = tx('rocky_terrain_02_nor_gl');
    const mat = new THREE.MeshStandardMaterial({ map: sat, normalMap: fgn, vertexColors: true, roughness: 0.95 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { tFG: { value: fg }, tRK: { value: rk }, tRKN: { value: rkn }, tNoise: { value: NOISE }, uHalf: { value: TG.half }, uSize: { value: TG.size } });
      sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = 'uniform sampler2D tFG, tRK, tRKN, tNoise; uniform float uHalf, uSize; varying vec3 vWp;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', `
        vec2 suv = (vWp.xz + uHalf) / uSize;
        vec3 sat = texture2D(map, vec2(suv.x, 1.0 - suv.y)).rgb;
        float dist = distance(vWp, cameraPosition);
        float nz = texture2D(tNoise, vWp.xz / 300.0).r;
        // autumn: shift the summer satellite greens toward russet / gold / crimson in patches
        float aut = vColor.a;
        vec3 autC = mix(vec3(0.42, 0.20, 0.07), vec3(0.50, 0.36, 0.10), nz) * (dot(sat, vec3(0.6)) / 0.09);
        vec3 alb = mix(sat, autC * 0.55 + sat * 0.45, clamp(aut * 0.75, 0.0, 0.8));
        // tree-crown mottling (reads as continuous forest canopy from the wall and the air)
        float cn = 0.5 + ((texture2D(tNoise, vWp.xz / 70.0).g - 0.5) * 0.5 + (texture2D(tNoise, vWp.xz / 19.0 + 0.3).b - 0.5) * 0.35 + (texture2D(tNoise, vWp.xz / 5.0 + 0.7).r - 0.5) * 0.25) * 2.6;
        float forest = 1.0 - vColor.g;
        alb = (alb - dot(alb, vec3(0.333))) * 1.35 + dot(alb, vec3(0.333));
        alb *= mix(1.0, mix(0.42, 1.4, smoothstep(0.3, 0.7, cn)), forest);
        alb *= 1.1;
        // near detail: forest floor / rock by slope, luminance-modulated so the satellite colour is kept
        float near = 1.0 - smoothstep(60.0, 420.0, dist);
        if (near > 0.0) {
          vec3 d1 = texture2D(tFG, vWp.xz / 5.0).rgb, d2 = texture2D(tRK, vWp.xz / 7.0).rgb;
          float rock = vColor.g;
          vec3 det = mix(d1 / 0.22, d2 / 0.30, rock);
          alb = mix(alb, alb * clamp(det, 0.3, 2.2), near * 0.85);
          alb = mix(alb, d2 * 0.9, rock * near * 0.6);
        }
        diffuseColor.rgb *= alb;`)
        .replace('#include <color_fragment>', 'float vAO = vColor.r;')
        .replace('#include <normal_fragment_maps>', `
        { float near2 = 1.0 - smoothstep(40.0, 300.0, distance(vWp, cameraPosition));
          vec3 mnA = texture2D(normalMap, vWp.xz / 5.0).xyz * 2.0 - 1.0, mnB = texture2D(tRKN, vWp.xz / 7.0).xyz * 2.0 - 1.0;
          vec3 mn = mix(mnA, mnB, vColor.g); mn.xy *= 1.2 * near2;
          vec3 T = normalize(vec3(viewMatrix * vec4(1.0, 0.0, 0.0, 0.0))), B = normalize(vec3(viewMatrix * vec4(0.0, 0.0, -1.0, 0.0)));
          normal = normalize(mat3(T, B, normal) * vec3(mn.xy, 1.0) + normal * 0.0); }`)
        .replace('#include <aomap_fragment>', `reflectedLight.indirectDiffuse *= vAO; reflectedLight.directDiffuse *= mix(1.0, vAO, 0.35);`);
    };
    mat.customProgramCacheKey = () => 'l2terrain2';
    const o = new THREE.Mesh(g, mat); o.receiveShadow = true; scene.add(o);
    buildTrees(); buildGrass();
  }

  // ---------- trees: textured trunks + alpha-cut leaf cards (near), crossed-card impostors (far)
  function leafAtlas(kind) {
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
    g.clearRect(0, 0, S, S);
    if (kind === 'pine') {
      for (let b = 0; b < 9; b++) { const y0 = 20 + b * 26; g.strokeStyle = 'rgb(70,48,30)'; g.lineWidth = 2; g.beginPath(); g.moveTo(S / 2, y0); g.lineTo(S / 2 + (b % 2 ? 1 : -1) * (40 + b * 9), y0 + 18); g.stroke();
        for (let k = 0; k < 160; k++) { const t = Math.random(), x = S / 2 + (b % 2 ? 1 : -1) * t * (40 + b * 9), y = y0 + t * 18; const a = Math.random() * 6.28, l = 6 + Math.random() * 7, v = 40 + Math.random() * 50;
          g.strokeStyle = `rgb(${v * 0.55},${v},${v * 0.45})`; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); } }
    } else {
      for (let k = 0; k < 900; k++) {
        const a = Math.random() * 6.28, r = Math.pow(Math.random(), 0.6) * S * 0.46, x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r * 0.85;
        const v = 0.7 + Math.random() * 0.6; g.fillStyle = `rgb(${200 * v | 0},${200 * v | 0},${200 * v | 0})`;
        g.save(); g.translate(x, y); g.rotate(Math.random() * 6.28); g.beginPath(); g.ellipse(0, 0, 4 + Math.random() * 3, 2 + Math.random() * 1.5, 0, 0, 6.28); g.fill(); g.restore();
      }
      g.strokeStyle = 'rgb(60,42,28)'; g.lineWidth = 2; for (let k = 0; k < 7; k++) { g.beginPath(); g.moveTo(S / 2, S / 2); const a = Math.random() * 6.28; g.lineTo(S / 2 + Math.cos(a) * 90, S / 2 + Math.sin(a) * 80); g.stroke(); }
    }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  function impostorTex(kind) {
    const W0 = 128, H0 = 256, cv = document.createElement('canvas'); cv.width = W0; cv.height = H0; const g = cv.getContext('2d');
    g.fillStyle = 'rgb(55,40,28)'; g.fillRect(W0 / 2 - 3, H0 * 0.55, 6, H0 * 0.45);
    const blobs = kind === 'pine' ? 260 : 420;
    for (let k = 0; k < blobs; k++) {
      let x, y, r;
      if (kind === 'pine') { const t = Math.random(); y = 12 + t * H0 * 0.78; x = W0 / 2 + (Math.random() - 0.5) * (8 + t * W0 * 0.8); r = 3 + Math.random() * 4; }
      else { const a = Math.random() * 6.28, rr = Math.sqrt(Math.random()); x = W0 / 2 + Math.cos(a) * rr * W0 * 0.46; y = H0 * 0.36 + Math.sin(a) * rr * H0 * 0.3; r = 3 + Math.random() * 5; }
      const v = 140 + Math.random() * 110 * (y < H0 * 0.4 ? 1 : 0.6); g.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`; g.beginPath(); g.arc(x, y, r, 0, 6.28); g.fill();
    }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function treeGeo(kind) {
    const trunk = [], cards = [];
    const H = kind === 'pine' ? 1.0 : 0.62;
    const tg = new THREE.CylinderGeometry(kind === 'pine' ? 0.018 : 0.03, kind === 'pine' ? 0.045 : 0.06, H, 6, 1, true); tg.translate(0, H / 2, 0);
    { const uv = tg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 6); }
    trunk.push(tg);
    if (kind !== 'pine') for (let b = 0; b < 4; b++) { const bg = new THREE.CylinderGeometry(0.008, 0.02, 0.35, 4, 1, true); bg.translate(0, 0.17, 0); bg.rotateZ(0.7 + Math.random() * 0.3); bg.rotateY(b * 1.6 + Math.random()); bg.translate(0, 0.45 + Math.random() * 0.12, 0); trunk.push(bg); }
    const nC = kind === 'pine' ? 12 : 14;
    for (let i = 0; i < nC; i++) {
      let w, h, y, ry, rx;
      if (kind === 'pine') { const t = i / nC; w = 0.55 * (1 - t) + 0.12; h = w * 0.8; y = 0.22 + t * 0.78; ry = i * 2.4; rx = -0.15; }
      else { w = 0.45 + Math.random() * 0.25; h = w; y = 0.62 + (Math.random() - 0.3) * 0.32; ry = Math.random() * 6.28; rx = (Math.random() - 0.5) * 1.2; }
      const c = new THREE.PlaneGeometry(w, h); c.rotateX(rx); c.rotateY(ry);
      const off = kind === 'pine' ? 0 : 0.12; c.translate(Math.sin(ry) * off, y, Math.cos(ry) * off);
      // bend normals outward for soft, volumetric crown shading
      const p = c.attributes.position, nn = c.attributes.normal; for (let k = 0; k < p.count; k++) { const v = new V3(p.getX(k), p.getY(k) - (kind === 'pine' ? p.getY(k) : 0.65), p.getZ(k)).normalize(); nn.setXYZ(k, v.x, v.y + 0.35, v.z); }
      cards.push(c);
    }
    return { trunk: mergeGeometries(trunk.map(g => g.toNonIndexed())), cards: mergeGeometries(cards) };
  }
  function buildTrees() {
    const m = mats();
    const kinds = ['oak', 'pine'], data = { oak: [], pine: [], far: { oak: [], pine: [] } };
    const nNear = IS_MOBILE ? 4200 : 9000, nFar = IS_MOBILE ? 9000 : 16000;
    let cl = null, tries = 0, k = 0;
    const place = (near) => {
      if (!cl || cl.n <= 0) { const s = Math.random() * D.len, f = frame(s, { ..._f }), side = Math.random() < 0.5 ? -1 : 1;
        const dd = near ? 12 + Math.pow(Math.random(), 1.7) * 200 : 200 + Math.pow(Math.random(), 1.3) * 1000;
        cl = { x: f.x + f.rx * side * dd, z: f.z + f.rz * side * dd, n: 8 + (Math.random() * 20) | 0, s, r: 10 + Math.random() * 20, pine: Math.random() < 0.3 }; }
      cl.n--; const a = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * cl.r, x = cl.x + Math.cos(a) * rr, z = cl.z + Math.sin(a) * rr;
      if (Math.abs(x) > TG.half - 30 || Math.abs(z) > TG.half - 30) return null;
      const sz = (cl.pine ? 9 : 7) + Math.random() * 6;
      const pr = project(x, z, cl.s); if (Math.abs(pr.lat) < HW + PAR + sz * 0.65 + 2.5) return null;
      if (Math.hypot(x - D.plaza[0], z - D.plaza[1]) < 50) return null;
      const y = TH(x, z), sl = Math.hypot(TH(x + 4, z) - TH(x - 4, z), TH(x, z + 4) - TH(x, z - 4)) / 8; if (sl > 1.0) return null;
      return { x, y, z, sz, pine: cl.pine && Math.random() < 0.9 };
    };
    while (k < nNear && tries++ < nNear * 10) { const t = place(true); if (t) { (t.pine ? data.pine : data.oak).push(t); k++; } }
    cl = null; k = 0; tries = 0;
    while (k < nFar && tries++ < nFar * 10) { const t = place(false); if (t) { (t.pine ? data.far.pine : data.far.oak).push(t); k++; } }
    const autumn = [0xc4561a, 0xd98c2a, 0xa8301a, 0xe0b040, 0x8a9a38, 0x6d8a30, 0xb87428, 0x9c2c18, 0x5f7a2a];
    const pinec = [0x3b5a2c, 0x34502a, 0x46663a];
    const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), sc = new V3();
    for (const kind of kinds) {
      const arr = data[kind]; if (!arr.length) continue;
      const G0 = treeGeo(kind), atlas = leafAtlas(kind);
      const lm = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 });
      lm.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n reflectedLight.directDiffuse += diffuseColor.rgb * 0.18 * vec3(1.0, 0.85, 0.5);'); };   // cheap leaf translucency
      lm.customProgramCacheKey = () => 'l2leaf';
      const ti = new THREE.InstancedMesh(G0.trunk, m.bark, arr.length), li = new THREE.InstancedMesh(G0.cards, lm, arr.length);
      arr.forEach((t, i) => { q.setFromAxisAngle(new V3(0, 1, 0), Math.random() * 6.28); mt.compose(new V3(t.x, t.y - 0.3, t.z), q, sc.set(t.sz * (0.85 + Math.random() * 0.3), t.sz, t.sz * (0.85 + Math.random() * 0.3)));
        ti.setMatrixAt(i, mt); li.setMatrixAt(i, mt);
        c.setHex(kind === 'pine' ? pinec[i % 3] : autumn[(Math.random() * autumn.length) | 0]).multiplyScalar(0.75 + Math.random() * 0.35); li.setColorAt(i, c); });
      ti.castShadow = li.castShadow = !IS_MOBILE; li.receiveShadow = true; scene.add(ti, li);
      // far impostors: two crossed cards
      const fa = data.far[kind]; if (!fa.length) continue;
      const ig = mergeGeometries([new THREE.PlaneGeometry(0.5, 1).translate(0, 0.5, 0), new THREE.PlaneGeometry(0.5, 1).translate(0, 0.5, 0).rotateY(Math.PI / 2)]);
      const im = new THREE.MeshStandardMaterial({ map: impostorTex(kind), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
      const fi = new THREE.InstancedMesh(ig, im, fa.length);
      fa.forEach((t, i) => { q.setFromAxisAngle(new V3(0, 1, 0), Math.random() * 6.28); mt.compose(new V3(t.x, t.y - 0.3, t.z), q, sc.set(t.sz * 1.6, t.sz * 1.1, t.sz * 1.6)); fi.setMatrixAt(i, mt);
        c.setHex(kind === 'pine' ? pinec[i % 3] : autumn[(Math.random() * autumn.length) | 0]).multiplyScalar(0.6 + Math.random() * 0.3); fi.setColorAt(i, c); });
      scene.add(fi);
    }
  }
  function buildGrass() {
    // tussock grass + shrubs along the foot of the wall (crossed alpha cards)
    const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
    for (let k = 0; k < 140; k++) { const x0 = S / 2 + (Math.random() - 0.5) * S * 0.7, h = S * (0.4 + Math.random() * 0.55), lean = (Math.random() - 0.5) * 40, v = 120 + Math.random() * 100;
      g.strokeStyle = `rgb(${v | 0},${v * 0.92 | 0},${v * 0.6 | 0})`; g.lineWidth = 1.2 + Math.random(); g.beginPath(); g.moveTo(x0, S); g.quadraticCurveTo(x0 + lean * 0.3, S - h * 0.6, x0 + lean, S - h); g.stroke(); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 });
    const gg = mergeGeometries([0, 1, 2].map(i => new THREE.PlaneGeometry(1, 0.7).translate(0, 0.35, 0).rotateY(i * Math.PI / 3)));
    { const nn = gg.attributes.normal; for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 1, 0); }
    const N = IS_MOBILE ? 5000 : 11000, inst = new THREE.InstancedMesh(gg, mat, N), mt = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    let k = 0;
    for (let i = 0; i < N * 3 && k < N; i++) {
      const s = Math.random() * D.len, f = frame(s, { ..._f }), side = Math.random() < 0.5 ? -1 : 1, dd = HW + PAR + 0.6 + Math.pow(Math.random(), 1.5) * 26;
      if (inGap(s)) continue;
      const x = f.x + f.rx * side * dd, z = f.z + f.rz * side * dd, y = TH(x, z);
      if (y > f.y - 0.3 && dd < HW + 2) continue;
      const sz = 0.8 + Math.random() * 1.6;
      q.setFromAxisAngle(new V3(0, 1, 0), Math.random() * 6.28); mt.compose(new V3(x, y - 0.05, z), q, new V3(sz, sz * (0.7 + Math.random() * 0.6), sz)); inst.setMatrixAt(k, mt);
      c.setHSL(0.09 + Math.random() * 0.08, 0.35 + Math.random() * 0.25, 0.32 + Math.random() * 0.18); inst.setColorAt(k, c); k++;
    }
    inst.count = k; inst.receiveShadow = true; scene.add(inst);
  }

  function buildPlaza() {
    // rectangular bastion terrace beside the wall (Apache landing ground), retaining walls + merlons
    const m = mats(), py = D.plaza[2], f = frame(D.start, { ..._f });
    const A0 = HW + PAR, A1 = HW + PAR + 40, L = 30;
    const P = (al, ac, y) => new V3(f.x + f.tx * al + f.rx * ac, py + y, f.z + f.tz * al + f.rz * ac);
    const quad = (gb, a, b, c, d, uv) => gb.quad(a.toArray(), b.toArray(), c.toArray(), d.toArray(), ...uv);
    const top = GB();
    quad(top, P(-L, A0, 0.01), P(L, A0, 0.01), P(L, A1, 0.01), P(-L, A1, 0.01), [[0, 0], [L, 0], [L, 20], [0, 20]]);
    // GB winding: flip if the normal points down
    let tg = top.geo(); if (tg.attributes.normal.getY(0) < 0) { const t2 = GB(); quad(t2, P(-L, A1, 0.01), P(L, A1, 0.01), P(L, A0, 0.01), P(-L, A0, 0.01), [[0, 20], [L, 20], [L, 0], [0, 0]]); tg = t2.geo(); }
    const tm = new THREE.Mesh(tg, m.floor); tm.receiveShadow = true; scene.add(tm);
    const side = GB(), dep = 30, sw = (a, b) => { // wall face from a to b (outward), parapet 1.05 m
      const a0 = a.clone(), b0 = b.clone(); a0.y = b0.y = py - dep; const a1 = a.clone(), b1 = b.clone(); a1.y = b1.y = py + 1.05;
      const len = a.distanceTo(b) / 1.6; side.quad(a0.toArray(), b0.toArray(), b1.toArray(), a1.toArray(), [0, -dep / 1.6], [len, -dep / 1.6], [len, 0.65], [0, 0.65]);
      side.quad(b0.toArray(), a0.toArray(), a1.toArray(), b1.toArray(), [len, -dep / 1.6], [0, -dep / 1.6], [0, 0.65], [len, 0.65]); };
    sw(P(-L, A0, 0), P(-L, A1, 0)); sw(P(-L, A1, 0), P(L, A1, 0)); sw(P(L, A1, 0), P(L, A0, 0));
    const sm = new THREE.Mesh(side.geo(), m.brick); sm.receiveShadow = true; scene.add(sm);
    const mer = []; for (let al = -L + 0.6; al <= L; al += 1.9) mer.push([al, A1, 0]); for (let ac = A0 + 1; ac < A1; ac += 1.9) { mer.push([-L, ac, 1]); mer.push([L, ac, 1]); }
    const mi = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 1.0, 1.05), m.brick, mer.length), mt = new THREE.Matrix4(), q = new THREE.Quaternion();
    const yaw = Math.atan2(f.tx, f.tz);
    mer.forEach((e, i) => { q.setFromAxisAngle(new V3(0, 1, 0), yaw + (e[2] ? Math.PI / 2 : 0)); mt.compose(P(e[0], e[1], 1.55), q, new V3(1, 1, 1)); mi.setMatrixAt(i, mt); });
    mi.castShadow = !IS_MOBILE; scene.add(mi);
    HSPOTS.forEach(([al, ac]) => { const p = spotW(al, ac); const pad = new THREE.Mesh(new THREE.RingGeometry(5.2, 5.8, 40), new THREE.MeshBasicMaterial({ color: 0xe8b818 })); pad.rotation.x = -Math.PI / 2; pad.position.set(p.x, py + 0.03, p.z); scene.add(pad); });
  }
  const HSPOTS = [[-21, 18], [0, 18], [21, 18], [-21, 35], [0, 35], [21, 35], [10, 26.5]];
  function spotW(al, ac) { const f = frame(D.start, { ..._f }); return new V3(f.x + f.tx * al + f.rx * ac, D.plaza[2], f.z + f.tz * al + f.rz * ac); }

  function buildSky() {
    const sun = new V3(0.62, 0.36, 0.30).normalize();   // late-afternoon autumn sun
    const sky = new THREE.Mesh(new THREE.SphereGeometry(6000, 48, 24), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uSun: { value: sun } },
      vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
      fragmentShader: `uniform vec3 uSun; varying vec3 vD;
        void main(){
          vec3 d = normalize(vD); float y = d.y;
          float mu = dot(d, uSun);
          // single-scattering style gradient: Rayleigh blue zenith, hazy warm horizon, Mie halo round the sun
          float hz = exp(-max(y, 0.0) * 6.5);
          vec3 zen = vec3(0.07, 0.17, 0.42), hor = vec3(0.40, 0.43, 0.44);
          vec3 c = mix(zen, hor, hz);
          c += vec3(0.95, 0.70, 0.42) * hz * 0.25 * pow(max(mu, 0.0), 3.0);
          float g = 0.76, mie = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.012;
          c += vec3(1.0, 0.85, 0.65) * mie;
          c += vec3(1.0, 0.95, 0.85) * smoothstep(0.9993, 0.9997, mu) * 6.0;
          if (y < 0.0) c = mix(hor, vec3(0.32, 0.34, 0.33), clamp(-y * 4.0, 0.0, 1.0));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` }));
    sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky); SKY = sky;
    scene.fog = new THREE.FogExp2(0x9aa3a6, IS_MOBILE ? 0.00078 : 0.0007);
    scene.add(new THREE.HemisphereLight(0xb8cff0, 0x6a5a40, 1.15));
    SUN = new THREE.DirectionalLight(0xffd9a8, 3.0); SUN.position.copy(sun).multiplyScalar(300);
    SUN.castShadow = true; SUN.shadow.mapSize.set(IS_MOBILE ? 2048 : 4096, IS_MOBILE ? 2048 : 4096);
    const sc = SUN.shadow.camera; sc.left = sc.bottom = -80; sc.right = sc.top = 80; sc.near = 10; sc.far = 800; SUN.shadow.bias = -0.0005; SUN.shadow.normalBias = 0.05;
    scene.add(SUN, SUN.target); SUNDIR = sun;
    if (C.envTex) { scene.environment = C.envTex; scene.environmentIntensity = 0.6; }
  }
  let SKY = null, SUN = null, SUNDIR = null;

  // ------------------------------------------------------------------ actors
  let AK = null, HELIS = [], KIT = null;
  const RACERS = [];   // [{player, col, name, num, a (AI entry), heli, walker, s, lat, ...}]
  async function loadKit() {
    try {
      const [gltf, SU] = await Promise.all([new Promise((res, rej) => new C.GLTFLoader().load('./models/rider.glb', res, undefined, rej)), import('three/addons/utils/SkeletonUtils.js')]);
      KIT = { gltf, SU };
    } catch (e) { console.warn('[l2] rider kit', e); }
  }
  function makeWalker(R) {
    if (!KIT) return null;
    const sc = KIT.SU.clone(KIT.gltf.scene);
    sc.traverse(o => { if (o.isSkinnedMesh) o.geometry = o.geometry.clone(); });
    const rig = makeRider({ scene: sc }, THREE);
    const ORG = new THREE.Color(1.0, 0.28, 0.02), paint = new THREE.Color(R.col);
    rig.group.traverse(o => {
      if (!o.isMesh) return; o.castShadow = !IS_MOBILE;
      if (o.isSkinnedMesh) { if (!R.player) o.material = makeGearMaterial(THREE, { name: R.name, num: R.num, main: R.col, accent: R.acc || '#ffffff' }); o.frustumCulled = false; }
      else if (!R.player && o.material && o.material.vertexColors && o.geometry.attributes.color) { const g = o.geometry.clone(), ca = g.attributes.color;
        for (let k = 0; k < ca.count; k++) if (Math.abs(ca.getX(k) - ORG.r) < 0.05 && Math.abs(ca.getY(k) - ORG.g) < 0.05) ca.setXYZ(k, paint.r, paint.g, paint.b); o.geometry = g; }
    });
    scene.add(rig.group);
    return { g: rig.group, rig, pos: new V3(), yaw: 0, done: false };
  }
  function makeHeli(R) {
    AK = AK || buildApacheKit(THREE, mergeGeometries, { mobile: IS_MOBILE });
    const A = AK.make(R.col, R.num, R.player ? 'Smith' : R.name, !IS_MOBILE);
    A.root.rotation.order = 'YXZ'; scene.add(A.root);
    return { root: A.root, rotor: A.rotor, trotor: A.trotor, pos: new V3(), yaw: 0, rpm: 1 };
  }

  const GRID = [[0, 0], [-2.6, 0], [2.6, 0], [-2.6, -7], [0, -7], [2.6, -7], [0, -14]];   // [lat, ds] from the start line
  function placeBikes() {
    RACERS.forEach((R, i) => {
      const [lat, ds] = GRID[i];
      Object.assign(R, { s: D.start + ds - 1.2, lat, spd: 0, vy: 0, y: 0, grounded: true, airT: 0, pitch: 0, roll: 0, finished: false, finishT: 0, cp: D.start, fall: 0 });
      const f = frame(R.s); R.y = f.y; R.yaw = yawOf(f);
      if (R.player) { const P = PL; Object.assign(P, { s: R.s, lat, speed: 0, vy: 0, y: f.y, grounded: true, airT: 0, steerS: 0, leanS: 0, steerAng: 0, roll: 0, pitch: 0, yaw: R.yaw, falling: 0, cp: D.start });
        P.x = f.x + f.rx * lat; P.z = f.z + f.rz * lat; }
      poseRacer(R, 0);
    });
    if (PL.x !== undefined) pushPlayer(0);
  }
  const PL = {};

  // ------------------------------------------------------------------ start / stop
  async function start(opts = {}) {
    if (active) return;
    active = true; phase = 'load'; clock = 0; results = null;
    const fade = ensureUI(); fade.style.opacity = 1; ui.title.style.opacity = 1;
    try {
      if (!built) {
        [D] = await Promise.all([loadData(), loadKit()]);
        buildSky(); buildTerrain(); buildWall(); buildTowers(); buildRamps(); buildNitro(); buildPlaza();
        try { ZM = createZombies({ THREE, scene, frame, HW, PAR, D, inGap, towerAt, pads: PADS, IS_MOBILE, SFX: C.SFX, camera }); } catch (e) { console.warn('[l2] zombies', e); ZM = null; }
        banner(D.start, 'START · 起点', '#a3140c'); banner(D.finish, 'FINISH · 终点', '#c08a10');
        for (const g of D.gaps) { const f = frame(g[1] + 12, { ..._f }); }
        built = true;
      }
    } catch (e) { console.error('[l2] build failed', e); active = false; phase = 'off'; fade.style.opacity = 0; toast('Level 2 failed to load', 3000); return; }
    // racers: player + the 6 AI rivals from level 1 (their bikes + riders move into this scene)
    if (!RACERS.length) {
      RACERS.push({ player: true, col: 0xff6a00, name: 'SMITH', num: '45', acc: '#ffffff' });
      for (const a of C.AI) RACERS.push({ player: false, a, col: a.r.col, name: a.r.name, num: a.r.num, acc: a.r.acc });
      RACERS.forEach(R => { R.heli = makeHeli(R); });
    }
    const bike = C.getBike(); scene.add(bike);
    for (const R of RACERS) if (!R.player) { scene.add(R.a.root); R.a.root.visible = true; R.a.dismounted = false; R.a.tag.visible = true; }
    for (const id of ['hint', 'egHud', 'egCtl']) { const e = $(id); if (e) e.style.display = 'none'; }
    $('overlay') && $('overlay').classList.add('hidden');
    showHud(false);
    C.state.running = false; C.state.finished = false;
    placeBikes();
    // walkers
    RACERS.forEach(R => { if (!R.walker) R.walker = makeWalker(R); if (R.walker) R.walker.g.visible = false; });
    setRidersVisible(false);
    if (opts.skip === 'race') { toCountdown(); fade.style.opacity = 0; ui.title.style.opacity = 0; return; }
    startFlight();
  }
  function showHud(v) { for (const id of ['mobile', 'stats']) { const e = $(id); if (e) e.style.visibility = v ? '' : 'hidden'; } }
  function setRidersVisible(v) { const rd = C.getRider(); if (rd) rd.group.visible = v; for (const R of RACERS) if (!R.player) R.a.rider.visible = v; }

  // ------------------------------------------------------------------ cutscene: fly-in, landing, walk
  const FLY_T = 13, LAND_T = 8.5, WALK_MAX = 14;
  let flyS0 = 0;
  function startFlight() {
    phase = 'flight'; clock = 0; flyS0 = Math.min(D.len - 50, 820);
    ui.skip.style.display = 'block';
    setTimeout(() => { ui.fade.style.opacity = 0; }, 300);
    setTimeout(() => { ui.title.style.opacity = 0; }, 3800);
  }
  const FORM = [[0, 0, 0], [-16, -14, 3], [16, -14, -2], [-32, -28, 5], [32, -28, 1], [-16, -42, -3], [16, -42, 4]];
  const _a = new V3(), _b = new V3(), _c = new V3();
  function flightLead(t) {
    // follows the wall (backwards from s0 toward the start terrace), ~70 m above the crest
    const u = clamp(t / FLY_T, 0, 1), e = 1 - Math.pow(1 - u, 1.6);
    const s = lerp(flyS0, D.start + 70, e), f = frame(s, { ..._f });
    let maxY = f.y; for (let k = -6; k <= 6; k++) maxY = Math.max(maxY, frame(s + k * 15, { ..._f }).y);
    return { x: f.x + f.rx * 40, y: maxY + 75 - 30 * sstep(0.75, 1, u), z: f.z + f.rz * 40, hx: -f.tx, hz: -f.tz };
  }
  function updateFlight(dt) {
    const t = clock;
    RACERS.forEach((R, i) => {
      const H = R.heli, [ox, oz, oy] = FORM[i];
      let tx, ty, tz, yaw;
      if (phase === 'flight') {
        const L = flightLead(t + 0.02 * i);
        yaw = Math.atan2(L.hx, L.hz);
        const rx = Math.cos(yaw), rz = -Math.sin(yaw);   // heli right (model +Z forward)
        tx = L.x + rx * ox + L.hx * oz; tz = L.z + rz * ox + L.hz * oz; ty = L.y + oy + Math.sin(t * 0.9 + i) * 1.2;
        H.root.rotation.set(0.1 + Math.sin(t * 0.7 + i) * 0.02, yaw, Math.sin(t * 0.5 + i * 2) * 0.05);
      } else {
        // landing: glide from the end-of-flight slot to the pad
        const L = flightLead(FLY_T), yaw0 = Math.atan2(L.hx, L.hz), rx = Math.cos(yaw0), rz = -Math.sin(yaw0);
        const p0 = _a.set(L.x + rx * ox + L.hx * oz, L.y + oy, L.z + rz * ox + L.hz * oz), p1 = spotW(...HSPOTS[i]);
        // approach + flare, a short hover in ground effect, then touchdown (staggered per heli)
        const tt = t - i * 0.25, u = clamp(tt / 4.2, 0, 1), e = u * u * (3 - 2 * u);
        const hov = clamp((tt - 4.2) / 1.6, 0, 1), hv = hov * hov * (3 - 2 * hov);
        tx = lerp(p0.x, p1.x, e); tz = lerp(p0.z, p1.z, e);
        ty = lerp(p0.y, p1.y + 5, sstep(0.2, 1, u)) - 5 * hv + (hov < 1 && hov > 0 ? Math.sin(tt * 5) * 0.08 : 0);
        const f = frame(D.start, { ..._f }); yaw = lerp(yaw0, Math.atan2(f.tx, f.tz), e);
        H.root.rotation.set(0.12 * (1 - e) - 0.16 * Math.sin(Math.PI * e) * (1 - hv), yaw, 0);
        if (hov >= 1) { H.rpm = Math.max(0.12, H.rpm - dt * 0.35); if (!H.td) { H.td = true; H.dust = 1; } }
        else H.td = false;
      }
      H.pos.set(tx, ty, tz); H.yaw = yaw; H.root.position.copy(H.pos);
      H.rotor.rotation.y += H.rpm * 26 * dt; H.trotor.rotation.x += H.rpm * 70 * dt;
    });
    // cinematic camera: 3 shots
    const L = RACERS[0].heli;
    if (phase === 'flight') {
      if (t < 4.5) { const f = frame(flyS0 - 260, { ..._f }); camera.position.set(f.x - f.rx * 14, f.y + 6, f.z - f.rz * 14); camera.lookAt(L.pos.x, L.pos.y - 4, L.pos.z); camera.fov = 50; }
      else if (t < 9) { const yaw = L.yaw, rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = Math.sin(yaw), fz = Math.cos(yaw);
        camera.position.set(L.pos.x + rx * 48 + fx * 10, L.pos.y + 8, L.pos.z + rz * 48 + fz * 10); camera.lookAt(L.pos.x - fx * 8, L.pos.y - 3, L.pos.z - fz * 8); camera.fov = 46; }
      else { const fx = Math.sin(L.yaw), fz = Math.cos(L.yaw); camera.position.set(L.pos.x - fx * 30, L.pos.y + 9, L.pos.z - fz * 30); const f = frame(D.start, { ..._f }); camera.lookAt(f.x, f.y, f.z); camera.fov = 52; }
    } else {
      // low three-quarter shot on the player's Apache as it flares, hovers and touches down
      const sp = spotW(...HSPOTS[0]), f = frame(D.start, { ..._f });
      const cx = sp.x - f.tx * 16 + f.rx * 14, cz = sp.z - f.tz * 16 + f.rz * 14;
      _b.set(cx, D.plaza[2] + 2.2 + Math.max(0, L.pos.y - D.plaza[2]) * 0.35, cz);
      if (t < 0.05) camera.position.copy(_b); else camera.position.lerp(_b, 1 - Math.exp(-2 * dt));
      _c.set(L.pos.x, L.pos.y + 1.5, L.pos.z); camera.lookAt(_c); camera.fov = 50;
    }
    camera.updateProjectionMatrix();
  }
  // walk: each racer exits the door, walks through the gate onto the wall, to its bike
  function startWalk() {
    phase = 'walk'; clock = 0;
    RACERS.forEach((R, i) => {
      const H = R.heli, W0 = R.walker; if (!W0) return;
      const rx = Math.cos(H.yaw), rz = -Math.sin(H.yaw);
      W0.pos.set(H.pos.x + rx * 2.6, D.plaza[2], H.pos.z + rz * 2.6); W0.g.visible = true; W0.done = false; W0.wait = i * 0.35;
      const gf = frame(24 + (i % 3) * 2, { ..._f }), bf = frame(R.s, { ..._f });
      W0.path = [new V3(gf.x + gf.rx * (HW + 3), 0, gf.z + gf.rz * (HW + 3)), new V3(gf.x + gf.rx * (HW - 1.5), 0, gf.z + gf.rz * (HW - 1.5)),
        new V3(bf.x + bf.rx * (R.lat + 0.9), 0, bf.z + bf.rz * (R.lat + 0.9))];
      W0.k = 0; W0.v = 0; W0.yaw = H.yaw;
    });
  }
  function updateWalk(dt) {
    let all = true;
    RACERS.forEach(R => {
      const w = R.walker; if (!w || w.done) return; all = false;
      if (w.wait > 0) { w.wait -= dt; w.rig.gait(0, dt, {}); placeWalker(w); return; }
      const tg = w.path[w.k], dx = tg.x - w.pos.x, dz = tg.z - w.pos.z, d = Math.hypot(dx, dz);
      const vT = w.k === w.path.length - 1 ? Math.min(2.6, d * 1.2 + 0.4) : 3.6;
      w.v += clamp(vT - w.v, -4 * dt, 2.5 * dt);
      const yT = Math.atan2(dx, dz); let dy = yT - w.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      const turn = clamp(dy * 3, -2.5, 2.5); w.yaw += turn * dt;
      w.pos.x += Math.sin(w.yaw) * w.v * dt; w.pos.z += Math.cos(w.yaw) * w.v * dt;
      if (d < 0.6) { if (w.k < w.path.length - 1) w.k++; else { w.done = true; w.g.visible = false; mountRacer(R); } }
      w.rig.gait(w.v, dt, { turn: turn * 0.3 });
      placeWalker(w);
    });
    // camera: behind the player's walker
    const w = RACERS[0].walker;
    if (w && w.g.visible) {
      const fx = Math.sin(w.yaw), fz = Math.cos(w.yaw);
      _b.set(w.pos.x - fx * 4.2 + fz * 1.2, w.pos.y + 2.3, w.pos.z - fz * 4.2 - fx * 1.2);
      camera.position.lerp(_b, 1 - Math.exp(-4 * dt)); camera.lookAt(w.pos.x + fx * 2, w.pos.y + 1.3, w.pos.z + fz * 2); camera.fov = 55; camera.updateProjectionMatrix();
    } else chaseCam(dt, true);
    if (all || clock > WALK_MAX + 6) { RACERS.forEach(R => { if (R.walker && !R.walker.done) { R.walker.done = true; R.walker.g.visible = false; mountRacer(R); } }); toCountdown(); }
  }
  function placeWalker(w) {
    const pr = project(w.pos.x, w.pos.z, 25);
    const onWall = Math.abs(pr.lat) < HW + PAR;
    w.pos.y = onWall ? frame(pr.s, { ..._f }).y : D.plaza[2];
    w.g.position.copy(w.pos); w.g.rotation.set(0, w.yaw + Math.PI, 0);
  }
  function mountRacer(R) { if (R.player) { const rd = C.getRider(); if (rd) rd.group.visible = true; } else R.a.rider.visible = true; }

  // ------------------------------------------------------------------ race
  let cdT = 0;
  function toCountdown() {
    if (ZM) ZM.reset(); if (ZV) ZV.forEach(V => { V.grabbedBy = null; }); PL.zg = null;
    phase = 'countdown'; clock = 0; cdT = 3.2; ui.skip.style.display = 'none'; showHud(true);
    RACERS.forEach(R => { if (R.walker) R.walker.g.visible = false; if (R.heli) { R.heli.pos.copy(spotW(...HSPOTS[RACERS.indexOf(R)])); R.heli.root.position.copy(R.heli.pos); const f = frame(D.start, { ..._f }); R.heli.root.rotation.set(0, Math.atan2(f.tx, f.tz), 0); R.heli.rpm = 0.12; } });
    setRidersVisible(true); placeBikes();
    camera.position.set(PL.x, PL.y + 3, PL.z);
  }
  function updateCountdown(dt) {
    const prev = Math.ceil(cdT); cdT -= dt; const now = Math.ceil(cdT);
    if (now !== prev && now > 0) toast(String(now), 800);
    if (cdT <= 0) { phase = 'race'; raceT = 0; toast('GO! · THE GREAT WALL', 1400); C.state.running = true; C.state.finished = false; }
    pushPlayer(dt); chaseCam(dt);
  }
  function stepPlayer(dt) {
    const P = PL, S = C.state;
    const fin = RACERS[0] && RACERS[0].finished;   // past the line: inputs off, auto-brake, hold the walkway line
    const gas = !fin && (keys.KeyW || keys.ArrowUp) ? 1 : 0, brake = !fin && (keys.KeyS || keys.ArrowDown) ? 1 : 0;
    const steer = fin ? 0 : ((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0);
    const zv = ZV && ZV[0];
    if (zv && zv.grabbedBy && !fin) {   // a zombie is hanging on: no drive, bike bogs down; alternate steer to shake it off
      const g = P.zg || (P.zg = { t: 0, n: 0, last: 0 }); g.t += dt;
      if (steer && steer !== g.last) { g.n++; g.last = steer; C.state.shake = 0.15; }
      P.speed *= Math.exp(-5 * dt);
      if (g.n >= 5 || g.t > 2.6) { ZM.release(zv, g.n >= 5 ? 'shake' : 'auto'); toast(g.n >= 5 ? 'SHOOK IT OFF!' : 'BROKE FREE', 900); P.zg = null; }
    }
    const zHeld = !!(zv && zv.grabbedBy);
    if (fin) { P.boost = 0; P.speed = Math.max(0, P.speed - 13 * dt); const f = frame(P.s, { ..._f }); let dy = yawOf(f) - P.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; P.yaw += dy * Math.min(1, 4 * dt); P.lat *= Math.exp(-1.5 * dt); }
    if (keys.KeyR && !P.rHeld) { P.rHeld = true; respawn(); return; } if (!keys.KeyR) P.rHeld = false;
    S.inGas = gas; S.inBrake = brake; S.inSteer = steer;
    if (P.falling > 0) { P.falling += dt; P.vy -= GRAV * dt; P.y += P.vy * dt; P.x += Math.sin(P.yaw) * P.speed * dt; P.z -= Math.cos(P.yaw) * P.speed * dt; P.speed *= Math.exp(-0.5 * dt); P.pitch += dt * 0.8;
      const gy = TH(P.x, P.z); if (P.y < gy + 0.3) { P.y = gy + 0.3; P.vy = 0; P.speed *= 0.2; }
      if (P.falling > 1.8) respawn(); return; }
    // steering: same feel as level 1 (smoothed ramp, speed-sensitive, steer-only lean feedback)
    const sPrev = P.steerS; P.steerS = sPrev + (steer - sPrev) * Math.min(1, (steer !== 0 ? 5.5 : 12) * dt);
    P.leanS += (P.steerS - P.leanS) * Math.min(1, 14 * dt);
    if (steer === 0 && Math.abs(P.steerS) < 0.02) { P.steerS = 0; P.leanS *= Math.exp(-12 * dt); }
    const spdN = clamp(P.speed / 32, 0, 1);
    const auth = clamp(0.35 + P.speed * 0.045, 0.35, 1.5) * (P.grounded ? 1 : 0.3) * (1 - 0.25 * spdN);
    P.yaw += (0.6 * P.steerS + 0.4 * P.leanS * (P.grounded ? 1 : 0.3)) * 1.9 * auth * dt;
    const sa = P.steerS * lerp(0.55, 0.07, Math.pow(spdN, 0.7)) - (steer - P.steerS) * 0.06 * spdN;
    P.steerAng += (sa - P.steerAng) * Math.min(1, 14 * dt);
    const f0 = frame(P.s, { ..._f });
    P.boost = Math.max(0, (P.boost || 0) - dt);
    const bo = P.boost > 0, bk = bo ? Math.min(1, P.boost / 0.6) : 0;
    if (bo) {   // nitro: big thrust (even off the gas), higher top speed, slope drag mostly cancelled
      P.speed += 34 * dt * Math.max(0, 1 - P.speed / 50);
    }
    if (P.grounded) {
      if (gas && !zHeld) P.speed += 21 * dt * (1 - P.speed / 33);
      if (brake) P.speed -= 30 * dt;
      P.speed -= (0.012 * P.speed + (gas ? 0 : 1.2)) * dt;
      P.speed -= 9.8 * 0.75 * (bo ? 0.35 : 1) * clamp(f0.g * Math.cos(P.yaw - yawOf(f0)), -0.4, 0.4) * dt;
    }
    P.vcap = bo ? 47 : Math.max(34, (P.vcap || 34) - 6 * dt);
    P.speed = clamp(P.speed, 0, P.vcap);
    P.x += Math.sin(P.yaw) * P.speed * dt; P.z -= Math.cos(P.yaw) * P.speed * dt;
    let pr = project(P.x, P.z, P.s);
    // parapets: hold the bike on the walkway, scrub speed, align with the wall
    if (Math.abs(pr.lat) > LATMAX) {
      const f = frame(pr.s, { ..._f }), tyaw = yawOf(f); pr.lat = Math.sign(pr.lat) * LATMAX;
      P.x = f.x + f.rx * pr.lat; P.z = f.z + f.rz * pr.lat;
      let dy = tyaw - P.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      if (Math.abs(dy) > 1.6) dy = dy - Math.sign(dy) * Math.PI;   // rubbing backwards: still align to the wall line
      P.yaw += dy * Math.min(1, 6 * dt); P.speed *= Math.exp(-1.6 * dt);
      if (!P.wallT || P.wallT < raceT - 0.6) { P.wallT = raceT; C.state.shake = 0.15; }
    }
    const sEnd = D.len - 4;   // physical end of the wall: never ride (or roll) off it
    if (pr.s > sEnd) { const f = frame(sEnd, { ..._f }); pr.s = sEnd; P.x = f.x + f.rx * pr.lat; P.z = f.z + f.rz * pr.lat; P.speed = 0; }
    if (pr.s < 1) { pr.s = 1; const f = frame(1, { ..._f }); P.x = f.x + f.rx * pr.lat; P.z = f.z + f.rz * pr.lat; P.speed = 0; }
    if (P.grounded && PADS.some(Q => P.s < Q.s + 3.5 && pr.s >= Q.s - 3.5 && pr.s > P.s - 0.01 && Q !== P.lastPad && (P.lastPad = Q))) {
      P.boost = BOOST_T; NITRO.hits++; NITRO.lastIn = P.speed; C.state.shake = 0.3; whoosh(0.8); toast('NITRO!', 900);
    }
    P.s = pr.s; P.lat = pr.lat;
    const gy = surf(P.s);
    const deck = frame(P.s, { ..._f }).y;
    if (P.grounded) {
      if (gy === null || gy < P.y + P.vy * dt - 0.5 * GRAV * dt * dt - 0.05) { P.grounded = false; P.airT = 0; }
      else { const vR = (gy - P.y) / Math.max(dt, 1e-3); P.vy = clamp(vR, -30, 30); P.y = gy; }
    }
    if (!P.grounded) {
      P.vy -= GRAV * dt; P.y += P.vy * dt; P.airT += dt;
      if (gy !== null && P.y <= gy) { const imp = -P.vy; P.y = gy; P.grounded = true; P.vy = 0; if (P.airT > 0.35) { C.state.landEv = Math.min(1, imp / 12); C.state.landSquat = 1; C.state.shake = Math.min(0.35, imp * 0.02); } }
      else if (gy === null && P.y < deck - 2.5) { P.falling = 0.001; toast('MISSED THE JUMP!', 1500); }
    }
    // checkpoints & finish
    for (const c of D.cps) if (P.s > c + 1 && c > P.cp && P.grounded) { P.cp = c; if (c !== D.start) toast('CHECKPOINT', 900); }
    const pitchT = P.grounded ? Math.atan(f0.g * Math.cos(P.yaw - yawOf(f0)) + (rampH(P.s) ? 0.23 : 0)) : Math.atan2(P.vy, Math.max(6, P.speed)) * 0.7;
    P.pitch += (clamp(pitchT, -0.6, 0.6) - P.pitch) * Math.min(1, (P.grounded ? 14 : 3.2) * dt);
    const rollT = clamp(-P.steerS * (0.12 + 0.2 * Math.min(1, P.speed / 22)), -0.34, 0.34);
    P.roll += (rollT - P.roll) * Math.min(1, 6.5 * dt);
    const R0 = RACERS[0];
    if (!R0.finished && P.s >= D.finish) { R0.finished = true; R0.finishT = raceT; finishOrder.push(R0); toast('FINISH!', 2000); }
  }
  function respawn() {
    const P = PL, f = frame(P.cp + 2, { ..._f });
    Object.assign(P, { s: P.cp + 2, lat: 0, x: f.x, z: f.z, y: f.y, vy: 0, speed: 6, grounded: true, falling: 0, airT: 0, yaw: yawOf(f), pitch: 0, roll: 0, steerS: 0, leanS: 0, steerAng: 0 });
    P.boost = 0; P.lastPad = null; if (ZV && ZV[0].grabbedBy && ZM) ZM.release(ZV[0], 'auto'); P.zg = null; toast('RESPAWN · last checkpoint', 1200);
  }
  function pushPlayer(dt) {
    const P = PL, S = C.state;
    S.x = P.x; S.y = P.y; S.z = P.z; S.yaw = P.yaw; S.pitch = P.pitch; S.roll = P.roll; S.speed = P.speed; S.grounded = P.grounded;
    S.airTime = P.airT || 0; S.steerAng = P.steerAng; S.vy = P.vy; S.s = P.s;
    C.syncBike(dt);
    if (SUN) { SUN.target.position.set(P.x, P.y, P.z); SUN.position.copy(SUNDIR).multiplyScalar(300).add(SUN.target.position); }
  }
  const finishOrder = [];
  function poseRacer(R, dt) {
    if (R.player) return;
    const a = R.a, f = frame(R.s, { ..._f });
    a.root.position.set(f.x + f.rx * R.lat, R.y, f.z + f.rz * R.lat);
    a.root.rotation.order = 'YXZ'; a.root.rotation.set(R.pitch, -(yawOf(f) + R.latV * 0.05), R.roll || 0);
    for (const w of a.wheels) w.rotation.x -= R.spd * dt / 0.43;
  }
  function stepAI(dt) {
    const order = RACERS.slice().sort((a, b) => b.s - a.s);
    RACERS.forEach((R, i) => {
      if (R.player) return;
      if (!R.base) R.base = 25.5 + (i % 3) * 0.9 - (i > 3 ? 0.8 : 0);
      R.latV = R.latV || 0;
      if (R.finished) { R.spd = Math.max(0, R.spd - 13 * dt); R.boost = 0; if (R.s > D.len - 6 - (i % 3) * 2) { R.s = D.len - 6 - (i % 3) * 2; R.spd = 0; } }
      else {
        const gap = PL.s - R.s;   // rubber band
        let tgt = R.base + clamp(gap * 0.03, -3, 3) + Math.sin(raceT * 0.3 + i) * 0.8;
        const f = frame(R.s, { ..._f }); tgt -= clamp(f.g, 0, 0.3) * 6;
        // never too slow into a kicker
        for (const r of D.ramps) if (R.s > r[0] - 60 && R.s < r[1]) tgt = Math.max(tgt, 24);
        R.boost = Math.max(0, (R.boost || 0) - dt);
        if (R.boost > 0) tgt = Math.max(tgt, 39);
        R.spd += clamp(tgt - R.spd, -14 * dt, (R.boost > 0 ? 24 : 9) * dt);
      }
      { const V = ZV && ZV[i]; if (V && V.grabbedBy) { R.spd = Math.max(0, R.spd - 40 * dt); R.zgT = (R.zgT || 0) + dt; if (R.zgT > 1.1 + (i % 3) * 0.3) { ZM.release(V, 'shake'); R.zgT = 0; } } }
      if (R.grounded && !R.finished && PADS.some(Q => R.s < Q.s - 3.5 && R.s + R.spd * dt >= Q.s - 3.5)) { R.boost = BOOST_T; NITRO.aiHits++; if (R.a.root.position.distanceTo(camera.position) < 60) whoosh(0.35); }
      if (!R.flame) R.flame = attachFlame(R.a.root); flameFx(R.flame, R.boost > 0, dt);
      R.s += R.spd * dt;
      // lanes: spread out, stay off the parapets, avoid the player
      const lane = ((i % 3) - 1) * 2.4 + Math.sin(raceT * 0.4 + i * 1.7) * 0.6;
      let lt = lane; if (Math.abs(R.s - PL.s) < 4 && Math.abs(R.lat - PL.lat) < 1.6) lt = R.lat + Math.sign(R.lat - PL.lat || 1) * 2;
      lt = clamp(lt, -LATMAX + 0.4, LATMAX - 0.4);
      const nl = R.lat + (lt - R.lat) * Math.min(1, 1.2 * dt); R.latV = (nl - R.lat) / Math.max(dt, 1e-3); R.lat = nl;
      const gy = surf(R.s), deck = frame(R.s, { ..._f }).y;
      if (R.grounded) {
        if (gy === null || gy < R.y + R.vy * dt - 0.5 * GRAV * dt * dt - 0.05) { R.grounded = false; R.airT = 0; }
        else { R.vy = clamp((gy - R.y) / Math.max(dt, 1e-3), -30, 30); R.y = gy; }
      }
      if (!R.grounded) {
        R.vy -= GRAV * dt; R.y += R.vy * dt; R.airT += dt;
        if (gy !== null && R.y <= gy) { R.y = gy; R.grounded = true; R.vy = 0; }
        else if (gy === null && R.y < deck - 2.5) { R.fall = (R.fall || 0) + 1; const g = D.gaps.find(g => R.s > g[0] - 5 && R.s < g[1] + 5); R.s = g ? g[1] + 3 : R.s; R.y = frame(R.s).y; R.vy = 0; R.grounded = true; R.spd = 10; }
      }
      const f = frame(R.s, { ..._f });
      const pt = R.grounded ? Math.atan(f.g + (rampH(R.s) ? 0.23 : 0)) : Math.atan2(R.vy, Math.max(6, R.spd)) * 0.7;
      R.pitch += (clamp(pt, -0.6, 0.6) - R.pitch) * Math.min(1, (R.grounded ? 14 : 3.2) * dt);
      R.roll += (clamp(-R.latV * 0.08, -0.25, 0.25) - (R.roll || 0)) * Math.min(1, 6 * dt);
      if (!R.finished && R.s >= D.finish) { R.finished = true; R.finishT = raceT; finishOrder.push(R); }
      poseRacer(R, dt);
      const d = R.a.root.position.distanceTo(camera.position); R.a.tag.visible = d < 90 && d > 7;
    });
  }
  const camP = new V3(), camL = new V3();
  function chaseCam(dt, snap) {
    const P = PL; const fx = Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    const back = P.falling > 0 ? 9 : 6.4, up = P.falling > 0 ? 5 : 2.5;
    _c.set(P.x - fx * back, P.y + up, P.z - fz * back);
    // keep the camera above the walkway between the parapets
    const pr = project(_c.x, _c.z, P.s), f = frame(pr.s, { ..._f });
    if (Math.abs(pr.lat) > HW - 0.4 && P.falling <= 0) { const l = Math.sign(pr.lat) * (HW - 0.4); _c.x = f.x + f.rx * l; _c.z = f.z + f.rz * l; }
    _c.y = Math.max(_c.y, (surf(pr.s) ?? f.y) + 1.6);
    if (snap || camP.lengthSq() === 0) camP.copy(_c); else camP.lerp(_c, 1 - Math.exp(-6 * dt));
    camL.set(P.x + fx * 4, P.y + 1.1, P.z + fz * 4);
    camera.position.copy(camP);
    const sh = C.state.shake || 0; if (sh > 0) { C.state.shake = Math.max(0, sh - dt); camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh; }
    camera.lookAt(camL);
    const bk = clamp((P.boost || 0) / 0.6, 0, 1);
    if (bk > 0) { camera.position.x += (Math.random() - 0.5) * 0.09 * bk; camera.position.y += (Math.random() - 0.5) * 0.09 * bk; }
    speedLines(bk * 0.85); flameFx(attachFlame(C.getBike()), bk > 0 && P.falling <= 0, dt);
    if (padGlow) padGlow.opacity = 0.25 + 0.18 * Math.sin(performance.now() * 0.008);
    const fov = 60 + clamp(P.speed / 34, 0, 1) * 10 + bk * 14; camera.fov += (fov - camera.fov) * Math.min(1, 3 * dt); camera.updateProjectionMatrix();
  }
  function hud() {
    const P = PL, pos = 1 + RACERS.filter(R => !R.player && (R.finished ? (!RACERS[0].finished || R.finishT < RACERS[0].finishT) : (!RACERS[0].finished && R.s > P.s))).length;
    const el = $('stats'); if (!el) return;
    el.innerHTML = '<div class="spd">' + Math.round(P.speed * 3.6) + ' <span>KM/H</span></div>' +
      '<div class="row">POS <b class="pos">' + pos + '</b>/' + RACERS.length + ' · LEVEL 2</div>' +
      '<div class="row">GREAT WALL <b>' + Math.round(clamp((P.s - D.start) / (D.finish - D.start), 0, 1) * 100) + '%</b> · ' + Math.max(0, Math.round(D.finish - P.s)) + ' m to go</div>' +
      '<div class="row">TIME <b>' + raceT.toFixed(1) + 's</b>' + (P.grounded ? '' : ' · <span class="air">AIR ' + (P.airT || 0).toFixed(1) + 's</span>') + '</div>';
    P.pos = pos;
  }
  function showResults() {
    phase = 'results';
    const all = RACERS.slice().sort((a, b) => (a.finished && b.finished) ? a.finishT - b.finishT : (b.finished - a.finished) || (b.s - a.s));
    const me = all.indexOf(RACERS[0]) + 1;
    ui.res.innerHTML = '<h1>' + (me === 1 ? 'YOU CONQUERED THE GREAT WALL!' : 'GREAT WALL · P' + me) + '</h1><p>' +
      all.map((R, i) => (i + 1) + '. ' + (R.player ? '<b>45 YOU</b>' : R.num + ' ' + R.name) + (R.finished ? ' — ' + R.finishT.toFixed(1) + 's' : ' — DNF')).join('<br>') +
      '</p><button id="l2Again">RACE THE WALL AGAIN</button> <button id="l2Back">BACK TO THE HIMALAYAS</button>';
    ui.res.style.display = 'flex';
    $('l2Again').onclick = () => { ui.res.style.display = 'none'; finishOrder.length = 0; toCountdown(); };
    $('l2Back').onclick = () => { location.href = location.pathname; };
  }

  // ------------------------------------------------------------------ UI
  let ui = null;
  function ensureUI() {
    if (ui) return ui.fade;
    const st = document.createElement('style');
    st.textContent = `#l2fade{position:fixed;inset:0;background:#000;opacity:1;transition:opacity 1.2s;pointer-events:none;z-index:40}
#l2title{position:fixed;left:0;right:0;top:34%;text-align:center;color:#fff;font:800 clamp(22px,5vw,46px) system-ui,Arial;letter-spacing:.12em;text-shadow:0 3px 18px #000;z-index:41;transition:opacity 1.2s;pointer-events:none}
#l2title small{display:block;font-size:.42em;letter-spacing:.3em;opacity:.85;margin-top:8px}
#l2skip{position:fixed;right:16px;bottom:18px;z-index:42;display:none;background:rgba(10,12,16,.6);color:#fff;border:1px solid rgba(255,255,255,.4);border-radius:10px;padding:10px 18px;font:700 15px system-ui}
#l2res{position:fixed;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;background:rgba(8,10,14,.62);color:#fff;z-index:43;font:16px system-ui;text-align:center}
#l2res h1{font-size:clamp(20px,4vw,36px);margin:0 0 10px}#l2res p{line-height:1.5}
#l2res button{margin:6px;border:0;border-radius:12px;padding:12px 22px;font-weight:800;background:linear-gradient(180deg,#ffd060,#ff9a20);color:#1a1008}`;
    document.head.appendChild(st);
    const mk = (id, tag = 'div') => { const e = document.createElement(tag); e.id = id; document.body.appendChild(e); return e; };
    ui = { fade: mk('l2fade'), title: mk('l2title'), skip: mk('l2skip', 'button'), res: mk('l2res') };
    ui.title.innerHTML = 'LEVEL 2 · THE GREAT WALL<small>JINSHANLING RIDGE · HEBEI, CHINA</small>';
    ui.skip.textContent = 'SKIP ▶';
    ui.skip.onclick = (e) => { e.preventDefault(); if (phase === 'flight' || phase === 'land' || phase === 'walk') { RACERS.forEach(R => { if (R.walker) { R.walker.done = true; R.walker.g.visible = false; } }); ui.title.style.opacity = 0; ui.fade.style.opacity = 0; toCountdown(); } };
    ui.skip.addEventListener('touchend', ui.skip.onclick, { passive: false });
    return ui.fade;
  }

  // ------------------------------------------------------------------ frame
  function update(dt) {
    if (!active) return;
    clock += dt;
    if (phase === 'load') return;
    if (phase === 'flight') { updateFlight(dt); if (clock > FLY_T) { phase = 'land'; clock = 0; } }
    else if (phase === 'land') { updateFlight(dt); if (clock > LAND_T) startWalk(); }
    else if (phase === 'walk') { updateWalk(dt); RACERS.forEach(R => { R.heli.rotor.rotation.y += R.heli.rpm * 26 * dt; R.heli.rpm = Math.max(0.1, R.heli.rpm - dt * 0.2); }); }
    else if (phase === 'countdown') updateCountdown(dt);
    else if (phase === 'race' || phase === 'done') {
      raceT += dt;
      stepPlayer(dt); stepAI(dt); if (ZM) { try { ZM.update(dt, zViews(), zOnHit); } catch (e) { console.warn('[l2] zombie update', e); ZM = null; } } pushPlayer(dt); chaseCam(dt);
      if (phase === 'race' && RACERS[0].finished) { phase = 'done'; clock = 0; }
      if (phase === 'done' && (clock > 4 && (RACERS.every(R => R.finished) || clock > 25))) showResults();
    } else if (phase === 'results') { stepAI(dt); chaseCam(dt); }
    if (phase === 'race' || phase === 'done' || phase === 'countdown') hud();
    if (SKY) SKY.position.copy(camera.position);
    if (SUN && phase !== 'race' && phase !== 'done' && phase !== 'countdown') { SUN.target.position.copy(camera.position); SUN.position.copy(SUNDIR).multiplyScalar(300).add(SUN.target.position); }
  }
  return { start, update, scene, get active() { return active; }, get phase() { return phase; },
    dbg: { get D() { return D; }, NITRO, get ZM() { return ZM; }, zViews, PL, RACERS, frame, surf, project, respawn, finishOrder, toCountdown, setPhase(v) { phase = v; clock = 0; }, get raceT() { return raceT; } } };
}
