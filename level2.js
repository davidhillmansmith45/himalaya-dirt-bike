// LEVEL 2 — The Great Wall (Jinshanling ridge, real SRTM DEM). Self-contained scene: Apache fly-in, landing,
// walk to the parked bikes, race on top of the wall with gap jumps, towers, checkpoints, AI racers.
import { buildApacheKit } from './apache.js?v=1';
import { makeRider, makeGearMaterial } from './rider.js?v=m5';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

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
  function mats() {
    if (M) return M;
    const brick = new THREE.MeshStandardMaterial({ map: tx('castle_brick_02_white_Diffuse', true), normalMap: tx('castle_brick_02_white_nor_gl'), roughness: 0.92, color: 0xc9c2b4 });
    brick.normalScale.set(1.2, 1.2);
    const floor = new THREE.MeshStandardMaterial({ map: tx('floor_bricks_02_Diffuse', true), normalMap: tx('floor_bricks_02_nor_gl'), roughness: 0.95, color: 0xb8b0a2 });
    const grass = tx('aerial_grass_rock_Diffuse', true), leaves = tx('forest_leaves_02_Diffuse', true);
    const ground = new THREE.MeshStandardMaterial({ map: grass, normalMap: tx('aerial_grass_rock_nor_gl'), vertexColors: true, roughness: 1 });
    ground.onBeforeCompile = (sh) => {
      sh.uniforms.tLeaves = { value: leaves };
      sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = 'uniform sampler2D tLeaves; varying vec3 vWp;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
        vec3 gA = texture2D(map, vWp.xz / 9.0).rgb, gB = texture2D(map, vWp.xz / 41.0 + 0.3).rgb;
        vec3 lv = texture2D(tLeaves, vWp.xz / 6.0).rgb;
        float w = clamp(vColor.a, 0.0, 1.0);
        // forest canopy seen from above: blotchy crowns (two leaf scales) over the grass/rock scan
        vec3 lv2 = texture2D(tLeaves, vWp.xz / 23.0 + 0.5).rgb;
        float crown = smoothstep(0.25, 0.6, dot(lv2, vec3(0.4)) + gB.g * 0.5);
        float lum = dot(gA * 0.6 + gB * 0.4, vec3(0.333)) / 0.3;
        vec3 tex = vec3(clamp(lum, 0.4, 1.8)) * mix(0.55, 1.25, crown);
        diffuseColor.rgb *= mix(tex, tex * (lv / max(dot(lv, vec3(0.333)), 0.05)) * 0.8, w * 0.6);`).replace('#include <color_fragment>', 'diffuseColor.rgb *= vColor.rgb;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `
        { vec3 mn = texture2D(normalMap, vWp.xz / 9.0).xyz * 2.0 - 1.0; mn.xy *= 0.8; normal = normalize(tbn0 * mn); }`.replace('tbn0', 'mat3(normalize(vec3(viewMatrix * vec4(1.0,0.0,0.0,0.0))), normalize(vec3(viewMatrix * vec4(0.0,0.0,-1.0,0.0))), normal)'));
    };
    ground.customProgramCacheKey = () => 'l2ground';
    // timber kicker ramps: procedural planks
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256; const g = cv.getContext('2d');
    for (let i = 0; i < 8; i++) { const v = 90 + Math.random() * 40; g.fillStyle = `rgb(${v + 30},${v},${v * 0.6})`; g.fillRect(0, i * 32, 256, 30); g.fillStyle = 'rgba(30,18,8,.9)'; g.fillRect(0, i * 32 + 30, 256, 2);
      for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(40,25,10,${Math.random() * 0.25})`; g.fillRect(Math.random() * 256, i * 32 + Math.random() * 30, 30 + Math.random() * 80, 1); } }
    const wt = new THREE.CanvasTexture(cv); wt.wrapS = wt.wrapT = THREE.RepeatWrapping; wt.colorSpace = THREE.SRGBColorSpace;
    const wood = new THREE.MeshStandardMaterial({ map: wt, roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15130f, roughness: 1 });
    const tile = new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.7, metalness: 0.05 });
    const red = new THREE.MeshStandardMaterial({ color: 0x9a1d14, roughness: 0.6 });
    M = { brick, floor, ground, wood, dark, tile, red };
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
    const parts = [], roofs = [], darks = [];
    const box = (arr, w, h, l, x, y, z, f, yaw) => {
      const g = new THREE.BoxGeometry(w, h, l);
      // brick-scale uvs
      const uv = g.attributes.uv, pos = g.attributes.position, nrm = g.attributes.normal;
      for (let k = 0; k < uv.count; k++) { const px = pos.getX(k) + x, py = pos.getY(k) + y, pz = pos.getZ(k) + z, nx = Math.abs(nrm.getX(k));
        uv.setXY(k, (nx > 0.5 ? pz : px) / 1.6, (Math.abs(nrm.getY(k)) > 0.5 ? pz : py) / 1.6); }
      g.translate(x, y, z); g.rotateY(yaw); g.translate(f.x, 0, f.z); arr.push(g);
    };
    for (const ts of D.towers) {
      const f = frame(ts, { ..._f }); const yaw = Math.atan2(f.tx, f.tz), y = f.y;
      const gy = Math.min(TH(f.x, f.z), y) - 4, L = 11, side = 1.9, Wt = W + 2 * side, H1 = 4.8, H2 = 8.2;
      for (const sd of [-1, 1]) box(parts, side, H2 - (gy - y), L, sd * (HW + side / 2), (gy + y + H2) / 2, 0, f, yaw);
      box(parts, W, H2 - H1, L, 0, y + (H1 + H2) / 2, 0, f, yaw);                               // lintel over the passage
      box(parts, Wt + 0.4, 0.35, L + 0.4, 0, y + H2 + 0.1, 0, f, yaw);                           // cornice
      for (let k = 0; k < 6; k++) for (const sd of [-1, 1]) {                                      // merlons round the top
        box(parts, 0.6, 1.0, 1.0, sd * (Wt / 2 - 0.1), y + H2 + 0.75, -L / 2 + 0.9 + k * (L - 1.8) / 5, f, yaw);
        box(parts, 1.0, 1.0, 0.6, -Wt / 2 + 0.9 + k * (Wt - 1.8) / 5, y + H2 + 0.75, sd * (L / 2 - 0.1), f, yaw);
      }
      // watch-room pavilion (grey tiled roof) on alternate towers
      if (Math.round(ts) % 2 === 0) {
        box(parts, 5.4, 2.6, 5.4, 0, y + H2 + 1.55, 0, f, yaw);
        const r = new THREE.ConeGeometry(5.0, 2.4, 4, 1); r.rotateY(Math.PI / 4); r.translate(0, y + H2 + 4.0, 0); r.rotateY(yaw); r.translate(f.x, 0, f.z); roofs.push(r);
      }
      // arched windows (dark recesses) on the outer faces + passage arch soffit
      for (const sd of [-1, 1]) for (const k of [-1, 0, 1]) box(darks, 0.12, 1.5, 1.0, sd * (Wt / 2 + 0.02), y + 3.0, k * 3.2, f, yaw);
      for (const e of [-1, 1]) box(darks, W - 1.0, 0.6, 0.12, 0, y + H1 + 0.1, e * (L / 2 + 0.01), f, yaw);
    }
    const add = (arr, mat, cast) => { if (!arr.length) return; const g = mergeGeometries(arr); g.computeVertexNormals(); const o = new THREE.Mesh(g, mat); o.castShadow = cast; o.receiveShadow = true; scene.add(o); };
    add(parts, m.brick, true); add(roofs, m.tile, !IS_MOBILE); add(darks, m.dark, false);
  }

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
    const m = mats();
    const n = IS_MOBILE ? 200 : 300, size = TG.size * 0.999, half = size / 2;
    const g = new THREE.PlaneGeometry(size, size, n - 1, n - 1); g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, cols = new Float32Array(pos.count * 4);
    const hash = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };
    const vn = (x, z) => { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
      return lerp(lerp(hash(ix, iz), hash(ix + 1, iz), sx), lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), sx), sz); };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = TH(x, z); pos.setY(i, y);
      const sl = Math.hypot(TH(x + 6, z) - TH(x - 6, z), TH(x, z + 6) - TH(x, z - 6)) / 12;
      const nA = vn(x / 220, z / 220), nB = vn(x / 70 + 9, z / 70), hN = (y - D.terrain.hmin) / 380;
      // autumn: warm (orange/red/gold) patches on the north slopes & high ground, green in the gullies
      const autumn0 = 0; const autumn = clamp(sstep(0.5, 0.8, nA * 0.7 + nB * 0.3 + hN * 0.12), 0, 1) * 0.85;
      let r = lerp(0.085, 0.17, autumn), gg = lerp(0.13, 0.11, autumn), b = lerp(0.045, 0.04, autumn);
      const rock = sstep(0.55, 0.9, sl);
      r = lerp(r, 0.33, rock); gg = lerp(gg, 0.31, rock); b = lerp(b, 0.28, rock);
      cols[i * 4] = r; cols[i * 4 + 1] = gg; cols[i * 4 + 2] = b; cols[i * 4 + 3] = autumn * 0.85 * (1 - rock);
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 4));
    g.computeVertexNormals();
    const o = new THREE.Mesh(g, m.ground); o.receiveShadow = true; scene.add(o);
    // forest: instanced deciduous canopies (autumn palette) + dark pines
    const N = IS_MOBILE ? 6500 : 9000;
    const lobes = [];
    for (const [x, y, z, r] of [[0, 1.05, 0, 0.78], [0.42, 0.85, 0.15, 0.55], [-0.38, 0.9, -0.2, 0.58], [0.05, 0.8, 0.45, 0.5], [-0.1, 1.45, -0.05, 0.5]]) {
      const l = new THREE.IcosahedronGeometry(r, IS_MOBILE ? 0 : 1); l.deleteAttribute('uv'); l.deleteAttribute('normal');
      const p = l.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 + 0.12 * Math.sin(p.getX(i) * 9 + p.getZ(i) * 7) * Math.cos(p.getY(i) * 8); p.setXYZ(i, p.getX(i) * k + x, p.getY(i) * k + y, p.getZ(i) * k + z); }
      lobes.push(l);
    }
    const cg = mergeVertices(mergeGeometries(lobes), 1e-3); cg.computeVertexNormals();
    const trunkG = new THREE.CylinderGeometry(0.05, 0.09, 0.9, 5, 1, true); trunkG.translate(0, 0.25, 0);
    const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1 }), N);
    const tm = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const inst = new THREE.InstancedMesh(cg, tm, N), mt = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    const pal = [0xb5541c, 0xc9862a, 0x8f3216, 0xd4a33a, 0x5b6b2a, 0x3e5524, 0x4a5e26, 0x9c6a24, 0x6e2a14, 0x33461e];
    let k = 0, tries = 0, cl = null;
    while (k < N && tries < N * 12) {
      tries++;
      if (!cl || cl.n <= 0) { const s = Math.random() * D.len, f = frame(s, { ..._f }), side = Math.random() < 0.5 ? -1 : 1, dd = 11 + Math.pow(Math.random(), 2.2) * 600;
        cl = { x: f.x + f.rx * side * dd, z: f.z + f.rz * side * dd, n: 4 + (Math.random() * 10) | 0, s, r: 6 + Math.random() * 14 }; }
      cl.n--; const s = cl.s, aa = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * cl.r;
      const x = cl.x + Math.cos(aa) * rr, z = cl.z + Math.sin(aa) * rr;
      if (Math.abs(x) > TG.half - 30 || Math.abs(z) > TG.half - 30) continue;
      const sz = 3.0 + Math.random() * 3.6;
      const pr = project(x, z, s); if (Math.abs(pr.lat) < HW + PAR + sz + 2) continue;
      if (Math.hypot(x - D.plaza[0], z - D.plaza[1]) < 48) continue;
      const y = TH(x, z), sl = Math.hypot(TH(x + 4, z) - TH(x - 4, z), TH(x, z + 4) - TH(x, z - 4)) / 8;
      if (sl > 0.9) continue;
      q.setFromAxisAngle(new V3(0, 1, 0), Math.random() * 6.28);
      mt.compose(new V3(x, y - sz * 0.35, z), q, new V3(sz, sz * (0.75 + Math.random() * 0.4), sz)); inst.setMatrixAt(k, mt); trunks.setMatrixAt(k, mt);
      c.setHex(pal[(Math.random() * pal.length) | 0]).multiplyScalar(0.42 + Math.random() * 0.25); inst.setColorAt(k, c); k++;
    }
    inst.count = k; inst.castShadow = false; inst.receiveShadow = true; scene.add(inst); trunks.count = k; scene.add(trunks);
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
    const sun = new V3(0.55, 0.42, 0.35).normalize();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(6000, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uSun: { value: sun } },
      vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
      fragmentShader: `uniform vec3 uSun; varying vec3 vD; void main(){ vec3 d = normalize(vD); float y = max(d.y, 0.0);
        vec3 hz = vec3(0.52, 0.55, 0.52), zen = vec3(0.32, 0.50, 0.78);
        vec3 c = mix(hz, zen, pow(y, 0.55));
        float sd = max(dot(d, uSun), 0.0); c += vec3(1.0, 0.85, 0.6) * (pow(sd, 8.0) * 0.35 + pow(sd, 400.0) * 3.0);
        if (d.y < 0.0) c = hz * 0.95;
        gl_FragColor = vec4(c, 1.0); }` }));
    sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky); SKY = sky;
    scene.fog = new THREE.FogExp2(0xbfc3bf, IS_MOBILE ? 0.00105 : 0.00095);
    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x6a5a40, 0.9));
    SUN = new THREE.DirectionalLight(0xffe2b8, 2.6); SUN.position.copy(sun).multiplyScalar(300);
    SUN.castShadow = true; SUN.shadow.mapSize.set(IS_MOBILE ? 1024 : 2048, IS_MOBILE ? 1024 : 2048);
    const sc = SUN.shadow.camera; sc.left = sc.bottom = -70; sc.right = sc.top = 70; sc.near = 10; sc.far = 700; SUN.shadow.bias = -0.0006; SUN.shadow.normalBias = 0.04;
    scene.add(SUN, SUN.target); SUNDIR = sun;
    if (C.envTex) scene.environment = C.envTex;
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
        buildSky(); buildTerrain(); buildWall(); buildTowers(); buildRamps(); buildPlaza();
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
  const FLY_T = 13, LAND_T = 5.5, WALK_MAX = 14;
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
        const u = clamp(t / (LAND_T - 0.6), 0, 1), e = u * u * (3 - 2 * u), ev = sstep(0.35, 1, u);
        tx = lerp(p0.x, p1.x, e); tz = lerp(p0.z, p1.z, e); ty = lerp(p0.y, p1.y + 0.0, ev);
        const f = frame(D.start, { ..._f }); yaw = lerp(yaw0, Math.atan2(f.tx, f.tz), e);
        H.root.rotation.set(0.12 * (1 - e) - 0.08 * Math.sin(Math.PI * e), yaw, 0);
        if (u >= 1) H.rpm = Math.max(0.15, H.rpm - dt * 0.4);
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
      const f = frame(D.start - 30, { ..._f }), pc = spotW(0, 55);
      camera.position.set(f.x - f.rx * 22, f.y + 26, f.z - f.rz * 22); camera.lookAt(pc.x, pc.y + 2, pc.z); camera.fov = 55;
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
    const gas = (keys.KeyW || keys.ArrowUp) ? 1 : 0, brake = (keys.KeyS || keys.ArrowDown) ? 1 : 0;
    const steer = ((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0);
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
    if (P.grounded) {
      if (gas) P.speed += 21 * dt * (1 - P.speed / 33);
      if (brake) P.speed -= 30 * dt;
      P.speed -= (0.012 * P.speed + (gas ? 0 : 1.2)) * dt;
      P.speed -= 9.8 * 0.75 * clamp(f0.g * Math.cos(P.yaw - yawOf(f0)), -0.4, 0.4) * dt;
    }
    P.speed = clamp(P.speed, 0, 34);
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
    if (pr.s < 1) { pr.s = 1; const f = frame(1, { ..._f }); P.x = f.x + f.rx * pr.lat; P.z = f.z + f.rz * pr.lat; P.speed = 0; }
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
    toast('RESPAWN · last checkpoint', 1200);
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
      if (R.finished) { R.spd = Math.max(0, R.spd - 10 * dt); }
      else {
        const gap = PL.s - R.s;   // rubber band
        let tgt = R.base + clamp(gap * 0.03, -3, 3) + Math.sin(raceT * 0.3 + i) * 0.8;
        const f = frame(R.s, { ..._f }); tgt -= clamp(f.g, 0, 0.3) * 6;
        // never too slow into a kicker
        for (const r of D.ramps) if (R.s > r[0] - 60 && R.s < r[1]) tgt = Math.max(tgt, 24);
        R.spd += clamp(tgt - R.spd, -14 * dt, 9 * dt);
      }
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
    const fov = 60 + clamp(P.speed / 34, 0, 1) * 10; camera.fov += (fov - camera.fov) * Math.min(1, 3 * dt); camera.updateProjectionMatrix();
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
      stepPlayer(dt); stepAI(dt); pushPlayer(dt); chaseCam(dt);
      if (phase === 'race' && RACERS[0].finished) { phase = 'done'; clock = 0; }
      if (phase === 'done' && (clock > 4 && (RACERS.every(R => R.finished) || clock > 25))) showResults();
    } else if (phase === 'results') { stepAI(dt); chaseCam(dt); }
    if (phase === 'race' || phase === 'done' || phase === 'countdown') hud();
    if (SKY) SKY.position.copy(camera.position);
    if (SUN && phase !== 'race' && phase !== 'done' && phase !== 'countdown') { SUN.target.position.copy(camera.position); SUN.position.copy(SUNDIR).multiplyScalar(300).add(SUN.target.position); }
  }
  return { start, update, scene, get active() { return active; }, get phase() { return phase; },
    dbg: { get D() { return D; }, PL, RACERS, frame, surf, project, respawn, finishOrder, toCountdown, get raceT() { return raceT; } } };
}
