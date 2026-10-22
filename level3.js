// LEVEL 3 — Tsunami. Tropical-coast beach race (wet/dry sand, dunes, palm groves, boardwalk, rocky headland,
// berm + driftwood jumps, nitro), warning signs (sea recedes, birds scatter, siren), a semi-scripted tsunami that
// sweeps the field (higher ground at impact = head start), then an open-ocean swim among debris with ten sharks
// (lock-on, lunge, dive/dodge, 3 bites = knocked out) to a rescue boat. Self-contained scene, procedural +
// Poly Haven CC0 textures, all audio synthesised (quiet, through the game's master bus / mute).
import { createNitroFx } from './nitro.js?v=1';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export function createLevel3(C) {
  const { THREE, renderer, camera, keys, IS_MOBILE, toast, mergeGeometries } = C;
  const V3 = THREE.Vector3, clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const $ = (id) => document.getElementById(id);
  const GRAV = 24;
  const scene = new THREE.Scene();
  let active = false, phase = 'off', clock = 0, built = false, raceT = 0, timeScale = 1;
  const NFX = createNitroFx(THREE, () => C.SFX);

  // ================================================================== geography (shared by JS physics + GLSL)
  // shoreline z = ZSH(x): sea is z < ZSH (south), land z > ZSH. d = z - ZSH(x) = distance inland.
  const HEAD_X = 1010, HEAD_W = 75, HEAD_B = 62;     // rocky headland bulging into the sea
  const HILL_X = 1640, HILL_D = 250, HILL_H = 40;     // the high ground the course climbs after the warning
  const GLSL_GEO = `
    float zsh(float x){ return 26.0*sin(x*0.0041) + 11.0*sin(x*0.0127+1.3) - ${HEAD_B.toFixed(1)}*exp(-((x-${HEAD_X.toFixed(1)})/${HEAD_W.toFixed(1)})*((x-${HEAD_X.toFixed(1)})/${HEAD_W.toFixed(1)})); }`;
  const zsh = (x) => 26 * Math.sin(x * 0.0041) + 11 * Math.sin(x * 0.0127 + 1.3) - HEAD_B * Math.exp(-(((x - HEAD_X) / HEAD_W) ** 2));
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  function vnoise(x, y) { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1); return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy; }
  const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1 + 5, y * 2.1 + 3) * 0.3 + vnoise(x * 4.3 + 9, y * 4.3 + 1) * 0.15;
  // terrain height (m, sea level 0)
  function H(x, z) {
    const d = z - zsh(x);
    let h;
    if (d < 0) h = d < -160 ? -8.0 + (d + 160) * 0.045 : d * 0.05;       // seabed: gentle shelf then drop-off
    else h = d * 0.032;                                                     // beach
    // dunes behind the beach (broken by the course where it runs through)
    const dn = sstep(70, 92, d) * (1 - sstep(118, 140, d));
    h += dn * (2.2 + 2.8 * fbm(x * 0.012, 3.1));
    // hinterland: rising jungle with low hills
    h += sstep(110, 220, d) * ((d - 110) * 0.05 + 7 * fbm(x * 0.004 + 2, d * 0.006));
    // the high ground
    h += HILL_H * Math.exp(-(((x - HILL_X) / 230) ** 2) - (((d - HILL_D) / 150) ** 2));
    // rocky headland hump
    const hx = Math.exp(-(((x - HEAD_X) / (HEAD_W * 0.95)) ** 2));
    h += hx * sstep(-HEAD_B - 10, -HEAD_B + 30, d) * (1 - sstep(60, 130, d)) * (4.2 + 2.5 * fbm(x * 0.05, z * 0.05));
    return h;
  }
  const headW = (x, d) => Math.exp(-(((x - HEAD_X) / (HEAD_W * 0.95)) ** 2)) * sstep(-HEAD_B - 10, -HEAD_B + 30, d) * (1 - sstep(60, 130, d));
  // terrain grid + heightmap texture (sampled by the water shader for depth / foam / shore attenuation)
  const TB = { x0: -500, x1: 2500, z0: -950, z1: 750 }, HMW = 512, HMH = 290;
  let HM = null;
  function buildHeightmap() {
    const data = new Uint16Array(HMW * HMH);
    for (let j = 0; j < HMH; j++) for (let i = 0; i < HMW; i++) {
      const x = TB.x0 + (TB.x1 - TB.x0) * i / (HMW - 1), z = TB.z0 + (TB.z1 - TB.z0) * j / (HMH - 1);
      data[j * HMW + i] = THREE.DataUtils.toHalfFloat(H(x, z));
    }
    HM = new THREE.DataTexture(data, HMW, HMH, THREE.RedFormat, THREE.HalfFloatType);
    HM.magFilter = HM.minFilter = THREE.LinearFilter; HM.needsUpdate = true;
  }

  // ================================================================== course (centre line in world space)
  // inland offset of the racing line from the shoreline: wet/dry boundary, boardwalk loop behind the dunes,
  // over the headland, then the climb to the high ground
  const BW0 = 560, BW1 = 830;
  function dcAt(x) {
    let d = 24;
    d += 70 * (sstep(BW0, BW0 + 55, x) - sstep(BW1 - 60, BW1, x));
    d += 215 * sstep(1150, 1720, x);
    return d;
  }
  const D = { ds: 2, x: [], z: [], len: 0, n: 0 };
  function buildCourse() {
    // sample by x, then re-sample uniformly by arc length
    const P = []; for (let x = 40; x <= 1900; x += 1) P.push([x, zsh(x) + dcAt(x)]);
    const acc = [0]; for (let i = 1; i < P.length; i++) acc.push(acc[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const L = acc[acc.length - 1]; let k = 0;
    for (let s = 0; s <= L; s += D.ds) { while (k < acc.length - 2 && acc[k + 1] < s) k++; const a = (s - acc[k]) / (acc[k + 1] - acc[k]);
      D.x.push(P[k][0] + (P[k + 1][0] - P[k][0]) * a); D.z.push(P[k][1] + (P[k + 1][1] - P[k][1]) * a); }
    D.n = D.x.length; D.len = (D.n - 1) * D.ds;
    D.start = 30; D.finish = D.len - 40;
    D.waveS = Math.round(D.len * 0.6);          // tsunami trigger (player progress)
    D.recedeS = Math.round(D.len * 0.34);       // sea starts pulling back
    D.birdS = Math.round(D.len * 0.42); D.sirenS = Math.round(D.len * 0.47);
    // boardwalk stretch in s
    D.bw = [sOfX(BW0 + 70), sOfX(BW1 - 70)];
  }
  function sOfX(x) { let best = 1e9, bi = 0; for (let i = 0; i < D.n; i++) { const d = Math.abs(D.x[i] - x); if (d < best) { best = d; bi = i; } } return bi * D.ds; }
  const _f = { x: 0, z: 0, tx: 1, tz: 0, rx: 0, rz: 1 };
  function frame(s, o = _f) {
    const f = clamp(s / D.ds, 0, D.n - 1.001), i = f | 0, a = f - i;
    o.x = D.x[i] + (D.x[i + 1] - D.x[i]) * a; o.z = D.z[i] + (D.z[i + 1] - D.z[i]) * a;
    const i0 = Math.max(0, i - 2), i1 = Math.min(D.n - 1, i + 3);
    let tx = D.x[i1] - D.x[i0], tz = D.z[i1] - D.z[i0]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    // right-hand side points inland (+z-ish when running +x): r = (-tz, tx)
    o.tx = tx; o.tz = tz; o.rx = -tz; o.rz = tx; return o;
  }
  function project(x, z, hint) {
    let best = 1e9, bi = 0; const i0 = Math.max(0, Math.round(hint / D.ds) - 16), i1 = Math.min(D.n - 2, Math.round(hint / D.ds) + 16);
    for (let i = i0; i <= i1; i++) { const d = (D.x[i] - x) ** 2 + (D.z[i] - z) ** 2; if (d < best) { best = d; bi = i; } }
    let s = bi * D.ds; for (let k = 0; k < 2; k++) { const f = frame(s); s += (x - f.x) * f.tx + (z - f.z) * f.tz; }
    s = clamp(s, 0, D.len - 0.1); const f = frame(s);
    return { s, lat: (x - f.x) * f.rx + (z - f.z) * f.rz };
  }
  const yawOf = (f) => Math.atan2(f.tx, -f.tz);
  // lateral room: open beach is wide; the boardwalk is a 9 m deck
  const onBW = (s) => s > D.bw[0] - 20 && s < D.bw[1] + 20;
  // lateral room varies smoothly (no step that would teleport a rider): wide open beach, funnel onto the 9 m
  // boardwalk deck, narrower trail up the high ground
  function latK(s) { const w = sstep(D.bw[0] - 110, D.bw[0] - 18, s) * (1 - sstep(D.bw[1] + 18, D.bw[1] + 110, s)), c = sstep(D.waveS + 40, D.waveS + 160, s); return [w, c]; }
  const latMin = (s) => { const [w, c] = latK(s); return lerp(lerp(-30, -14, c), -4.2, w); };
  const latMax = (s) => { const [w, c] = latK(s); return lerp(lerp(22, 14, c), 4.2, w); };
  // boardwalk deck height above the sand (ramps on/off)
  const BWH = 1.4;
  function bwH(s) { return BWH * (sstep(D.bw[0] - 22, D.bw[0] + 2, s) - sstep(D.bw[1] - 2, D.bw[1] + 22, s)); }
  // boardwalk deck: smoothed line over the dunes (precomputed per course sample)
  function buildDeck() {
    D.deck = new Float32Array(D.n);
    const raw = new Float32Array(D.n);
    for (let i = 0; i < D.n; i++) { const f = frame(i * D.ds, { ..._f }); let m = -1e9; for (let l = -5; l <= 5; l += 2.5) m = Math.max(m, H(f.x + f.rx * l, f.z + f.rz * l)); raw[i] = m + 0.9; }
    for (let i = 0; i < D.n; i++) { let s = 0, w = 0; for (let k = -12; k <= 12; k++) { const j = clamp(i + k, 0, D.n - 1); const ww = 13 - Math.abs(k); s += raw[j] * ww; w += ww; } D.deck[i] = s / w; }
  }
  const deckAt = (s) => { const f = clamp(s / D.ds, 0, D.n - 1.001), i = f | 0, a = f - i; return D.deck[i] + (D.deck[i + 1] - D.deck[i]) * a; };
  // jumps: sand berms (kickers) and driftwood logs across the beach, plus nitro pads on the firm wet sand
  function buildJumpData() {
    D.ramps = [];
    const at = (fr, len, h, kind) => { const s = Math.round(D.len * fr); D.ramps.push({ s0: s, s1: s + len, h, kind }); };
    at(0.085, 7, 1.35, 'berm'); at(0.16, 6.5, 1.1, 'log'); at(0.235, 8, 1.6, 'berm'); at(0.45, 7, 1.3, 'berm'); at(0.52, 6.5, 1.15, 'log');
    // drop the ones that landed on the boardwalk
    D.ramps = D.ramps.filter(r => !(r.s1 > D.bw[0] - 30 && r.s0 < D.bw[1] + 30));
    D.pads = [Math.round(D.len * 0.12), Math.round(D.len * 0.3), Math.round(D.len * 0.49), Math.round(D.len * 0.63)].map((s, i) => ({ s, lat: [-15, -12, -16, -6][i], hw: 2.4 }));
  }
  function rampH(s) { for (const r of D.ramps) if (s >= r.s0 && s <= r.s1) return r.h * (s - r.s0) / (r.s1 - r.s0); return 0; }
  function rampSlope(s) { for (const r of D.ramps) if (s >= r.s0 && s <= r.s1) return r.h / (r.s1 - r.s0); return 0; }
  // ride surface height at a world point on the course (s known)
  function ground(x, z, s) {
    const g = H(x, z) + rampH(s);
    const w = bwH(s) / BWH; return w > 0 ? lerp(g, deckAt(s), w) : g;
  }

  // ================================================================== textures / materials
  const TL = new THREE.TextureLoader();
  const aniso = Math.min(IS_MOBILE ? 4 : 8, renderer.capabilities.getMaxAnisotropy());
  const TEXP = [];
  const tload = (url) => { let done; TEXP.push(new Promise(r => { done = r; })); return TL.load(url, () => done(), undefined, () => done()); };
  function tx(path, srgb, rep) { const t = tload(path); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; if (rep) t.repeat.set(rep, rep); return t; }
  let M = null;
  const U = { uTime: { value: 0 }, uRecede: { value: 0 }, uFront: { value: -3000 }, uWaveH: { value: 0 }, uSurge: { value: 0 }, uSwell: { value: 0.55 }, uShore: { value: 1 }, uBore: { value: 0 } };
  function mats() {
    if (M) return M;
    const A = './assets/l3/', A2 = './assets/l2/';
    M = {
      tWet: tx(A + 'coast_sand_01_Diffuse.jpg', true), tDry: tx(A + 'aerial_beach_01_Diffuse.jpg', true), tRock: tx(A + 'coast_land_rocks_01_Diffuse.jpg', true),
      tGrass: tx(A2 + 'aerial_grass_rock_Diffuse.jpg', true), nSand: tx(A + 'coast_sand_01_nor_gl.jpg', false), nRock: tx(A + 'coast_land_rocks_01_nor_gl.jpg', false),
      plank: tx(A + 'brown_planks_03_Diffuse.jpg', true), plankN: tx(A + 'brown_planks_03_nor_gl.jpg', false),
      bark: tx(A + 'palm_bark_Diffuse.jpg', true), barkN: tx(A + 'palm_bark_nor_gl.jpg', false),
    };
    M.rock = new THREE.MeshStandardMaterial({ map: M.tRock, normalMap: M.nRock, roughness: 0.9, color: 0x9a9690 });
    M.wood = new THREE.MeshStandardMaterial({ map: M.plank, normalMap: M.plankN, roughness: 0.85 });
    M.drift = new THREE.MeshStandardMaterial({ map: M.bark, normalMap: M.barkN, roughness: 0.95, color: 0xc8c0b4 });
    return M;
  }
  // ================================================================== terrain
  let TERR = null;
  function buildTerrain() {
    const m = mats();
    const nx = IS_MOBILE ? 300 : 420, nz = IS_MOBILE ? 170 : 240;
    const g = new THREE.PlaneGeometry(TB.x1 - TB.x0, TB.z1 - TB.z0, nx, nz); g.rotateX(-Math.PI / 2);
    g.translate((TB.x0 + TB.x1) / 2, 0, (TB.z0 + TB.z1) / 2);
    const p = g.attributes.position, uv = g.attributes.uv;
    const aC = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, H(x, z)); uv.setXY(i, x / 9, z / 9); const d = z - zsh(x); aC[i] = (d > 120 && d < 600 && x > TB.x0 + 250 && offCourse(x, z, 7)) ? 1 : 0; }
    g.setAttribute('aC', new THREE.BufferAttribute(aC, 1));
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: m.tDry, normalMap: m.nSand, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 1 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { tWet: { value: m.tWet }, tRock: { value: m.tRock }, tGrass: { value: m.tGrass }, uRecede: U.uRecede, uSurge: U.uSurge });
      sh.vertexShader = 'attribute float aC; varying float vC; varying vec3 vWp; varying vec3 vWn;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed,1.0)).xyz; vWn = normalize(mat3(modelMatrix) * objectNormal); vC = aC;');
      sh.fragmentShader = 'uniform sampler2D tWet, tRock, tGrass; uniform float uRecede, uSurge; varying float vC; varying vec3 vWp; varying vec3 vWn;\n' + GLSL_GEO + `
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f); return mix(mix(h21(i), h21(i+vec2(1,0)), u.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), u.x), u.y); }
        float wetK; float rockK;
      ` + sh.fragmentShader.replace('#include <map_fragment>', `
        vec2 wuv = vWp.xz / 9.0;
        float d = vWp.z - zsh(vWp.x);
        float n1 = vn(vWp.xz * 0.045), n2 = vn(vWp.xz * 0.21 + 7.0);
        // Makena golden-tan sand: keep the texture's grain, re-tint it warm and saturated
        vec3 dt0 = texture2D(map, wuv * 0.8).rgb; float dl0 = dot(dt0, vec3(0.3, 0.5, 0.2));
        vec3 dry = vec3(0.43, 0.27, 0.095) * (0.55 + 0.45 * dl0 / 0.245) * mix(0.94, 1.05, vn(vWp.xz * 0.02));
        vec3 wt0 = texture2D(tWet, wuv * 1.1).rgb; float wl0 = dot(wt0, vec3(0.3, 0.5, 0.2));
        vec3 wet = vec3(0.16, 0.095, 0.032) * (0.6 + 0.4 * wl0 / 0.19);
        vec3 rock = texture2D(tRock, wuv * 0.6).rgb * vec3(0.62, 0.62, 0.64);
        vec3 g0 = texture2D(tGrass, wuv * 0.45).rgb; float gl0 = dot(g0, vec3(0.3, 0.5, 0.2));
        vec3 grass = vec3(0.075, 0.14, 0.035) * (0.5 + 0.5 * gl0 / 0.16) * mix(0.75, 1.15, n1);
        // further inland the ground is under the kiawe forest: dark, dense canopy colour for the distance
        vec3 canopy = mix(vec3(0.025, 0.07, 0.02), vec3(0.06, 0.13, 0.035), vn(vWp.xz * 0.08) * 0.6 + vn(vWp.xz * 0.3) * 0.4);
        // wet below the swash line (and on any seabed the sea has exposed), drying out up the beach
        wetK = 1.0 - smoothstep(0.35, 1.1 + n1 * 0.5, vWp.y);
        vec3 sand = mix(dry * mix(0.92, 1.06, n2), wet, wetK);
        sand = mix(sand, vec3(0.30, 0.25, 0.15) * (0.7 + 0.3 * n2), (1.0 - smoothstep(-2.0, -0.4, vWp.y)) * 0.8);     // seabed: clean pale sand under clear water
        sand = mix(sand, sand * vec3(0.6, 0.66, 0.62), (1.0 - smoothstep(-14.0, -6.0, vWp.y)) * 0.6);
        float slope = 1.0 - vWn.y;
        rockK = clamp(smoothstep(0.18, 0.42, slope + n1 * 0.12) + smoothstep(0.4, 0.75, ${HEAD_B.toFixed(1)} > 0.0 ? exp(-((vWp.x-${HEAD_X.toFixed(1)})/${(HEAD_W * 0.85).toFixed(1)})*((vWp.x-${HEAD_X.toFixed(1)})/${(HEAD_W * 0.85).toFixed(1)})) * (1.0 - smoothstep(30.0, 90.0, d)) * (0.6 + n1 * 0.6) : 0.0), 0.0, 1.0);
        float grassK = smoothstep(105.0, 150.0, d + n1 * 40.0) * (1.0 - rockK * 0.6);
        vec3 col = mix(sand, grass, grassK);
        col = mix(col, canopy, smoothstep(0.35, 0.9, vC + (n1 - 0.5) * 0.3) * (1.0 - rockK));
        col = mix(col, rock, rockK);
        diffuseColor.rgb = col;
      `).replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(0.95, 0.68, wetK * (1.0 - smoothstep(0.5, 1.2, vWp.y)) * step(-0.4, vWp.y)) * mix(1.0, 0.9, n2); roughnessFactor = mix(roughnessFactor, 0.88, rockK);`);
    };
    mat.customProgramCacheKey = () => 'l3terr';
    TERR = new THREE.Mesh(g, mat); TERR.receiveShadow = true; scene.add(TERR);
  }
  // ================================================================== sky, light, fog
  let SKY = null, SUN = null; const SUNDIR = new V3(0.30, 0.86, -0.42).normalize();   // bright midday
  const SKYGLSL = `
    vec3 skyCol(vec3 d, vec3 sunD){
      float y = d.y, mu = dot(d, sunD);
      float hz = exp(-max(y, 0.0) * 6.0);
      vec3 zen = vec3(0.003, 0.03, 0.46), hor = vec3(0.30, 0.50, 0.88);
      vec3 c = mix(zen, hor, hz);
      float g = 0.78, mie = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.010;
      c += vec3(1.0, 0.92, 0.75) * mie;
      if (y < 0.0) c = mix(hor, vec3(0.10, 0.28, 0.52), clamp(-y * 3.0, 0.0, 1.0));
      return c;
    }`;
  function buildSky() {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(7000, 48, 24), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uSun: { value: SUNDIR }, uTime: U.uTime },
      vertexShader: 'varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
      fragmentShader: `uniform vec3 uSun; uniform float uTime; varying vec3 vD;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f); return mix(mix(h21(i), h21(i+vec2(1,0)), u.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), u.x), u.y); }
        ${SKYGLSL}
        void main(){
          vec3 d = normalize(vD); vec3 c = skyCol(d, uSun);
          c += vec3(1.0, 0.96, 0.88) * smoothstep(0.9994, 0.9998, dot(d, uSun)) * 8.0;
          // fair-weather cumulus
          if (d.y > 0.0) { vec2 p = d.xz / (d.y + 0.10) * 0.55 + vec2(uTime * 0.002, 0.0);
            #define CN(q) (vn(q) * 0.46 + vn(q * 2.1 + 3.1) * 0.26 + vn(q * 4.7 + 7.7) * 0.16 + vn(q * 9.8 + 1.3) * 0.12)
            float n = CN(p);
            float cov = smoothstep(0.0, 0.06, d.y) * (1.0 - smoothstep(0.45, 0.8, d.y)) * (0.75 + 0.25 * smoothstep(-0.3, 0.6, d.z));
            float cl = smoothstep(0.52, 0.6, n) * cov * smoothstep(0.08, 0.25, d.y);
            vec2 sd = normalize(uSun.xz + 1e-4) * 0.05;
            float ns = CN(p + sd);                        // denser toward the sun = this side is in shadow
            float lit = clamp(0.55 + (n - ns) * 7.0, 0.0, 1.0);
            float core = smoothstep(0.62, 0.85, n);
            vec3 cc = mix(vec3(0.46, 0.52, 0.64), vec3(1.05, 1.04, 1.02), smoothstep(0.15, 0.85, lit)) * mix(1.0, 0.84, core * (1.0 - lit));
            cc *= 0.86 + 0.22 * vn(p * 16.0 + 2.0) * (0.5 + 0.5 * vn(p * 33.0));   // cauliflower texture
            cc += vec3(1.0, 0.97, 0.9) * pow(1.0 - smoothstep(0.5, 0.58, n), 2.0) * 0.25 * cl;   // bright silver lining
            c = mix(c, cc, cl * 0.75); }
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` }));
    sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky); SKY = sky;
    scene.fog = new THREE.FogExp2(0x9dbbe0, 0.00028);
    scene.add(new THREE.HemisphereLight(0xbcd8ff, 0xc9a86c, 0.9));
    SUN = new THREE.DirectionalLight(0xfff4e2, 3.3); SUN.position.copy(SUNDIR).multiplyScalar(300);
    SUN.castShadow = true; SUN.shadow.mapSize.set(IS_MOBILE ? 2048 : 4096, IS_MOBILE ? 2048 : 4096);
    const sc = SUN.shadow.camera; sc.left = sc.bottom = -70; sc.right = sc.top = 70; sc.near = 10; sc.far = 800; SUN.shadow.bias = -0.0005; SUN.shadow.normalBias = 0.05;
    scene.add(SUN, SUN.target);
    if (C.envTex) { scene.environment = C.envTex; scene.environmentIntensity = 0.55; }
  }
  // ================================================================== MX-style sand track (Level 1 look, Makena sand)
  // A ribbon over the beach following the course: packed racing line with wandering tyre ruts, churned loose
  // sand toward the edges, windrow berms of ploughed sand along both borders, marker stakes. Visual only:
  // it sits on the same ground() the riders use, the windrows lie outside the ride limits.
  let TRACK = null;
  function buildTrack() {
    const m = mats(), EW = 4.5, NA = IS_MOBILE ? 22 : 30, pos = [], uvs = [], trk = [], idx = [], hole = [];
    const f = { ..._f }, rows = D.n;
    for (let r = 0; r < rows; r++) {
      const s = r * D.ds; frame(s, f); const lo = latMin(s) - 0.5, hi = latMax(s) + 0.5, bw = bwH(s) > 0.02;
      hole.push(bw);
      for (let k = 0; k <= NA; k++) {
        const u = k / NA, l = lerp(lo - EW, hi + EW, u), x = f.x + f.rx * l, z = f.z + f.rz * l;
        const out = l < lo ? (lo - l) / EW : l > hi ? (l - hi) / EW : 0;
        const wind = out > 0 ? Math.sin(Math.min(1, out * 1.25) * Math.PI) * 1.1 * (0.8 + 0.2 * Math.sin(s * 0.11 + k)) : 0;
        const y = (out > 0 ? H(x, z) : ground(x, z, s)) + 0.07 + wind;
        pos.push(x, y, z); uvs.push(x / 9, z / 9); trk.push(l - (lo + hi) / 2, s, out, (hi - lo) / 2);
      }
    }
    for (let r = 0; r < rows - 1; r++) { if (hole[r] || hole[r + 1]) continue; for (let k = 0; k < NA; k++) { const a = r * (NA + 1) + k, b = a + 1, c = a + NA + 1, d = c + 1; idx.push(a, c, b, b, c, d); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('aTrk', new THREE.Float32BufferAttribute(trk, 4)); g.setIndex(idx); g.computeVertexNormals();
    { const n = g.attributes.normal; let flip = 0; for (let i = 0; i < Math.min(n.count, 200); i++) flip += n.getY(i); if (flip < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); } }
    const mat = new THREE.MeshStandardMaterial({ map: m.tDry, normalMap: m.nSand, normalScale: new THREE.Vector2(1, 1), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { tWet: { value: m.tWet } });
      sh.vertexShader = 'attribute vec4 aTrk; varying vec4 vTrk; varying vec3 vWp2;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTrk = aTrk; vWp2 = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = 'uniform sampler2D tWet; varying vec4 vTrk; varying vec3 vWp2; vec3 gN;\n' + `
        float th21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float tvn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f); return mix(mix(th21(i), th21(i+vec2(1,0)), u.x), mix(th21(i+vec2(0,1)), th21(i+vec2(1,1)), u.x), u.y); }
      ` + sh.fragmentShader.replace('#include <map_fragment>', `
        float lat = vTrk.x, s = vTrk.y, otk = vTrk.z, hw = vTrk.w;
        vec2 wuv = vWp2.xz / 9.0;
        float n1 = tvn(vWp2.xz * 0.045), n2 = tvn(vWp2.xz * 0.21 + 7.0), mid = tvn(vWp2.xz * 0.15 + 3.0) - 0.5;
        vec3 dt0 = texture2D(map, wuv * 0.8).rgb; float dl0 = dot(dt0, vec3(0.3, 0.5, 0.2));
        vec3 dry = vec3(0.43, 0.27, 0.095) * (0.55 + 0.45 * dl0 / 0.245);
        vec3 wt0 = texture2D(tWet, wuv * 1.6).rgb; float wl0 = dot(wt0, vec3(0.3, 0.5, 0.2));
        float wetK = 1.0 - smoothstep(0.35, 1.3 + n1 * 0.5, vWp2.y);
        // pkc racing line: rider-compacted, slightly damp and darker; lse churned sand toward the borders
        vec3 pkc = mix(dry * 0.62, vec3(0.20, 0.12, 0.045) * (0.6 + 0.4 * wl0 / 0.19), 0.45 + 0.45 * wetK);
        vec3 lse = dry * vec3(1.06, 1.04, 1.0) * mix(0.9, 1.12, n2);
        float lk = smoothstep(hw * 0.45, hw * 0.85, abs(lat) + mid * 5.0);
        lk = max(lk, step(0.001, otk));
        // tyre ruts wandering along the racing line
        float rutH = 0.0, rutD = 0.0, lipC = 0.0;
        for (int i = 0; i < 9; i++) {
          float fi = float(i);
          float c = (-0.62 + fi * 0.155) * hw + sin(s * 0.023 + fi * 1.9) * 1.4 + sin(s * 0.071 + fi * 4.1) * 0.4;
          float wd = 0.18 + 0.06 * sin(s * 0.05 + fi * 1.3);
          float dep = 0.05 * (0.5 + 0.5 * sin(s * 0.013 + fi * 2.3));
          float dd = (lat - c) / wd, gg = exp(-dd * dd);
          rutH -= dep * gg; rutD += dep * gg * 2.0 * dd / wd;
          float e = abs(dd) - 1.7; lipC += exp(-e * e * 2.5) * dep * 14.0;
        }
        float rk = 1.0 - lk * 0.75; rutH *= rk; rutD *= rk; lipC *= rk;
        float rutG = clamp(-rutH / 0.05, 0.0, 1.0);
        // cross-hatched knobby tread prints in the rut floors
        float tread = step(0.55, fract(s * 2.6 + lat * 0.4)) * rutG;
        vec3 col = mix(pkc, lse, lk);
        col *= 0.82 + 0.36 * n1;
        col *= 1.0 - 0.32 * rutG + 0.06 * tread;
        col = mix(col, col * 0.62, rutG * 0.4 * wetK);
        col *= 1.0 + 0.16 * clamp(lipC, 0.0, 1.0);
        // borders: ploughed windrow, bright dry sand on top with a darker trodden toe line at the track edge
        float toe = exp(-pow((otk - 0.06) / 0.05, 2.0)) * step(0.0001, otk);
        col = mix(col, dry * 1.12 * mix(0.88, 1.1, n2), smoothstep(0.1, 0.5, otk) * (1.0 - smoothstep(0.85, 1.0, otk) * 0.5));
        col *= 1.0 - 0.25 * toe;
        // blend the far side of the windrow back into the beach
        diffuseColor.rgb = col;
        diffuseColor.a = 1.0;
        gN = vec3(-rutD * vec2(1.0, 0.0) * 1.2, 1.0);
      `).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(normal + tbn * vec3(gN.xy, 0.0));`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.97, 0.78, (1.0 - lk) * (0.4 + 0.6 * wetK));');
    };
    mat.customProgramCacheKey = () => 'l3track';
    // chunked for frustum culling
    TRACK = new THREE.Group(); const RPC = 120, nc = NA + 1, A = g.attributes;
    for (let r0 = 0; r0 < rows - 1; r0 += RPC) {
      const r1 = Math.min(rows - 1, r0 + RPC), v0 = r0 * nc, v1 = (r1 + 1) * nc, cg = new THREE.BufferGeometry();
      for (const [name, at] of Object.entries(A)) cg.setAttribute(name, new THREE.BufferAttribute(at.array.slice(v0 * at.itemSize, v1 * at.itemSize), at.itemSize));
      const ci = []; for (let i = 0; i < idx.length; i += 3) { const a = idx[i]; if (a >= v0 && a < r1 * nc) ci.push(idx[i] - v0, idx[i + 1] - v0, idx[i + 2] - v0); }
      if (!ci.length) continue; cg.setIndex(ci); cg.computeBoundingSphere();
      const ms = new THREE.Mesh(cg, mat); ms.receiveShadow = true; TRACK.add(ms);
    }
    scene.add(TRACK);
    // orange / white marker stakes along both borders
    const sg = new THREE.CylinderGeometry(0.05, 0.06, 1.2, 6); sg.translate(0, 0.6, 0);
    const smat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const pts = []; for (let s = 10; s < D.len - 5; s += 14) { if (bwH(s) > 0.02) continue; frame(s, f); for (const l of [latMin(s) - 1.0, latMax(s) + 1.0]) { const x = f.x + f.rx * l, z = f.z + f.rz * l; pts.push([x, H(x, z) + 0.05, z]); } }
    const im = new THREE.InstancedMesh(sg, smat, pts.length), mm = new THREE.Matrix4();
    pts.forEach((p, i) => { mm.makeTranslation(p[0], p[1], p[2]); im.setMatrixAt(i, mm); im.setColorAt(i, new THREE.Color((i >> 1) % 2 ? 0xffffff : 0xff6a12)); });
    im.castShadow = true; scene.add(im); TRACK.userData.stakes = im;
  }
  // ================================================================== ocean
  // One camera-following radial grid (dense under the camera), height = swell (depth-attenuated) + sea-level
  // drawdown before the tsunami + the tsunami crest / surge. Depth comes from the terrain heightmap, so the
  // swash line, foam, turquoise shallows and the exposed seabed all line up with the beach geometry.
  const WATER_GLSL = GLSL_GEO + `
    uniform float uTime, uRecede, uFront, uWaveH, uSurge, uSwell, uShore, uBore;
    uniform sampler2D tH; uniform vec4 uHB;
    float terrH(vec2 p){ vec2 uv = (p - uHB.xy) * uHB.zw; if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -60.0; return texture2D(tH, uv).r; }
    float tsuK(float dd){ return dd > 0.0 ? exp(-dd * dd / 40.0) : exp(-dd * dd / 6000.0); }
    float seaLevel(vec2 p, out float crest){
      float d = p.y - zsh(p.x);
      float lv = -uRecede * (1.0 - smoothstep(-950.0, -380.0, d));
      float dd = d - uFront;
      // on land the bore floods whatever it reaches: level never drops below terrain + uBore behind the front
      float tb = uBore > 0.0 ? terrH(p) + uBore : 0.0;
      crest = max(min(uWaveH, 40.0), tb) * tsuK(dd) * 0.8;   // the dedicated face mesh (buildWave) carries the real crest
      float surge = max(uSurge, tb * step(0.01, uSurge)) * (1.0 - smoothstep(-110.0, 12.0, dd));
      return lv + max(crest, surge);
    }
    float swell(vec2 p, float att){
      float t = uTime, h = 0.0;
      h += 0.55 * sin(dot(p, vec2(0.018, 0.100)) + t * 0.95);
      h += 0.34 * sin(dot(p, vec2(-0.060, 0.150)) + t * 1.25 + 1.7);
      h += 0.22 * sin(dot(p, vec2(0.210, 0.170)) + t * 1.7 + 4.1);
      h += 0.09 * sin(dot(p, vec2(-0.37, 0.52)) + t * 2.6 + 0.3);
      h += 0.05 * sin(dot(p, vec2(0.71, -0.33)) + t * 3.4 + 2.2);
      return h * uSwell * att;
    }
    float waterH(vec2 p, out float depth, out float crest, out float brk){
      float base = seaLevel(p, crest);
      float th = terrH(p);
      float dep0 = base - th;
      float att = smoothstep(0.2, 7.0, dep0);
      // little spilling breakers rolling up the beach
      float d = p.y - zsh(p.x);
      brk = uShore * smoothstep(0.15, 1.2, dep0) * (1.0 - smoothstep(2.5, 9.0, dep0));
      float sb = 0.32 * pow(0.5 + 0.5 * sin(d * 0.105 - uTime * 0.9), 6.0) * brk;
      float h = base + swell(p, att) + sb;
      depth = h - th;
      return h;
    }`;
  let WATER = null;
  function buildWater() {
    const NA = IS_MOBILE ? 128 : 176, NR = IS_MOBILE ? 96 : 116, pos = [], idx = [];
    for (let i = 0; i <= NR; i++) { const r = i === 0 ? 0 : 2.0 * (Math.pow(1.045, i) - 1) / 0.045;
      for (let j = 0; j < NA; j++) { const a = j / NA * Math.PI * 2; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); } }
    for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) { const a = i * NA + j, b = i * NA + (j + 1) % NA, c = (i + 1) * NA + j, d = (i + 1) * NA + (j + 1) % NA; idx.push(a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const uni = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    Object.assign(uni, U, { tH: { value: HM }, uHB: { value: new THREE.Vector4(TB.x0, TB.z0, 1 / (TB.x1 - TB.x0), 1 / (TB.z1 - TB.z0)) }, uSun: { value: SUNDIR } });
    const mat = new THREE.ShaderMaterial({ uniforms: uni, transparent: true, fog: true, depthWrite: true,
      vertexShader: WATER_GLSL + `
        varying vec3 vWp; varying vec3 vN; varying float vDepth, vCrest, vBrk, vSw;
        #include <fog_pars_vertex>
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float dep, cr, bk, d1, c1, b1, d2, c2, b2;
          float h = waterH(wp.xz, dep, cr, bk);
          float e = max(1.2, length(wp.xz - cameraPosition.xz) * 0.012);
          float hx = waterH(wp.xz + vec2(e, 0.0), d1, c1, b1), hz = waterH(wp.xz + vec2(0.0, e), d2, c2, b2);
          vN = normalize(vec3(h - hx, e, h - hz));
          wp.y = h; vWp = wp.xyz; vDepth = dep; vCrest = cr; vBrk = bk; vSw = h;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform float uTime, uWaveH, uSurge; uniform vec3 uSun;
        ${GLSL_GEO}
        varying vec3 vWp; varying vec3 vN; varying float vDepth, vCrest, vBrk, vSw;
        #include <fog_pars_fragment>
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f); return mix(mix(h21(i), h21(i+vec2(1,0)), u.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), u.x), u.y); }
        ${SKYGLSL}
        void main(){
          if (vDepth < -0.05) discard;
          float dist = length(cameraPosition - vWp);
          // ripples: two scrolling noise octaves as a normal perturbation (faded with distance)
          vec2 q = vWp.xz;
          float r1 = vn(q * 0.35 + vec2(uTime * 0.25, uTime * 0.18)), r2 = vn(q * 0.9 - vec2(uTime * 0.31, -uTime * 0.22));
          float r1x = vn(q * 0.35 + vec2(0.7, 0.0) + vec2(uTime * 0.25, uTime * 0.18)), r2x = vn(q * 0.9 + vec2(0.0, 0.5) - vec2(uTime * 0.31, -uTime * 0.22));
          float fade = 1.0 - smoothstep(60.0, 400.0, dist);
          vec3 N = normalize(vN + vec3((r1x - r1) * 0.9 + (r2x - r2) * 0.5, 0.0, (r1 - r2x) * 0.6 + (r2 - r1x) * 0.4) * fade * 0.32);
          vec3 V = normalize(cameraPosition - vWp);
          float NV = max(dot(N, V), 0.0);
          float F = 0.02 + 0.98 * pow(1.0 - NV, 5.0);
          vec3 R = reflect(-V, N); R.y = abs(R.y);
          vec3 refl = skyCol(R, uSun);
          float spec = pow(max(dot(R, uSun), 0.0), 220.0) * 5.0 + pow(max(dot(R, uSun), 0.0), 18.0) * 0.12;
          // Maui palette: bright aqua over sand in the shallows -> turquoise -> deep sapphire offshore
          vec3 deep = vec3(0.002, 0.036, 0.15), mid = vec3(0.003, 0.15, 0.16), shallow = vec3(0.035, 0.40, 0.31);
          vec3 body = mix(shallow, mid, smoothstep(0.5, 3.0, vDepth)); body = mix(body, deep, smoothstep(4.0, 16.0, vDepth));
          // sun through clear shallow water: caustic shimmer over the sandy bottom
          float cau = vn(q * 0.8 + vec2(uTime * 0.6, uTime * 0.4)) * vn(q * 1.3 - vec2(uTime * 0.5, -uTime * 0.3));
          body += vec3(0.10, 0.16, 0.12) * smoothstep(0.18, 0.45, cau) * (1.0 - smoothstep(0.5, 4.0, vDepth)) * fade;
          body *= 0.85 + 0.35 * clamp(vSw * 0.6, -0.5, 1.0);
          // the tsunami is heavy with sand: turbid, darker green-brown
          float turb = clamp(vCrest / max(min(uWaveH, 40.0), 0.01), 0.0, 1.0) * step(0.01, uWaveH) + clamp(uSurge * 0.06, 0.0, 0.7);
          body = mix(body, vec3(0.03, 0.20, 0.24), clamp(turb, 0.0, 0.8));
          vec3 col = mix(body, refl * vec3(0.55, 0.7, 0.95), F * mix(0.42, 0.34, smoothstep(4.0, 15.0, vDepth))) + vec3(1.0, 0.95, 0.85) * spec;
          // foam: swash line, spilling breakers, tsunami face + churn
          float fn = vn(q * 0.6 + uTime * 0.4) * 0.6 + vn(q * 2.3 - uTime * 0.7) * 0.4;
          // a thin swash line + a couple of clean shore-break lines rolling in (no busy streaks)
          float shore = (1.0 - smoothstep(0.0, 0.06 + fn * 0.1, vDepth)) * (0.7 + 0.3 * fn);
          float dl = vWp.z - zsh(vWp.x);
          float band = pow(max(0.0, sin(dl * 0.105 - uTime * 0.9)), 22.0) * smoothstep(0.15, 0.55, vn(vec2(vWp.x * 0.025, uTime * 0.05)) * 0.7 + fn * 0.4);
          float brk = vBrk * smoothstep(0.25, 0.75, band * (0.55 + 0.6 * fn)) * smoothstep(0.25, 0.6, vDepth) * (1.0 - smoothstep(1.4, 2.6, vDepth));
          float tsu = step(0.01, uWaveH) * smoothstep(0.35, 0.8, vCrest / max(min(uWaveH, 40.0), 0.01)) * (0.55 + 0.45 * fn);
          float foam = clamp(max(max(shore * 0.85, brk * 0.95), tsu), 0.0, 1.0);
          col = mix(col, vec3(0.93, 0.95, 0.95), foam);
          float alpha = clamp(smoothstep(-0.05, 3.5, vDepth) * 0.8 + 0.12 + foam * 0.6 + F * 0.25, 0.0, 1.0);
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }` });
    WATER = new THREE.Mesh(g, mat); WATER.frustumCulled = false; WATER.renderOrder = 1; scene.add(WATER);
  }
  // JS mirror of the shader height (no ripples) for physics, splash, sweeping and floating objects
  function terrHJ(x, z) { return (x < TB.x0 || x > TB.x1 || z < TB.z0 || z > TB.z1) ? -60 : H(x, z); }
  function seaLevelJ(x, z) {
    const d = z - zsh(x); let lv = -U.uRecede.value * (1 - sstep(-950, -380, d));
    const dd = d - U.uFront.value, k = dd > 0 ? Math.exp(-dd * dd / 40) : Math.exp(-dd * dd / 6000);
    const tb = U.uBore.value > 0 ? terrHJ(x, z) + U.uBore.value : 0;
    const crest = Math.max(Math.min(U.uWaveH.value, 40), tb) * k, surge = Math.max(U.uSurge.value, U.uSurge.value > 0.01 ? tb : 0) * sstep(12, -110, dd);
    return lv + Math.max(crest, surge);
  }
  function waterHJ(x, z) {
    const base = seaLevelJ(x, z), th = terrHJ(x, z), att = sstep(0.2, 7, base - th), t = U.uTime.value;
    let h = 0.55 * Math.sin(x * 0.018 + z * 0.1 + t * 0.95) + 0.34 * Math.sin(-x * 0.06 + z * 0.15 + t * 1.25 + 1.7) + 0.22 * Math.sin(x * 0.21 + z * 0.17 + t * 1.7 + 4.1);
    return base + h * U.uSwell.value * att;
  }
  // ================================================================== props
  function canvasTex(w, h, draw, srgb = true) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t; }
  const offCourse = (x, z, pad) => { const pr = project(x, z, clamp(sOfXFast(x), 0, D.len)); return pr.s <= 0.5 || pr.s >= D.len - 1 || pr.lat < latMin(pr.s) - pad || pr.lat > latMax(pr.s) + pad; };
  function sOfXFast(x) { // course is monotonic in x: bisection
    let a = 0, b = D.n - 1; while (b - a > 1) { const m = (a + b) >> 1; if (D.x[m] < x) a = m; else b = m; } return a * D.ds; }
  const swayChunk = (amp) => (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec4 ip = instanceMatrix[3]; float ph = ip.x * 0.37 + ip.z * 0.23; float r = length(transformed.xz);
        float k = ${amp.toFixed(3)} * r * r; transformed.y += sin(uTime * 1.6 + ph) * k * 0.6 + sin(uTime * 3.1 + ph * 2.0) * k * 0.15;
        transformed.x += sin(uTime * 1.2 + ph) * k * 0.4; }`);
  };
  // --- palms: 4 procedural variants (tapered curved trunk with ring scars + 12 arching fronds), instanced
  function frondTex() {
    return canvasTex(256, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = '#6b6a2a'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
      for (let i = 6; i < w - 4; i += 5) { const t = i / w, L = (h * 0.5) * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (0.75 + Math.random() * 0.25);
        for (const sd of [-1, 1]) { const gr = g.createLinearGradient(i, h / 2, i + 10, h / 2 + sd * L);
          gr.addColorStop(0, '#3f6a1c'); gr.addColorStop(1, Math.random() < 0.15 ? '#8a8a3a' : '#5d8c2a'); g.strokeStyle = gr; g.lineWidth = 3.2;
          g.beginPath(); g.moveTo(i, h / 2); g.quadraticCurveTo(i + 4, h / 2 + sd * L * 0.5, i + 11, h / 2 + sd * L); g.stroke(); } }
    });
  }
  function palmVariant(seed) {
    const rnd = (k) => hash(seed * 13.1 + k, seed * 7.7 - k);
    const Ht = 7.5 + rnd(1) * 4, lean = 0.12 + rnd(2) * 0.28, bend = 0.3 + rnd(3) * 0.5;
    const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new V3(0, t * Ht, 0).add(new V3(0, 0, -1).multiplyScalar(lean * Ht * t + bend * t * t * 1.5))); }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tg = new THREE.TubeGeometry(curve, 14, 0.24, 8, false);
    { const p = tg.attributes.position, uv = tg.attributes.uv, n = new V3();
      for (let i = 0; i < p.count; i++) { const v = uv.getX(i); const c = curve.getPointAt(v); n.set(p.getX(i) - c.x, p.getY(i) - c.y, p.getZ(i) - c.z);
        const r = (1 - 0.42 * v) * (1 + 0.05 * Math.sin(v * Ht * 9)) * (v < 0.04 ? 1.35 - v * 8 : 1); n.multiplyScalar(r);
        p.setXYZ(i, c.x + n.x, c.y + n.y, c.z + n.z); uv.setXY(i, uv.getY(i) * 1, v * Ht / 1.4); } tg.computeVertexNormals(); }
    const top = curve.getPointAt(1);
    const fr = [], nF = 11 + Math.floor(rnd(4) * 4);
    for (let k = 0; k < nF; k++) {
      const a = k / nF * Math.PI * 2 + rnd(k + 9) * 0.4, L = 3.6 + rnd(k + 20) * 1.4, droop = 0.6 + rnd(k + 30) * 0.9, up = 0.5 + rnd(k + 40) * 0.6;
      const g = new THREE.PlaneGeometry(L, 1.25, 8, 1); g.translate(L / 2, 0, 0);
      const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), t = x / L, y = p.getY(i);
        p.setXYZ(i, x, (up * t - droop * t * t) * L * 0.55 + Math.abs(y) * 0.25, y * (1 - t * 0.6)); }
      g.rotateX(-0.25 + rnd(k + 50) * 0.5); g.rotateY(a); g.translate(top.x, top.y, top.z); fr.push(g);
    }
    // coconut cluster
    const cg = []; for (let k = 0; k < 4; k++) { const s = new THREE.SphereGeometry(0.17, 7, 5); s.translate(top.x + Math.cos(k * 1.7) * 0.28, top.y - 0.3, top.z + Math.sin(k * 1.7) * 0.28); cg.push(s); }
    return { trunk: tg, fronds: mergeGeometries(fr), nuts: mergeGeometries(cg), top };
  }
  let PALMS = null;
  function buildPalms() {
    const m = mats();
    const trunkM = new THREE.MeshStandardMaterial({ map: m.bark, normalMap: m.barkN, roughness: 0.92, color: 0xbdb2a0 });
    const frondM = new THREE.MeshStandardMaterial({ map: frondTex(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, color: 0xd8e8b8 });
    frondM.onBeforeCompile = swayChunk(0.012); frondM.customProgramCacheKey = () => 'l3frond';
    const nutM = new THREE.MeshStandardMaterial({ color: 0x5a4a22, roughness: 0.7 });
    const V = [0, 1, 2, 3].map(i => palmVariant(i + 1));
    const spots = [[], [], [], []];
    const N = IS_MOBILE ? 90 : 140; let tries = 0;   // Makena: only a few coconut palms among the kiawe
    while (spots.flat().length < N && tries++ < N * 30) {
      const x = TB.x0 + 300 + Math.random() * (TB.x1 - TB.x0 - 500);
      const d = Math.random() < 0.7 ? 60 + Math.pow(Math.random(), 1.5) * 220 : 25 + Math.random() * 60;
      const z = zsh(x) + d; if (H(x, z) < 1.2 || offCourse(x, z, 4) === false) continue;
      if (headW(x, d) > 0.4) continue;
      const grove = fbm(x * 0.01, z * 0.01); if (grove < 0.42 && Math.random() < 0.7) continue;
      spots[Math.floor(Math.random() * 4)].push([x, H(x, z) - 0.2, z, Math.random() * Math.PI * 2, 0.85 + Math.random() * 0.35]);
    }
    PALMS = [];
    const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new V3(), ps = new V3(), Y = new V3(0, 1, 0);
    V.forEach((v, vi) => { const arr = spots[vi]; if (!arr.length) return;
      for (const [geo, mat, cast] of [[v.trunk, trunkM, true], [v.fronds, frondM, true], [v.nuts, nutM, false]]) {
        const im = new THREE.InstancedMesh(geo, mat, arr.length);
        arr.forEach((e, i) => { q.setFromAxisAngle(Y, e[3]); mt.compose(ps.set(e[0], e[1], e[2]), q, sc.set(e[4], e[4], e[4])); im.setMatrixAt(i, mt); });
        im.castShadow = cast && !IS_MOBILE; im.receiveShadow = true; scene.add(im); PALMS.push(im); } });
    PALMS.count = spots.flat().length;
  }
  // --- beach grass tufts on the dunes
  function buildGrass() {
    const tex = canvasTex(128, 128, (g, w, h) => { g.clearRect(0, 0, w, h);
      for (let i = 0; i < 46; i++) { const x = 10 + Math.random() * (w - 20), L = h * (0.45 + Math.random() * 0.5), bend = (Math.random() - 0.5) * 30;
        g.strokeStyle = ['#8f8d4a', '#a8a35a', '#6f7a34', '#c2b77a'][i % 4]; g.lineWidth = 1.6 + Math.random() * 1.4;
        g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + bend * 0.3, h - L * 0.6, x + bend, h - L); g.stroke(); } });
    const a = new THREE.PlaneGeometry(1.8, 1.1); a.translate(0, 0.55, 0); const b = a.clone(); b.rotateY(Math.PI / 2); const geo = mergeGeometries([a, b]);
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 });
    mat.onBeforeCompile = (sh) => { sh.uniforms.uTime = U.uTime; sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n{ vec4 ip = instanceMatrix[3]; transformed.x += sin(uTime * 2.2 + ip.x * 0.5 + ip.z * 0.3) * 0.12 * transformed.y; }'); };
    mat.customProgramCacheKey = () => 'l3grass';
    const arr = []; const N = IS_MOBILE ? 1400 : 2600; let t = 0;
    while (arr.length < N && t++ < N * 20) { const x = TB.x0 + 400 + Math.random() * 2300, d = 62 + Math.random() * 90, z = zsh(x) + d;
      if (!offCourse(x, z, 1.5) || headW(x, d) > 0.3) continue; arr.push([x, H(x, z) - 0.05, z, Math.random() * 3, 0.7 + Math.random() * 0.8]); }
    const im = new THREE.InstancedMesh(geo, mat, arr.length), mt = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new V3(0, 1, 0);
    arr.forEach((e, i) => { q.setFromAxisAngle(Y, e[3]); mt.compose(new V3(e[0], e[1], e[2]), q, new V3(e[4], e[4], e[4])); im.setMatrixAt(i, mt); });
    im.receiveShadow = true; scene.add(im);
  }
  // --- rocks: headland boulders and outcrops (noise-displaced icospheres)
  function rockGeo(seed) {
    const g = new THREE.IcosahedronGeometry(1, 3), p = g.attributes.position, v = new V3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = fbm(v.x * 1.7 + seed * 3, v.y * 1.7 + v.z * 1.3 + seed) - 0.5; v.multiplyScalar(1 + n * 0.55); v.y *= 0.62; p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals(); return g;
  }
  function buildRocks() {
    const m = mats(), V = [rockGeo(1), rockGeo(2), rockGeo(3)], arr = [[], [], []];
    for (let i = 0; i < (IS_MOBILE ? 140 : 220); i++) {
      const x = HEAD_X + (Math.random() - 0.5) * HEAD_W * 2.6, d = -HEAD_B - 25 + Math.random() * 150, z = zsh(x) + d;
      if (!offCourse(x, z, 2.5)) continue;
      const big = Math.random() < 0.3; const s = big ? 2.5 + Math.random() * 4 : 0.6 + Math.random() * 1.8;
      arr[i % 3].push([x, H(x, z) - s * 0.25, z, Math.random() * 6, s]);
    }
    // a few outcrops along the beach / at the dune foot
    for (let i = 0; i < 40; i++) { const x = 100 + Math.random() * 1800, d = (Math.random() < 0.5 ? -35 - Math.random() * 30 : 50 + Math.random() * 30), z = zsh(x) + d;
      if (!offCourse(x, z, 3)) continue; const s = 0.8 + Math.random() * 2.2; arr[i % 3].push([x, H(x, z) - s * 0.3, z, Math.random() * 6, s]); }
    const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), E = new THREE.Euler();
    V.forEach((g, k) => { if (!arr[k].length) return; const im = new THREE.InstancedMesh(g, m.rock, arr[k].length);
      arr[k].forEach((e, i) => { q.setFromEuler(E.set(Math.random() * 0.3, e[3], Math.random() * 0.3)); mt.compose(new V3(e[0], e[1], e[2]), q, new V3(e[4], e[4] * (0.8 + Math.random() * 0.5), e[4] * (0.8 + Math.random() * 0.6))); im.setMatrixAt(i, mt); });
      im.castShadow = !IS_MOBILE; im.receiveShadow = true; scene.add(im); });
  }
  // --- boardwalk: plank deck on posts, handrails, ramps on/off the sand
  function buildBoardwalk() {
    const m = mats(), s0 = D.bw[0] - 22, s1 = D.bw[1] + 22, HWb = 4.6, pos = [], uv = [], idx = [];
    let n = 0; for (let s = s0; s <= s1; s += 1) { const f = frame(s, { ..._f }); const y = ground(f.x, f.z, s) + 0.02;
      for (const l of [-HWb, HWb]) { pos.push(f.x + f.rx * l, y, f.z + f.rz * l); uv.push((l + HWb) / 2.2, s / 2.2); }
      if (n > 0) { const a = (n - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } n++; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const deckM = m.wood.clone(); deckM.map = m.plank.clone(); deckM.map.needsUpdate = true; deckM.map.rotation = Math.PI / 2;
    const deck = new THREE.Mesh(g, deckM); deck.receiveShadow = true; scene.add(deck);
    const parts = [];
    for (let s = s0 + 2; s <= s1 - 2; s += 3) { const f = frame(s, { ..._f }); const y = ground(f.x, f.z, s);
      for (const l of [-HWb + 0.1, HWb - 0.1]) { const gx = f.x + f.rx * l, gz = f.z + f.rz * l, gy = H(gx, gz) - 0.4, h = y - gy;
        if (h > 0.25) { const b = new THREE.BoxGeometry(0.22, h, 0.22); b.translate(gx, gy + h / 2, gz); parts.push(b); }
        if (s > D.bw[0] && s < D.bw[1]) { const r = new THREE.BoxGeometry(0.12, 1.0, 0.12); r.translate(gx, y + 0.5, gz); parts.push(r); } } }
    // handrails
    for (const l of [-HWb + 0.1, HWb - 0.1]) { const pts = []; for (let s = D.bw[0]; s <= D.bw[1]; s += 3) { const f = frame(s, { ..._f }); pts.push(new V3(f.x + f.rx * l, ground(f.x, f.z, s) + 1.0, f.z + f.rz * l)); }
      if (pts.length > 1) parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.06, 5, false)); }
    const po = new THREE.Mesh(mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p).map(p => { p.deleteAttribute('uv'); return p; })), new THREE.MeshStandardMaterial({ color: 0x6b5a46, roughness: 0.9 }));
    po.castShadow = !IS_MOBILE; po.receiveShadow = true; scene.add(po);
  }
  // --- jumps: sand berms (with a sand-coloured face) and driftwood barriers; nitro pads
  function buildJumps() {
    const m = mats();
    const sandM = new THREE.MeshStandardMaterial({ map: m.tDry, normalMap: m.nSand, color: 0xe6d6b0, roughness: 0.96 });
    for (const r of D.ramps) {
      const pos = [], uv = [], idx = [], L0 = -32, L1 = 24, NL = 28; let n = 0;
      const prof = (s) => s < r.s1 ? r.h * clamp((s - r.s0) / (r.s1 - r.s0), 0, 1) : r.h * (1 - clamp((s - r.s1) / 3.5, 0, 1));
      for (let s = r.s0 - 1; s <= r.s1 + 3.6; s += 0.5) { const f = frame(s, { ..._f });
        for (let k = 0; k <= NL; k++) { const l = L0 + (L1 - L0) * k / NL, x = f.x + f.rx * l, z = f.z + f.rz * l, edge = sstep(L0, L0 + 6, l) * (1 - sstep(L1 - 6, L1, l));
          pos.push(x, H(x, z) + prof(s) * edge + 0.03, z); uv.push(x / 9, z / 9); }
        if (n > 0) for (let k = 0; k < NL; k++) { const a = (n - 1) * (NL + 1) + k, b = a + NL + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); } n++; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, sandM); mesh.receiveShadow = true; scene.add(mesh);
      if (r.kind === 'log') { // weathered driftwood laid along the lip
        const logs = []; for (let l = L0 + 4; l < L1 - 6; l += 9.5 + Math.random() * 2) { const len = 7 + Math.random() * 3, f = frame(r.s1 + 0.4, { ..._f });
          const c = new THREE.CylinderGeometry(0.42, 0.5, len, 10, 1); c.rotateZ(Math.PI / 2); c.rotateY(-Math.atan2(f.rz, f.rx)); const lm = l + len / 2;
          const x = f.x + f.rx * lm, z = f.z + f.rz * lm; c.translate(x, H(x, z) + r.h * 0.75, z); logs.push(c); }
        const lg = new THREE.Mesh(mergeGeometries(logs), m.drift); lg.castShadow = !IS_MOBILE; scene.add(lg);
      }
    }
    // nitro pads (shared nitro look), laid on the sand
    for (const P of D.pads) {
      const pos = [], uv = [], idx = []; let n = 0;
      for (let s = P.s - 3.5; s <= P.s + 3.5; s += 1.75) { const f = frame(s, { ..._f }); for (const l of [P.lat - P.hw, P.lat + P.hw]) { const x = f.x + f.rx * l, z = f.z + f.rz * l; pos.push(x, ground(x, z, s) + 0.06, z); uv.push(l > P.lat ? 1 : 0, (s - P.s + 3.5) / 7); }
        if (n > 0) { const a = (n - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } n++; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
      const pm = new THREE.Mesh(g, NFX.padMat); pm.renderOrder = 2; scene.add(pm);
      const gm = new THREE.Mesh(g, NFX.glowMat); gm.renderOrder = 3; gm.position.y = 0.02; scene.add(gm);
    }
  }
  // ================================================================== Makena-style backdrop: kiawe tree line + Haleakala slopes
  // Dense, low, umbrella-canopied kiawe / tropical trees right behind the sand (instanced), and a hazy green volcanic
  // massif rising inland, with its own aerial-perspective haze (lighter than the scene fog so it stays readable).
  let TREES = null, MTN = null;
  function kiaweGeo(seed) {
    let sd = seed * 977; const rnd = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    const parts = [], c = new THREE.Color();
    const paint = (g, fn) => { const p = g.attributes.position, n = g.attributes.normal, col = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { fn(c, p.getX(i), p.getY(i), p.getZ(i), n.getY(i)); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g; };
    // crooked trunk + two limbs
    const H0 = 1.0 + rnd() * 0.7, lean = (rnd() - 0.5) * 0.5;
    const tr = new THREE.CylinderGeometry(0.16, 0.26, H0, 6, 1); tr.translate(0, H0 / 2, 0); tr.rotateZ(lean * 0.5);
    parts.push(paint(tr, (c) => c.setRGB(0.16, 0.12, 0.09)));
    for (let k = 0; k < 2; k++) { const L = 1.8 + rnd(), b = new THREE.CylinderGeometry(0.08, 0.14, L, 5, 1); b.translate(0, L / 2, 0); b.rotateZ((k ? 1 : -1) * (0.6 + rnd() * 0.4)); b.rotateY(rnd() * 6.28); b.translate(lean * H0 * 0.25, H0 * 0.95, 0);
      parts.push(paint(b, (c) => c.setRGB(0.15, 0.11, 0.08))); }
    // canopy: a broad, flattened dome of leafy clumps
    const R = 2.1 + rnd() * 1.3, top = H0 + 2.0 + rnd() * 1.8, nb = IS_MOBILE ? 4 : 5;
    for (let k = 0; k < nb; k++) {
      const a = k / nb * 6.28 + rnd() * 0.8, r = k === 0 ? 0 : R * (0.5 + rnd() * 0.45), s = 1.6 + rnd() * 1.0;
      const g = new THREE.IcosahedronGeometry(1, 1); const p = g.attributes.position;
      const nr = g.attributes.normal;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), f = 1 + (fbm(x * 1.7 + seed * 3 + k, y * 1.9 + z * 1.3) - 0.5) * 0.55; p.setXYZ(i, x * f, y * f, z * f); nr.setXYZ(i, x, y, z); }   // smooth (spherical) normals: no facets
      g.scale(s * 1.2, s * (0.95 + rnd() * 0.4), s * 1.2); g.translate(Math.cos(a) * r, top - (k === 0 ? -0.2 : rnd() * 0.6), Math.sin(a) * r);
      const sh = 0.8 + rnd() * 0.35;
      parts.push(paint(g, (c, x, y, z, ny) => { const t = clamp(ny * 0.5 + 0.5, 0, 1); c.setRGB((0.018 + 0.05 * t) * sh, (0.05 + 0.10 * t) * sh, (0.012 + 0.022 * t) * sh); }));
    }
    const m = mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g)); return m;
  }
  function buildTrees() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
    mat.onBeforeCompile = (sh) => {   // leafy break-up: clumps of light/dark foliage in world space + a gentle sway
      sh.uniforms.uTime = U.uTime; sh.uniforms.uFront = U.uFront; sh.uniforms.uBore = U.uBore;
      sh.vertexShader = 'uniform float uTime, uFront, uBore; varying vec3 vLp;\n' + GLSL_GEO + '\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vec4 ip = instanceMatrix[3]; float sw = max(0.0, transformed.y - 2.0) * 0.025; transformed.x += sin(uTime * 1.3 + ip.x * 0.11) * sw; transformed.z += cos(uTime * 1.1 + ip.z * 0.13) * sw;\n { float dd = ip.z - zsh(ip.x) - uFront; float fl = step(0.01, uBore) * smoothstep(6.0, -35.0, dd); if (fl > 0.0) { float hs = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453); float snap = step(0.62, hs) * smoothstep(-8.0, -40.0, dd);\n vec3 dl = transpose(mat3(instanceMatrix)) * vec3(0.0, 0.0, 1.0); dl.y = 0.0; dl = normalize(dl); float th = fl * (0.32 + 0.12 * sin(uTime * 5.0 + hs * 20.0)) + snap * 1.15;\n float yy = max(transformed.y, 0.0), hh = dot(transformed, dl); float y2 = yy * cos(th) - hh * sin(th), h2 = yy * sin(th) + hh * cos(th); transformed += dl * (h2 - hh); transformed.y = y2 - fl * 0.6; } }')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vLp = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'varying vec3 vLp;\nfloat lh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }\nfloat ln3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(mix(lh(i), lh(i+vec3(1,0,0)), f.x), mix(lh(i+vec3(0,1,0)), lh(i+vec3(1,1,0)), f.x), f.y), mix(mix(lh(i+vec3(0,0,1)), lh(i+vec3(1,0,1)), f.x), mix(lh(i+vec3(0,1,1)), lh(i+vec3(1,1,1)), f.x), f.y), f.z); }\n'
        + sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n { vec3 q = vLp * 2.4; normal = normalize(normal + (vec3(ln3(q), ln3(q + 7.1), ln3(q + 13.7)) - 0.5) * 1.3); }').replace('#include <color_fragment>', '#include <color_fragment>\n { float l = ln3(vLp * 2.6) * 0.6 + ln3(vLp * 7.0) * 0.4; diffuseColor.rgb *= 0.62 + 0.75 * l; }');
    };
    mat.customProgramCacheKey = () => 'l3kiawe';
    const V = [0, 1, 2, 3, 4].map(i => kiaweGeo(i + 1));
    const spots = V.map(() => []);
    const N = IS_MOBILE ? 1000 : 1700; let tries = 0;
    while (spots.flat().length < N && tries++ < N * 40) {
      const x = TB.x0 + 260 + Math.random() * (TB.x1 - TB.x0 - 360);
      const d = Math.random() < 0.65 ? 74 + Math.pow(Math.random(), 1.4) * 80 : 150 + Math.pow(Math.random(), 1.3) * 260;
      const z = zsh(x) + d; if (z > TB.z1 - 20) continue;
      const h = H(x, z); if (h < 1.6) continue;
      if (headW(x, d) > 0.3 || !offCourse(x, z, 10)) continue;
      // a dense wall at the back of the beach, thinning into clumps further in
      if (d > 140 && fbm(x * 0.013, z * 0.013) < 0.38 && Math.random() < 0.6) continue;
      spots[Math.floor(Math.random() * V.length)].push([x, h - 0.15, z, Math.random() * 6.28, (d < 160 ? 1.7 : 1.5) + Math.random() * 0.9]);
    }
    TREES = [];
    const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new V3(), ps = new V3(), Y = new V3(0, 1, 0);
    // chunk by x so the camera frustum culls whole stretches of forest
    const CH = 260, chunks = new Map();
    V.forEach((geo, vi) => spots[vi].forEach(e => { const k = vi + ':' + Math.floor(e[0] / CH); if (!chunks.has(k)) chunks.set(k, { geo, arr: [] }); chunks.get(k).arr.push(e); }));
    chunks.forEach(({ geo, arr }) => {
      const im = new THREE.InstancedMesh(geo, mat, arr.length);
      arr.forEach((e, i) => { q.setFromAxisAngle(Y, e[3]); mt.compose(ps.set(e[0], e[1], e[2]), q, sc.set(e[4], e[4] * (0.85 + Math.random() * 0.3), e[4])); im.setMatrixAt(i, mt); });
      im.castShadow = !IS_MOBILE; im.receiveShadow = false; im.computeBoundingSphere(); scene.add(im); TREES.push(im); });
    TREES.count = spots.flat().length;
  }
  // big fair-weather cumulus: painted billboard clouds on a ring around the camera (puffy tops, grey flat bases)
  let CLOUDS = null;
  function cumulusTex(seed) {
    let sd = seed * 7919; const r = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    return canvasTex(512, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h); const base = h * 0.78;
      const puffs = []; for (let i = 0; i < 110; i++) { const u = r(), x = w * (0.1 + 0.8 * u), env = Math.sin(Math.PI * u) ** 0.7, y = base - env * h * (0.25 + 0.4 * r()) * r(), rad = (18 + 50 * env * r()) * (y < base - 40 ? 1 : 0.8); puffs.push([x, Math.min(y, base - rad * 0.35), rad]); }
      for (const [x, y, rad] of puffs) { const gr = g.createRadialGradient(x - rad * 0.25, y - rad * 0.3, rad * 0.1, x, y, rad);
        gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.45, 'rgba(248,250,253,0.8)'); gr.addColorStop(0.8, 'rgba(240,244,250,0.3)'); gr.addColorStop(1, 'rgba(230,236,245,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill(); }
      // shade: grey, flat base; sunlit crowns
      g.globalCompositeOperation = 'source-atop';
      const sh = g.createLinearGradient(0, h * 0.25, 0, base); sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.55, 'rgba(170,182,200,0.25)'); sh.addColorStop(1, 'rgba(118,130,152,0.75)');
      g.fillStyle = sh; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) { const [x, y, rad] = puffs[(r() * puffs.length) | 0], cx = x + rad * 0.3, cy = y + rad * 0.35, gr = g.createRadialGradient(cx, cy, 0, cx, cy, rad * 0.6); gr.addColorStop(0, 'rgba(120,132,155,0.12)'); gr.addColorStop(1, 'rgba(120,132,155,0)'); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, rad * 0.6, 0, Math.PI * 2); g.fill(); }
      g.globalCompositeOperation = 'destination-out'; const cut = g.createLinearGradient(0, base - 6, 0, base + 10); cut.addColorStop(0, 'rgba(0,0,0,0)'); cut.addColorStop(1, 'rgba(0,0,0,1)'); g.fillStyle = cut; g.fillRect(0, base - 6, w, h);
      g.globalCompositeOperation = 'source-over';
    });
  }
  function buildClouds() {
    const tx = [1, 2, 3, 4].map(cumulusTex); CLOUDS = new THREE.Group(); let sd = 4242; const r = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    for (let i = 0; i < 22; i++) {
      // mostly over the land (+z) and along the coast, a few out to sea
      const a = (i < 15 ? (0.12 + 0.76 * r()) * Math.PI : (1.1 + 0.8 * r()) * Math.PI), dist = 3200 + r() * 2600;
      const m = new THREE.SpriteMaterial({ map: tx[i % 4], transparent: true, depthWrite: false, fog: false, color: 0xffffff });
      const s = new THREE.Sprite(m); const W = 1500 + r() * 2200; s.scale.set(W, W * 0.5, 1);
      s.position.set(Math.cos(a) * dist, 380 + r() * 700, Math.sin(a) * dist); s.renderOrder = -5; CLOUDS.add(s);
    }
    scene.add(CLOUDS);
  }
  // distant volcanic massif (Haleakala's leeward slopes): ridged fbm on a broad cone, gullies, green with dry lower flanks
  function buildMountains() {
    const NX = IS_MOBILE ? 260 : 360, NZ = IS_MOBILE ? 60 : 80, X0 = -7500, X1 = 7000, pos = [], col = [], idx = [], c = new THREE.Color();
    const ridge = (x, z) => { let a = 0, f = 1, w = 0.5; for (let o = 0; o < 4; o++) { a += w * (1 - Math.abs(vnoise(x * f, z * f) * 2 - 1)); f *= 2.1; w *= 0.5; } return a; };
    for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
      const x = X0 + (X1 - X0) * i / NX, inT = sstep(TB.x0 - 300, TB.x0 + 100, x) * (1 - sstep(TB.x1 - 100, TB.x1 + 300, x));
      const d0 = lerp(140, 680, inT), u = Math.pow(j / NZ, 1.35), d = d0 + u * 8200, z = zsh(x) * (0.4 + 0.6 * inT) + d;
      const base = H(x, zsh(x) + Math.min(d, 600)) * (d < 700 ? 1 : 1);
      const dist = Math.hypot(x - 900, d - 8600);
      const cone = 1700 * Math.exp(-((dist / 5600) ** 1.5)) + 1150 * Math.exp(-((Math.hypot(x + 3600, d - 5200) / 3800) ** 1.6));   // + the coastal range ahead along the beach               // the big shield volcano inland
      const foot = 220 * sstep(1200, 3200, d) * (0.5 + fbm(x * 0.0006, d * 0.0005));
      const rg = ridge(x * 0.0011, d * 0.0011);
      const m = sstep(1300, 4200, d);
      const h = base + m * (cone * (0.7 + 0.45 * rg) + foot + 160 * rg) + sstep(700, 1600, d) * 60 * fbm(x * 0.003, d * 0.003) - (1 - sstep(0, 150, d - d0)) * 2;
      pos.push(x, h, z);
      const gul = clamp((rg - 0.45) * 2.2, 0, 1), dry = sstep(300, 900, h) * (1 - sstep(1100, 1800, h)) * 0.6, top = sstep(1500, 2300, h);
      c.setRGB(0.04 + 0.05 * dry + 0.02 * top, 0.10 + 0.03 * gul - 0.02 * dry + 0.02 * top, 0.03 + 0.01 * top); col.push(c.r, c.g, c.b);
    }
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i, b = a + 1, cc = a + NX + 1, dd = cc + 1; idx.push(a, cc, b, b, cc, dd); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, fog: false });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uHaze = { value: new THREE.Color(0x9fc0e8) };
      sh.vertexShader = 'varying vec3 vMw;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vMw = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'uniform vec3 uHaze; varying vec3 vMw;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n { float dd = length(vMw - cameraPosition); float hz = 1.0 - exp(-dd * 0.00027); hz *= mix(1.0, 0.8, smoothstep(200.0, 1500.0, vMw.y)); gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, clamp(hz, 0.0, 0.88)); }');
    };
    mat.customProgramCacheKey = () => 'l3mtn';
    MTN = new THREE.Mesh(g, mat); MTN.frustumCulled = false; MTN.renderOrder = -1; scene.add(MTN);
  }
  // --- tsunami hazard / evacuation signs, siren towers, lifeguard tower, start banner
  function signTex(kind) {
    return canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = kind === 'evac' ? '#0a5d2a' : '#0b4ea2'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 10; g.strokeRect(8, 8, w - 16, h - 16);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '900 28px Arial';
      if (kind === 'evac') { g.fillText('TSUNAMI', w / 2, 52); g.fillText('EVACUATION', w / 2, 84); g.font = '900 110px Arial'; g.fillText('➜', w / 2, 200); g.font = '800 22px Arial'; g.fillText('HIGH GROUND', w / 2, 236); }
      else { g.fillText('TSUNAMI', w / 2, 52); g.fillText('HAZARD ZONE', w / 2, 84);
        g.beginPath(); g.moveTo(40, 200); g.bezierCurveTo(70, 110, 160, 90, 200, 140); g.bezierCurveTo(170, 120, 140, 140, 150, 170); g.lineTo(216, 200); g.closePath(); g.fill();
        g.font = '800 20px Arial'; g.fillText('IN CASE OF EARTHQUAKE', w / 2, 226); g.fillText('GO TO HIGH GROUND', w / 2, 246); }
    });
  }
  let SIRENS = [];
  function buildSigns() {
    const post = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.4 });
    const parts = []; const signs = { haz: [], evac: [] };
    for (let s = 120, k = 0; s < D.waveS + 200; s += 140, k++) { const f = frame(s, { ..._f }), l = latMax(s) + 3, x = f.x + f.rx * l, z = f.z + f.rz * l, y = H(x, z);
      const p = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6); p.translate(x, y + 1.3, z); parts.push(p); (k % 2 ? signs.evac : signs.haz).push([x, y + 2.3, z, Math.atan2(-f.tx, -f.tz)]); }
    for (const [kind, arr] of Object.entries(signs)) { if (!arr.length) continue; const g = new THREE.PlaneGeometry(1.3, 1.3);
      const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ map: signTex(kind), roughness: 0.6, side: THREE.DoubleSide }), arr.length);
      arr.forEach((e, i) => { const mt = new THREE.Matrix4().compose(new V3(e[0], e[1], e[2]), new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), e[3]), new V3(1, 1, 1)); im.setMatrixAt(i, mt); }); scene.add(im); }
    // siren towers: tall pole + horn cluster (the warning wail comes from these)
    SIRENS = [];
    for (const fr of [0.36, 0.47, 0.56, 0.66]) { const s = D.len * fr, f = frame(s, { ..._f }), l = latMax(s) + 9, x = f.x + f.rx * l, z = f.z + f.rz * l, y = H(x, z);
      const p = new THREE.CylinderGeometry(0.16, 0.24, 11, 8); p.translate(x, y + 5.5, z); parts.push(p);
      for (let k = 0; k < 4; k++) { const c = new THREE.CylinderGeometry(0.12, 0.42, 0.9, 10, 1, true); c.rotateZ(Math.PI / 2); c.rotateY(k * Math.PI / 2); c.translate(x + Math.cos(k * Math.PI / 2) * 0.5, y + 10.6, z - Math.sin(k * Math.PI / 2) * 0.5); parts.push(c); }
      SIRENS.push(new V3(x, y + 10.6, z)); }
    // lifeguard tower at the start
    { const f = frame(D.start + 40, { ..._f }), l = -36, x = f.x + f.rx * l, z = f.z + f.rz * l, y = H(x, z);
      for (const a of [-1, 1]) for (const b of [-1, 1]) { const leg = new THREE.BoxGeometry(0.18, 3.2, 0.18); leg.translate(x + a * 1.2, y + 1.6, z + b * 1.2); parts.push(leg); }
      const hut = new THREE.BoxGeometry(3.2, 2.2, 3.2); hut.translate(x, y + 4.3, z); parts.push(hut);
      const rf = new THREE.ConeGeometry(2.8, 1.0, 4); rf.rotateY(Math.PI / 4); rf.translate(x, y + 5.9, z); parts.push(rf); }
    const pm = new THREE.Mesh(mergeGeometries(parts.map(g => { const q = g.index ? g.toNonIndexed() : g; q.deleteAttribute('uv'); return q; })), post);
    pm.castShadow = !IS_MOBILE; scene.add(pm);
    // start banner
    { const f = frame(D.start, { ..._f }), tex = canvasTex(1024, 128, (g, w, h) => { g.fillStyle = '#0b5a8a'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = '900 72px Arial'; g.textAlign = 'center'; g.fillText('START · PACIFIC COAST BEACH RACE', w / 2, 90); });
      const b = new THREE.Mesh(new THREE.PlaneGeometry(26, 3.2), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.7 }));
      const l = -8; b.position.set(f.x + f.rx * l, H(f.x + f.rx * l, f.z + f.rz * l) + 7.5, f.z + f.rz * l); b.rotation.y = Math.atan2(-f.rx, -f.rz) + Math.PI / 2; scene.add(b);
      for (const e of [-13, 13]) { const pp = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 9.2, 8), post); const x = b.position.x + f.rx * e, z = b.position.z + f.rz * e; pp.position.set(x, H(x, z) + 4.6, z); scene.add(pp); } }
  }
  // --- birds: a flock resting on the sand that bolts inland when the sea pulls back, + gulls circling
  let BIRDS = null;
  function buildBirds() {
    const pos = [], wing = [];
    const add = (a, b, c, w) => { pos.push(...a, ...b, ...c); wing.push(w[0], w[1], w[2]); };
    add([0, 0, -0.25], [0, 0, 0.3], [0.08, 0.05, 0], [0, 0, 0]); add([0, 0, -0.25], [0.08, 0.05, 0], [0, 0, 0.3], [0, 0, 0]);
    add([0, 0.03, -0.08], [0, 0.03, 0.1], [0.55, 0.03, 0.02], [0, 0, 1]); add([0, 0.03, -0.08], [-0.55, 0.03, 0.02], [0, 0.03, 0.1], [0, -1, 0]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('wing', new THREE.Float32BufferAttribute(wing, 1)); g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.8, side: THREE.DoubleSide });
    const uFlap = { value: 0 };
    mat.onBeforeCompile = (sh) => { sh.uniforms.uTime = U.uTime; sh.vertexShader = 'uniform float uTime; attribute float wing;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec4 ip = instanceMatrix[3]; float fl = step(1.305, length(instanceMatrix[2].xyz)); float ph = ip.x * 3.1 + ip.z * 1.7; float w = abs(wing);
        transformed.y += sin(uTime * 11.0 + ph) * w * 0.38 * fl; }`); };
    mat.customProgramCacheKey = () => 'l3bird';
    const N = 60; const im = new THREE.InstancedMesh(g, mat, N); im.frustumCulled = false; scene.add(im);
    const B = [];
    for (let i = 0; i < N; i++) { const rest = i < 38; const s = D.birdS + (Math.random() - 0.3) * 90, f = frame(s, { ..._f }), l = -20 + Math.random() * 30;
      const x = f.x + f.rx * l, z = f.z + f.rz * l;
      B.push({ rest, p: new V3(x, rest ? H(x, z) + 0.12 : 18 + Math.random() * 14, z), v: new V3(), yaw: Math.random() * 6, t: Math.random() * 10, c: new V3(x + 60 - Math.random() * 120, 0, z - 80 - Math.random() * 120), r: 30 + Math.random() * 40, fly: !rest }); }
    BIRDS = { im, B, scared: false, mt: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, 'YXZ') };
  }
  function updateBirds(dt) {
    if (!BIRDS) return; const { im, B, mt, q, e } = BIRDS;
    B.forEach((b, i) => {
      if (b.fly) {
        if (b.rest) { // bolted: climb away inland
          b.v.lerp(b.dir, Math.min(1, dt * 1.5)); b.p.addScaledVector(b.v, dt); b.yaw = Math.atan2(b.v.x, b.v.z);
        } else { b.t += dt * (0.25 + (i % 5) * 0.03); b.p.set(b.c.x + Math.cos(b.t) * b.r, b.p.y, b.c.z + Math.sin(b.t) * b.r); b.yaw = -b.t; }
      }
      e.set(b.fly ? 0.1 : 0, b.yaw, b.fly ? Math.sin(b.t * 2) * 0.2 : 0); q.setFromEuler(e);
      mt.compose(b.p, q, new V3(1.3, 1.3, b.fly ? 1.31 : 1.3)); im.setMatrixAt(i, mt);
    });
    im.instanceMatrix.needsUpdate = true;
  }
  function scareBirds() {
    if (!BIRDS || BIRDS.scared) return; BIRDS.scared = true;
    BIRDS.B.forEach(b => { if (!b.rest) return; b.fly = true; const f = frame(project(b.p.x, b.p.z, D.birdS).s, { ..._f });
      b.dir = new V3(f.rx * 9 + f.tx * (Math.random() * 6 - 1), 3.5 + Math.random() * 2.5, f.rz * 9 + f.tz * (Math.random() * 6 - 1)); b.v.set(0, 2, 0); });
    birdCalls();
  }
  // ================================================================== particles (spray, splashes, blood, flare smoke)
  let PT = null;
  function buildParticles() {
    const N = 700, g = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 4), sz = new Float32Array(N);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 4)); g.setAttribute('size', new THREE.BufferAttribute(sz, 1));
    const tex = canvasTex(64, 64, (c, w, h) => { const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { tMap: { value: tex }, uScale: { value: 1 } },
      vertexShader: 'attribute vec4 color; attribute float size; uniform float uScale; varying vec4 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / max(0.5, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D tMap; varying vec4 vC; void main(){ vec4 t = texture2D(tMap, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); if (gl_FragColor.a < 0.01) discard; }' });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 4; scene.add(pts);
    PT = { pts, pos, col, sz, N, P: [], mat };
    for (let i = 0; i < N; i++) PT.P.push({ life: 0 });
  }
  let ptI = 0;
  function emit(x, y, z, vx, vy, vz, life, size, r, gC, b, a, grav = 9.8, drag = 0.6, grow = 1.5) {
    const p = PT.P[ptI]; ptI = (ptI + 1) % PT.N;
    Object.assign(p, { x, y, z, vx, vy, vz, life, max: life, size, r, g: gC, b, a, grav, drag, grow });
  }
  function updateParticles(dt) {
    if (!PT) return; const { pos, col, sz } = PT;
    PT.mat.uniforms.uScale.value = renderer.domElement.height * 0.5 / Math.tan(camera.fov * Math.PI / 360);
    PT.P.forEach((p, i) => {
      if (p.life <= 0) { sz[i] = 0; col[i * 4 + 3] = 0; return; }
      p.life -= dt; const k = Math.exp(-p.drag * dt); p.vx *= k; p.vz *= k; p.vy = p.vy * k - p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const u = 1 - p.life / p.max;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; sz[i] = p.size * (1 + u * p.grow);
      col[i * 4] = p.r; col[i * 4 + 1] = p.g; col[i * 4 + 2] = p.b; col[i * 4 + 3] = p.a * (1 - u) * Math.min(1, u * 8 + 0.2);
    });
    PT.pts.geometry.attributes.position.needsUpdate = true; PT.pts.geometry.attributes.color.needsUpdate = true; PT.pts.geometry.attributes.size.needsUpdate = true;
  }

  // ================================================================== racers (bike race on the beach)
  const RACERS = [];   // { player, a (AI entry), col, name, num, s, lat, y, vy, spd, ... }
  const PL = {};
  const GRID = [[-12, 0], [-16.5, 0], [-7.5, 0], [-14.2, -7], [-9.8, -7], [-16.5, -14], [-7.5, -14]];
  function placeBikes() {
    RACERS.forEach((R, i) => {
      const [lat, ds] = GRID[i];
      Object.assign(R, { s: D.start + ds, lat, spd: 0, vy: 0, grounded: true, airT: 0, pitch: 0, roll: 0, swept: false, latV: 0, boost: 0, lane: null, base: null, stT: 0 });
      const f = frame(R.s, { ..._f }); R.x = f.x + f.rx * lat; R.z = f.z + f.rz * lat; R.y = ground(R.x, R.z, R.s); R.yaw = yawOf(f);
      if (R.player) { Object.assign(PL, { s: R.s, lat, x: R.x, z: R.z, y: R.y, vy: 0, speed: 0, grounded: true, airT: 0, steerS: 0, leanS: 0, steerAng: 0, roll: 0, pitch: 0, yaw: R.yaw, boost: 0, vcap: 34, cp: D.start, vmaxS: 34, lastPad: null, tumble: null }); }
      else { R.a.root.visible = true; R.a.rider.visible = true; R.a.tag.visible = true; R.a.dismounted = false; R.tumble = null; }
      poseRacer(R, 0);
    });
    const b = C.getBike(); b.visible = true; const rd = C.getRider(); if (rd) rd.group.visible = true;
    pushPlayer(0);
  }
  // surface under a point: firm wet sand is fast, soft dry sand slow, water slowest, boardwalk smooth
  function surfaceAt(x, z, s) {
    if (bwH(s) / BWH > 0.5) return { vmax: 35, drag: 0.012, k: 'deck' };
    const th = terrHJ(x, z), wd = seaLevelJ(x, z) - th;
    if (wd > 0.12 && !(U.uWaveH.value > 0)) return { vmax: 21, drag: 0.05, k: 'water', wd };
    const d = z - zsh(x);
    if (headW(x, d) > 0.45) return { vmax: 30, drag: 0.02, k: 'rock' };
    if (th < 0.7) return { vmax: 37, drag: 0.008, k: 'wet' };
    if (d > 125) return { vmax: 31, drag: 0.016, k: 'grass' };
    return { vmax: 27.5, drag: 0.03, k: 'dry' };
  }
  function stepPlayer(dt) {
    const P = PL, S = C.state;
    const ctl = phase === 'race' || phase === 'wave';
    let gasA = 0; let gas = ctl && (keys.KeyW || keys.ArrowUp) ? 1 : 0; const brake = ctl && (keys.KeyS || keys.ArrowDown) ? 1 : 0;
    let steer = ctl ? ((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) : 0;
    if (P.auto) {   // cutaway autopilot: hold the throttle and follow the course
      const f = frame(P.s + 12, { ..._f }); let dy = yawOf(f) - P.yaw - clamp(P.lat - (-6), -8, 8) * 0.02; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      steer = clamp(dy * 3, -1, 1); gasA = 1; }
    if (keys.KeyR && !P.rHeld && ctl) { P.rHeld = true; respawn(); return; } if (!keys.KeyR) P.rHeld = false;
    if (gasA) gas = 1;
    S.inGas = gas; S.inBrake = brake; S.inSteer = steer;
    const sPrev = P.steerS; P.steerS = sPrev + (steer - sPrev) * Math.min(1, (steer !== 0 ? 5.5 : 12) * dt);
    P.leanS += (P.steerS - P.leanS) * Math.min(1, 14 * dt);
    if (steer === 0 && Math.abs(P.steerS) < 0.02) { P.steerS = 0; P.leanS *= Math.exp(-12 * dt); }
    const spdN = clamp(P.speed / 32, 0, 1);
    const auth = clamp(0.35 + P.speed * 0.045, 0.35, 1.5) * (P.grounded ? 1 : 0.3) * (1 - 0.25 * spdN);
    P.yaw += (0.6 * P.steerS + 0.4 * P.leanS * (P.grounded ? 1 : 0.3)) * 1.9 * auth * dt;
    const sa = P.steerS * lerp(0.55, 0.07, Math.pow(spdN, 0.7)) - (steer - P.steerS) * 0.06 * spdN;
    P.steerAng += (sa - P.steerAng) * Math.min(1, 14 * dt);
    const sf = surfaceAt(P.x, P.z, P.s); P.surf = sf.k;
    P.vmaxS += (sf.vmax - P.vmaxS) * Math.min(1, 2.5 * dt);
    P.boost = Math.max(0, (P.boost || 0) - dt); const bo = P.boost > 0;
    if (bo) P.speed += 34 * dt * Math.max(0, 1 - P.speed / 50);
    // ground slope along the heading
    const fx = Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    const g0 = ground(P.x, P.z, P.s), g1 = ground(P.x + fx * 1.5, P.z + fz * 1.5, P.s + 1.5), slope = (g1 - g0) / 1.5;
    if (P.grounded) {
      if (gas) P.speed += 22 * dt * (1 - P.speed / P.vmaxS);
      if (brake) P.speed -= 30 * dt;
      P.speed -= (sf.drag * P.speed * (P.speed > P.vmaxS ? 6 : 1) + (gas ? 0 : 1.2)) * dt;
      P.speed -= 9.8 * 0.75 * (bo ? 0.35 : 1) * clamp(slope, -0.4, 0.4) * dt;
    }
    P.vcap = bo ? 48 : Math.max(36, (P.vcap || 36) - 6 * dt);
    P.speed = clamp(P.speed, 0, P.vcap);
    P.x += fx * P.speed * dt; P.z += fz * P.speed * dt;
    const pr = project(P.x, P.z, P.s);
    const lo = latMin(pr.s), hi = latMax(pr.s);
    if (pr.lat < lo || pr.lat > hi) {   // soft edge: the surf on one side, dunes / rocks / rails on the other
      const f = frame(pr.s, { ..._f }), tyaw = yawOf(f); pr.lat = clamp(pr.lat, lo, hi);
      P.x = f.x + f.rx * pr.lat; P.z = f.z + f.rz * pr.lat;
      let dy = tyaw - P.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      if (Math.abs(dy) > 1.6) dy = dy - Math.sign(dy) * Math.PI;
      P.yaw += dy * Math.min(1, 5 * dt); P.speed *= Math.exp(-0.45 * dt);
    }
    if (pr.s > D.len - 3) { pr.s = D.len - 3; P.speed = 0; }
    if (P.grounded) for (const Q of D.pads) if (Q !== P.lastPad && P.s < Q.s + 3.5 && pr.s >= Q.s - 3.5 && Math.abs(pr.lat - Q.lat) < Q.hw + 0.3) {
      P.lastPad = Q; P.boost = NFX.BOOST_T; NITRO.hits++; C.state.shake = 0.3; NFX.whoosh(0.8); toast('NITRO!', 900); }
    P.s = pr.s; P.lat = pr.lat;
    const gy = ground(P.x, P.z, P.s);
    if (P.grounded) {
      if (gy < P.y + P.vy * dt - 0.5 * GRAV * dt * dt - 0.05) { P.grounded = false; P.airT = 0; }
      else { P.vy = clamp((gy - P.y) / Math.max(dt, 1e-3), -30, Math.min(30, P.speed * 0.45 + 2)); P.y = gy; }
    }
    if (!P.grounded) {
      P.vy -= GRAV * dt; P.y += P.vy * dt; P.airT += dt;
      if (P.y <= gy) { const imp = -P.vy; P.y = gy; P.grounded = true; P.vy = 0; if (P.airT > 0.35) { C.state.landEv = Math.min(1, imp / 12); C.state.landSquat = 1; C.state.shake = Math.min(0.35, imp * 0.02); } }
    }
    if (P.s > P.cp + 150) P.cp = Math.floor(P.s / 150) * 150;
    const pitchT = P.grounded ? Math.atan(slope) : Math.atan2(P.vy, Math.max(6, P.speed)) * 0.7;
    P.pitch += (clamp(pitchT, -0.6, 0.6) - P.pitch) * Math.min(1, (P.grounded ? 14 : 3.2) * dt);
    const rollT = clamp(-P.steerS * (0.12 + 0.2 * Math.min(1, P.speed / 22)), -0.34, 0.34);
    P.roll += (rollT - P.roll) * Math.min(1, 6.5 * dt);
    // spray when riding through the swash / shallows
    if (sf.k === 'water' && P.speed > 6 && Math.random() < 0.9) for (let k = 0; k < 2; k++) emit(P.x - fx * 0.8 + (Math.random() - 0.5), P.y + 0.3, P.z - fz * 0.8 + (Math.random() - 0.5), (Math.random() - 0.5) * 3 - fx * 2, 2.5 + Math.random() * 3, (Math.random() - 0.5) * 3 - fz * 2, 0.7, 0.5, 0.92, 0.96, 1, 0.75);
    else if ((sf.k === 'dry' || sf.k === 'wet') && P.speed > 14 && P.grounded && Math.random() < 0.35) emit(P.x - fx * 1.0, P.y + 0.15, P.z - fz * 1.0, (Math.random() - 0.5) * 1.5, 0.8 + Math.random(), (Math.random() - 0.5) * 1.5, 0.9, 0.7, sf.k === 'dry' ? 0.86 : 0.6, sf.k === 'dry' ? 0.78 : 0.55, sf.k === 'dry' ? 0.62 : 0.45, 0.35, 2, 1.2, 2.2);
  }
  function respawn() {
    const P = PL, s = Math.max(D.start, P.cp + 2), f = frame(s, { ..._f });
    Object.assign(P, { s, lat: -12, x: f.x + f.rx * -12, z: f.z + f.rz * -12, vy: 0, speed: 6, grounded: true, airT: 0, yaw: yawOf(f), pitch: 0, roll: 0, steerS: 0, leanS: 0, steerAng: 0, boost: 0 });
    P.y = ground(P.x, P.z, s); toast('RESPAWN', 900);
  }
  function pushPlayer(dt) {
    const P = PL, S = C.state;
    S.x = P.x; S.y = P.y; S.z = P.z; S.yaw = P.yaw; S.pitch = P.pitch; S.roll = P.roll; S.speed = P.speed; S.grounded = P.grounded;
    S.airTime = P.airT || 0; S.steerAng = P.steerAng; S.vy = P.vy; S.s = P.s;
    C.syncBike(dt);
    if (P.tumble) { const b = C.getBike(); b.rotation.x += P.tumble.ax; b.rotation.z += P.tumble.az; }
  }
  function poseRacer(R, dt) {
    if (R.player) return;
    const a = R.a;
    if (R.tumble) { a.root.position.set(R.x, R.y, R.z); a.root.rotation.set(R.tumble.ax, R.tumble.ay, R.tumble.az); return; }
    const f = frame(R.s, { ..._f }); R.x = f.x + f.rx * R.lat; R.z = f.z + f.rz * R.lat;
    a.root.position.set(R.x, R.y, R.z);
    a.root.rotation.order = 'YXZ'; a.root.rotation.set(R.pitch, -(yawOf(f) + (R.latV || 0) * 0.05), R.roll || 0);
    for (const w of a.wheels) w.rotation.x -= R.spd * dt / 0.43;
  }
  const NITRO = { hits: 0, aiHits: 0 };
  function stepAI(dt) {
    RACERS.forEach((R, i) => {
      if (R.player || R.swept) return;
      if (!R.base) R.base = 31.6 + (i % 3) * 0.8 - (i > 3 ? 0.6 : 0);
      const gap = PL.s - R.s;
      const f0 = frame(R.s, { ..._f }); const x = f0.x + f0.rx * R.lat, z = f0.z + f0.rz * R.lat;
      const sf = surfaceAt(x, z, R.s);
      const gA = ground(x + f0.tx * 3, z + f0.tz * 3, R.s + 3), slA = (gA - (R.y || 0)) / 3;
      let tgt = Math.min(R.base, sf.vmax - 0.5) + clamp(gap * 0.04, -5, 4) + Math.sin(raceT * 0.3 + i) * 0.7 - clamp(slA, 0, 0.4) * 22;
      for (const r of D.ramps) if (R.s > r.s0 - 50 && R.s < r.s1) tgt = Math.max(tgt, 24);
      R.boost = Math.max(0, (R.boost || 0) - dt); if (R.boost > 0) tgt = Math.max(tgt, 41);
      if (phase === 'wave') tgt += 3;   // everyone flat out for the high ground
      R.spd += clamp(tgt - R.spd, -14 * dt, (R.boost > 0 ? 24 : 9) * dt);
      if (R.grounded) for (const Q of D.pads) if (R.s < Q.s - 3.5 && R.s + R.spd * dt >= Q.s - 3.5 && Math.abs(R.lat - Q.lat) < Q.hw + 0.4) { R.boost = NFX.BOOST_T; NITRO.aiHits++; if (R.a.root.position.distanceTo(camera.position) < 60) NFX.whoosh(0.35); }
      if (!R.flame) R.flame = NFX.attachFlame(R.a.root); NFX.flame(R.flame, R.boost > 0);
      R.s += R.spd * dt;
      // lanes on the firm sand, a few on the dry sand; aim for nitro pads when close
      const lo = latMin(R.s) + 1.2, hi = latMax(R.s) - 1.2;
      if (R.lane == null) R.lane = [-20, -16, -12.5, -9, -5.5, -2][(i - 1) % 6];
      let lt = R.lane + Math.sin(raceT * 0.35 + i * 1.7) * 0.8;
      for (const Q of D.pads) if (Q.s - R.s > 0 && Q.s - R.s < 70 && (i % 2 === 0)) lt = Q.lat;
      if (Math.abs(R.s - PL.s) < 4 && Math.abs(R.lat - PL.lat) < 1.8) lt = R.lat + Math.sign(R.lat - PL.lat || 1) * 2;
      for (const O of RACERS) if (O !== R && !O.player && !O.swept && O.s - R.s > 0 && O.s - R.s < 7 && Math.abs(O.lat - R.lat) < 1.6) lt = R.lat + (R.lat > O.lat ? 1.8 : -1.8);
      lt = clamp(lt, lo, hi);
      const nl = R.lat + clamp((lt - R.lat) * Math.min(1, 1.4 * dt), -4 * dt, 4 * dt); R.latV = (nl - R.lat) / Math.max(dt, 1e-3); R.lat = nl;
      const f = frame(R.s, { ..._f }); R.x = f.x + f.rx * R.lat; R.z = f.z + f.rz * R.lat;
      const gy = ground(R.x, R.z, R.s);
      if (R.grounded) {
        if (gy < R.y + R.vy * dt - 0.5 * GRAV * dt * dt - 0.05) { R.grounded = false; R.airT = 0; }
        else { R.vy = clamp((gy - R.y) / Math.max(dt, 1e-3), -30, Math.min(30, R.spd * 0.45 + 2)); R.y = gy; }
      }
      if (!R.grounded) { R.vy -= GRAV * dt; R.y += R.vy * dt; R.airT += dt; if (R.y <= gy) { R.y = gy; R.grounded = true; R.vy = 0; } }
      const g1 = ground(R.x + f.tx * 1.5, R.z + f.tz * 1.5, R.s + 1.5);
      const pt = R.grounded ? Math.atan((g1 - gy) / 1.5) : Math.atan2(R.vy, Math.max(6, R.spd)) * 0.7;
      R.pitch += (clamp(pt, -0.6, 0.6) - R.pitch) * Math.min(1, (R.grounded ? 14 : 3.2) * dt);
      R.roll += (clamp(-R.latV * 0.08, -0.25, 0.25) - (R.roll || 0)) * Math.min(1, 6 * dt);
      if (sf.k === 'water' && R.spd > 6 && Math.random() < 0.5 && R.a.root.position.distanceTo(camera.position) < 80) emit(R.x, R.y + 0.3, R.z, (Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3, 0.6, 0.5, 0.92, 0.96, 1, 0.7);
      poseRacer(R, dt);
      const d = R.a.root.position.distanceTo(camera.position); R.a.tag.visible = d < 110 && d > 7 * Math.max(1, 55 / camera.fov);
    });
  }
  const camP = new V3(), camL = new V3(), _c = new V3();
  function chaseCam(dt, snap) {
    const P = PL; const fx = Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    const asp = camera.aspect || 1, pk = asp < 1 ? 1.35 : 1;
    _c.set(P.x - fx * 6.6 * pk, P.y + 2.6 * pk, P.z - fz * 6.6 * pk);
    _c.y = Math.max(_c.y, ground(_c.x, _c.z, Math.max(0, P.s - 6)) + 1.4);
    if (snap || camP.lengthSq() === 0) camP.copy(_c); else camP.lerp(_c, 1 - Math.exp(-6 * dt));
    camL.set(P.x + fx * 4, P.y + 1.1, P.z + fz * 4);
    camera.position.copy(camP); shake(dt); camera.lookAt(camL);
    const bk = clamp((P.boost || 0) / 0.6, 0, 1);
    NFX.speedLines(bk * 0.85); NFX.flame(NFX.attachFlame(C.getBike()), bk > 0);
    NFX.glowMat.opacity = 0.25 + 0.18 * Math.sin(performance.now() * 0.008);
    const fov = (asp < 1 ? 70 : 60) + clamp(P.speed / 34, 0, 1) * 10 + bk * 14; camera.fov += (fov - camera.fov) * Math.min(1, 3 * dt); camera.updateProjectionMatrix();
  }
  function shake(dt) { const sh = C.state.shake || 0; if (sh > 0) { C.state.shake = Math.max(0, sh - dt); camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh; camera.position.z += (Math.random() - 0.5) * sh * 0.5; } }
  // ================================================================== the tsunami face
  // A dedicated strip that rides the front (z = shore(x) + front + profile offset) with an analytic, steep,
  // slightly curling cross-section: no aliasing even when it is still a kilometre out on the horizon.
  // Its back slope sits just above the ocean grid's broad hump / surge so the two blend into one body of water.
  let WAVE = null;
  const WPROF = [[22, -0.6], [15, 0.2], [10.5, 0.46], [7.5, 0.68], [6.0, 0.82], [6.4, 0.92], [9.0, 0.99], [13.5, 1.03], [16.0, 1.0], [14.0, 0.95], [10.0, 1.04], [3.0, 1.1], [-4, 1.03], [-14, 0.93], [-32, 0.83], [-64, 0.79], [-110, 0.77], [-160, 0.45], [-230, 0.15], [-300, -0.25]];
  // billowing white spray blown up and back off the lip: a translucent noise-masked sheet riding the crest
  function buildSpray(uni) {
    const NX = IS_MOBILE ? 120 : 200, NY = 7, pos = [], idx = [];
    for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) pos.push(-1700 + 3400 * i / NX, j / NY, 0);
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({ uniforms: uni, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
      vertexShader: `uniform float uTime, uFront, uWaveH, uCX; varying vec2 vUv; varying vec3 vWp;
        ` + WATER_GLSL.match(/float zsh[^}]*}/)[0] + `
        #include <fog_pars_vertex>
        void main(){
          float x = floor(uCX / 20.0) * 20.0 + position.x, v = position.y;
          float sec = (sin(x * 0.021 - uTime * 0.6) * 0.5 + 0.5) * (sin(x * 0.083 + uTime * 1.3) * 0.4 + 0.6);
          float hl = uWaveH, puff = 0.45 + 0.45 * sec + 0.08 * sin(x * 0.05 + uTime * 0.8);
          float z = zsh(x) + uFront + 8.0 - v * hl * (0.15 + 0.5 * puff) + v * v * hl * 0.05;
          vec3 wp = vec3(x, hl * (0.98 + v * puff), z);
          vUv = vec2(x, v); vWp = wp;
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vWp;
        #include <fog_pars_fragment>
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f); return mix(mix(h21(i), h21(i+vec2(1,0)), u.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), u.x), u.y); }
        void main(){
          vec2 p = vec2(vUv.x * 0.03, vUv.y * 2.2 - uTime * 0.25);
          float n = vn(p) * 0.5 + vn(p * 2.3 + 1.7) * 0.3 + vn(p * 5.1 + 4.1) * 0.2;
          float a = smoothstep(0.2, 0.6, n + 0.75 - vUv.y * 1.0) * smoothstep(0.0, 0.12, vUv.y + 0.05);
          vec3 c = mix(vec3(0.86, 0.92, 0.94), vec3(1.0), n);
          gl_FragColor = vec4(c, a * 0.92);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }` });
    const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 3; return m;
  }
  function buildWave() {
    const NX = IS_MOBILE ? 240 : 320, NP = WPROF.length, pos = [], idx = [];
    for (let j = 0; j < NP; j++) for (let i = 0; i <= NX; i++) pos.push(-1700 + 3400 * i / NX, WPROF[j][1], WPROF[j][0]);
    for (let j = 0; j < NP - 1; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const uni = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    Object.assign(uni, U, { tH: { value: HM }, uHB: { value: new THREE.Vector4(TB.x0, TB.z0, 1 / (TB.x1 - TB.x0), 1 / (TB.z1 - TB.z0)) }, uSun: { value: SUNDIR }, uCX: { value: 0 } });
    const mat = new THREE.ShaderMaterial({ uniforms: uni, transparent: false, fog: true, side: THREE.DoubleSide,
      vertexShader: WATER_GLSL + `
        uniform float uCX; varying vec3 vWp; varying float vK, vLand, vDd;
        #include <fog_pars_vertex>
        void main(){
          float x = floor(uCX / 20.0) * 20.0 + position.x;
          float z = zsh(x) + uFront + position.z;
          vec2 p = vec2(x, z);
          float d = z - zsh(x);
          float lv = -uRecede * (1.0 - smoothstep(-950.0, -380.0, d));
          float tb = uBore > 0.0 ? terrH(p) + uBore : 0.0;
          float hl = max(uWaveH, tb);
          float k = position.y;
          // turbulent crest: lumps travelling along the front
          float lump = (sin(x * 0.045 + uTime * 0.9) * 0.5 + sin(x * 0.13 - uTime * 1.7) * 0.3 + sin(x * 0.31 + uTime * 2.3) * 0.15) * smoothstep(0.7, 1.05, k) * 0.07;
          float sec = (sin(x * 0.021 - uTime * 0.6) * 0.5 + 0.5) * (sin(x * 0.083 + uTime * 1.3) * 0.4 + 0.6);           // crest height varies along the front
          float lipk = smoothstep(0.98, 1.08, k) * step(0.0, position.z);
          z += lipk * (2.5 + 3.5 * sec + 1.2 * sin(uTime * 1.9 + x * 0.05)) * clamp(hl / 30.0, 0.3, 2.6);           // the lip pitches forward
          float back = (1.0 - step(0.0, position.z)) * smoothstep(0.6, 0.95, k);
          float chop = back * (sin(x * 0.17 + position.z * 0.21 - uTime * 2.1) * sin(x * 0.07 - position.z * 0.13 + uTime * 1.4)) * 0.025;  // churning back with secondary waves
          vec3 wp = vec3(x, lv + (k * (0.88 + 0.16 * sec) + lump + chop) * hl + 0.35, z);
          vWp = wp; vK = k; vDd = position.z; vLand = clamp(tb / max(hl, 0.01), 0.0, 1.0) * step(0.01, uBore);
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform float uTime; uniform vec3 uSun; varying vec3 vWp; varying float vK, vLand, vDd;
        #include <fog_pars_fragment>
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f); return mix(mix(h21(i), h21(i+vec2(1,0)), u.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), u.x), u.y); }
        ${SKYGLSL}
        float fbm3(vec2 p){ return vn(p) * 0.5 + vn(p * 2.03 + 3.1) * 0.3 + vn(p * 4.1 + 7.7) * 0.2; }
        void main(){
          vec3 N = normalize(cross(dFdx(vWp), dFdy(vWp))); vec3 V = normalize(cameraPosition - vWp); if (dot(N, V) < 0.0) N = -N;
          // normal-map style detail: turbulence flowing down the face + streaky churn along it
          vec2 q = vec2(vWp.x * 0.35, vWp.y * 0.18 + uTime * 0.9), q2 = vec2(vWp.x * 1.1, vWp.y * 0.5 + uTime * 1.7);
          float e = 0.6, h0 = fbm3(q) + 0.4 * vn(q2);
          float hx = fbm3(q + vec2(e, 0.0)) + 0.4 * vn(q2 + vec2(e * 3.0, 0.0)), hy = fbm3(q + vec2(0.0, e)) + 0.4 * vn(q2 + vec2(0.0, e * 3.0));
          vec3 T = normalize(vec3(1.0, 0.0, 0.0)), B = normalize(cross(N, T)); N = normalize(N + (T * (hx - h0) + B * (hy - h0)) * 1.6);
          float n1 = vn(vec2(vWp.x * 0.21, vWp.y * 0.05 + uTime * 0.45)) * 0.65 + vn(vec2(vWp.x * 0.6, vWp.y * 0.14 + uTime * 1.1)) * 0.35, n2 = vn(vWp.xz * 0.25 + uTime * 0.5);
          float face = smoothstep(0.0, 1.0, vDd) * step(vK, 1.0);
          // body: deep translucent teal at the base, lighter turquoise toward the crest, vertical light streaks
          float hk = smoothstep(0.0, 1.0, vK);
          vec3 body = mix(vec3(0.008, 0.06, 0.09), vec3(0.04, 0.24, 0.29), hk) * (0.85 + 0.3 * n2);
          float vs = vn(vec2(vWp.x * 0.09 + n2 * 2.0, vWp.y * 0.012)) * 0.6 + vn(vec2(vWp.x * 0.33, vWp.y * 0.03 + uTime * 0.3)) * 0.4;
          body *= 0.82 + 0.4 * vs;
          // sun through the thin upper face / lip: glowing aqua
          float thin = smoothstep(0.72, 1.02, vK) * face;
          float bl = pow(max(dot(-V, uSun) * 0.5 + 0.5, 0.0), 2.0) * 0.6 + 0.55;
          body += vec3(0.05, 0.22, 0.23) * thin * bl * (0.6 + 0.5 * n1);
          float F = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 R = reflect(-V, N); R.y = abs(R.y);
          vec3 col = mix(body, skyCol(R, uSun) * 0.55, F * 0.35) + pow(max(dot(R, uSun), 0.0), 40.0) * 0.35;
          // foam: torn lip, long streaks pouring down the face, boiling base, churning back — dirty, not clean white
          float lip = smoothstep(0.95, 1.06, vK) * (0.6 + 0.4 * n1);
          float wx = vWp.x + (n2 - 0.5) * 18.0 + (n1 - 0.5) * 9.0;
          float st = vn(vec2(wx * 0.16, vWp.y * 0.04 + uTime * 0.7)) * 0.6 + vn(vec2(wx * 0.55, vWp.y * 0.11 + uTime * 1.3)) * 0.4;
          float streak = smoothstep(0.66, 0.85, st + 0.3 * (vK - 0.75)) * face * (0.4 + 0.6 * n2);
          float base = (1.0 - smoothstep(-0.25, 0.22, vK)) * (0.55 + 0.45 * n2);
          float back = (1.0 - face) * smoothstep(0.55, 0.85, n2 + 0.25 * n1);
          float foam = clamp(max(max(lip, streak * 0.18), max(base, back * 0.7)) + vLand * (0.2 + 0.35 * n1), 0.0, 1.0);
          vec3 fc = mix(vec3(0.97, 0.98, 0.98), vec3(0.72, 0.80, 0.80), clamp(0.15 + vLand * 0.5 + (1.0 - vK) * 0.3, 0.0, 1.0) * n2);
          col = mix(col, fc * (0.78 + 0.3 * max(dot(N, uSun), 0.0)), foam);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }` });
    WAVE = new THREE.Mesh(g, mat); WAVE.frustumCulled = false; WAVE.visible = false; WAVE.renderOrder = 2; scene.add(WAVE); WAVE.add(buildSpray(uni)); buildWaveDebris();
  }

  // ---- debris carried in the wave: planks, palm fronds, beach umbrellas, surfboards, tumbling in the face and the flood behind it
  let WDEB = null;
  function buildWaveDebris() {
    const mk = (geo, col, n) => { const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: col, roughness: 0.8, side: THREE.DoubleSide }), n); m.frustumCulled = false; m.visible = false; scene.add(m); return m; };
    const N = IS_MOBILE ? 26 : 40;
    const plank = new THREE.BoxGeometry(2.6, 0.14, 0.32);
    const frond = new THREE.ConeGeometry(0.6, 3.6, 5, 1, true); frond.rotateZ(Math.PI / 2); frond.scale(1, 0.18, 1);
    const umb = mergeGeometries([new THREE.ConeGeometry(1.2, 0.45, 10, 1, true).translate(0, 1.0, 0), new THREE.CylinderGeometry(0.03, 0.03, 2.0, 5)]);
    const board = new THREE.CapsuleGeometry(0.28, 1.8, 3, 8); board.rotateZ(Math.PI / 2); board.scale(1, 0.18, 1);
    const ims = [mk(plank, 0x6b4a2e, N), mk(frond, 0x4f6a2a, N), mk(umb, 0xd84a2a, (N / 2) | 0), mk(board, 0xf2d24a, (N / 2) | 0)];
    const items = []; ims.forEach((im, k) => { for (let i = 0; i < im.count; i++) items.push({ k, i, u: Math.random(), w: (Math.random() - 0.5) * 2, ph: Math.random() * 6.28, sp: 0.6 + Math.random() * 2.2, ax: Math.random() * 6, ay: Math.random() * 6, behind: Math.random() < 0.45 }); });
    WDEB = { ims, items, m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), p: new V3(), s: new V3(1, 1, 1) };
  }
  function updateWaveDebris(dt) {
    if (!WDEB) return; const fr = U.uFront.value, hl = U.uWaveH.value, on = fr > -650 && WAVE && WAVE.visible;
    WDEB.ims.forEach(im => { im.visible = on; }); if (!on) return;
    const cx = Math.floor(camera.position.x / 40) * 40, t = U.uTime.value, { m, q, e, p, s } = WDEB;
    for (const it of WDEB.items) {
      const x = cx + it.w * 140 + Math.sin(t * 0.3 + it.ph) * 4;
      let y, z;
      if (!it.behind) { const k = 0.15 + 0.75 * ((it.u + t * 0.05 * it.sp) % 1); z = zsh(x) + fr + 9 - k * 6 + Math.sin(t + it.ph) * 1.5; y = hl * k * 0.95 + 0.4; }
      else { z = zsh(x) + fr - 8 - it.u * 70; y = Math.max(waterHJ(x, z), terrHJ(x, z) + U.uBore.value * 0.9) + 0.3; }
      e.set(it.ax + t * it.sp, it.ay + t * 0.4 * it.sp, it.ph + t * 0.7 * it.sp); q.setFromEuler(e);
      m.compose(p.set(x, y, z), q, s); WDEB.ims[it.k].setMatrixAt(it.i, m);
    }
    WDEB.ims.forEach(im => { im.instanceMatrix.needsUpdate = true; });
  }
  // ================================================================== warning signs -> tsunami
  const EV = { recede: false, birds: false, siren: false, wave: false };
  let waveT = 0, recT = 0, cutT = 0, sweepN = 0, cut2 = false;
  const WAVE_T_SHORE = 10, LAND_V = 34, FORCE_T = 16;
  function frontAt(t) {
    if (t <= WAVE_T_SHORE) { const u = t / WAVE_T_SHORE; return -1400 * (1 - u) * (1 - 0.45 * u); }
    return (t - WAVE_T_SHORE) * LAND_V;
  }
  function warnings(dt) {
    const s = PL.s;
    if (!EV.recede && s >= D.recedeS) { EV.recede = true; recT = 0; toast('THE SEA IS PULLING BACK…', 2600); ui.warn.textContent = 'THE SEA IS RECEDING'; ui.warn.style.opacity = 0.9; setTimeout(() => { if (!EV.siren) ui.warn.style.opacity = 0; }, 3500); }
    if (EV.recede && !EV.wave) { recT += dt; U.uRecede.value = 3.8 * sstep(0, 15, recT); U.uShore.value = 1 - sstep(0, 9, recT); }
    if (!EV.birds && s >= D.birdS) { EV.birds = true; scareBirds(); toast('THE BIRDS ARE FLEEING INLAND', 2200); }
    if (!EV.siren && s >= D.sirenS) { EV.siren = true; sirenStart(); toast('⚠ TSUNAMI WARNING — HEAD FOR HIGH GROUND!', 3200); ui.warn.textContent = '⚠ TSUNAMI WARNING · HIGH GROUND →'; ui.warn.style.opacity = 1; ui.warn.classList.add('pulse'); }
    if (!EV.wave && s >= D.waveS) startWave();
  }
  function startWave() {
    EV.wave = true; EV.recede = true; EV.birds = EV.birds; if (!EV.siren) { EV.siren = true; sirenStart(); } if (!EV.birds) { EV.birds = true; scareBirds(); }
    phase = 'wave'; waveT = 0; cutT = 3.0; cut2 = false; sweepN = 0; WAVE.visible = true;
    ui.warn.textContent = '⚠ TSUNAMI! CLIMB! HIGHER = HEAD START'; ui.warn.classList.add('pulse'); ui.warn.style.opacity = 1;
    roarStart(); camShot = -1;
  }
  function waveUniforms(t) {
    U.uFront.value = frontAt(t);
    const k = Math.pow(sstep(0, WAVE_T_SHORE, t), 1.2);
    U.uWaveH.value = 100 + 30 * k;
    U.uSurge.value = (24 + 16 * k) * 0.72 * sstep(WAVE_T_SHORE - 3, WAVE_T_SHORE + 1, t);
    U.uBore.value = 7 * sstep(WAVE_T_SHORE - 0.5, WAVE_T_SHORE + 1.5, t);
    U.uRecede.value = 3.8 * (1 - sstep(WAVE_T_SHORE - 2, WAVE_T_SHORE, t));
  }
  const dOf = (x, z) => z - zsh(x);
  function updateWave(dt) {
    waveT += dt; waveUniforms(waveT);
    if (!cut2 && waveT > 8.4) { cut2 = true; cutT = 2.3; camShot = -1; }
    const front = U.uFront.value;
    // sweep riders as the front reaches them (everybody by FORCE_T)
    sweepCheck();
    // mist off the lip near the camera
    if (front > -700) { const n = IS_MOBILE ? 3 : 6; for (let k = 0; k < n; k++) { const x = camera.position.x + (Math.random() - 0.5) * 260, zf = zsh(x) + front + 5; if (Math.hypot(x - camera.position.x, zf - camera.position.z) < 30) continue;
      const lv = U.uWaveH.value; emit(x, lv * (1.0 + Math.random() * 0.15), zf + 6 + Math.random() * 8, (Math.random() - 0.5) * 3, 6 + Math.random() * 8, -(10 + Math.random() * 12), 2.6, 12 + Math.random() * 12, 0.96, 0.98, 0.98, 0.6, 1.0, 0.35, 2.6);
        if (Math.random() < 0.5) emit(x, lv * 0.3 * Math.random(), zf + 8 + Math.random() * 6, (Math.random() - 0.5) * 4, 2 + Math.random() * 4, 4 + Math.random() * 6, 1.8, 6 + Math.random() * 5, 0.7, 0.68, 0.6, 0.45, 2, 0.5, 2.2); } }
    updateWaveDebris(dt);
    roarLevel(clamp(1 - Math.abs(front - dOf(PL.x, PL.z)) / 900, 0.05, 1));
  }
  function sweepCheck() {
    const front = U.uFront.value;
    RACERS.forEach((R, i) => {
      if (R.swept) return;
      const x = R.player ? PL.x : R.x, z = R.player ? PL.z : R.z, y = R.player ? PL.y : R.y;
      if (front >= dOf(x, z) - (R.player ? 21 : 5) || waveT >= FORCE_T + (R.player ? 0 : 0.4 + i * 0.12)) sweep(R, x, y, z);
    });
  }
  function sweep(R, x, y, z) {
    R.swept = true; R.sweepH = Math.max(0, y); R.sweepT = waveT; R.order = sweepN++;
    R.headStart = clamp(420 - 5 * R.sweepH - 4 * R.sweepT, 160, 420);
    const f = frame(R.player ? PL.s : R.s, { ..._f });
    const tm = { ax: 0, ay: R.player ? PL.yaw : -yawOf(f), az: 0, vx: f.rx * 26 + f.tx * 4, vz: f.rz * 26 + f.tz * 4, vy: 6, wx: 2 + Math.random() * 3, wz: 3 + Math.random() * 4, t: 0 };
    if (R.player) { PL.tumble = tm; startPlayerSweep(); }
    else { R.tumble = tm; R.y = y; }
    for (let k = 0; k < 40; k++) emit(x + (Math.random() - 0.5) * 6, y + Math.random() * 4, z + (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 10, 4 + Math.random() * 10, (Math.random() - 0.5) * 10, 1.2, 1.2 + Math.random() * 1.5, 0.93, 0.95, 0.96, 0.8, 6, 0.8, 2);
  }
  function updateTumbles(dt) {
    RACERS.forEach(R => {
      const tm = R.player ? PL.tumble : R.tumble; if (!tm) return;
      tm.t += dt; const k = Math.exp(-0.25 * dt);
      tm.vx *= k; tm.vz *= k; tm.vy -= 9 * dt;
      if (R.player) { const hk = sstep(0.3, 0.75, tm.t); PL.x += tm.vx * dt * hk; PL.z += tm.vz * dt * hk; PL.y = Math.max(PL.y + tm.vy * dt, seaLevelJ(PL.x, PL.z) - (tm.t < 1.6 ? 0.7 : 0.7 + (tm.t - 1.6) * 2)); if (PL.y <= seaLevelJ(PL.x, PL.z) - 1) tm.vy = Math.max(tm.vy, 0.5); PL.speed = 0; }
      else { R.x += tm.vx * dt; R.z += tm.vz * dt; R.y = Math.max(R.y + tm.vy * dt, seaLevelJ(R.x, R.z) - 2.5 - tm.t); if (tm.t > 3.5) { R.a.root.visible = false; R.a.tag.visible = false; } }
      tm.ax += tm.wx * dt; tm.az += tm.wz * dt;
      if (!R.player) poseRacer(R, dt);
      if (Math.random() < 0.6 && tm.t < 2.5) { const x = R.player ? PL.x : R.x, z = R.player ? PL.z : R.z; emit(x + (Math.random() - 0.5) * 3, (R.player ? PL.y : R.y) + 1, z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6, 3 + Math.random() * 6, (Math.random() - 0.5) * 6, 1.2, R.player ? 0.8 : 2.5, 0.85, 0.84, 0.78, 0.7, 6, 0.8, 2); }
    });
  }
  // player is hit: slow motion, camera holds on the wall of water, bike tumbles, white-out -> the swim
  let swT = 0;
  function startPlayerSweep() {
    phase = 'swept'; swT = 0; timeScale = 0.22; C.state.shake = 0.9; camShot = -1;
    ui.warn.style.opacity = 0; ui.warn.classList.remove('pulse');
    C.state.inGas = 0; splashSnd(1); ui.slow.style.opacity = 1;
  }
  function updateSwept(dtReal, dt) {
    swT += dtReal;
    if (swT > 2.2) timeScale = Math.min(0.8, timeScale + dtReal * 0.8);
    waveT += dt; waveUniforms(waveT);
    sweepCheck(); stepAI(dt);
    updateTumbles(dt);
    updateWaveDebris(dt);
    // camera stays on the rider: the wall lands on them, they are lifted and rolled, the water closes over the lens
    const t = PL.tumble, f = frame(PL.s, { ..._f });
    const vl = Math.hypot(t.vx, t.vz) || 1, ux = t.vx / vl, uz = t.vz / vl;          // direction the wave is carrying them
    const sink = sstep(1.7, 3.0, swT), wl = seaLevelJ(PL.x, PL.z);
    const cd = 13 - 5 * sstep(0.2, 2.8, swT); _b.set(PL.x + ux * cd + f.tx * 4, Math.max(PL.y + 3.8 - sink * 3.5, wl + 0.8 - sink * 1.4), PL.z + uz * cd + f.tz * 6);
    if (camShot !== 5) { camShot = 5; camP.copy(_b); } else camP.lerp(_b, 1 - Math.exp(-6 * dtReal));
    camera.position.copy(camP); shake(dtReal);
    camera.lookAt(PL.x - ux * 4, PL.y + 1.5 + (1 - sink) * 5, PL.z - uz * 4);
    camera.fov += (camFit(62).fov - camera.fov) * Math.min(1, 3 * dtReal); camera.updateProjectionMatrix();
    // churning whitewater around the rider and on the lens
    for (let k = 0; k < (IS_MOBILE ? 3 : 5); k++) emit(PL.x - ux * 2 + (Math.random() - 0.5) * 5, wl + Math.random() * 1.5, PL.z - uz * 2 + (Math.random() - 0.5) * 5, ux * 6 + (Math.random() - 0.5) * 5, 2 + Math.random() * 4, uz * 6 + (Math.random() - 0.5) * 5, 0.8, 0.5 + Math.random() * 0.9, 0.78, 0.77, 0.7, 0.75, 6, 0.8, 2);
    ui.uw.style.opacity = (sink * 0.85).toFixed(2);
    ui.white.style.opacity = clamp((swT - 2.9) / 0.7, 0, 1).toFixed(3);
    pushPlayer(dt);
    if (swT > 3.75) { ui.slow.style.opacity = 0; ui.uw.style.opacity = 0; timeScale = 1; startSwim(); }
  }
  // seconds of the tsunami cutaway: the wall on the horizon, seen past the player
  function waveCam(dt) {
    const f = frame(PL.s, { ..._f }), k = camFit(1), late = waveT > 6;
    const fr = U.uFront.value, sx = PL.x, sz = zsh(sx) + Math.min(fr, -20);           // the wave front, seaward of the player
    let fov;
    if (!late) {   // telephoto from high ground behind the player: the wall of water on the horizon
      _b.set(PL.x + f.rx * 6 - f.tx * 10, PL.y + 3.2, PL.z + f.rz * 6 - f.tz * 10);
      _a.set(sx + f.tx * 60, U.uWaveH.value * 0.45, sz); fov = camFit(15).fov;
    } else {       // low on the beach ahead, looking back: the player racing toward us, the wave filling the sky behind
      _b.set(PL.x + f.tx * 32 + f.rx * 6, PL.y + 2.6, PL.z + f.tz * 32 + f.rz * 6);
      _a.set(PL.x - f.rx * 60 - f.tx * 10, PL.y + 9, PL.z - f.rz * 60 - f.tz * 10); fov = camFit(58).fov;
    }
    const sh = late ? 9 : 8;
    if (camShot !== sh) { camShot = sh; camP.copy(_b); camL.copy(_a); } else { camP.lerp(_b, 1 - Math.exp(-5 * dt)); camL.lerp(_a, 1 - Math.exp(-5 * dt)); }
    camera.position.copy(camP); shake(dt); camera.lookAt(camL); camera.fov = fov; camera.updateProjectionMatrix();
    NFX.speedLines(0);
  }
  function camFit(fov) { const asp = camera.aspect || 1; if (asp >= 1) return { fov, k: 1 };
    const hf = 2 * Math.atan(Math.tan(fov * Math.PI / 360) * 1.6), fv = Math.min(76, 2 * Math.atan(Math.tan(hf * 0.62 / 2) / asp) * 180 / Math.PI);
    return { fov: fv, k: clamp(1 + (1 - asp) * 0.9, 1, 1.6) }; }
  const _a = new V3(), _b = new V3(); let camShot = -1;
  // ================================================================== ocean swim: swimmers, sharks, debris, rescue boat
  const BOAT_P = new V3(1000, 0, -3700);          // rescue boat, far out in open water: a 1.5-2.5 km jet-ski run from where the riders surface
  const LADDER_OFF = 7.45;                         // stern ladder, metres from the boat centre toward the swimmers (+z)
  const BOAT_YAW = Math.PI * 0.74;                 // stern quarter toward the swimmers: you see her profile and the ladder
  const LADDER = () => _l.set(BOAT_P.x - Math.sin(BOAT_YAW) * LADDER_OFF, 0, BOAT_P.z - Math.cos(BOAT_YAW) * LADDER_OFF);
  // world <-> boat-local (model: bow +z, beam x)
  const toBoat = (x, z) => { const dx = x - BOAT_P.x, dz = z - BOAT_P.z, c = Math.cos(BOAT_YAW), s = Math.sin(BOAT_YAW); return [dx * c - dz * s, dx * s + dz * c]; };
  const fromBoat = (lx, lz) => { const c = Math.cos(BOAT_YAW), s = Math.sin(BOAT_YAW); return [BOAT_P.x + lx * c + lz * s, BOAT_P.z - lx * s + lz * c]; };
  const _l = new V3();
  const fwd = (yaw, o) => o.set(Math.sin(yaw), 0, Math.cos(yaw));   // swim-space yaw: forward = (sin, cos); toward the boat = PI
  // ---- swimmer: a man in a polo shirt, belt, trousers and dress shoes (David's character); realistic freestyle
  const SKIN = new THREE.MeshStandardMaterial({ color: 0xd09a7a, roughness: 0.48 });
  const LOOKS = [ // [shirt, hair, trousers]  — index 0 is the player: cream polo, dark brown hair, dark brown trousers
    [0xe8dcc0, 0x3a2618, 0x3b2a1f], [0x9cc4e4, 0x16110d, 0x2c3440], [0xf2f2ee, 0x6e4a2a, 0x4a4036], [0xa9b98f, 0x2a1c14, 0x2b2a28],
    [0x6d7f99, 0x8a6a42, 0x3a3128], [0xd99a86, 0x1c1612, 0x33302c], [0xb8b2a6, 0x5a5550, 0x2e2620]];
  const SWG = {};
  function swGeo() {
    if (SWG.torso) return SWG;
    // torso: a lathed chest-to-waist profile (broad shoulders, tapering waist), lying along z
    const prof = [[0.0, 0.0], [0.13, 0.02], [0.17, 0.06], [0.185, 0.14], [0.19, 0.25], [0.18, 0.36], [0.165, 0.45], [0.15, 0.5], [0.0, 0.52]].map(([r, y]) => new THREE.Vector2(r, y));
    const t = new THREE.LatheGeometry(prof, 18); t.rotateX(Math.PI / 2); t.scale(1.25, 0.72, 1); SWG.torso = t;      // y-up lathe -> along +z, flattened front/back
    SWG.collar = new THREE.TorusGeometry(0.085, 0.022, 6, 16, Math.PI * 1.6);
    SWG.sleeve = new THREE.CylinderGeometry(0.068, 0.062, 0.2, 10); SWG.sleeve.translate(0, -0.1, 0);
    SWG.upper = new THREE.CapsuleGeometry(0.048, 0.22, 3, 8); SWG.upper.translate(0, -0.15, 0);
    SWG.fore = new THREE.CapsuleGeometry(0.042, 0.22, 3, 8); SWG.fore.translate(0, -0.13, 0);
    SWG.hand = new THREE.BoxGeometry(0.08, 0.16, 0.03); SWG.hand.translate(0, -0.08, 0);
    SWG.belt = new THREE.CylinderGeometry(0.168, 0.168, 0.045, 18, 1, true); SWG.belt.rotateX(Math.PI / 2); SWG.belt.scale(1.25, 0.72, 1);
    SWG.buckle = new THREE.BoxGeometry(0.05, 0.012, 0.04);
    SWG.hips = new THREE.SphereGeometry(0.17, 14, 10); SWG.hips.scale(1.22, 0.7, 0.8);
    SWG.thigh = new THREE.CapsuleGeometry(0.075, 0.36, 3, 10); SWG.thigh.translate(0, -0.24, 0);
    SWG.shin = new THREE.CapsuleGeometry(0.06, 0.38, 3, 10); SWG.shin.translate(0, -0.24, 0);
    const sh = new THREE.CapsuleGeometry(0.048, 0.17, 3, 8); sh.rotateX(Math.PI / 2); sh.translate(0, 0.0, 0.07); SWG.shoe = sh;
    SWG.skull = new THREE.SphereGeometry(0.108, 18, 14); SWG.skull.scale(0.92, 1.06, 1.02);
    SWG.jaw = new THREE.SphereGeometry(0.08, 12, 10); SWG.jaw.scale(0.95, 0.8, 1.0);
    // hair: a cap over the crown + back, with a swept front quiff
    const hc = new THREE.SphereGeometry(0.114, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5); hc.scale(0.95, 0.82, 1.08); SWG.hairCap = hc;
    const hb = new THREE.SphereGeometry(0.112, 16, 10, Math.PI * 0.62, Math.PI * 0.76, Math.PI * 0.3, Math.PI * 0.42); hb.scale(0.96, 1.05, 1.06); SWG.hairBack = hb;
    const q = new THREE.SphereGeometry(0.07, 12, 8); q.scale(1.35, 0.55, 0.85); SWG.quiff = q;
    SWG.nose = new THREE.ConeGeometry(0.018, 0.045, 6); SWG.nose.rotateX(Math.PI / 2);
    SWG.ear = new THREE.SphereGeometry(0.026, 8, 6); SWG.ear.scale(0.45, 1, 0.8);
    SWG.eye = new THREE.SphereGeometry(0.012, 8, 6);
    SWG.brow = new THREE.BoxGeometry(0.035, 0.008, 0.01);
    SWG.neck = new THREE.CylinderGeometry(0.05, 0.056, 0.12, 10); SWG.neck.rotateX(Math.PI / 2);
    SWG.btn = new THREE.SphereGeometry(0.008, 6, 4);
    return SWG;
  }
  function makeSwimmer(R) {
    const G = swGeo(), li = R.player ? 0 : 1 + ((R.num || 0) + (R.name || '').length) % (LOOKS.length - 1), lk = LOOKS[li];
    // soaked cloth: darker, glossier than dry (the swim is all in the sea)
    const wet = (c, k) => new THREE.Color(c).multiplyScalar(k);
    const shirt = new THREE.MeshStandardMaterial({ color: wet(lk[0], 0.8), roughness: 0.5 });
    const hairM = new THREE.MeshStandardMaterial({ color: wet(lk[1], 0.75), roughness: 0.32 });
    const pants = new THREE.MeshStandardMaterial({ color: wet(lk[2], 0.82), roughness: 0.55 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x2e1d12, roughness: 0.38 });
    const shoeM = new THREE.MeshStandardMaterial({ color: 0x17110d, roughness: 0.25, metalness: 0.1 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xb8a77a, roughness: 0.3, metalness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 0.4 });
    const M = (geo, mat, p, par) => { const m = new THREE.Mesh(geo, mat); if (p) m.position.set(p[0], p[1], p[2]); (par || g).add(m); return m; };
    const g = new THREE.Group(); g.rotation.order = 'YXZ';
    const body = new THREE.Group(); g.add(body);                         // rolls about the long axis
    M(G.torso, shirt, [0, -0.08, -0.12], body);                          // shirt body: z -0.12 (waist) .. 0.4 (shoulders)
    const col = M(G.collar, shirt, [0, -0.02, 0.41], body); col.rotation.set(0, 0, -Math.PI * 0.3); col.scale.set(1.2, 0.95, 1.6);
    const btnM = new THREE.MeshStandardMaterial({ color: 0xf0ece0, roughness: 0.3 }); M(G.btn, btnM, [0, -0.168, 0.37], body); M(G.btn, btnM, [0, -0.17, 0.32], body);
    M(G.belt, leather, [0, -0.08, -0.1], body); M(G.buckle, metal, [0, -0.205, -0.1], body);
    M(G.hips, pants, [0, -0.08, -0.2], body);
    M(G.neck, SKIN, [0, -0.03, 0.47], body);
    // head: tilted face-down/forward like a real crawl; rolls to the side to breathe
    const head = new THREE.Group(); head.position.set(0, -0.0, 0.52); body.add(head);
    const hd = new THREE.Group(); hd.position.set(0, 0.0, 0.1); hd.rotation.x = 0.55; head.add(hd);   // face points +z, tilted down
    M(G.skull, SKIN, [0, 0.02, 0], hd); M(G.jaw, SKIN, [0, -0.06, 0.03], hd);
    M(G.hairCap, hairM, [0, 0.035, -0.005], hd); M(G.hairBack, hairM, [0, 0.0, 0], hd);
    const qf = M(G.quiff, hairM, [0.012, 0.1, 0.06], hd); qf.rotation.set(-0.35, 0.25, 0.12);
    M(G.nose, SKIN, [0, -0.005, 0.115], hd);
    for (const sd of [-1, 1]) { M(G.ear, SKIN, [sd * 0.1, 0.0, -0.005], hd); M(G.eye, dark, [sd * 0.036, 0.02, 0.098], hd); const br = M(G.brow, hairM, [sd * 0.037, 0.045, 0.1], hd); br.rotation.z = sd * -0.12; }
    const arms = [], elb = [], legs = [], knees = [];
    for (const sd of [-1, 1]) {
      const shd = new THREE.Group(); shd.position.set(sd * 0.25, -0.06, 0.36); body.add(shd);
      M(G.sleeve, shirt, [0, 0, 0], shd); M(G.upper, SKIN, [0, -0.03, 0], shd);
      const e = new THREE.Group(); e.position.set(0, -0.3, 0); shd.add(e);
      M(G.fore, SKIN, [0, 0, 0], e); const hn = M(G.hand, SKIN, [0, -0.26, 0], e); hn.rotation.y = sd * 0.25;
      arms.push(shd); elb.push(e);
      const hip = new THREE.Group(); hip.position.set(sd * 0.1, -0.08, -0.24); hip.rotation.x = 0; body.add(hip);
      // leg segments hang along -y in their groups; the hip group turns them to trail behind (-z)
      const hl = new THREE.Group(); hl.rotation.x = Math.PI / 2; hip.add(hl);
      M(G.thigh, pants, [0, 0, 0], hl);
      const kn = new THREE.Group(); kn.position.set(0, -0.48, 0); hl.add(kn);
      M(G.shin, pants, [0, 0, 0], kn);
      const ft = new THREE.Group(); ft.position.set(0, -0.5, 0); kn.add(ft); const shoe = M(G.shoe, shoeM, [0, 0, 0], ft); shoe.rotation.x = Math.PI / 2 - 0.25;
      legs.push(hip); knees.push(kn);
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    const tag = nameTag(R); tag.position.set(0, 1.25, 0); g.add(tag);
    g.scale.setScalar(1.3);   // a touch larger than life so he reads on a phone screen
    g.visible = false; scene.add(g);
    return { g, body, arms, elb, legs, knees, head, tag, lk };
  }
  // ---- jet ski (sit-down PWC, WaveRunner / Sea-Doo style): lofted V-hull, deck, hood, seat, handlebars, pump nozzle
  let SKI_HULL = null;
  function skiHullGeo() {
    if (SKI_HULL) return SKI_HULL;
    const NS = 26, prof = [], pos = [], col = [], idx = [];
    // section ring (x>=0 half, mirrored): deck edge -> gunwale -> chine -> V keel
    for (let i = 0; i <= NS; i++) {
      const u = i / NS, z = -1.55 + u * 3.25;                                      // stern (-z) .. bow (+z)
      const bow = sstep(0.62, 1.0, u), w = 0.58 * (1 - 0.92 * Math.pow(bow, 1.6)) * (0.93 + 0.07 * sstep(0, 0.12, u)) + 0.02;
      const deck = 0.42 + 0.16 * bow * bow, keel = -0.2 + 0.05 * (1 - sstep(0, 0.2, u)) + 0.26 * Math.pow(bow, 2.2), ch = -0.02 + 0.12 * bow;
      const ring = [[0, deck + 0.02], [w * 0.7, deck], [w, deck - 0.06], [w * 1.02, 0.18 + 0.06 * bow], [w * 0.92, ch], [w * 0.5, (ch + keel) * 0.55], [0, keel]];
      const full = ring.concat(ring.slice(1, -1).reverse().map(([x, y]) => [-x, y]));
      prof.push(full.map(([x, y]) => [x, y, z]));
    }
    const R = prof[0].length;
    prof.forEach((ring, i) => ring.forEach(([x, y, z], j) => { pos.push(x, y, z); const top = y > 0.3 ? 1 : 0; col.push(top, j, 0); }));
    for (let i = 0; i < NS; i++) for (let j = 0; j < R; j++) { const a = i * R + j, b = i * R + (j + 1) % R, c = a + R, d = b + R; idx.push(a, c, b, b, c, d); }
    // transom (stern cap)
    const c0 = pos.length / 3; pos.push(0, 0.2, -1.55); col.push(0, 0, 0); for (let j = 0; j < R; j++) idx.push(c0, j, (j + 1) % R);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    SKI_HULL = g; return g;
  }

  // ---- real watercraft models (CC0, Grab3D "Cozy Boats & Aircraft Kit"): motor yacht + jet ski; WebP textures, meshopt geometry.
  // Loaded with the level (TEXP); the procedural boat / skis stay as a fallback if the files fail to load.
  const CRAFT = { ready: false, p: null, ski: null, yacht: null };
  const YACHT_OFF = new V3(0, -0.62, 2.6);   // model -> boat group: waterline (antifouling top) at the sea surface, swim platform at the stern ladder
  const DECK_Y = 3.10 - 0.62;                // aft-cockpit sole height in the boat group
  function loadCraft() {
    if (CRAFT.p) return CRAFT.p;
    const gl = new GLTFLoader(); gl.setMeshoptDecoder(MeshoptDecoder);
    const ld = (u) => new Promise((res) => gl.load(u, res, undefined, (e) => { console.warn('[l3] craft', u, e); res(null); }));
    CRAFT.p = Promise.all([ld('./assets/l3/craft/yacht.glb?v=1'), ld('./assets/l3/craft/jet-ski.glb?v=1')]).then(([y, k]) => {
      if (!y || !k) return;
      try {
        const prep = (r) => { r.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (m.map) m.map.anisotropy = aniso; m.envMapIntensity = 1; }); } }); return r; };
        CRAFT.yacht = prep(y.scene); CRAFT.yacht.traverse(o => { if (/propeller|rudder/.test(o.name)) o.visible = false; }); /* running gear sits below the translucent sea surface */ CRAFT.ski = prep(k.scene); CRAFT.ready = true;
      } catch (e) { console.warn('[l3] craft prep', e); } });
    TEXP.push(CRAFT.p); return CRAFT.p;
  }
  // per-rider hood / seat-cowl colour: the model's mint paint is re-tinted in the shader (keeps its baked AO + normal map)
  function tintSkiMat(src, col) {
    const m = src.clone(); m.userData.tint = { value: new THREE.Color(col) };
    m.onBeforeCompile = (sh) => { sh.uniforms.uTint = m.userData.tint;
      sh.fragmentShader = 'uniform vec3 uTint;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        { vec3 c = diffuseColor.rgb; float mint = smoothstep(0.08, 0.2, c.g - c.r) * smoothstep(0.03, 0.1, c.g - c.b);
          float lum = dot(c, vec3(0.3, 0.59, 0.11)); diffuseColor.rgb = mix(c, uTint * clamp(lum * 1.7, 0.35, 1.25), mint); }`); };
    m.customProgramCacheKey = () => 'skitint'; return m;
  }
  function realSki(k, R) {
    if (k.real || !CRAFT.ready) return;
    const r = CRAFT.ski.clone(true); r.position.y = -0.1;
    r.traverse(o => { if (o.isMesh && o.material && /body/.test(o.material.name)) o.material = tintSkiMat(o.material, R.col); });
    let bars = null; r.traverse(o => { if (!bars && /handlebar/.test(o.name)) bars = o; });
    k.proc.forEach(o => { o.visible = false; }); k.tilt.add(r); k.real = r;
    if (bars) { k.bars = bars; bars.rotation.order = 'YXZ'; }
    k.nums.forEach((n, i) => { n.position.set((i ? 1 : -1) * 0.655, 0.36, -0.75); n.scale.setScalar(0.7); });
  }
  function makeJetSki(R) {
    const g = new THREE.Group(); g.rotation.order = 'YXZ';
    const base = new THREE.Color(R.col), hullM = new THREE.MeshStandardMaterial({ color: 0xf2f3f4, roughness: 0.32, metalness: 0.05, side: THREE.DoubleSide });
    const colM = new THREE.MeshStandardMaterial({ color: base, roughness: 0.28, metalness: 0.15 });
    const darkM = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.55 }), seatM = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.7 });
    const chromeM = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.25, metalness: 0.9 });
    const tilt = new THREE.Group(); g.add(tilt);                                   // pitch / roll / bounce live here
    const hull = new THREE.Mesh(skiHullGeo(), hullM); tilt.add(hull);
    // coloured upper deck shell + hood over the bow
    const deck = new THREE.Mesh(new THREE.CapsuleGeometry(0.46, 1.9, 4, 14), colM); deck.rotation.x = Math.PI / 2; deck.scale.set(1.18, 1, 0.38); deck.position.set(0, 0.47, 0.05); tilt.add(deck);
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), colM); hood.scale.set(1.15, 0.62, 1.55); hood.position.set(0, 0.55, 0.9); tilt.add(hood);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 1.7), new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.45), roughness: 0.4 })); stripe.position.set(0, 0.25, -0.15); stripe.scale.set(0.99, 1, 1); tilt.add(stripe);
    // seat, footwells, handlebar on its steering post, windscreen, tow eye, jet nozzle
    const seat = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.05, 4, 10), seatM); seat.rotation.x = Math.PI / 2; seat.scale.set(1.25, 1, 0.75); seat.position.set(0, 0.74, -0.55); tilt.add(seat);
    for (const sd of [-1, 1]) { const fw = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 1.3), darkM); fw.position.set(sd * 0.44, 0.38, -0.25); tilt.add(fw); }
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.42, 8), darkM); post.position.set(0, 0.78, 0.38); post.rotation.x = -0.45; tilt.add(post);
    const bars = new THREE.Group(); bars.position.set(0, 0.97, 0.3); tilt.add(bars);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.86, 8), chromeM); bar.rotation.z = Math.PI / 2; bars.add(bar);
    for (const sd of [-1, 1]) { const gr = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.16, 8), seatM); gr.rotation.z = Math.PI / 2; gr.position.x = sd * 0.38; bars.add(gr); }
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.22), new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.6, side: THREE.DoubleSide })); scr.position.set(0, 0.98, 0.52); scr.rotation.x = -0.9; tilt.add(scr);
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.25, 10), darkM); noz.rotation.x = Math.PI / 2; noz.position.set(0, 0.05, -1.6); tilt.add(noz);
    const num = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.24), new THREE.MeshBasicMaterial({ map: canvasTex(128, 64, (c, w, h) => { c.fillStyle = '#fff'; c.font = '900 46px Arial'; c.textAlign = 'center'; c.fillText(R.player ? 'YOU' : String(R.num), w / 2, 48); }), transparent: true }));
    const proc = tilt.children.slice(), nums = [];
    for (const sd of [-1, 1]) { const n = num.clone(); n.position.set(sd * 0.6, 0.33, 0.35); n.rotation.y = sd * Math.PI / 2; tilt.add(n); nums.push(n); }
    // foam wake: a soft V of churned water trailing the hull (opacity follows speed)
    const wk = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 9).rotateX(-Math.PI / 2).translate(0, 0.16, -5.2), new THREE.MeshBasicMaterial({ map: skiWakeTex(), transparent: true, depthWrite: false, opacity: 0, fog: true, color: 0xffffff }));
    wk.renderOrder = 2; g.add(wk);
    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    g.visible = false; scene.add(g);
    const k = { g, tilt, bars, proc, nums, wake: wk }; realSki(k, R); return k;
  }
  let SKI_WAKE = null;
  function skiWakeTex() {
    if (SKI_WAKE) return SKI_WAKE;
    SKI_WAKE = canvasTex(128, 256, (c, w, h) => { const img = c.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = 1 - y / h, u = Math.abs(x / w - 0.5) * 2;          // v: 1 at the stern, 0 far behind
        const sp = 0.18 + (1 - v) * 0.8, arm = Math.exp(-((u - sp) ** 2) / 0.006), core = Math.exp(-(u * u) / (0.02 + (1 - v) * 0.08)) * 0.8;
        const n = 0.6 + 0.4 * Math.sin(x * 1.7 + y * 0.9) * Math.sin(y * 0.37 - x * 0.5);
        const a = Math.min(1, (arm + core) * n) * Math.pow(v, 1.3) * Math.min(1, (1 - v) * 12 + 0.3); const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 245; img.data[i + 3] = a * 255; }
      c.putImageData(img, 0, 0); }); return SKI_WAKE;
  }
  // seated riding pose for the polo-shirt rider (the swimmer model is built lying along +z; stand it up and sit it down)
  function poseRider(W, dt) {
    const m = W.m, k = W.ski; if (m.g.parent !== k.tilt) { k.tilt.add(m.g); m.g.scale.setScalar(1.12); }
    m.g.position.set(0, k.real ? 0.7 : 0.78, k.real ? -0.6 : -0.62); m.g.rotation.set(-Math.PI / 2 + 0.22 - (W.crouch || 0) * 0.25, 0, 0);
    m.body.rotation.z = (W.lean || 0) * 0.6;
    for (let s = 0; s < 2; s++) { m.arms[s].rotation.set(0.55, 0, (s ? -1 : 1) * 0.22); m.elb[s].rotation.x = -0.55; }
    for (let s = 0; s < 2; s++) { m.legs[s].rotation.set(-1.45, 0, (s ? -1 : 1) * 0.18); m.knees[s].rotation.x = 1.75; }
    m.head.rotation.set(-0.5, 0, 0);
    m.tag.visible = false;
  }
  function nameTag(R) {
    const tex = canvasTex(256, 64, (c, w, h) => { c.fillStyle = 'rgba(0,0,0,0.45)'; c.beginPath(); c.roundRect ? c.roundRect(4, 6, w - 8, h - 12, 14) : c.rect(4, 6, w - 8, h - 12); c.fill();
      c.fillStyle = '#' + new THREE.Color(R.col).getHexString(); c.fillRect(14, 16, 10, 32); c.fillStyle = '#fff'; c.font = '800 30px Arial'; c.textAlign = 'center'; c.fillText(R.player ? 'YOU' : R.num + ' ' + R.name, w / 2 + 8, 43); });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, fog: false })); s.scale.set(2.2, 0.55, 1); s.renderOrder = 6; return s;
  }
  function poseSwimmer(W, dt) {
    const m = W.m, ph = W.ph; m.g.position.set(W.x, W.y, W.z); m.g.rotation.set(-0.06 + W.dive * 0.55, W.yaw, 0);
    // freestyle: shoulders circle (pull under the body, high-elbow recovery over the water), body rolls toward the pulling arm
    m.body.rotation.z = Math.sin(ph) * 0.42;
    for (let k = 0; k < 2; k++) { const a = ph + k * Math.PI, aw = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);   // 0: reaching forward, pi/2: pulled to the hip, pi: overhead
      // aw: 0 reach forward -> pi/2 pull under the chest -> pi exit at the hip -> 3pi/2 over the water -> 2pi entry
      // recovery (arm out of the water, pi..2pi): swung out to the side, elbow high and bent, hand trailing
      const recE = aw > Math.PI ? Math.sin(aw - Math.PI) : 0;
      m.arms[k].rotation.set(-Math.PI / 2 + aw, 0, (k ? 1 : -1) * (0.1 * Math.sin(aw) + 0.75 * recE));
      const pull = aw <= Math.PI ? Math.sin(aw) * 0.5 : 0;
      m.elb[k].rotation.x = -(pull + recE * 1.55); }
    // flutter kick from the hips, knees soft
    W.kick = (W.kick || 0) + dt * (5 + W.v * 1.1);
    for (let k = 0; k < 2; k++) { const s = Math.sin(W.kick + k * Math.PI); m.legs[k].rotation.x = s * 0.26; m.knees[k].rotation.x = -(0.15 + 0.25 * Math.max(0, -s)); }
    // breathing: every cycle the head turns with the roll to one side
    m.head.rotation.z = Math.pow(Math.max(0, Math.sin(ph)), 3) * 0.9; m.head.rotation.x = -0.05;
    m.tag.visible = !W.player && !W.ko && camera.position.distanceTo(m.g.position) < 140;
  }
  // ---- shark (lofted body, counter-shaded, fins, lunate tail, hinged jaw; vertex-bend swim)
  let SHARK_GEO = null, JAW_GEO = null;
  function sharkGeos() {
    if (SHARK_GEO) return;
    const L = 3.8, NS = 34, NR = 18, pos = [], col = [], idx = [];
    const top = new THREE.Color(0x4a5560), belly = new THREE.Color(0xe9e6e0), tmp = new THREE.Color();
    for (let i = 0; i <= NS; i++) {
      const u = i / NS, z = L / 2 - u * L;                         // nose (+z) -> tail (-z)
      const sh = Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(u, 0.62) * 1.0)), 0.85) * (1 - 0.82 * sstep(0.62, 1, u));
      const hw = 0.43 * sh + 0.012, hh = 0.5 * sh + 0.012, yc = -0.06 * sstep(0, 0.25, u) + 0.04 * sstep(0.6, 1, u);
      for (let j = 0; j < NR; j++) { const a = j / NR * Math.PI * 2, cy = Math.cos(a), sx = Math.sin(a);
        const y = yc + cy * hh * (cy < 0 ? 0.86 : 1), x = sx * hw;
        pos.push(x, y, z);
        const k = sstep(-0.25, 0.2, cy + 0.08 * Math.sin(u * 30)); tmp.copy(belly).lerp(top, k); if (u < 0.06) tmp.multiplyScalar(0.85); col.push(tmp.r, tmp.g, tmp.b); }
    }
    for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) { const a = i * NR + j, b = i * NR + (j + 1) % NR, c = a + NR, d = b + NR; idx.push(a, b, c, b, d, c); }
    let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g = g.toNonIndexed(); g.computeVertexNormals();
    const fin = (pts, thick, c) => { const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath();
      let f = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.4, bevelSize: thick * 0.5, bevelSegments: 1, curveSegments: 2 }); f.translate(0, 0, -thick / 2); if (f.index) f = f.toNonIndexed(); f.deleteAttribute('uv');
      const n = f.attributes.position.count, cc = []; for (let i = 0; i < n; i++) cc.push(c.r, c.g, c.b); f.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3)); f.computeVertexNormals(); return f; };
    const dark = top.clone().multiplyScalar(0.92);
    // dorsal (in the z-y plane): shape drawn in x=z, y=y then rotated
    const dor = fin([[0.38, 0.4], [-0.1, 1.12], [-0.28, 1.08], [-0.42, 0.38]], 0.05, dark); dor.rotateY(Math.PI / 2);
    const cauU = fin([[-1.72, 0.06], [-2.25, 0.86], [-2.12, 0.86], [-1.9, 0.05]], 0.04, dark); cauU.rotateY(0); 
    const cU = cauU.clone(); cU.rotateY(Math.PI / 2);
    const cauL = fin([[-1.72, 0.0], [-2.12, -0.6], [-2.0, -0.6], [-1.85, 0.02]], 0.04, dark); cauL.rotateY(Math.PI / 2);
    const pecs = [];
    for (const sd of [-1, 1]) { const p = fin([[0, 0], [0.55, -0.12], [0.62, -0.2], [0.05, -0.18]], 0.035, dark); // span along x
      p.rotateZ(sd < 0 ? Math.PI : 0); p.rotateZ(-sd * 0.5); p.translate(sd * 0.3, -0.22, 0.65); pecs.push(p); }
    const eye = new THREE.SphereGeometry(0.035, 6, 4); const eyes = [];
    for (const sd of [-1, 1]) { let e = eye.clone(); if (e.index) e = e.toNonIndexed(); e.deleteAttribute('uv'); e.translate(sd * 0.2, 0.05, 1.42); const cc = []; for (let i = 0; i < e.attributes.position.count; i++) cc.push(0.02, 0.02, 0.02); e.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3)); eyes.push(e); }
    // gills: thin dark slits
    const gills = []; for (const sd of [-1, 1]) for (let k = 0; k < 5; k++) { let b = new THREE.BoxGeometry(0.01, 0.2, 0.012); b = b.toNonIndexed(); b.deleteAttribute('uv'); b.rotateZ(sd * 0.1); b.translate(sd * 0.4 * (0.98 - k * 0.012), -0.02, 0.95 - k * 0.07); const cc = []; for (let i = 0; i < b.attributes.position.count; i++) cc.push(0.18, 0.2, 0.22); b.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3)); gills.push(b); }
    g.deleteAttribute && g.attributes.uv && g.deleteAttribute('uv');
    SHARK_GEO = mergeGeometries([g, dor, cU, cauL, ...pecs, ...eyes, ...gills]);
    // lower jaw: a wedge with a row of teeth + dark red mouth
    const jp = [], jc = [];
    const tri = (a, b, c, cl) => { jp.push(...a, ...b, ...c); for (let k = 0; k < 3; k++) jc.push(cl.r, cl.g, cl.b); };
    const mouth = new THREE.Color(0x5a1a1c), white = new THREE.Color(0xf4f1e8), jbel = belly.clone();
    const W = 0.3, Ln = 0.55;
    tri([-W, 0, 0], [W, 0, 0], [0, 0, Ln], mouth); tri([W, 0, 0], [-W, 0, 0], [0, -0.12, Ln * 0.9], jbel);
    tri([-W, 0, 0], [0, -0.12, Ln * 0.9], [0, 0, Ln], jbel); tri([W, 0, 0], [0, 0, Ln], [0, -0.12, Ln * 0.9], jbel);
    for (let k = 0; k < 9; k++) { const u = k / 8, x = lerp(-W * 0.9, W * 0.9, u), zz = Ln * (1 - Math.abs(u - 0.5) * 1.7) - 0.02; tri([x - 0.025, 0, zz], [x + 0.025, 0, zz], [x, 0.07, zz - 0.01], white); }
    JAW_GEO = new THREE.BufferGeometry(); JAW_GEO.setAttribute('position', new THREE.Float32BufferAttribute(jp, 3)); JAW_GEO.setAttribute('color', new THREE.Float32BufferAttribute(jc, 3)); JAW_GEO.computeVertexNormals();
  }
  function makeShark(i) {
    sharkGeos();
    const uni = { uPh: { value: Math.random() * 10 }, uAmp: { value: 0.12 } };
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.0 });
    mat.onBeforeCompile = (sh) => { sh.uniforms.uPh = uni.uPh; sh.uniforms.uAmp = uni.uAmp;
      sh.vertexShader = 'uniform float uPh, uAmp;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float bw = (1.0 - smoothstep(-2.2, 1.2, position.z)); transformed.x += sin(position.z * 1.9 + uPh) * uAmp * bw * bw * 1.6;`); };
    mat.customProgramCacheKey = () => 'l3shark';
    const g = new THREE.Group(); g.rotation.order = 'YXZ'; const body = new THREE.Mesh(SHARK_GEO, mat); g.add(body);
    const jaw = new THREE.Mesh(JAW_GEO, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide })); jaw.position.set(0, -0.22, 1.25); g.add(jaw);
    const sc = 0.88 + (i % 5) * 0.09; g.scale.setScalar(sc); g.visible = false; scene.add(g);
    return { g, uni, jaw, sc };
  }
  // ---- standing man (deck pose): y-up rig, real proportions (~1.8 m), smooth joints; used for the rider on the boat + the crewman
  const STG = {};
  function stGeo() {
    if (STG.torso) return STG;
    // torso lathe: hips (y=0) -> waist -> chest -> shoulders (y=0.56), flattened front/back
    const prof = [[0.0, -0.02], [0.155, 0.0], [0.16, 0.08], [0.15, 0.17], [0.165, 0.28], [0.18, 0.4], [0.185, 0.47], [0.165, 0.53], [0.1, 0.565], [0.0, 0.575]].map(([r, y]) => new THREE.Vector2(r, y));
    STG.torso = new THREE.LatheGeometry(prof, 24); STG.torso.scale(1.18, 1, 0.68);
    STG.pelvis = new THREE.SphereGeometry(0.16, 18, 12); STG.pelvis.scale(1.12, 0.75, 0.78);
    STG.belt = new THREE.CylinderGeometry(0.162, 0.162, 0.045, 24, 1, true); STG.belt.scale(1.13, 1, 0.7);
    STG.buckle = new THREE.BoxGeometry(0.055, 0.04, 0.012);
    STG.collar = new THREE.TorusGeometry(0.068, 0.02, 6, 18); STG.collar.rotateX(Math.PI / 2); STG.collar.scale(1.15, 1, 1.05);
    STG.placket = new THREE.BoxGeometry(0.03, 0.12, 0.006);
    STG.btn = new THREE.SphereGeometry(0.007, 6, 4);
    STG.neck = new THREE.CylinderGeometry(0.052, 0.058, 0.12, 12);
    STG.joint = new THREE.SphereGeometry(1, 14, 10);
    STG.sleeve = new THREE.CylinderGeometry(0.07, 0.062, 0.17, 14, 1); STG.sleeve.translate(0, -0.07, 0);
    STG.upper = new THREE.CapsuleGeometry(0.047, 0.24, 4, 12); STG.upper.translate(0, -0.15, 0);
    STG.fore = new THREE.CapsuleGeometry(0.04, 0.22, 4, 12); STG.fore.translate(0, -0.13, 0);
    const hand = new THREE.CapsuleGeometry(0.036, 0.07, 3, 8); hand.scale(1, 1, 0.55); hand.translate(0, -0.07, 0); STG.hand = hand;
    const thumb = new THREE.CapsuleGeometry(0.014, 0.04, 3, 6); thumb.translate(0, -0.03, 0); STG.thumb = thumb;
    STG.thigh = new THREE.CapsuleGeometry(0.078, 0.36, 4, 14); STG.thigh.translate(0, -0.22, 0);
    STG.shin = new THREE.CapsuleGeometry(0.06, 0.37, 4, 14); STG.shin.translate(0, -0.22, 0);
    const sh = new THREE.CapsuleGeometry(0.05, 0.17, 4, 10); sh.rotateX(Math.PI / 2); sh.scale(0.95, 0.7, 1); sh.translate(0, -0.035, 0.05); STG.shoe = sh;
    STG.sole = new THREE.BoxGeometry(0.095, 0.018, 0.27); STG.sole.translate(0, -0.07, 0.05);
    STG.skull = new THREE.SphereGeometry(0.1, 24, 18); STG.skull.scale(0.86, 1.06, 0.98);
    STG.jaw = new THREE.SphereGeometry(0.075, 16, 12); STG.jaw.scale(0.92, 0.85, 0.95);
    STG.chin = new THREE.SphereGeometry(0.03, 10, 8);
    const hc = new THREE.SphereGeometry(0.105, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.52); hc.scale(0.9, 0.9, 1.02); STG.hairCap = hc;
    const hb = new THREE.SphereGeometry(0.104, 18, 12, Math.PI * 0.6, Math.PI * 0.8, Math.PI * 0.35, Math.PI * 0.35); hb.scale(0.9, 1.04, 1.02); STG.hairBack = hb;
    STG.nose = new THREE.ConeGeometry(0.016, 0.045, 8); STG.nose.rotateX(Math.PI / 2 + 0.25);
    STG.ear = new THREE.SphereGeometry(0.024, 10, 8); STG.ear.scale(0.45, 1, 0.75);
    STG.eye = new THREE.SphereGeometry(0.011, 8, 6);
    STG.brow = new THREE.BoxGeometry(0.034, 0.008, 0.01);
    STG.mouth = new THREE.BoxGeometry(0.035, 0.006, 0.006);
    STG.vest = new THREE.CylinderGeometry(0.2, 0.19, 0.42, 20, 1, true); STG.vest.scale(1.1, 1, 0.75);
    return STG;
  }
  // look: { shirt, hair, pants, vest? (life-jacket colour), cap? }
  function makeStandMan(look) {
    if (RM.ready) return makeRealMan(look);
    const G = stGeo();
    const shirt = new THREE.MeshStandardMaterial({ color: look.shirt, roughness: 0.62 });
    const hairM = new THREE.MeshStandardMaterial({ color: look.hair, roughness: 0.45 });
    const pants = new THREE.MeshStandardMaterial({ color: look.pants, roughness: 0.7 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x2e1d12, roughness: 0.38 });
    const shoeM = new THREE.MeshStandardMaterial({ color: 0x15100c, roughness: 0.22, metalness: 0.1 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xc0ad7a, roughness: 0.3, metalness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a120e, roughness: 0.3 });
    const lip = new THREE.MeshStandardMaterial({ color: 0x9a5a4a, roughness: 0.5 });
    const M = (geo, mat, p, par, s) => { const m = new THREE.Mesh(geo, mat); if (p) m.position.set(p[0], p[1], p[2]); if (s) m.scale.setScalar(s); par.add(m); return m; };
    const g = new THREE.Group(); g.rotation.order = 'YXZ';
    const pelvis = new THREE.Group(); pelvis.position.y = 0.94; g.add(pelvis);          // weight shift + breathing pivot
    M(G.pelvis, pants, [0, -0.02, 0], pelvis);
    M(G.belt, leather, [0, 0.07, 0], pelvis); M(G.buckle, metal, [0, 0.07, 0.115], pelvis);
    const chest = new THREE.Group(); chest.position.y = 0.06; pelvis.add(chest);        // spine
    M(G.torso, shirt, [0, 0.0, 0], chest);
    if (look.vest) { const vm = new THREE.MeshStandardMaterial({ color: look.vest, roughness: 0.55 }); M(G.vest, vm, [0, 0.31, 0], chest); }
    else { M(G.placket, shirt, [0, 0.49, 0.112], chest); M(G.btn, metal, [0, 0.52, 0.116], chest); M(G.btn, metal, [0, 0.47, 0.118], chest); }
    const col = M(G.collar, shirt, [0, 0.57, 0.005], chest); col.rotation.x = -0.18;
    M(G.neck, SKIN, [0, 0.6, 0.0], chest);
    const head = new THREE.Group(); head.position.set(0, 0.66, 0.005); chest.add(head);
    const hd = new THREE.Group(); hd.position.y = 0.1; head.add(hd);
    M(G.skull, SKIN, [0, 0.0, 0], hd); M(G.jaw, SKIN, [0, -0.055, 0.025], hd); M(G.chin, SKIN, [0, -0.095, 0.06], hd);
    M(G.hairCap, hairM, [0, 0.03, -0.012], hd); M(G.hairBack, hairM, [0, -0.005, -0.004], hd);
    M(G.nose, SKIN, [0, -0.01, 0.1], hd); M(G.mouth, lip, [0, -0.06, 0.085], hd);
    for (const sd of [-1, 1]) { M(G.ear, SKIN, [sd * 0.088, -0.005, -0.005], hd); M(G.eye, dark, [sd * 0.033, 0.015, 0.088], hd); const br = M(G.brow, hairM, [sd * 0.034, 0.04, 0.09], hd); br.rotation.z = sd * -0.1; }
    const arms = [], elb = [], legs = [], knees = [];
    for (const sd of [-1, 1]) {
      const shd = new THREE.Group(); shd.position.set(sd * 0.2, 0.5, -0.005); chest.add(shd);
      M(G.joint, shirt, [0, 0, 0], shd, 0.072); M(G.sleeve, shirt, [0, 0, 0], shd); M(G.upper, SKIN, [0, 0, 0], shd);
      const e = new THREE.Group(); e.position.set(0, -0.3, 0); shd.add(e);
      M(G.joint, SKIN, [0, 0, 0], e, 0.044); M(G.fore, SKIN, [0, 0, 0], e);
      const wr = new THREE.Group(); wr.position.set(0, -0.27, 0); e.add(wr);
      const hn = M(G.hand, SKIN, [0, 0, 0], wr); hn.rotation.y = sd * 0.3; const th = M(G.thumb, SKIN, [-sd * 0.02, -0.02, 0.02], wr); th.rotation.set(0.3, 0, sd * 0.5);
      arms.push(shd); elb.push(e);
      const hip = new THREE.Group(); hip.position.set(sd * 0.095, -0.02, 0); pelvis.add(hip);
      M(G.thigh, pants, [0, 0, 0], hip);
      const kn = new THREE.Group(); kn.position.set(0, -0.44, 0); hip.add(kn);
      M(G.joint, pants, [0, 0, 0], kn, 0.064); M(G.shin, pants, [0, 0, 0], kn);
      const ft = new THREE.Group(); ft.position.set(0, -0.44, 0); kn.add(ft); M(G.shoe, shoeM, [0, 0, 0], ft); M(G.sole, dark, [0, 0, 0], ft);
      legs.push(hip); knees.push(kn);
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    return { g, pelvis, chest, head, arms, elb, legs, knees };
  }
  // natural standing animation. mode: 'idle' | 'cheer' | 'wave'; t seconds; ph per-man phase offset
  function poseStandMan(m, t, mode, k) {
    if (m.real) return poseRealMan(m, t, mode, k == null ? 1 : k);
    k = k == null ? 1 : k;
    const br = Math.sin(t * 1.6), sw = Math.sin(t * 0.55);
    // weight shift onto one leg: hips sway + roll, standing knee straight, other knee soft; feet stay planted (hip roll compensated)
    const shift = sw * 0.025;
    m.pelvis.position.x = shift; m.pelvis.position.y = 0.94 - Math.abs(sw) * 0.008; m.pelvis.rotation.z = -sw * 0.04;
    for (let s = 0; s < 2; s++) { const sd = s ? 1 : -1; m.legs[s].rotation.set(-0.02, 0, sw * 0.04 - shift / 0.9 * 1.0); m.knees[s].rotation.x = 0.04 + Math.max(0, sd * sw) * 0.08; m.legs[s].rotation.x -= Math.max(0, sd * sw) * 0.04; }
    m.chest.rotation.set(-0.02 + br * 0.012, sw * 0.05, sw * 0.05); m.chest.scale.set(1, 1 + br * 0.006, 1 + br * 0.012);
    m.head.rotation.set(0.04 - br * 0.01, -sw * 0.12, -sw * 0.03);
    // arms
    const rest = (s) => { const sd = s ? 1 : -1; m.arms[s].rotation.set(0.05 + br * 0.02, 0, sd * (0.09 + br * 0.01)); m.elb[s].rotation.set(-0.18, 0, 0); };
    if (mode === 'idle') { rest(0); rest(1); return; }
    if (mode === 'cheer') { // both arms up, pumping, little bounce
      const pmp = Math.abs(Math.sin(t * 5.5));
      for (let s = 0; s < 2; s++) { const sd = s ? 1 : -1; m.arms[s].rotation.set(-0.15, 0, sd * (2.75 - pmp * 0.25) * k + sd * 0.09 * (1 - k)); m.elb[s].rotation.set(-0.25 - pmp * 0.5 * k, 0, 0); }
      m.pelvis.position.y += pmp * 0.025 * k; m.head.rotation.x -= 0.18 * k; for (let s = 0; s < 2; s++) m.knees[s].rotation.x += pmp * 0.1 * k; return;
    }
    // wave: right arm raised, forearm swinging side to side, left relaxed
    rest(0);
    const wv = Math.sin(t * 7);
    m.arms[1].rotation.set(-0.25 * k, 0, (0.09 + 2.35 * k)); m.elb[1].rotation.set(0, 0, 0); m.elb[1].rotation.x = -0.25 * k; m.elb[1].rotation.z = (-0.55 + wv * 0.45) * k;
    m.chest.rotation.z -= 0.04 * k; m.head.rotation.z += 0.05 * k;
  }

  // ---- REAL rigged human (Quaternius Universal Base Characters, CC0) + Universal Animation Library clips (CC0).
  // Clothing (cream polo, leather belt, dark trousers, dress shoes) is painted onto the skinned body in the shader
  // from bind-pose bone regions, so it deforms exactly with the skeleton. Cheer / wave are layered on the arm bones
  // over the mocap idle (AnimationMixer, crossfaded idle <-> talking-idle).
  const RM = { ready: false, p: null };
  function loadRealMan() {
    if (RM.p) return RM.p;
    const gl = new GLTFLoader(), ld = (u) => new Promise((res) => gl.load(u, res, undefined, (e) => { console.warn('[l3] man', u, e); res(null); }));
    RM.p = Promise.all([ld('./assets/l3/man/man.glb?v=1'), ld('./assets/l3/man/hair.glb?v=1'), ld('./assets/l3/man/anims.glb?v=1')]).then(([m, h, a]) => {
      if (!m || !a) return; try { prepRealMan(m, h, a); RM.ready = true; } catch (e) { console.warn('[l3] man prep', e); } });
    TEXP.push(RM.p); return RM.p;
  }
  function prepRealMan(m, h, a) {
    const root = m.scene; root.updateMatrixWorld(true);
    root.traverse(o => { if (o.isMesh && o.material && /Hair/.test(o.material.name)) { o.material.alphaTest = 0.5; o.material.transparent = false; } if (o.isMesh && /Eye/.test(o.material.name)) { o.material.color.setScalar(0.55); o.material.roughness = 0.15; } });
    let body = null; root.traverse(o => { if (o.isSkinnedMesh) { o.frustumCulled = false; o.castShadow = true; if (!body || o.geometry.attributes.position.count > body.geometry.attributes.position.count) body = o; } });
    const box = new THREE.Box3().setFromObject(body); const ht = box.max.y - box.min.y;
    const bones = {}; body.skeleton.bones.forEach(b => { bones[b.name] = b; });
    const bw = (n) => bones[n].getWorldPosition(new V3());
    const yP = bw('pelvis').y, yS1 = bw('spine_01').y, yNeck = bw('neck_01').y;
    const waist = yP + (yS1 - yP) * 0.4, beltH = ht * 0.028;
    const sh = [bw('upperarm_l'), bw('upperarm_r')], el = [bw('lowerarm_l'), bw('lowerarm_r')];
    // per-vertex cloth weights: x shirt, y trousers, z shoes, w belt  (skin = the rest)
    const SB = [new THREE.Box3(), new THREE.Box3()];
    const G = body.geometry, P = G.attributes.position, SI = G.attributes.skinIndex, SW = G.attributes.skinWeight, N = P.count;
    const GC = [P.getX, P.getY, P.getZ, P.getW], cw = new Float32Array(N * 4), v = new V3(), names = body.skeleton.bones.map(b => b.name);
    for (let i = 0; i < N; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(body.matrixWorld);
      let arm = 0, foot = 0, leg = 0, head = 0;
      for (let k = 0; k < 4; k++) { const n = names[GC[k].call(SI, i)], w = GC[k].call(SW, i);
        if (/hand|lowerarm|thumb|index|middle|ring|pinky/.test(n)) arm += w; else if (/foot|ball/.test(n)) foot += w; else if (/thigh|calf/.test(n)) leg += w; else if (/Head|neck/.test(n)) head += w; else if (/upperarm/.test(n)) {
          const s = sh[n.endsWith('_l') ? 0 : 1], e = el[n.endsWith('_l') ? 0 : 1]; const u = v.clone().sub(s).dot(e.clone().sub(s)) / e.distanceToSquared(s); arm += w * sstep(0.42, 0.5, u); } }
      const ankle = box.min.y + ht * 0.062;
      const shoe = Math.max(sstep(0.35, 0.6, foot), 1 - sstep(ankle - 0.01, ankle + 0.01, v.y));
      const collar = 1 - sstep(yNeck - ht * 0.045, yNeck - ht * 0.03, v.y);   // polo collar rides up the neck a little
      const mask = (1 - sstep(0.4, 0.6, arm)) * Math.max(1 - sstep(0.3, 0.7, head), collar);
      cw.set([mask, shoe, v.y, 0], i * 4);
      if (shoe > 0.5) { const sb = v.x > 0 ? SB[0] : SB[1]; sb.expandByPoint(v); }
    }
    G.setAttribute('cloth', new THREE.BufferAttribute(cw, 4));
    const bm = body.material; bm.map && (bm.map.colorSpace = THREE.SRGBColorSpace);
    RM.scene = root; RM.body = body; RM.scale = 1.8 / ht; RM.minY = box.min.y; RM.headBone = 'Head'; RM.waist = waist; RM.beltH = beltH; RM.shX = Math.abs(sh[0].x - sh[1].x) / 2; RM.SB = SB; RM.footN = [SB[0].getCenter(new V3()).distanceTo(bw('foot_l')) < SB[0].getCenter(new V3()).distanceTo(bw('foot_r')) ? 'foot_l' : 'foot_r'];
    RM.footN[1] = RM.footN[0] === 'foot_l' ? 'foot_r' : 'foot_l'; console.log('[l3] man ht', ht.toFixed(3), [...new Set((()=>{const a=[];root.traverse(o=>{if(o.isMesh)a.push(o.name+':'+o.material.name+':'+o.material.transparent+':'+(o.material.map&&o.material.map.format))});return a;})())].join(' '));
    // hair: static mesh authored at the bind pose -> parent to the head bone
    if (h) { RM.hair = h.scene; RM.hair.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } }); }
    // clips: rotations only (+ pelvis translation) so the mannequin's bone lengths don't distort this body
    RM.clips = {}; for (const c of a.animations) { const tr = c.tracks.filter(t => t.name.endsWith('.quaternion') && !/^(foot|ball|thigh|calf)_/.test(t.name)); RM.clips[c.name] = new THREE.AnimationClip(c.name, c.duration, tr); }
  }
  function clothMat(base, look) {
    const m = base.clone();
    const U = { cShirt: { value: new THREE.Color(look.shirt) }, cPants: { value: new THREE.Color(look.pants) }, cShoe: { value: new THREE.Color(0x120d0a) }, cBelt: { value: new THREE.Color(0x3a2416) }, cVest: { value: new THREE.Color(look.vest || 0) }, vest: { value: look.vest ? 1 : 0 }, uShX: { value: RM.shX * 0.8 }, uWaist: { value: RM.waist }, uBH: { value: RM.beltH } };
    m.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 cloth; uniform float vest, uShX, uWaist, uBH; varying vec4 vCloth; varying vec3 vOP; vec4 clothReg(vec3 c){ float sh = c.x * smoothstep(uWaist - 0.003, uWaist + 0.003, c.z); float be = c.x * (smoothstep(uWaist - uBH - 0.003, uWaist - uBH + 0.003, c.z) - smoothstep(uWaist - 0.003, uWaist + 0.003, c.z)); float sho = c.y; float pa = c.x * (1.0 - smoothstep(uWaist - uBH - 0.003, uWaist - uBH + 0.003, c.z)) * (1.0 - sho); return vec4(sh, pa, sho, be); }')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCloth = cloth; vOP = position; vec4 cR = clothReg(cloth.xyz); transformed += objectNormal * (cR.x * (0.022 + vest * 0.035 * (1.0 - smoothstep(uShX - 0.03, uShX, abs(position.x)))) + cR.y * 0.024 - cR.z * 0.012 + cR.w * 0.026);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 cShirt, cPants, cShoe, cBelt, cVest; uniform float vest, uShX, uWaist, uBH; varying vec4 vCloth; varying vec3 vOP; vec4 clothReg(vec3 c){ float sh = c.x * smoothstep(uWaist - 0.003, uWaist + 0.003, c.z); float be = c.x * (smoothstep(uWaist - uBH - 0.003, uWaist - uBH + 0.003, c.z) - smoothstep(uWaist - 0.003, uWaist + 0.003, c.z)); float sho = c.y; float pa = c.x * (1.0 - smoothstep(uWaist - uBH - 0.003, uWaist - uBH + 0.003, c.z)) * (1.0 - sho); return vec4(sh, pa, sho, be); }')
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec4 CR = clothReg(vCloth.xyz);
          float knit = 0.97 + 0.03 * sin(vOP.x * 420.0) * sin(vOP.y * 420.0);
          float weave = 0.95 + 0.05 * sin((vOP.y + vOP.x) * 600.0);
          float vz = vest * (1.0 - smoothstep(uShX - 0.03, uShX, abs(vOP.x))); vec3 shirtC = mix(cShirt, cVest * (0.9 + 0.1 * sin(vOP.y * 140.0)), vz);
          float cl = clamp(CR.x + CR.y + CR.z + CR.w, 0.0, 1.0);
          vec3 cc = (shirtC * knit * CR.x + cPants * weave * CR.y + cShoe * CR.z + cBelt * CR.w) / max(cl, 1e-3);
          diffuseColor.rgb = mix(diffuseColor.rgb, cc, cl);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.9, CR.x); roughnessFactor = mix(roughnessFactor, 0.78, CR.y); roughnessFactor = mix(roughnessFactor, 0.28, CR.z); roughnessFactor = mix(roughnessFactor, 0.45, CR.w);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          normal = normalize(mix(normal, normalize(vNormal) * faceDirection, clamp(CR.x + CR.y + CR.z + CR.w, 0.0, 1.0)));`);
    };
    m.customProgramCacheKey = () => 'l3cloth';
    return m;
  }
  function makeRealMan(look) {
    const g = new THREE.Group(); g.rotation.order = 'YXZ';
    const r = SkeletonUtils.clone(RM.scene); r.scale.setScalar(RM.scale); r.position.y = -RM.minY * RM.scale; g.add(r);
    let body = null; r.traverse(o => { if (o.isSkinnedMesh) { o.frustumCulled = false; o.castShadow = true; if (o.geometry === RM.body.geometry) body = o; } });
    body.material = clothMat(RM.body.material, look);
    const bones = {}; body.skeleton.bones.forEach(b => { bones[b.name] = b; });
    if (RM.hair) { r.updateMatrixWorld(true); const hr = RM.hair.clone(); hr.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color = new THREE.Color(look.hair).multiplyScalar(4.0); } });
      r.add(hr); hr.position.set(0, 0, 0); hr.updateMatrixWorld(true); bones.Head.attach(hr); }
    // slim the 'superhero' build toward a regular adult: narrower chest, slimmer arms (head/neck counter-scaled)
    const sc = (n, x, y, z) => { if (bones[n]) bones[n].scale.set(x, y, z); };
    sc('spine_03', 0.92, 1, 0.94); sc('neck_01', 1 / 0.92, 1, 1 / 0.94); sc('clavicle_l', 0.95, 1, 0.95); sc('clavicle_r', 0.95, 1, 0.95);
    sc('upperarm_l', 0.86, 1, 0.86); sc('upperarm_r', 0.86, 1, 0.86); sc('hand_l', 1.08, 1, 1.08); sc('hand_r', 1.08, 1, 1.08);
    sc('thigh_l', 0.93, 1, 0.93); sc('thigh_r', 0.93, 1, 0.93);
    // dress shoes: polished leather upper + sole, fitted to the bind-pose foot bounds, riding the foot bone
    r.updateMatrixWorld(true);
    const leather = new THREE.MeshStandardMaterial({ color: 0x15100c, roughness: 0.25, metalness: 0.05 }), soleM = new THREE.MeshStandardMaterial({ color: 0x0b0806, roughness: 0.6 });
    for (let s = 0; s < 2; s++) { const bb = RM.SB[s], c = bb.getCenter(new V3()), sz = bb.getSize(new V3());
      const fwdZ = true; const L = (fwdZ ? sz.z : sz.x) + 0.015, Wd = (fwdZ ? sz.x : sz.z) + 0.008, Hh = Math.min(sz.y, 0.075) + 0.01;
      const up = new THREE.SphereGeometry(0.5, 24, 14); const pa = up.attributes.position;
      for (let i = 0; i < pa.count; i++) { let x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i); // z along the foot (+ = toe)
        const toe = Math.max(0, z) * 2; x *= 1 - toe * 0.28; y = Math.max(y, -0.32) * (1 - toe * 0.35) - toe * 0.04; if (y < 0) y *= 0.6; pa.setXYZ(i, x, y, z); }
      up.computeVertexNormals(); up.scale(Wd, Hh * 1.25, L * 0.97);
      const shoe = new THREE.Group(); const um = new THREE.Mesh(up, leather); um.position.y = Hh * 0.35; shoe.add(um);
      const so = new THREE.Mesh(new THREE.BoxGeometry(Wd * 0.74, 0.014, L * 0.8), soleM); so.position.set(0, 0.008, L * 0.04); shoe.add(so);
      const hl = new THREE.Mesh(new THREE.BoxGeometry(Wd * 0.62, 0.028, L * 0.2), soleM); hl.position.set(0, 0.014, -L * 0.3); shoe.add(hl);
      shoe.traverse(o => { if (o.isMesh) o.castShadow = true; });
      // orientation: toe direction = horizontal offset from the foot bone (heel) to the bounds centre
      const fb = bones[RM.footN[s]]; const hp = fb.getWorldPosition(new V3()).applyMatrix4(new THREE.Matrix4().copy(r.matrixWorld).invert());
      const cl = c.clone(); let dz = cl.z - hp.z, dx = cl.x - hp.x; if (Math.hypot(dx, dz) < 1e-3) { dz = 1; dx = 0; }
      shoe.position.set(c.x, bb.min.y, c.z + 0.01); shoe.rotation.y = 0;
      r.add(shoe); shoe.updateMatrixWorld(true); fb.attach(shoe); }
    r.traverse(o => { if (o.isMesh && o.material && /Hair_1/.test(o.material.name) && o !== body) { o.material = o.material.clone(); o.material.color = new THREE.Color(look.hair).multiplyScalar(2.5); } });
    const mixer = new THREE.AnimationMixer(r);
    const A = { idle: mixer.clipAction(RM.clips.Idle_Loop), talk: mixer.clipAction(RM.clips.Idle_Talking_Loop || RM.clips.Idle_Loop) };
    A.idle.play(); A.talk.play(); A.talk.setEffectiveWeight(0);
    return { real: true, g, r, mixer, A, bones, lastT: null, cur: 'idle', wTalk: 0, ua: [bones.upperarm_l, bones.upperarm_r], la: [bones.lowerarm_l, bones.lowerarm_r], fing: body.skeleton.bones.filter(b => /_(0[1-4])(_leaf)?_r$/.test(b.name) && /index|middle|ring|pinky|thumb/.test(b.name)).map(b => [b, b.quaternion.clone()]), hd: [bones.hand_l, bones.hand_r], cl: [bones.clavicle_l, bones.clavicle_r] };
  }
  // aim a bone (in its parent's space) so its +Y (bone axis) points along world dir d, blended by k on top of the animation
  const _rq = new THREE.Quaternion(), _rq2 = new THREE.Quaternion(), _rqp = new THREE.Quaternion(), _rd = new V3(), _ry = new V3(0, 1, 0);
  function aimBone(b, dir, k) {
    if (k <= 0) return; b.parent.getWorldQuaternion(_rqp); b.updateWorldMatrix(true, false); b.getWorldQuaternion(_rq);
    _rd.copy(_ry).applyQuaternion(_rq);                        // current bone axis (world)
    _rq2.setFromUnitVectors(_rd, dir.clone().normalize());     // swing to target
    _rq.premultiply(_rq2); _rq.premultiply(_rqp.invert());       // back to parent space
    b.quaternion.slerp(_rq, k);
  }
  function poseRealMan(m, t, mode, k) {
    const dt = m.lastT == null ? 0 : Math.min(0.1, Math.max(0, t - m.lastT)); m.lastT = t;
    // idle <-> talking idle crossfade (talking idle has natural gestures; used while waving / between cheers)
    // no bone overrides: 'cheer'/'wave' crossfade into the real mocap talking-idle (natural arm gestures), else plain idle
    m.wTalk += ((mode === 'idle' ? 0 : 1) * k - m.wTalk) * Math.min(1, dt * 2.5);
    m.A.talk.setEffectiveWeight(m.wTalk); m.A.idle.setEffectiveWeight(1 - m.wTalk);
    m.mixer.update(dt);
  }
  // ---- rescue boat
  const DECK_SLOTS = [[-1.25, -4.95, 0.25], [1.2, -5.0, -0.25], [-1.45, -3.2, 0.5], [0.0, -2.75, 0.0], [-0.05, -5.0, 0.05], [0.75, -3.35, -0.35], [-1.7, -4.1, 0.6], [1.6, -4.2, -0.5]];
  const _dk = new V3();
  let BOAT = null;
  function buildBoat() {
    loadRealMan(); loadCraft();
    const g = new THREE.Group(); const L = 13, NS = 26, pos = [], col = [], idx = [];
    const orange = new THREE.Color(0xe2541c), white = new THREE.Color(0xf2f2ee), red = new THREE.Color(0x8a1e18);
    const sec = (w, dk, kl) => [[-w, dk], [-w * 0.98, 0.9], [-w * 0.86, 0.1], [-w * 0.45, -0.45], [0, kl], [w * 0.45, -0.45], [w * 0.86, 0.1], [w * 0.98, 0.9], [w, dk]];
    for (let i = 0; i <= NS; i++) { const u = i / NS, z = -L / 2 + u * L;            // stern (-z) .. bow (+z)
      const w = 2.05 * (u < 0.62 ? 1 : Math.sqrt(Math.max(0, 1 - ((u - 0.62) / 0.38) ** 2))) + 0.02, dk = 1.55 + 0.6 * sstep(0.6, 1, u), kl = -0.7 + 0.5 * sstep(0.7, 1, u);
      const S = sec(w, dk, kl); for (const [x, y] of S) { pos.push(x, y, z); const c = y > 1.05 ? white : y < -0.1 ? red : orange; col.push(c.r, c.g, c.b); } }
    const NP = 9; for (let i = 0; i < NS; i++) for (let j = 0; j < NP - 1; j++) { const a = i * NP + j, b = a + 1, c = a + NP, d = c + 1; idx.push(a, c, b, b, c, d); }
    // transom
    const tb = pos.length / 3; for (let j = 0; j < NP; j++) { pos.push(pos[j * 3] * 0.98, pos[j * 3 + 1], -L / 2); col.push(orange.r, orange.g, orange.b); }
    const tc = pos.length / 3; pos.push(0, 0.6, -L / 2); col.push(orange.r, orange.g, orange.b); for (let j = 0; j < NP - 1; j++) idx.push(tc, tb + j + 1, tb + j);
    let hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); hg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); hg.setIndex(idx); hg = hg.toNonIndexed(); hg.computeVertexNormals();
    const hull = new THREE.Mesh(hg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, side: THREE.DoubleSide })); hull.castShadow = true; g.add(hull);
    const deckM = new THREE.MeshStandardMaterial({ color: 0xb9bcb8, roughness: 0.8 }), whiteM = new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.5 }), glass = new THREE.MeshStandardMaterial({ color: 0x1b2730, roughness: 0.08, metalness: 0.8 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.3, metalness: 0.85 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.08, 10.2), deckM); deck.position.set(0, 1.5, -0.6); g.add(deck);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.7, 3.2), whiteM); cab.position.set(0, 2.35, 0.9); cab.castShadow = true; g.add(cab);
    const win = new THREE.Mesh(new THREE.BoxGeometry(2.64, 0.55, 2.7), glass); win.position.set(0, 2.75, 0.95); g.add(win);
    const ws = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 0.05), glass); ws.position.set(0, 2.85, 2.53); ws.rotation.x = -0.35; g.add(ws);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.12, 3.6), whiteM); roof.position.set(0, 3.25, 0.9); g.add(roof);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.6, 8), steel); mast.position.set(0, 4.5, 0.6); g.add(mast);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.18), new THREE.MeshStandardMaterial({ color: 0x1a4fd0, emissive: 0x2050ff, emissiveIntensity: 1.5 })); bar.position.set(0, 3.42, 1.6); g.add(bar);
    // rails
    const rail = (pts) => { const c = new THREE.CatmullRomCurve3(pts.map(p => new V3(...p))); const m = new THREE.Mesh(new THREE.TubeGeometry(c, 40, 0.035, 6, false), steel); g.add(m); };
    rail([[-1.95, 2.45, -5.9], [-2.0, 2.45, 0], [-1.6, 2.6, 4.6], [0, 2.75, 6.4]]); rail([[1.95, 2.45, -5.9], [2.0, 2.45, 0], [1.6, 2.6, 4.6], [0, 2.75, 6.4]]);
    for (const sd of [-1, 1]) for (let k = 0; k < 7; k++) { const z = -5.6 + k * 1.6; const p = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 5), steel); p.position.set(sd * (z > 3 ? 1.75 : 1.97), 2.0, z); g.add(p); }
    // RESCUE lettering
    const tex = canvasTex(512, 96, (c, w, h) => { c.fillStyle = '#fff'; c.font = '900 76px Arial'; c.textAlign = 'center'; c.fillText('RESCUE', w / 2, 76); });
    for (const sd of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.8), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: true }));
      p.position.set(sd * 2.07, 0.62, 0.8); p.rotation.y = sd * Math.PI / 2; g.add(p); }
    // stern ladder (into the water)
    for (const sd of [-1, 1]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.9, 6), steel); r.position.set(sd * 0.32, 0.55, -L / 2 - 0.18); r.rotation.x = 0.12; g.add(r); }
    for (let k = 0; k < 6; k++) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.64, 5), steel); r.rotation.z = Math.PI / 2; r.position.set(0, -0.7 + k * 0.45, -L / 2 - 0.18 - (-0.7 + k * 0.45 - 0.55) * -0.12); g.add(r); }
    // outboards
    for (const sd of [-1, 1]) { const ob = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.9, 0.55), new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.4 })); ob.position.set(sd * 1.1, 1.3, -L / 2 - 0.25); g.add(ob); }
    // life rings
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.08, 8, 16), new THREE.MeshStandardMaterial({ color: 0xff5a10, roughness: 0.6 })); ring.position.set(1.32, 2.4, 0.2); ring.rotation.y = Math.PI / 2; g.add(ring);
    // a crewman in a life jacket at the stern, waving the riders in
    const crewM = makeStandMan({ shirt: 0x24324a, hair: 0x2a1c14, pants: 0x2b2f36, vest: 0xff5a10 });
    crewM.g.position.set(-1.45, 1.54, -2.3); crewM.g.rotation.y = Math.PI - 0.5; g.add(crewM.g);
    const proc = g.children.filter(o => o !== crewM.g && o !== bar);
    // foam collar where the hull meets the sea (soft ring, slightly heavier at the bow and the stern quarter)
    const ft0 = canvasTex(128, 256, (c, w, h) => { const img = c.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const u = (x / w - 0.5) * 2, v = (y / h - 0.5) * 2, d = Math.hypot(u, v * 1.0);
        const n = 0.55 + 0.45 * Math.sin(x * 0.9 + y * 0.31) * Math.sin(y * 0.53 - x * 0.27); const a = Math.exp(-((d - 0.8) ** 2) / 0.012) * n + Math.exp(-((d - 0.92) ** 2) / 0.004) * 0.5 * n; const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 248; img.data[i + 3] = Math.min(1, a) * 220; }
      c.putImageData(img, 0, 0); });
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 23).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: ft0, transparent: true, depthWrite: false, fog: true, opacity: 0.85 }));
    foam.position.set(0, 0.2, 2.2); foam.renderOrder = 2; foam.visible = false; g.add(foam);
    g.rotation.y = BOAT_YAW; g.visible = false; scene.add(g);
    BOAT = { g, crew: crewM, bar, flare: null, flT: 3, hornT: 1.5, deckSlots: 0, proc, foam, letters: proc.filter(o => o.material && o.material.map && o.geometry.type === 'PlaneGeometry') };
    // flare (additive glow sprite; no real light, so nothing recompiles)
    const ft = canvasTex(64, 64, (c) => { const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,240,220,1)'); gr.addColorStop(0.25, 'rgba(255,60,30,0.9)'); gr.addColorStop(1, 'rgba(255,0,0,0)'); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); });
    const fs = new THREE.Sprite(new THREE.SpriteMaterial({ map: ft, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, toneMapped: false })); fs.scale.set(9, 9, 1); fs.visible = false; scene.add(fs);
    BOAT.flare = { s: fs, p: new V3(), v: new V3(), t: 0, on: false };
  }
  function swapBoat() {
    if (!BOAT || BOAT.real || !CRAFT.ready) return;
    const y = CRAFT.yacht.clone(true); y.position.copy(YACHT_OFF); BOAT.g.add(y); BOAT.real = y;
    BOAT.proc.forEach(o => { o.visible = BOAT.letters.includes(o); }); BOAT.foam.visible = true;
    // RESCUE on the topsides, light bar on the hardtop, crewman in the aft cockpit by the transom gate
    BOAT.letters.forEach(p => { p.position.set(Math.sign(p.position.x) * 2.47, 1.55, 3.6); p.scale.setScalar(0.85); });
    BOAT.bar.position.set(0, 9.04 - 0.62 + 0.02, 2.6 - 1.2); BOAT.bar.scale.set(1, 0.8, 1);
    BOAT.crew.g.position.set(1.7, DECK_Y, -2.75); BOAT.crew.g.rotation.y = Math.PI - 0.45;
  }
  function swapCrew() { swapBoat(); if (!RM.ready || !BOAT || BOAT.crew.real) return; const o = BOAT.crew.g; const c = makeStandMan({ shirt: 0x24324a, hair: 0x2a1c14, pants: 0x2b2f36, vest: 0xff5a10 }); c.g.position.copy(o.position); c.g.rotation.copy(o.rotation); o.parent.add(c.g); o.parent.remove(o); BOAT.crew = c; poseStandMan(c, 0, 'idle', 1); }
  function updateBoat(dt, t) {
    if (!BOAT || !BOAT.g.visible) return;
    const x = BOAT_P.x, z = BOAT_P.z, B = fromBoat(0, 9), S = fromBoat(0, -6), Pt = fromBoat(-2.4, 1), Sb = fromBoat(2.4, 1);
    const hb = waterHJ(B[0], B[1]), hs = waterHJ(S[0], S[1]), hl = waterHJ(Pt[0], Pt[1]), hr = waterHJ(Sb[0], Sb[1]);
    BOAT.g.position.set(x, (hb + hs + hl + hr) / 4 - 0.15, z);
    BOAT.g.rotation.order = 'YXZ'; BOAT.g.rotation.set(-Math.atan2(hb - hs, 15) * 0.6, BOAT_YAW, Math.atan2(hr - hl, 4.8) * 0.45);
    swapCrew();
    poseStandMan(BOAT.crew, t + 1.3, 'wave', 1); BOAT.bar.material.emissiveIntensity = (Math.sin(t * 9) > 0 ? 2.2 : 0.3);
    const F = BOAT.flare; BOAT.flT -= dt;
    if (BOAT.flT <= 0 && !F.on) { BOAT.flT = 22; F.on = true; F.t = 0; F.p.set(x, 4, z - 2); F.v.set(2, 42, 6); }
    if (F.on) { F.t += dt; F.v.y -= (F.v.y > -2 ? 12 : 0) * dt; F.p.addScaledVector(F.v, dt); F.s.visible = true; F.s.position.copy(F.p); const fl = 7 + Math.random() * 4; F.s.scale.set(fl, fl, 1);
      if (Math.random() < 0.7) emit(F.p.x, F.p.y, F.p.z, (Math.random() - 0.5) * 0.6, 0.3, (Math.random() - 0.5) * 0.6, 7, 3, 0.85, 0.82, 0.82, 0.5, 0, 0.1, 3);
      if (F.t > 12) { F.on = false; F.s.visible = false; } }
    BOAT.hornT -= dt; if (BOAT.hornT <= 0) { BOAT.hornT = 11; hornSnd(camera.position.distanceTo(BOAT.g.position)); }
  }
  // ---- debris (instanced per type, bobbing on the swell)
  let DEB = null;
  function buildDebris() {
    const m = mats();
    const T = [
      { g: new THREE.BoxGeometry(2.6, 0.06, 0.26), m: m.wood, r: 1.2 },
      { g: new THREE.CylinderGeometry(0.19, 0.24, 5.5, 9).rotateZ(Math.PI / 2), m: m.drift, r: 2.6 },
      { g: new THREE.CapsuleGeometry(0.28, 1.6, 4, 10).rotateZ(Math.PI / 2).scale(1, 0.18, 1), m: new THREE.MeshStandardMaterial({ color: 0xf7f2e4, roughness: 0.35 }), r: 1.1 },
      { g: new THREE.TorusGeometry(0.36, 0.11, 8, 16).rotateX(Math.PI / 2), m: new THREE.MeshStandardMaterial({ color: 0xff5a14, roughness: 0.55 }), r: 0.5 },
      { g: new THREE.BoxGeometry(0.75, 0.45, 0.5), m: new THREE.MeshStandardMaterial({ color: 0x2a7fd0, roughness: 0.5 }), r: 0.5 },
      { g: new THREE.ConeGeometry(1.1, 0.45, 12, 1, true), m: new THREE.MeshStandardMaterial({ map: canvasTex(128, 16, (c, w, h) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#f2f0e8' : '#e0402a'; c.fillRect(i * 16, 0, 16, h); } }), side: THREE.DoubleSide, roughness: 0.7 }), r: 1.0 },
      { g: new THREE.TorusGeometry(0.34, 0.14, 8, 14).rotateX(Math.PI / 2), m: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.9 }), r: 0.45 },
      { g: new THREE.CylinderGeometry(0.3, 0.3, 0.9, 12).rotateZ(Math.PI / 2), m: new THREE.MeshStandardMaterial({ color: 0x1f5fa8, roughness: 0.5, metalness: 0.3 }), r: 0.5 },
    ];
    const N = IS_MOBILE ? 170 : 230, per = T.map(() => []), items = [];
    for (let i = 0; i < N; i++) { const t = i % T.length; const it = { t, x: 0, z: 0, yaw: Math.random() * 6.28, spin: (Math.random() - 0.5) * 0.2, ph: Math.random() * 6, r: T[t].r }; per[t].push(it); items.push(it); }
    const ims = T.map((ty, t) => { const im = new THREE.InstancedMesh(ty.g, ty.m, per[t].length); im.frustumCulled = false; im.visible = false; scene.add(im); return im; });
    DEB = { T, per, items, ims, mt: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler() };
  }
  function scatterDebris(cz0) {
    // spread over the corridor between the swimmers' start and the boat, thicker near the start (the wave's wreckage)
    const L = LADDER();
    DEB.items.forEach((it, i) => { const u = Math.pow(Math.random(), 0.8); it.z = lerp(cz0 + 30, L.z + 40, u); it.x = L.x + (Math.random() - 0.5) * (150 - 90 * u); });
  }
  function updateDebris(dt) {
    if (!DEB || !DEB.ims[0].visible) return; const { per, ims, mt, q, e } = DEB, t = U.uTime.value;
    per.forEach((arr, k) => { arr.forEach((it, i) => { it.yaw += it.spin * dt;
      const h = waterHJ(it.x, it.z), hx = waterHJ(it.x + 1, it.z), hz = waterHJ(it.x, it.z + 1);
      e.set(Math.atan(hz - h) + Math.sin(t + it.ph) * 0.05, it.yaw, -Math.atan(hx - h) + (k === 5 ? 0.9 : 0), 'YXZ'); q.setFromEuler(e);
      mt.compose(_d.set(it.x, h + (k === 5 ? 0.1 : 0.02), it.z), q, _one); ims[k].setMatrixAt(i, mt); }); ims[k].instanceMatrix.needsUpdate = true; });
  }
  const _d = new V3(), _one = new V3(1, 1, 1);
  // ---- ocean phase state: after the wave every rider surfaces on a jet ski (the "swim" phase name is kept internally)
  const SW = [];             // one per racer: { R, player, m (rider), ski, x, z, y, vy, yaw, v, hp, ko, air, offT, ... }
  const SHARKS = [];
  const SWS = { t: 0, dodged: 0, bites: 0, dives: 0, lastAtk: -10, start: null, finishOrder: [], retries: 0, attempts: 0 };
  let swimBuilt = false;
  function ensureSwim() {
    if (swimBuilt) return; swimBuilt = true;
    RACERS.forEach(R => { const W = { R, player: R.player, m: makeSwimmer(R), ski: makeJetSki(R) }; if (!R.player) { W.tag = nameTag(R); W.tag.position.set(0, 2.3, 0); W.ski.g.add(W.tag); } SW.push(W); });
    for (let i = 0; i < 10; i++) SHARKS.push(makeShark(i));
  }
  function setSwimVisible(v) {
    SW.forEach(W => { W.m.g.visible = v; W.ski.g.visible = v; }); SHARKS.forEach(S => { S.g.visible = v; });
    if (BOAT) BOAT.g.visible = v; if (DEB) DEB.ims.forEach(im => { im.visible = v; });
  }
  function setRaceVisible(v) {
    const b = C.getBike(); if (b) b.visible = v; const rd = C.getRider(); if (rd) rd.group.visible = v;
    RACERS.forEach(R => { if (!R.player) { R.a.root.visible = v; R.a.tag.visible = v; } });
    if (WAVE) WAVE.visible = v && EV.wave;
  }
  function startSwim() {
    phase = 'swim'; clock = 0; ensureSwim();
    for (const k of ['KeyW', 'ArrowUp', 'KeyS', 'ArrowDown', 'KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyC']) keys[k] = false;
    RACERS.forEach(R => { if (!R.swept) { R.swept = true; R.sweepH = R.player ? PL.y : R.y; R.sweepT = waveT; R.headStart = clamp(420 - 5 * R.sweepH - 4 * R.sweepT, 160, 420); } });
    SWS.start = RACERS.map(R => R.headStart); SWS.attempts++;
    sirenStop(); roarStop(); ambSwim(true);
    resetSwim(false);
    ui.white.style.transition = 'opacity 1.6s'; ui.white.style.opacity = 0; setTimeout(() => { ui.white.style.transition = 'opacity .5s'; }, 1700);
    toast('JET SKIS! RACE TO THE RESCUE BOAT', 2600);
  }
  // beach head start (160-420, higher ground = less) -> jet-ski run to the boat (1.5-2.5 km)
  function swimDist(hs) { return 1500 + (hs - 160) / 260 * 1000; }
  function resetSwim(isRetry) {
    Object.assign(U.uFront, { value: -3000 }); U.uWaveH.value = 0; U.uSurge.value = 0; U.uBore.value = 0; U.uRecede.value = 0; U.uShore.value = 1; U.uSwell.value = 1.7;
    setRaceVisible(false); setSwimVisible(true); NFX.speedLines(0);
    const L = LADDER();
    let maxZ = L.z;
    SW.forEach((W, i) => { const hs = swimDist(SWS.start[i]);
      const lat = W.player ? 0 : [-16, 14, -28, 26, -8, 8][(i - 1) % 6] + (Math.random() - 0.5) * 4;
      Object.assign(W, { x: L.x + lat, z: L.z + hs, yaw: Math.PI, v: 0, vy: 0, air: false, airT: 0, hp: 3, ko: false, koT: 0, dive: 0, offT: 0, jcd: 0, lean: 0, crouch: 0, pitch: 0, done: false, doneT: 0, climb: 0, rise: 1, react: null, skill: 0.88 + Math.random() * 0.2, wob: Math.random() * 6, bites: 0, jumps: 0, bump: 0, cx: null, cz: null, inGas: false, inBrk: false, inSteer: 0 });
      W.y = waterHJ(W.x, W.z); W.prevWl = W.y; W.slot = null; W.push = null; maxZ = Math.max(maxZ, W.z);
      W.m.g.visible = true; W.ski.g.visible = true; W.ski.g.rotation.set(0, W.yaw, 0); });
    SHARKS.forEach((S, i) => { const a = i / 10 * Math.PI * 2 + Math.random() * 0.3, r = 60 + Math.random() * 90, P = SW[0];
      Object.assign(S, { x: P.x + Math.cos(a) * r, z: P.z - 60 + Math.sin(a) * r * 1.3, yaw: Math.PI, v: 6, st: 'roam', t: 0, tgt: null, depth: 0.55, cx: P.x, cz: P.z, cr: 25 + Math.random() * 30, dir: Math.random() < 0.5 ? -1 : 1, jaw: 0, warned: false });
      S.g.visible = true; });
    SWS.t = 0; SWS.lastAtk = isRetry ? 2 : 3; SWS.aiAtk = 6; SWS.finishOrder.length = 0; SWS.dodged = 0; SWS.bites = 0; SWS.dives = 0;
    scatterDebris(maxZ);
    if (BOAT) { BOAT.flT = 1.5; BOAT.hornT = 2.5; BOAT.deckSlots = 0; }
    camShot = -1; swimCam(1 / 60, true);
    swimUI(true); showHud(false); ui.ko.style.display = 'none';
  }
  // ---- player controls: steer, throttle, brake, hop
  const _w = new V3();
  const SKI = { vmax: 28, acc: 16, brake: 16, drag: 0.03, turn: 1.25, jump: 6.2, g: 15 };
  function swimInput(W, dt) {
    const steer = ((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0);
    W.inSteer = steer; W.inGas = !!(keys.KeyW || keys.ArrowUp); W.inBrk = !!(keys.KeyS || keys.ArrowDown);
    const jump = !!(keys.Space || keys.ShiftLeft || keys.ShiftRight || keys.KeyC);
    if (jump && !W.jHeld) skiJump(W); W.jHeld = jump;
  }
  function skiJump(W) { if (W.air || W.offT > 0 || W.jcd > 0 || W.done || W.ko) return; W.air = true; W.vy = SKI.jump + Math.min(2, W.v * 0.05); W.jcd = 0.35; W.jumps++; if (W.player) { SWS.dives++; splashSnd(0.3); } }
  function skiPhys(W, dt) {
    W.jcd = Math.max(0, W.jcd - dt);
    const wl = waterHJ(W.x, W.z);
    if (W.offT > 0) {   // knocked off: rider in the water beside the drifting ski, then climbs back on
      W.offT -= dt; W.v *= Math.exp(-2.2 * dt); W.air = false; W.y = wl; W.vy = 0;
      if (W.offT <= 0 && !W.ko) { W.offT = 0; W.m.g.visible = true; }
    } else if (!W.ko) {
      const top = SKI.vmax * (W.player ? 1 : 1) * (W.hp === 1 ? 0.9 : 1);
      const thr = W.inGas ? 1 : 0;
      W.v += (thr * SKI.acc * (1 - W.v / top) - (W.inBrk ? SKI.brake : 0) - SKI.drag * W.v - (W.air ? 0 : 0.25)) * dt; W.v = clamp(W.v, 0, top * 1.05);
      const tr = SKI.turn * clamp(0.35 + W.v / 14, 0.35, 1.15) * (W.air ? 0.35 : 1) * (W.inBrk ? 1.25 : 1);
      W.yaw -= (W.inSteer || 0) * tr * dt;
      W.lean += (-(W.inSteer || 0) * clamp(W.v / 18, 0, 1) * 0.42 - W.lean) * Math.min(1, dt * 5);
    } else { W.v *= Math.exp(-1.5 * dt); }
    fwd(W.yaw, _w); W.x += _w.x * W.v * dt; W.z += _w.z * W.v * dt;
    if (W.push) { W.x += W.push.x * dt; W.z += W.push.z * dt; W.push.multiplyScalar(Math.exp(-3 * dt)); }
    // ride the surface; leave it when the swell falls away faster than gravity (crest launches) or on a hop
    const sv = (wl - W.prevWl) / Math.max(dt, 1e-3); W.prevWl = wl;
    if (!W.air) { if (W.v > 9 && sv - W.vy < -SKI.g * dt * 1.0 && W.vy > 0.5) { W.air = true; } else { W.y = wl; W.vy = sv; } }
    if (W.air) { W.vy -= SKI.g * dt; W.y += W.vy * dt; W.airT += dt;
      if (W.y <= wl) { W.y = wl; W.air = false; const imp = Math.max(0, -W.vy); W.vy = sv; W.airT = 0; W.crouch = Math.min(1, imp * 0.12); W.v *= 1 - Math.min(0.12, imp * 0.01);
        if (imp > 3 && camera.position.distanceTo(W.ski.g.position) < 60) { for (let k = 0; k < 14; k++) emit(W.x + (Math.random() - 0.5) * 1.6, wl + 0.1, W.z + (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 4, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 4, 0.9, 0.7, 0.95, 0.97, 1, 0.8, 8, 0.9, 1.4); if (W.player) splashSnd(clamp(imp * 0.06, 0.15, 0.6)); } } }
    W.crouch = Math.max(0, W.crouch - dt * 2.5);
    if (W.ko) W.koT += dt;
    W.dive = W.air ? clamp((W.y - wl) / 0.7, 0, 1) : 0;   // sharks cannot bite a ski that is in the air
    // debris + the boat hull are solid (a ski in the air clears low debris)
    if (!W.air || W.y - wl < 0.4) for (const it of DEB.items) { const dx = W.x - it.x, dz = W.z - it.z, d2 = dx * dx + dz * dz, r = it.r + 0.95;
      if (d2 < r * r && d2 > 1e-4) { const d = Math.sqrt(d2), k = (r - d) / d; W.x += dx * k; W.z += dz * k;
        if (W.v > 8 && W.bump <= 0) { W.v *= 0.55; W.bump = 0.6; if (W.player) { C.state.shake = 0.35; toast('DEBRIS!', 700); } splashSnd(W.player ? 0.4 : 0.1); }
        if (!W.player && !(W.avoidT > 0)) { fwd(W.yaw, _w); W.avoidT = 1.0; W.avoidSd = (_w.x * dz - _w.z * dx) > 0 ? -1 : 1; } } }
    W.bump = Math.max(0, (W.bump || 0) - dt);
    { let [lx, lz] = toBoat(W.x, W.z); if (Math.abs(lx) < 2.7 && lz > -7.3 && lz < 12.3) { const px = 2.7 - Math.abs(lx), pz = lz + 7.3; if (px < pz) lx = Math.sign(lx || 1) * 2.7; else lz = -7.3; [W.x, W.z] = fromBoat(lx, lz); W.v *= 0.9; } }
    poseSki(W, dt, wl);
    // wake + rooster-tail spray
    if (W.v > 6 && !W.air && camera.position.distanceTo(W.ski.g.position) < 90 && Math.random() < 0.85) {
      const bx = W.x - _w.x * 1.7, bz = W.z - _w.z * 1.7;
      emit(bx + (Math.random() - 0.5) * 0.5, wl + 0.15, bz + (Math.random() - 0.5) * 0.5, -_w.x * W.v * 0.25 + (Math.random() - 0.5) * 1.2, 1.5 + W.v * 0.12 * Math.random(), -_w.z * W.v * 0.25 + (Math.random() - 0.5) * 1.2, 0.6 + W.v * 0.02, 0.9, 0.95, 0.97, 1, 0.75, 6, 0.9, 1.3);
      for (const sd of [-1, 1]) if (Math.random() < 0.5) emit(W.x + _w.z * sd * 0.6, wl + 0.08, W.z - _w.x * sd * 0.6, _w.z * sd * 2.2 - _w.x * 2, 0.8 + Math.random(), -_w.x * sd * 2.2 - _w.z * 2, 0.5, 0.6, 0.95, 0.97, 1, 0.6, 4, 1, 1.2);
    }
  }
  function poseSki(W, dt, wl) {
    const k = W.ski; if (!k.real) realSki(k, W.R); k.g.position.set(W.x, W.y - 0.12, W.z); k.g.rotation.set(0, W.yaw, 0);
    k.wake.material.opacity += ((W.air || W.offT > 0 || W.ko ? 0 : clamp((W.v - 3) / 18, 0, 0.8)) - k.wake.material.opacity) * Math.min(1, dt * 4);
    // pitch from the swell slope ahead / in the air nose-up then down; roll into turns
    fwd(W.yaw, _w); const ah = waterHJ(W.x + _w.x * 1.5, W.z + _w.z * 1.5), bh = waterHJ(W.x - _w.x * 1.5, W.z - _w.z * 1.5);
    const tp = W.air ? clamp(W.vy * 0.05, -0.35, 0.3) : Math.atan2(ah - bh, 3) - Math.min(0.12, W.v * 0.005);
    W.pitch += (tp - W.pitch) * Math.min(1, dt * 6);
    k.tilt.rotation.set(-W.pitch, 0, -W.lean - Math.sin(SWS.t * 2.1 + W.wob) * 0.03); k.bars.rotation.y = (W.inSteer || 0) * -0.35;
    if (W.offT > 0 || W.ko) { // rider in the water beside the ski
      if (W.m.g.parent !== scene) scene.add(W.m.g);
      W.m.g.scale.setScalar(1.3); W.m.g.position.set(W.x + Math.cos(W.yaw) * 1.4, wl - 0.1 - (W.ko ? Math.min(3, W.koT * 0.4) : 0), W.z - Math.sin(W.yaw) * 1.4); W.m.g.rotation.set(-0.3, W.yaw, 0.3);
      W.ph = (W.ph || 0) + dt * 5; const m = W.m; m.body.rotation.z = Math.sin(W.ph) * 0.3; for (let s = 0; s < 2; s++) { m.arms[s].rotation.set(-Math.PI / 2 + W.ph + s * Math.PI, 0, 0); m.elb[s].rotation.x = -0.4; m.legs[s].rotation.set(Math.sin(W.ph * 1.6 + s * 3) * 0.3, 0, 0); m.knees[s].rotation.x = -0.2; } m.head.rotation.set(0, 0, 0);
    } else poseRider(W, dt);
    if (W.tag) W.tag.visible = !W.ko && camera.position.distanceTo(k.g.position) < 220;
  }
  // ---- AI jet skis: race for the ladder, avoid debris, hop or swerve when a shark locks on
  function swimAI(W, dt, i) {
    if (W.ko || W.done) { W.inGas = false; return; }
    const L = LADDER(); const dx = L.x - W.x, dz = L.z - W.z, dist = Math.hypot(dx, dz);
    let ty = Math.atan2(dx, dz) + Math.sin(SWS.t * 0.25 + W.wob) * 0.1 * clamp(dist / 200, 0, 1);
    if (W.react && W.react.k === 'dodge') ty += W.react.sd * 0.9;
    // look ahead for debris
    fwd(W.yaw, _w); if (!(W.avoidT > 0)) for (const it of DEB.items) { const ex = it.x - W.x, ez = it.z - W.z, along = ex * _w.x + ez * _w.z; if (along < 2 || along > 28) continue; const lat = ex * _w.z - ez * _w.x; if (Math.abs(lat) < it.r + 1.6) { W.avoidT = 0.7; W.avoidSd = lat > 0 ? 1 : -1; break; } }
    if (W.avoidT > 0) { W.avoidT -= dt; ty += W.avoidSd * 0.7; }
    let dy = ty - W.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    W.inSteer = clamp(-dy * 3, -1, 1);
    const P = SW[0], Lp = Math.hypot(P.x - L.x, P.z - L.z), rb = P.done || P.ko ? 1 : clamp(1 + (dist - Lp) * 0.0012, 0.86, 1.12);
    const tv = (24.2 + 0.7 * (i % 3)) * W.skill * rb * (dist < 60 ? clamp(dist / 60, 0.35, 1) : 1);
    W.inGas = W.v < tv; W.inBrk = W.v > tv + 4;
    if (W.react) { W.react.t -= dt; if (W.react.k === 'dive' && W.react.t < 0.35 && W.react.t > 0.0 && !W.air) skiJump(W); if (W.react.t < -1.2) W.react = null; }
    if (dist < 5.5) finishSwimmer(W);
  }
  function finishSwimmer(W) {
    if (W.done) return; W.done = true; W.doneT = SWS.t; SWS.finishOrder.push(W); W.climb = 0; W.inGas = false;
    if (W.m.g.parent !== scene) scene.add(W.m.g); W.m.g.scale.setScalar(1.3);
    if (W.player) { phase = 'climb'; clock = 0; swimUI(false); skiEngine(0, 0, false); toast('YOU MADE IT TO THE BOAT!', 2200); hornSnd(10); }
  }
  // the ski is tied off at the stern; the rider climbs the ladder, then stands at the rail
  function climbUpdate(W, dt) {
    W.climb = Math.min(1, W.climb + dt / 2.6);
    const L = LADDER(), wl = waterHJ(L.x, L.z), slot = W.slot != null ? W.slot : (W.slot = BOAT.deckSlots++);
    // park the ski behind the boat, fanned out by finishing order
    { const [px, pz] = fromBoat((slot % 4 - 1.5) * 2.4, -10.6 - Math.floor(slot / 4) * 4); W.x = lerp(W.x, px, Math.min(1, dt * 1.5)); W.z = lerp(W.z, pz, Math.min(1, dt * 1.5)); W.v = 0; W.lean *= 0.9;
      const k = W.ski, kw = waterHJ(W.x, W.z); k.g.position.set(W.x, kw - 0.12, W.z); k.g.rotation.y = lerp(k.g.rotation.y, BOAT_YAW, Math.min(1, dt)); k.tilt.rotation.set(Math.sin(SWS.t * 1.3 + slot) * 0.03, 0, Math.sin(SWS.t * 1.7 + slot) * 0.04); if (W.tag) W.tag.visible = false; k.wake.material.opacity *= 0.95; }
    const u = W.climb, up = sstep(0.05, 0.7, u), on = sstep(0.65, 1, u);
    // aft cockpit standing spots (boat-local; clear of the centre hatch, the transom bench and the crewman)
    const SL = DECK_SLOTS[slot % DECK_SLOTS.length], sx = SL[0] * on, sz = lerp(-LADDER_OFF + 0.4, SL[1], on);
    const dp = BOAT.g.localToWorld(_dk.set(sx, BOAT.real ? DECK_Y : 1.55, sz)), deckY = dp.y, tx = dp.x, tz = dp.z;
    W.cx = lerp(W.cx == null ? L.x : W.cx, tx, Math.min(1, dt * 4)); W.cz = lerp(W.cz == null ? L.z : W.cz, tz, Math.min(1, dt * 4));
    const cy = lerp(wl - 0.4, deckY + 1.1, up), cyaw = BOAT_YAW + Math.PI * (1 - on);
    const m = W.m; m.g.position.set(W.cx, cy, W.cz); m.g.rotation.set(-Math.PI / 2 * Math.max(up, on), cyaw, 0);
    m.arms[0].rotation.set(-Math.PI * 0.95 + Math.sin(SWS.t * 6) * 0.4 * (1 - on), 0, 0); m.arms[1].rotation.set(-Math.PI * 0.95 - Math.sin(SWS.t * 6) * 0.4 * (1 - on), 0, 0);
    m.legs[0].rotation.set(Math.sin(SWS.t * 6) * 0.4 * (1 - on), 0, 0); m.legs[1].rotation.set(-Math.sin(SWS.t * 6) * 0.4 * (1 - on), 0, 0);
    m.body.rotation.z = 0; m.head.rotation.set(0, 0, 0); m.elb[0].rotation.x = m.elb[1].rotation.x = -0.35 * (1 - on); m.knees[0].rotation.x = m.knees[1].rotation.x = -0.4 * Math.abs(Math.sin(SWS.t * 6)) * (1 - on);
    m.tag.visible = false;
    // on deck: swap the swim rig for the standing man (real proportions, smooth joints) and animate him naturally
    if (!W.dm) { const lk = m.lk; W.dm = makeStandMan({ shirt: new THREE.Color(lk[0]).multiplyScalar(0.9).getHex(), hair: lk[1], pants: lk[2] }); if (!W.dm.real) W.dm.g.scale.setScalar(1.08); W.dm.g.visible = false; scene.add(W.dm.g); W.dmT = 0; }
    const D = W.dm, onDeck = on > 0.55;
    m.g.visible = !onDeck; D.g.visible = onDeck;
    if (onDeck) {
      W.dmT += dt; const t = W.dmT, ph = slot * 0.9;
      D.g.position.set(W.cx, deckY + (D.real ? 0.015 : -0.01), W.cz); D.g.rotation.set(0, BOAT_YAW + Math.PI + SL[2], 0);
      const mode = t < 0.5 ? 'idle' : t < 3.2 ? 'cheer' : (Math.floor((t + ph) / 4) % 2 ? 'idle' : 'wave');
      const k = mode === 'cheer' ? sstep(0.5, 0.85, t) * (1 - sstep(2.9, 3.2, t)) : mode === 'wave' ? Math.min(sstep(0, 0.4, (t + ph) % 4), 1 - sstep(3.6, 4, (t + ph) % 4)) : 1;
      poseStandMan(D, t + ph, mode, k);
    }
  }
  // ---- sharks: roam (fins circling) -> stalk -> lock-on (warning) -> lunge -> bite / miss -> retreat
  const _s = new V3();
  function targetsAlive() { return SW.filter(W => !W.ko && !W.done); }
  function sharkDirector(dt) {
    const P = SW[0];
    const busyP = SHARKS.some(S => S.tgt === P && S.st !== 'roam' && S.st !== 'retreat');
    // the player: one shark at a time, at least 4 s after the previous attack ended
    if (!busyP && !P.ko && !P.done && SWS.t - SWS.lastAtk > 4 + Math.random() * 0.05 && SWS.t > 3.5) {
      let best = null, bd = 1e9; for (const S of SHARKS) if (S.st === 'roam') { const d = Math.hypot(S.x - P.x, S.z - P.z); if (d < bd) { bd = d; best = S; } }
      if (best) { best.st = 'stalk'; best.t = 0; best.tgt = P; best.ang = Math.atan2(best.x - P.x, best.z - P.z); SWS.lastAtk = 1e9; }
    }
    SWS.aiAtk -= dt;
    if (SWS.aiAtk <= 0) { SWS.aiAtk = 7 + Math.random() * 4;
      const cand = SW.filter(W => !W.player && !W.ko && !W.done && !SHARKS.some(S => S.tgt === W && S.st !== 'roam'));
      if (cand.length) { const W = cand[(Math.random() * cand.length) | 0]; let best = null, bd = 1e9;
        for (const S of SHARKS) if (S.st === 'roam') { const d = Math.hypot(S.x - W.x, S.z - W.z); if (d < bd) { bd = d; best = S; } }
        if (best) { best.st = 'stalk'; best.t = 0; best.tgt = W; best.ang = Math.atan2(best.x - W.x, best.z - W.z); } } }
  }
  function steerTo(S, tx, tz, rate, dt) { const ty = Math.atan2(tx - S.x, tz - S.z); let dy = ty - S.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; S.yaw += clamp(dy, -rate * dt, rate * dt); return Math.abs(dy); }
  function sharkUpdate(S, dt) {
    S.t += dt; const T = S.tgt;
    if (S.st === 'roam') {
      // circle the pack: centre drifts to a swimmer, radius 25-55 m
      const al = targetsAlive(); const c = al.length ? al[(SHARKS.indexOf(S)) % al.length] : SW[0];
      fwd(c.yaw, _s); const ah = 25 + c.v * 1.2; S.cx += (c.x + _s.x * ah - S.cx) * Math.min(1, dt * 1.5); S.cz += (c.z + _s.z * ah - S.cz) * Math.min(1, dt * 1.5);
      const a = Math.atan2(S.x - S.cx, S.z - S.cz) + S.dir * 0.35;
      steerTo(S, S.cx + Math.sin(a) * S.cr, S.cz + Math.cos(a) * S.cr, 1.1, dt); S.v += (Math.max(9, (c.v || 0) + 3 + Math.min(14, Math.hypot(S.x - S.cx, S.z - S.cz) * 0.12)) - S.v) * Math.min(1, dt); S.depth += (0.55 - S.depth) * Math.min(1, dt);
    } else if (S.st === 'stalk') {
      if (!T || T.ko || T.done) return sharkRetreat(S);
      // close in on a shrinking ring around the target
      S.ang += dt * 0.5 * S.dir; const r = lerp(30, 14, clamp(S.t / 3, 0, 1));
      const tx = T.x + Math.sin(S.ang) * r, tz = T.z + Math.cos(S.ang) * r;
      steerTo(S, tx, tz, 1.7, dt); S.v += (Math.max(12, T.v + 6 + Math.min(10, Math.hypot(S.x - T.x, S.z - T.z) * 0.15)) - S.v) * Math.min(1, dt * 1.5); S.depth += (0.45 - S.depth) * Math.min(1, dt * 2);
      if (S.t > 2.4 && Math.hypot(S.x - T.x, S.z - T.z) < 19) { S.st = 'lock'; S.t = 0; if (T.player) lockWarn(S, true); else aiReact(T, S); }
    } else if (S.st === 'lock') {
      if (!T || T.ko || T.done) { if (T && T.player) lockWarn(S, false); return sharkRetreat(S); }
      // slows, swings round to aim, fin high and steady (1.5 s of warning)
      steerTo(S, T.x, T.z, 2.2, dt); S.v += (T.v * 0.97 + 1.5 - S.v) * Math.min(1, dt * 3); S.depth += (0.32 - S.depth) * Math.min(1, dt * 3);
      const d = Math.hypot(S.x - T.x, S.z - T.z); if (d < 9) { S.x -= Math.sin(S.yaw) * (9 - d) * dt * 2; S.z -= Math.cos(S.yaw) * (9 - d) * dt * 2; }
      if (S.t > 1.5) { S.st = 'lunge'; S.t = 0; fwd(T.yaw, _s); S.lv = T.v + 14; const lead = T.v * Math.hypot(T.x - S.x, T.z - S.z) / S.lv;
        const ax = T.x + _s.x * lead - S.x, az = T.z + _s.z * lead - S.z, l = Math.hypot(ax, az) || 1; S.ldx = ax / l; S.ldz = az / l; S.yaw = Math.atan2(S.ldx, S.ldz); S.l0 = l; S.trav = 0; S.sawAir = false; S.minD = 1e9; S.bit = false; S.v = S.lv;
        if (T.player) lungeSnd(); }
    } else if (S.st === 'lunge') {
      S.v = S.lv; S.depth += (0.05 - S.depth) * Math.min(1, dt * 8); S.jaw = Math.min(1, S.jaw + dt * 5);
      const hx = S.x + S.ldx * 1.75 * S.sc, hz = S.z + S.ldz * 1.75 * S.sc, d = Math.hypot(hx - T.x, hz - T.z);
      S.minD = Math.min(S.minD, d); if (d < 4 && T.dive >= 0.45) S.sawAir = true;
      if (!S.bit && d < 2.1 && T.dive < 0.45 && !(T.offT > 0) && !T.ko && !T.done) { S.bit = true; bite(S, T); }
      S.trav += S.v * dt;
      if (S.trav > S.l0 + 7 || S.t > 2.2) {
        if (!S.bit && T.player) { SWS.dodged++; toast(S.sawAir ? 'JUMPED IT!' : 'SWERVED!', 900); }
        if (!S.bit && !T.player) T.dodged = (T.dodged || 0) + 1;
        if (T.player) lockWarn(S, false);
        return sharkRetreat(S);
      }
      // splash along the breaching run
      if (Math.random() < 0.8) emit(hx, waterHJ(hx, hz) + 0.2, hz, (Math.random() - 0.5) * 2 + S.ldx * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 2 + S.ldz * 3, 0.7, 0.8, 0.95, 0.97, 1, 0.8, 9, 0.8, 1.6);
    } else if (S.st === 'bite') {
      S.v *= Math.exp(-4 * dt); S.jaw = 0.4 + 0.6 * Math.abs(Math.sin(S.t * 14)); S.yaw += Math.sin(S.t * 22) * dt * 4;
      if (S.t > 0.7) { if (T && T.player) lockWarn(S, false); sharkRetreat(S); }
    } else if (S.st === 'retreat') {
      S.v += (14 - S.v) * Math.min(1, dt * 2); S.depth += (0.9 - S.depth) * Math.min(1, dt); S.jaw = Math.max(0, S.jaw - dt * 3);
      if (S.t > 3.2) { S.st = 'roam'; S.t = 0; S.tgt = null; S.cr = 25 + Math.random() * 30; }
    }
    if (S.st !== 'lunge' && S.st !== 'bite') S.jaw = Math.max(0, S.jaw - dt * 2);
    if (S.st === 'lunge') { S.x += S.ldx * S.v * dt; S.z += S.ldz * S.v * dt; } else { S.x += Math.sin(S.yaw) * S.v * dt; S.z += Math.cos(S.yaw) * S.v * dt; }
    // pose: fin cuts the surface; body pitches up on the breach
    const wl = waterHJ(S.x, S.z); let lift = 0, pit = 0;
    if (S.st === 'lunge') { const pr = clamp(S.trav / (S.l0 + 7), 0, 1); lift = Math.sin(pr * Math.PI) * 0.75 * S.sc; pit = -0.38 * Math.cos(pr * Math.PI) - 0.05; }
    else if (S.st === 'bite') { lift = 0.35 * S.sc * Math.max(0, 1 - S.t * 1.5); pit = -0.1; }
    S.g.position.set(S.x, wl - (0.95 * S.depth + 0.25) * S.sc - 0.15 + lift, S.z);
    S.g.rotation.set(pit, S.yaw, Math.sin(S.uni.uPh.value * 0.5) * 0.04);
    S.uni.uPh.value += dt * (2.4 + S.v * 0.9); S.uni.uAmp.value = 0.1 + Math.min(0.12, S.v * 0.012);
    S.jawM = S.jaw; S.jawMesh = S.jaw; S.g.children[1].rotation.x = S.jaw * 0.55;
    if (S.st === 'lock' || S.st === 'stalk' || S.st === 'roam') if (Math.random() < (S.st === 'lock' ? 0.5 : 0.12)) { const fx = S.x + Math.sin(S.yaw) * 0.1 * S.sc, fz = S.z + Math.cos(S.yaw) * 0.1 * S.sc;
      if (camera.position.distanceTo(S.g.position) < 70) emit(fx, wl + 0.05, fz, -Math.sin(S.yaw) * 0.6, 0.4, -Math.cos(S.yaw) * 0.6, 0.6, 0.45, 0.95, 0.97, 1, 0.75, 3, 1, 1.5); }
  }
  function sharkRetreat(S) { S.st = 'retreat'; S.t = 0; if (S.tgt) S.yaw = Math.atan2(S.x - S.tgt.x, S.z - S.tgt.z) + (Math.random() - 0.5); if (S.tgt && S.tgt.player) SWS.lastAtk = SWS.t; }
  function aiReact(W, S) {
    const r = Math.random() * W.skill;
    W.react = r > 0.42 ? { k: 'dive', t: 1.6 } : r > 0.2 ? { k: 'dodge', t: 1.5, sd: Math.random() < 0.5 ? -1 : 1 } : { k: 'none', t: 1.5 };
  }
  function bite(S, T) {
    S.st = 'bite'; S.t = 0; T.hp--; T.bites++; T.push = new V3(S.ldx * 5, 0, S.ldz * 5); T.v *= 0.25; T.offT = 1.8; T.air = false;
    for (let k = 0; k < 38; k++) emit(T.x + (Math.random() - 0.5) * 1.2, waterHJ(T.x, T.z) + 0.1 + Math.random() * 0.3, T.z + (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 3, 1 + Math.random() * 3.5, (Math.random() - 0.5) * 3, 1.4 + Math.random(), 0.9 + Math.random() * 0.8, 0.55, 0.04, 0.04, 0.85, 7, 1.2, 2.2);
    for (let k = 0; k < 20; k++) emit(T.x, waterHJ(T.x, T.z) + 0.2, T.z, (Math.random() - 0.5) * 5, 3 + Math.random() * 4, (Math.random() - 0.5) * 5, 0.8, 0.7, 0.95, 0.97, 1, 0.8, 9, 0.8, 1.6);
    if (T.player) { SWS.bites++; C.state.shake = 0.6; ui.red.style.opacity = 0.75; setTimeout(() => { ui.red.style.opacity = 0; }, 260); biteSnd(1);
      if (T.hp <= 0) { T.ko = true; T.koT = 0; playerKO(); } else toast('KNOCKED OFF! ' + '❤'.repeat(T.hp) + '♡'.repeat(3 - T.hp), 1300); }
    else { biteSnd(clamp(1 - camera.position.distanceTo(S.g.position) / 120, 0, 0.6)); if (T.hp <= 0) { T.ko = true; T.koT = 0; toast(T.R.num + ' ' + T.R.name + ' KNOCKED OUT', 1600); } }
  }
  function playerKO() {
    phase = 'ko'; clock = 0; swimUI(false); lockWarn(null, false);
    setTimeout(() => { if (phase !== 'ko') return; ui.ko.style.display = 'flex'; }, 1600);
  }
  // shark warning UI for the player: edge arrow toward the shark + tension
  let warnS = null;
  function lockWarn(S, on) { if (on) { warnS = S; ui.shk.style.display = 'block'; tensionStart(); } else if (!S || warnS === S) { warnS = null; ui.shk.style.display = 'none'; tensionStop(); } }
  function warnUI() {
    if (!warnS) return; const S = warnS;
    _s.set(S.x, waterHJ(S.x, S.z) + 0.5, S.z).project(camera);
    const behind = _s.z > 1; let x = _s.x, y = _s.y; if (behind) { x = -x; y = -y; }
    const onScr = !behind && Math.abs(x) < 0.9 && Math.abs(y) < 0.85;
    const a = Math.atan2(y, x); const k = onScr ? 1 : 0.92 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
    const px = onScr ? x : Math.cos(a) * k, py = onScr ? y : Math.sin(a) * k;
    ui.shk.style.left = clamp((px + 1) * 50, 14, 86).toFixed(1) + '%'; ui.shk.style.top = 'calc(' + ((1 - py) * 50).toFixed(1) + '% - ' + (onScr ? 58 : 0) + 'px)';
    ui.shk.firstChild.style.transform = 'rotate(' + (-a * 180 / Math.PI + 90).toFixed(0) + 'deg)';
    ui.shk.firstChild.style.opacity = onScr ? 0 : 1;
    const t = S.st === 'lock' ? 1.5 - S.t : 0; ui.shk.lastChild.textContent = S.st === 'lunge' ? 'JUMP / SWERVE!' : 'SHARK! ' + t.toFixed(1);
  }
  // ---- swim frame
  function swimCam(dt, snap) {
    const W = SW[0]; fwd(W.yaw, _w);
    // when a shark is locked on the player, the camera widens and swings to keep it in frame
    let S0 = null; for (const S of SHARKS) if (S.tgt === W && (S.st === 'lock' || S.st === 'lunge' || S.st === 'bite')) S0 = S;
    SWS.camW = (SWS.camW || 0) + ((S0 ? 1 : 0) - (SWS.camW || 0)) * Math.min(1, dt * 2.5);
    if (S0) { SWS.camSx = S0.x; SWS.camSz = S0.z; }
    const cw = SWS.camW, k = camFit(54 + cw * 8 + Math.min(12, W.v * 0.4)), kk = 1 + (k.k - 1) * 0.4, back = 5.4 * kk * (1 + cw * 0.8), up = 2.1 * kk * (1 + cw * 0.6);
    _b.set(W.x - _w.x * back, 0, W.z - _w.z * back); _b.y = Math.max(waterHJ(_b.x, _b.z) + 1.6, W.y + up);
    if (snap || camShot !== 6) { camShot = 6; camP.copy(_b); } else camP.lerp(_b, 1 - Math.exp(-10 * dt));
    camera.position.copy(camP); shake(dt);
    camL.set(W.x + _w.x * 7, W.y + 0.7, W.z + _w.z * 7);
    if (cw > 0.01 && SWS.camSx !== undefined) { camL.x += ((W.x + SWS.camSx) * 0.5 - camL.x) * cw * 0.7; camL.z += ((W.z + SWS.camSz) * 0.5 - camL.z) * cw * 0.7; }
    camera.lookAt(camL);
    camera.fov += (k.fov - camera.fov) * Math.min(1, 3 * dt); camera.updateProjectionMatrix();
    ui.uw.style.opacity = 0;
  }
  function updateSwim(dt) {
    SWS.t += dt;
    const P = SW[0];
    if (phase === 'swim') swimInput(P, dt);
    SW.forEach((W, i) => { if (W.done) { climbUpdate(W, dt); return; } if (!W.player) swimAI(W, dt, i); skiPhys(W, dt);
      if (W.player && phase === 'swim' && Math.hypot(W.x - LADDER().x, W.z - LADDER().z) < 5.5) finishSwimmer(W); });
    if (phase === 'swim') skiEngine(P.v, P.inGas && !(P.offT > 0) ? 1 : 0, !(P.offT > 0) && !P.ko); else if (phase === 'ko') skiEngine(0, 0, false);
    if (phase === 'swim') sharkDirector(dt);
    SHARKS.forEach(S => sharkUpdate(S, dt));
    updateDebris(dt); updateBoat(dt, SWS.t);
    if (phase === 'swim' || phase === 'ko') swimCam(dt);
    if (phase === 'swim') { warnUI(); swimHud(); }
  }
  function climbCam(dt) {
    const W = SW[0], L = LADDER(), a = 0.6 + clock * 0.18;
    _b.set(L.x + Math.sin(a) * 9, BOAT.g.position.y + 3.5 + clock * 0.4, L.z + Math.cos(a) * 9);
    if (camShot !== 7) { camShot = 7; camP.copy(camera.position); } camP.lerp(_b, 1 - Math.exp(-2 * dt));
    camera.position.copy(camP); camera.lookAt(W.m.g.position.x, W.m.g.position.y + 0.4, W.m.g.position.z); camera.fov += (55 - camera.fov) * Math.min(1, 2 * dt); camera.updateProjectionMatrix();
    ui.uw.style.opacity = 0;
  }
  // ================================================================== audio (synthesised, quiet, via the master bus)
  const AU = { loops: {} };
  function A() { const S = C.SFX; if (!S || !S.ctx || !S.bus || S.ctx.state !== 'running') return null; return { ac: S.ctx, bus: S.bus }; }
  let NB = null;
  function noiseBuf(ac, brown) {
    if (NB && NB[brown ? 1 : 0]) return NB[brown ? 1 : 0]; NB = NB || [];
    const b = ac.createBuffer(1, ac.sampleRate * 3, ac.sampleRate), d = b.getChannelData(0); let l = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; if (brown) { l = (l + 0.02 * w) / 1.02; d[i] = l * 3.5; } else d[i] = w; }
    NB[brown ? 1 : 0] = b; return b;
  }
  function loop(name, build) { if (AU.loops[name]) return AU.loops[name]; const a = A(); if (!a) return null; try { AU.loops[name] = build(a.ac, a.bus); } catch (e) { AU.loops[name] = null; } return AU.loops[name]; }
  function stopLoop(name, fade = 0.6) { const L = AU.loops[name]; if (!L) return; AU.loops[name] = null; try { const t = L.ac.currentTime; L.g.gain.cancelScheduledValues(t); L.g.gain.setValueAtTime(L.g.gain.value, t); L.g.gain.linearRampToValueAtTime(0, t + fade); L.nodes.forEach(n => { try { n.stop(t + fade + 0.05); } catch (e) {} }); } catch (e) {} }
  function noiseSrc(ac, brown) { const s = ac.createBufferSource(); s.buffer = noiseBuf(ac, brown); s.loop = true; return s; }
  // surf on the beach / open-ocean wash
  function ambBeach() { loop('surf', (ac, bus) => { const g = ac.createGain(); g.gain.value = 0; g.gain.linearRampToValueAtTime(0.11, ac.currentTime + 2); g.connect(bus);
    const n = noiseSrc(ac, true), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; const am = ac.createGain(); am.gain.value = 0.6;
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.11; const lg = ac.createGain(); lg.gain.value = 0.4; lfo.connect(lg); lg.connect(am.gain);
    n.connect(lp); lp.connect(am); am.connect(g); n.start(); lfo.start(); return { ac, g, nodes: [n, lfo], lp }; }); }
  function ambSwim(on) { stopLoop('surf', 1); if (!on) { stopLoop('swim'); return; }
    loop('swim', (ac, bus) => { const g = ac.createGain(); g.gain.value = 0; g.gain.linearRampToValueAtTime(0.1, ac.currentTime + 2); g.connect(bus);
      const n = noiseSrc(ac, true), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; const am = ac.createGain(); am.gain.value = 0.7;
      const lfo = ac.createOscillator(); lfo.frequency.value = 0.17; const lg = ac.createGain(); lg.gain.value = 0.3; lfo.connect(lg); lg.connect(am.gain);
      n.connect(lp); lp.connect(am); am.connect(g); n.start(); lfo.start(); return { ac, g, nodes: [n, lfo], lp }; }); }
  function underwater(k) { const L = AU.loops.swim; if (L) L.lp.frequency.setTargetAtTime(520 - 380 * k, L.ac.currentTime, 0.1); }
  // civil-defence siren: two detuned wailing tones
  function sirenStart() { loop('siren', (ac, bus) => { const g = ac.createGain(); g.gain.value = 0; g.gain.linearRampToValueAtTime(0.05, ac.currentTime + 3); g.connect(bus);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.8; bp.connect(g);
    const nodes = []; for (const f of [430, 437]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const l = ac.createOscillator(); l.frequency.value = 0.09; const lg = ac.createGain(); lg.gain.value = f * 0.42; l.connect(lg); lg.connect(o.frequency); o.connect(bp); o.start(); l.start(); nodes.push(o, l); }
    return { ac, g, nodes }; }); }
  function sirenStop() { stopLoop('siren', 1.5); }
  // the tsunami: a rising low roar
  function roarStart() { loop('roar', (ac, bus) => { const g = ac.createGain(); g.gain.value = 0; g.connect(bus);
    const n = noiseSrc(ac, true), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; const n2 = noiseSrc(ac, false), bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.6; const g2 = ac.createGain(); g2.gain.value = 0.15;
    n.connect(lp); lp.connect(g); n2.connect(bp); bp.connect(g2); g2.connect(g);
    const o = ac.createOscillator(), og = ac.createGain(), o2 = ac.createOscillator(); o.type = 'sine'; o.frequency.value = 34; o2.type = 'triangle'; o2.frequency.value = 47; og.gain.value = 0.5; const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 0.7; lg.gain.value = 0.25; lfo.connect(lg); lg.connect(og.gain); o.connect(og); o2.connect(og); og.connect(g);
    n.start(); n2.start(); o.start(); o2.start(); lfo.start(); return { ac, g, nodes: [n, n2, o, o2, lfo], lp }; }); }
  function roarLevel(k) { const L = AU.loops.roar; if (!L) return; L.g.gain.setTargetAtTime(0.03 + 0.32 * k * k, L.ac.currentTime, 0.3); L.lp.frequency.setTargetAtTime(250 + 900 * k, L.ac.currentTime, 0.3); }
  function roarStop() { stopLoop('roar', 1.2); }
  // shark lock-on: pulsing low ostinato that speeds up
  function tensionStart() { loop('tension', (ac, bus) => { const g = ac.createGain(); g.gain.value = 0.0; g.gain.linearRampToValueAtTime(0.12, ac.currentTime + 0.25); g.connect(bus);
    const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 55; const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; const am = ac.createGain(); am.gain.value = 0;
    const t0 = ac.currentTime; for (let k = 0; k < 16; k++) { const t = t0 + 1.6 * (1 - Math.pow(0.86, k)) / 0.14 * 0.2; am.gain.setValueAtTime(1, t); am.gain.linearRampToValueAtTime(0.05, t + 0.16); }
    o.connect(lp); lp.connect(am); am.connect(g);
    const o2 = ac.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 58.3; o2.connect(lp); o.start(); o2.start();
    return { ac, g, nodes: [o, o2] }; }); }
  function tensionStop() { stopLoop('tension', 0.4); }
  function oneShot(fn) { const a = A(); if (!a) return; try { fn(a.ac, a.bus, a.ac.currentTime); } catch (e) {} }
  function env(g, t, a, v, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + d); }
  function splashSnd(v = 0.5) { oneShot((ac, bus, t) => { const g = ac.createGain(); env(g, t, 0.01, 0.3 * v, 0.9); g.connect(bus); const n = ac.createBufferSource(); n.buffer = noiseBuf(ac, false); const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(2200, t); bp.frequency.exponentialRampToValueAtTime(500, t + 0.8); n.connect(bp); bp.connect(g); n.start(t); n.stop(t + 0.95); }); }
  function strokeSnd() { oneShot((ac, bus, t) => { const g = ac.createGain(); env(g, t, 0.02, 0.05, 0.3); g.connect(bus); const n = ac.createBufferSource(); n.buffer = noiseBuf(ac, false); const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900 + Math.random() * 500; bp.Q.value = 1.2; n.connect(bp); bp.connect(g); n.start(t, Math.random()); n.stop(t + 0.32); }); }
  function lungeSnd() { oneShot((ac, bus, t) => { const g = ac.createGain(); env(g, t, 0.05, 0.22, 1.0); g.connect(bus); const n = ac.createBufferSource(); n.buffer = noiseBuf(ac, false); const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.6); n.connect(bp); bp.connect(g); n.start(t); n.stop(t + 1.05);
    const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.7); const og = ac.createGain(); env(og, t, 0.05, 0.08, 0.8); const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; o.connect(lp); lp.connect(og); og.connect(bus); o.start(t); o.stop(t + 0.85); }); }
  function biteSnd(v) { if (v < 0.03) return; oneShot((ac, bus, t) => { const g = ac.createGain(); env(g, t, 0.005, 0.5 * v, 0.45); g.connect(bus); const o = ac.createOscillator(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.35); o.connect(g); o.start(t); o.stop(t + 0.5);
    const n = ac.createBufferSource(); n.buffer = noiseBuf(ac, false); const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800; const ng = ac.createGain(); env(ng, t, 0.003, 0.25 * v, 0.12); n.connect(hp); hp.connect(ng); ng.connect(bus); n.start(t); n.stop(t + 0.15); splashSnd(v); }); }
  function hornSnd(dist) { const v = clamp(1 - dist / 700, 0.12, 1) * 0.16; oneShot((ac, bus, t) => { const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.12); g.gain.setValueAtTime(v, t + 1.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8); const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.connect(g); g.connect(bus);
    for (const f of [110, 138.6, 165]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(t); o.stop(t + 1.85); } }); }
  function birdCalls() { oneShot((ac, bus, t) => { for (let k = 0; k < 14; k++) { const tt = t + k * 0.09 + Math.random() * 0.25, o = ac.createOscillator(), g = ac.createGain(); o.type = 'triangle'; const f = 1900 + Math.random() * 1600;
    o.frequency.setValueAtTime(f, tt); o.frequency.exponentialRampToValueAtTime(f * 0.6, tt + 0.12); env(g, tt, 0.01, 0.03, 0.15); o.connect(g); g.connect(bus); o.start(tt); o.stop(tt + 0.17); } }); }
  // jet-ski engine: two detuned saws + rumble through a low-pass; pitch follows speed and throttle. Kept quiet like the bikes.
  function skiEngine(v, thr, on) {
    if (!on) { if (AU.loops.ski) stopLoop('ski', 0.4); return; }
    const L = loop('ski', (ac, bus) => { const g = ac.createGain(); g.gain.value = 0; g.connect(bus);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 2; lp.connect(g);
      const o1 = ac.createOscillator(), o2 = ac.createOscillator(); o1.type = 'sawtooth'; o2.type = 'square'; o1.frequency.value = 55; o2.frequency.value = 27.7;
      const g2 = ac.createGain(); g2.gain.value = 0.35; o2.connect(g2); g2.connect(lp); o1.connect(lp);
      const n = noiseSrc(ac, true), ng = ac.createGain(); ng.gain.value = 0.5; n.connect(ng); ng.connect(g);
      o1.start(); o2.start(); n.start(); return { ac, g, lp, o1, o2, nodes: [o1, o2, n] }; });
    if (!L) return; const t = L.ac.currentTime, k = clamp(v / 27, 0, 1.1);
    const f = 48 + 70 * k + 30 * thr; L.o1.frequency.setTargetAtTime(f, t, 0.12); L.o2.frequency.setTargetAtTime(f * 0.503, t, 0.12);
    L.lp.frequency.setTargetAtTime(380 + 900 * k + 500 * thr, t, 0.15); L.g.gain.setTargetAtTime(0.025 + 0.035 * thr + 0.02 * k, t, 0.15);
  }
  function stopAllAudio() { for (const k of Object.keys(AU.loops)) stopLoop(k, 0.3); }
  // ================================================================== UI
  let ui = null;
  function ensureUI() {
    if (ui) return ui.fade;
    const st = document.createElement('style');
    st.textContent = `#l3fade{position:fixed;inset:0;background:#000;opacity:1;transition:opacity 1.2s;pointer-events:none;z-index:40}
#l3white{position:fixed;inset:0;background:#f4f8fa;opacity:0;transition:opacity .5s;pointer-events:none;z-index:39}
#l3red{position:fixed;inset:0;background:radial-gradient(circle,rgba(160,0,0,0) 30%,rgba(170,0,0,.85) 100%);opacity:0;transition:opacity .25s;pointer-events:none;z-index:38}
#l3uw{position:fixed;inset:0;background:linear-gradient(180deg,rgba(95,100,80,.6),rgba(30,34,22,.93));opacity:0;pointer-events:none;z-index:12}
#l3slow{position:fixed;inset:0;pointer-events:none;z-index:13;opacity:0;transition:opacity .4s;box-shadow:inset 0 0 140px 40px rgba(0,0,0,.65)}
#l3title{position:fixed;left:0;right:0;top:32%;text-align:center;color:#fff;font:800 clamp(22px,5vw,46px) system-ui,Arial;letter-spacing:.12em;text-shadow:0 3px 18px #000;z-index:41;transition:opacity 1.2s;pointer-events:none}
#l3title small{display:block;font-size:.42em;letter-spacing:.3em;opacity:.85;margin-top:8px}
#l3skip{position:fixed;right:16px;bottom:18px;z-index:42;display:none;background:rgba(10,12,16,.6);color:#fff;border:1px solid rgba(255,255,255,.4);border-radius:10px;padding:10px 18px;font:700 15px system-ui}
#l3warn{position:fixed;left:50%;top:max(10px,env(safe-area-inset-top));transform:translateX(-50%);z-index:20;color:#fff;background:rgba(170,20,10,.78);border:2px solid #ffd060;border-radius:10px;padding:6px 16px;font:800 clamp(12px,2.4vw,18px) system-ui;letter-spacing:.06em;opacity:0;transition:opacity .4s;pointer-events:none;white-space:nowrap}
#l3warn.pulse{animation:l3p .8s infinite}@keyframes l3p{50%{background:rgba(230,40,10,.95)}}
#l3res,#l3ko{position:fixed;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;background:rgba(6,14,20,.66);color:#fff;z-index:43;font:15px system-ui;text-align:center;padding:12px;overflow:auto}
#l3res h1,#l3ko h1{font-size:clamp(20px,4vw,34px);margin:0 0 8px}#l3res p{line-height:1.45;margin:6px 0}#l3res .st{opacity:.9;font-size:.92em}
#l3res button,#l3ko button{margin:6px;border:0;border-radius:12px;padding:12px 20px;font-weight:800;background:linear-gradient(180deg,#ffd060,#ff9a20);color:#1a1008}
#l3swim{position:fixed;left:max(12px,env(safe-area-inset-left));top:max(10px,env(safe-area-inset-top));z-index:20;color:#fff;font:700 14px system-ui;text-shadow:0 2px 6px #000;display:none;pointer-events:none}
#l3swim .hp{font-size:22px;color:#ff3b3b;letter-spacing:2px}#l3swim .row{margin-top:3px}
#l3swim .br{width:120px;height:7px;border-radius:4px;background:rgba(255,255,255,.25);margin-top:5px;overflow:hidden}#l3swim .br i{display:block;height:100%;background:#7fe0ff}
#l3rh{position:fixed;right:max(18px,env(safe-area-inset-right));top:max(14px,env(safe-area-inset-top));z-index:20;width:44px;height:44px;border-radius:50%;border:3px solid rgba(255,255,255,.5);display:none;pointer-events:none;transition:transform .1s,border-color .1s}
#l3rh.r2{border-color:#5dff8a;transform:scale(1.25)}#l3rh.r1{border-color:#ffd060;transform:scale(1.1)}#l3rh.r0{border-color:#ff5a3a;transform:scale(.9)}
#l3shk{position:fixed;z-index:21;display:none;pointer-events:none;transform:translate(-50%,-50%);text-align:center}
#l3shk b{display:block;width:0;height:0;margin:0 auto;border-left:16px solid transparent;border-right:16px solid transparent;border-bottom:30px solid #ff2a1a;filter:drop-shadow(0 0 6px #000)}
#l3shk span{display:block;color:#fff;background:rgba(200,20,10,.85);border-radius:8px;padding:3px 9px;font:900 14px system-ui;margin-top:4px;white-space:nowrap}
#l3ctl{position:fixed;inset:0;z-index:22;display:none;pointer-events:none}
#l3ctl button{position:absolute;pointer-events:auto;border:2px solid rgba(255,255,255,.55);background:rgba(10,30,45,.45);color:#fff;font:900 16px system-ui;border-radius:50%;-webkit-user-select:none;user-select:none;touch-action:none}
#l3ctl .lf{left:max(18px,env(safe-area-inset-left));bottom:22px;width:76px;height:76px}#l3ctl .rt{left:calc(max(18px,env(safe-area-inset-left)) + 90px);bottom:22px;width:76px;height:76px}
#l3ctl .sk{right:max(20px,env(safe-area-inset-right));bottom:20px;width:104px;height:104px;background:rgba(30,150,60,.5)}#l3ctl .bk{right:calc(max(20px,env(safe-area-inset-right)) + 116px);bottom:18px;width:70px;height:70px;background:rgba(150,40,30,.5)}#l3ctl .dv{right:calc(max(20px,env(safe-area-inset-right)) + 60px);bottom:136px;width:76px;height:76px;background:rgba(30,40,120,.5)}
#l3ctl button.on{background:rgba(255,255,255,.35)}
#l3help{position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:20;color:#fff;font:600 12px system-ui;opacity:.75;display:none;pointer-events:none;text-shadow:0 1px 4px #000;white-space:nowrap}`;
    document.head.appendChild(st);
    const mk = (id, tag = 'div') => { const e = document.createElement(tag); e.id = id; document.body.appendChild(e); return e; };
    ui = { fade: mk('l3fade'), white: mk('l3white'), red: mk('l3red'), uw: mk('l3uw'), slow: mk('l3slow'), title: mk('l3title'), skip: mk('l3skip', 'button'), warn: mk('l3warn'), res: mk('l3res'), ko: mk('l3ko'), swim: mk('l3swim'), rh: mk('l3rh'), shk: mk('l3shk'), ctl: mk('l3ctl'), help: mk('l3help') };
    ui.title.innerHTML = 'LEVEL 3 · TSUNAMI<small>PACIFIC COAST BEACH RACE</small>';
    ui.skip.textContent = 'SKIP ▶';
    ui.skip.onclick = (e) => { e.preventDefault(); if (phase === 'flight' || phase === 'warm' || phase === 'warmview') { skipReq = true; if (phase === 'flight') { ui.title.style.opacity = 0; ui.fade.style.opacity = 0; toCountdown(); } } };
    ui.skip.addEventListener('touchend', ui.skip.onclick, { passive: false });
    ui.shk.innerHTML = '<b></b><span>SHARK!</span>';
    ui.ko.innerHTML = '<h1>KNOCKED OUT</h1><p>Three shark hits — knocked off your jet ski for good.</p><div><button id="l3retry">RETRY THE RIDE</button><button id="l3koBack">LEVEL SELECT</button></div>';
    ui.ctl.innerHTML = '<button class="lf" data-k="ArrowLeft">◀</button><button class="rt" data-k="ArrowRight">▶</button><button class="dv" data-k="Space">JUMP</button><button class="bk" data-k="KeyS">BRK</button><button class="sk" data-k="KeyW">GAS</button>';
    ui.ctl.querySelectorAll('button').forEach(b => { const k = b.dataset.k;
      const dn = (e) => { e.preventDefault(); keys[k] = true; b.classList.add('on'); C.SFX && C.SFX.unlock && C.SFX.unlock(); }, up = (e) => { e.preventDefault(); keys[k] = false; b.classList.remove('on'); };
      b.addEventListener('touchstart', dn, { passive: false }); b.addEventListener('touchend', up, { passive: false }); b.addEventListener('touchcancel', up, { passive: false });
      b.addEventListener('mousedown', dn); b.addEventListener('mouseup', up); b.addEventListener('mouseleave', up); });
    ui.help.textContent = 'A/D or ←/→ steer · W / ↑ throttle · S / ↓ brake · SPACE jump (hop waves & sharks)';
    $('l3retry').onclick = () => retrySwim(); $('l3koBack').onclick = () => { location.href = location.pathname; };
    return ui.fade;
  }
  function showHud(v) { for (const id of ['mobile', 'stats']) { const e = $(id); if (e) e.style.visibility = v ? '' : 'hidden'; } }
  function swimUI(v) { ui.swim.style.display = v ? 'block' : 'none'; ui.rh.style.display = 'none'; ui.ctl.style.display = v && IS_MOBILE ? 'block' : 'none'; ui.help.style.display = v && !IS_MOBILE ? 'block' : 'none'; if (!v) { ui.shk.style.display = 'none'; ui.uw.style.opacity = 0; } }
  function hud() {
    const P = PL, pos = 1 + RACERS.filter(R => !R.player && R.s > P.s).length; P.pos = pos;
    const el = $('stats'); if (!el) return;
    const elev = Math.max(0, P.y);
    el.innerHTML = '<div class="spd">' + Math.round(P.speed * 3.6) + ' <span>KM/H</span></div>' +
      '<div class="row">POS <b class="pos">' + pos + '</b>/' + RACERS.length + ' · LEVEL 3</div>' +
      '<div class="row">COAST <b>' + Math.round(clamp((P.s - D.start) / (D.len - 40 - D.start), 0, 1) * 100) + '%</b> · ' + ({ wet: 'firm wet sand', dry: 'soft sand', water: 'shallows', deck: 'boardwalk', rock: 'rock', grass: 'grass' }[P.surf] || '') + '</div>' +
      (phase === 'wave' ? '<div class="row">ELEVATION <b>' + elev.toFixed(0) + ' m</b> · WAVE ' + Math.max(0, Math.round(dOf(P.x, P.z) - U.uFront.value)) + ' m</div>' : '<div class="row">TIME <b>' + raceT.toFixed(1) + 's</b>' + (P.grounded ? '' : ' · <span class="air">AIR ' + (P.airT || 0).toFixed(1) + 's</span>') + '</div>');
  }
  function swimHud() {
    const W = SW[0], L = LADDER(), d = Math.hypot(W.x - L.x, W.z - L.z);
    const rank = 1 + SW.filter(O => O !== W && !O.ko && (O.done || Math.hypot(O.x - L.x, O.z - L.z) < d)).length;
    ui.swim.innerHTML = '<div class="hp">' + '❤'.repeat(Math.max(0, W.hp)) + '<span style="opacity:.35">' + '❤'.repeat(3 - Math.max(0, W.hp)) + '</span></div>' +
      '<div class="row">RESCUE BOAT <b>' + Math.round(d) + ' m</b> · ' + rank + '/' + SW.filter(O => !O.ko).length + '</div>' +
      '<div class="row">SPEED <b>' + Math.round(W.v * 3.6) + ' km/h</b>' + (W.air ? ' · <span class="air">AIR</span>' : '') + (W.offT > 0 ? ' · <span style="color:#ff8a6a">REMOUNTING…</span>' : '') + '</div>' +
      '<div class="row">SHARKS DODGED <b>' + SWS.dodged + '</b></div>' +
      '<div class="br"><i style="width:' + Math.round(clamp(W.v / 27, 0, 1) * 100) + '%;background:' + (W.inGas ? '#ffd060' : '#bfefff') + '"></i></div>';
  }

  // ================================================================== intro, warm-up, countdown, results
  const INTRO_T = 10;
  let skipReq = false;
  const raf = () => new Promise(r => requestAnimationFrame(() => r()));
  const WARM = { ms: 0, steps: 0, tex: 0 };
  function introCam(t, dt, snap) {
    const f0 = frame(D.start, { ..._f }), k = camFit(55);
    const shot = t < 3.6 ? 0 : t < 6.8 ? 1 : 2; let cx, cy, cz, lx, ly, lz, fov = k.fov;
    if (shot === 0) { const u = t / 3.6; // high over the surf, sliding along the coast toward the grid
      cx = f0.x + 260 - u * 120; cz = zsh(cx) - 90 * k.k; cy = 34 - u * 8; lx = f0.x + 40; ly = 2; lz = f0.z - 8; }
    else if (shot === 1) { const u = (t - 3.6) / 3.2; // low along the wet sand, palms streaming past
      const s = D.start + 150 - u * 110, f = frame(s, { ..._f }); cx = f.x + f.rx * -20; cz = f.z + f.rz * -20; cy = H(cx, cz) + 2.2; const g = frame(s - 25, { ..._f }); lx = g.x + g.rx * -8; ly = 1.5; lz = g.z + g.rz * -8; }
    else { const u = (t - 6.8) / 3.2; // behind the grid, rising
      cx = f0.x - f0.tx * (22 - u * 8) * k.k + f0.rx * -12; cz = f0.z - f0.tz * (22 - u * 8) * k.k + f0.rz * -12; cy = H(cx, cz) + 3 + u * 3; lx = f0.x + f0.tx * 30 + f0.rx * -12; ly = 1.5; lz = f0.z + f0.tz * 30 + f0.rz * -12; }
    _b.set(cx, cy, cz); _a.set(lx, ly, lz);
    if (snap || shot !== camShot) { camShot = shot; camP.copy(_b); camL.copy(_a); } else { camP.lerp(_b, 1 - Math.exp(-8 * dt)); camL.lerp(_a, 1 - Math.exp(-8 * dt)); }
    camera.position.copy(camP); camera.lookAt(camL); camera.fov = fov; camera.updateProjectionMatrix();
  }
  async function warmup() {
    phase = 'warm'; const t0 = performance.now(); WARM.steps = 0;
    await Promise.race([Promise.all(TEXP), new Promise(r => setTimeout(r, 9000))]);
    try { const seen = new Set(); scene.traverse(o => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of ms) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'emissiveMap']) { const t = m[k]; if (t && !seen.has(t) && t.image) { seen.add(t); renderer.initTexture && renderer.initTexture(t); } } });
      renderer.initTexture && renderer.initTexture(HM); WARM.tex = seen.size; } catch (e) { console.warn('[l3] warm tex', e); }
    // everything visible once so every program compiles now (swim / wave / flare objects included)
    swapCrew(); const boatVis = BOAT.g.visible; BOAT.g.visible = true;
    ensureSwim(); setSwimVisible(true); WAVE.visible = true; BOAT.flare.s.visible = true; if (WDEB) WDEB.ims.forEach(im => { im.visible = true; }); SW.forEach((W, i) => { W.m.g.position.set(PL.x + 3 + i, 0, PL.z + 4); }); SHARKS.forEach((S, i) => S.g.position.set(PL.x - 4 - i, -0.5, PL.z + 6));
    try { if (renderer.compileAsync) await renderer.compileAsync(scene, camera); else renderer.compile(scene, camera); } catch (e) { try { renderer.compile(scene, camera); } catch (e2) {} }
    const views = [['intro', 0.5], ['intro', 4.5], ['intro', 8], ['wave', 0], ['swim', 0]];
    for (const [v, t] of views) {
      if (!active || (phase !== 'warm' && phase !== 'warmview') || skipReq) break;
      phase = 'warmview';
      if (v === 'intro') introCam(t, 0, true);
      else if (v === 'wave') { U.uWaveH.value = 20; U.uFront.value = -300; const f = frame(D.waveS, { ..._f }); camera.position.set(f.x + f.rx * 15, H(f.x, f.z) + 8, f.z + f.rz * 15); camera.lookAt(f.x - f.rx * 200, 8, f.z - f.rz * 200); }
      else { const L = LADDER(); camera.position.set(L.x, 3, L.z + 40); camera.lookAt(L.x, 0, L.z); }
      await raf(); await raf(); WARM.steps++;
    }
    BOAT.g.visible = boatVis; U.uWaveH.value = 0; U.uFront.value = -3000; setSwimVisible(false); WAVE.visible = false; BOAT.flare.s.visible = false; if (WDEB) WDEB.ims.forEach(im => { im.visible = false; });
    WARM.ms = Math.round(performance.now() - t0);
    if (phase === 'warmview') phase = 'warm';
  }
  function startIntro() {
    phase = 'flight'; clock = 0; camShot = -1; ui.skip.style.display = 'block';
    setTimeout(() => { ui.fade.style.opacity = 0; }, 150); setTimeout(() => { ui.title.style.opacity = 0; }, 3600);
    ambBeach();
  }
  let cdT = 0;
  function resetRace() {
    Object.assign(EV, { recede: false, birds: false, siren: false, wave: false });
    U.uFront.value = -3000; U.uWaveH.value = 0; U.uSurge.value = 0; U.uBore.value = 0; U.uRecede.value = 0; U.uShore.value = 1; U.uSwell.value = 0.55;
    waveT = 0; timeScale = 1; raceT = 0; NITRO.hits = 0; NITRO.aiHits = 0;
    if (BIRDS) { BIRDS.scared = false; BIRDS.B.forEach(b => { if (b.rest) { b.fly = false; b.p.copy(b.home); } }); }
    setSwimVisible(false); swimUI(false);
    ui.warn.style.opacity = 0; ui.warn.classList.remove('pulse'); ui.white.style.opacity = 0; ui.ko.style.display = 'none'; ui.res.style.display = 'none'; ui.slow.style.opacity = 0;
    stopAllAudio(); ambBeach();
    RACERS.forEach(R => { R.swept = false; R.tumble = null; R.headStart = 0; }); PL.tumble = null;
    setRaceVisible(true); placeBikes();
  }
  function toCountdown() {
    resetRace(); phase = 'countdown'; clock = 0; cdT = 3.2; ui.skip.style.display = 'none'; showHud(true);
    camP.set(0, 0, 0); chaseCam(1 / 60, true);
  }
  function updateCountdown(dt) {
    const prev = Math.ceil(cdT); cdT -= dt; const now = Math.ceil(cdT);
    if (now !== prev && now > 0) toast(String(now), 800);
    if (cdT <= 0) { phase = 'race'; raceT = 0; toast('GO! · RIDE THE COAST', 1400); C.state.running = true; C.state.finished = false; }
    pushPlayer(dt); chaseCam(dt);
  }
  function retrySwim() { SWS.retries++; ui.ko.style.display = 'none'; ui.res.style.display = 'none'; resetSwim(true); phase = 'swim'; clock = 0; swimUI(true); toast('RETRY · RIDE FOR THE BOAT', 1600); }
  function showResults() {
    phase = 'results'; swimUI(false);
    const L = LADDER();
    const rest = SW.filter(W => !W.done).sort((a, b) => (a.ko - b.ko) || (Math.hypot(a.x - L.x, a.z - L.z) - Math.hypot(b.x - L.x, b.z - L.z)));
    const all = SWS.finishOrder.concat(rest), me = all.indexOf(SW[0]) + 1;
    const swimT = SW[0].doneT, total = raceT + swimT;
    if (!showResults.marked) { showResults.marked = true; try { window.HDBProgress && window.HDBProgress.mark('l3', { time: +total.toFixed(1), place: me }); } catch (e) {} }
    const R0 = RACERS[0];
    ui.res.innerHTML = '<h1>' + (me === 1 ? 'FIRST ABOARD — YOU SURVIVED THE TSUNAMI!' : 'RESCUED · P' + me) + '</h1><p>' +
      all.map((W, i) => (i + 1) + '. ' + (W.player ? '<b>45 YOU</b>' : W.R.num + ' ' + W.R.name) + (W.done ? ' — aboard ' + W.doneT.toFixed(1) + 's' : W.ko ? ' — KO (shark)' : ' — still riding, ' + Math.round(Math.hypot(W.x - L.x, W.z - L.z)) + ' m')).join('<br>') +
      '</p><p class="st">Height when the wave hit <b>' + (R0.sweepH || 0).toFixed(0) + ' m</b> → head start, jet-ski run <b>' + Math.round(swimDist(SWS.start[0])) + ' m</b><br>Sharks dodged <b>' + SWS.dodged + '</b> · bites <b>' + SWS.bites + '</b> · jumps <b>' + SWS.dives + '</b>' + (SWS.retries ? ' · retries <b>' + SWS.retries + '</b>' : '') + '<br>Beach ' + raceT.toFixed(1) + 's + jet ski ' + swimT.toFixed(1) + 's</p>' +
      '<div><button id="l3swimAgain">RIDE AGAIN</button><button id="l3again">RACE AGAIN</button><button id="l3back">LEVEL SELECT</button></div>';
    ui.res.style.display = 'flex';
    $('l3swimAgain').onclick = () => { showResults.marked = false; retrySwim(); };
    $('l3again').onclick = () => { showResults.marked = false; ui.res.style.display = 'none'; SWS.retries = 0; toCountdown(); };
    $('l3back').onclick = () => { location.href = location.pathname; };
  }

  // ================================================================== start / stop / frame
  async function start(opts = {}) {
    if (active) return;
    active = true; phase = 'load'; clock = 0; skipReq = false;
    const fade = ensureUI(); fade.style.opacity = 1; ui.title.style.opacity = 1;
    try {
      if (!built) {
        buildCourse(); buildDeck(); buildJumpData(); buildHeightmap();
        buildSky(); buildTerrain(); buildTrack(); buildWater(); buildWave(); buildPalms(); buildTrees(); buildMountains(); buildClouds(); buildGrass(); buildRocks(); buildBoardwalk(); buildJumps(); buildSigns(); buildBirds();
        BIRDS.B.forEach(b => { b.home = b.p.clone(); });
        buildParticles(); buildBoat(); buildDebris();
        built = true;
      }
    } catch (e) { console.error('[l3] build failed', e); active = false; phase = 'off'; fade.style.opacity = 0; toast('Level 3 failed to load', 3000); return; }
    if (!RACERS.length) {
      RACERS.push({ player: true, col: 0xff6a00, name: 'SMITH', num: '45', acc: '#ffffff' });
      for (const a of C.AI) RACERS.push({ player: false, a, col: a.r.col, name: a.r.name, num: a.r.num, acc: a.r.acc });
    }
    const bike = C.getBike(); scene.add(bike);
    for (const R of RACERS) if (!R.player) { scene.add(R.a.root); R.a.root.visible = true; R.a.dismounted = false; R.a.tag.visible = true; R.a.rider.visible = true; }
    for (const id of ['hint', 'egHud', 'egCtl', 'l2fade', 'l2title', 'l2skip', 'l2res', 'l2Nitro']) { const e = $(id); if (e) e.style.display = 'none'; }
    $('overlay') && $('overlay').classList.add('hidden');
    showHud(false); C.state.running = false; C.state.finished = false;
    resetRace();
    if (opts.skip === 'ski' || opts.skip === 'swim') {
      // dev: straight into the ocean (head starts as if swept from mid-height)
      RACERS.forEach((R, i) => { R.swept = true; R.sweepH = R.player ? 18 : 10 + i * 3; R.sweepT = 13; R.headStart = clamp(420 - 5 * R.sweepH - 4 * R.sweepT, 160, 420); });
      await warmup(); ui.title.style.opacity = 0; ui.fade.style.opacity = 0; raceT = 0; waveT = 13; startSwim(); swimUI(true); return;
    }
    if (opts.skip === 'race') { toCountdown(); fade.style.opacity = 0; ui.title.style.opacity = 0; return; }
    await warmup();
    if (phase !== 'warm') return;
    if (skipReq) { ui.title.style.opacity = 0; ui.fade.style.opacity = 0; toCountdown(); ambBeach(); return; }
    startIntro();
  }
  function stop() {
    active = false; phase = 'off'; stopAllAudio(); timeScale = 1;
    if (ui) for (const k of Object.keys(ui)) ui[k].style.display = 'none';
    NFX.speedLines(0); showHud(true);
  }
  function update(dtReal) {
    if (!active) return;
    const dt = dtReal * timeScale;
    clock += dtReal; U.uTime.value += dt;
    if (phase === 'load' || phase === 'warm' || phase === 'warmview') { follow(); return; }
    if (phase === 'flight') { introCam(clock, dtReal); stepAIIdle(); if (clock > INTRO_T) { ui.title.style.opacity = 0; toCountdown(); } }
    else if (phase === 'countdown') updateCountdown(dt);
    else if (phase === 'race' || phase === 'wave') {
      raceT += dt; warnings(dt); if (phase === 'race' && raceT > 150) startWave();
      if (phase === 'wave') { updateWave(dt); if (cutT > 0) { cutT -= dtReal; PL.auto = true; } else PL.auto = false; }
      if (phase !== 'swept') stepPlayer(dt);
      stepAI(dt); updateTumbles(dt); pushPlayer(dt);
      if (phase !== 'swept') { if (phase === 'wave' && cutT > 0) waveCam(dtReal); else chaseCam(dt); hud(); }
    }
    else if (phase === 'swept') updateSwept(dtReal, dt);
    else if (phase === 'swim' || phase === 'ko') updateSwim(dt);
    else if (phase === 'climb') { updateSwim(dt); climbCam(dt); if (clock > 4.6) showResults(); }
    else if (phase === 'results') { updateSwim(dt); climbCam(dt); }
    updateBirds(dt); updateParticles(dt); follow();
  }
  function stepAIIdle() { RACERS.forEach(R => { if (!R.player) poseRacer(R, 0); }); pushPlayer(0); }
  function follow() {
    if (WATER) { const sn = 8; WATER.position.set(Math.round(camera.position.x / sn) * sn, 0, Math.round(camera.position.z / sn) * sn); }
    if (WAVE) WAVE.material.uniforms.uCX.value = camera.position.x;
    if (SKY) SKY.position.copy(camera.position);
    if (CLOUDS) CLOUDS.position.set(camera.position.x, 0, camera.position.z);
    if (SUN) { const tgt = (phase === 'race' || phase === 'wave' || phase === 'countdown') ? _d.set(PL.x, PL.y, PL.z) : _d.copy(camera.position); SUN.target.position.copy(tgt); SUN.position.copy(SUNDIR).multiplyScalar(300).add(tgt); }
  }
  return { start, stop, update, scene,
    get active() { return active; }, get phase() { return phase; }, get clock() { return clock; },
    get riding() { return phase === 'race' || phase === 'wave' || phase === 'countdown'; },
    dbg: { scene, renderer, get WATER() { return WATER; }, get WAVE() { return WAVE; }, get BOAT() { return BOAT; }, get TERR() { return TERR; }, get D() { return D; }, U, EV, PL, RACERS, SW, SHARKS, SWS, WARM, NITRO, frame, project, ground, H, latMin, latMax, surfaceAt, seaLevelJ, waterHJ, LADDER, BOAT_P,
      get waveT() { return waveT; }, get raceT() { return raceT; }, get timeScale() { return timeScale; }, get cutT() { return cutT; },
      setPhase(v) { phase = v; clock = 0; }, toCountdown, startWave, startSwim, retrySwim, finishSwimmer, bite, sharkRetreat, showResults, skiJump,
      warp(s, lat = -12) { const f = frame(s, { ..._f }); Object.assign(PL, { s, lat, x: f.x + f.rx * lat, z: f.z + f.rz * lat, yaw: yawOf(f), speed: 30, cp: Math.floor(s / 150) * 150 }); PL.y = ground(PL.x, PL.z, s);
        RACERS.forEach((R, i) => { if (!R.player) { R.s = s - 10 - i * 6; R.spd = 30; } }); },
      forceAttack(W) { const S = SHARKS.find(s => s.st === 'roam') || SHARKS[0]; W = W || SW[0]; S.x = W.x + 12; S.z = W.z; S.yaw = -Math.PI / 2; S.st = 'lock'; S.t = 0; S.tgt = W; if (W.player) lockWarn(S, true); else aiReact(W, S); return S; } } };
}
