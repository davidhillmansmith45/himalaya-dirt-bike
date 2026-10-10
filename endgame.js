// Summit finale ("Dragon War"): after the finish arch every racer gets off the bike, walks (first person for you) to a
// helipad with 7 Apaches, then flies against all the wyverns. Most dragons shot down wins. Wyverns fight back: they
// dive on the helicopters, grab them in their talons and hurl them at the mountain; the pilot is thrown out and falls.
// If YOU fall to the ground you lose. Everything is procedural + pooled so it stays playable on an iPhone.
import { makeRider, makeGearMaterial } from './rider.js?v=m4';
export function createEndgame(G) {
  const { THREE, scene, camera, state, keys, AI, RIVALS, DRAGON, SFX, IS_MOBILE, toast, groundAt, pathPoint, FINISH_S, TRACK_LEN,
    makeNameTag, mergeGeometries, DRAGON_LOD, altShown } = G;
  const V3 = THREE.Vector3, clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
  const TH = (x, z) => { const f = G.terrainH(); const t = f ? f(x, z) : null; return t == null || isNaN(t) ? groundAt(x, z, FINISH_S).y : t; };
  const TOUCH = matchMedia('(hover:none), (max-width:900px)').matches;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const tv = new V3(), tv2 = new V3(), tv3 = new V3();

  // ======================================================================= DOM: HUD, touch controls, fade
  const css = document.createElement('style');
  css.textContent = `
#egHud{position:fixed;inset:0;pointer-events:none;z-index:3;display:none;font-family:"Segoe UI",system-ui,-apple-system,sans-serif}
#egHud.on{display:block}
#egBoard{position:absolute;left:12px;top:10px;background:linear-gradient(180deg,rgba(8,10,14,.74),rgba(8,10,14,.48));border:1px solid rgba(255,90,60,.35);border-radius:12px;padding:8px 11px;font-size:12px;line-height:1.38;min-width:172px;text-shadow:0 1px 3px #000;color:#dfe5ee}
#egBoard .t{font-weight:800;letter-spacing:.08em;color:#ffb070;font-size:11px;margin-bottom:3px}
#egBoard .r{display:flex;gap:6px;align-items:center;white-space:nowrap}
#egBoard .r i{display:inline-block;width:9px;height:9px;border-radius:2px}
#egBoard .r b{margin-left:auto;color:#fff;min-width:14px;text-align:right}
#egBoard .r.me{color:#fff;font-weight:800}
#egBoard .r.out{opacity:.45;text-decoration:line-through}
@media (max-height:500px){#egBoard{font-size:9.5px;line-height:1.25;padding:5px 8px;min-width:128px;top:6px;left:8px;border-radius:9px}#egBoard .t{font-size:8.5px}#egBoard .r i{width:7px;height:7px}}
#egObj{position:absolute;left:50%;top:10px;transform:translateX(-50%);background:rgba(8,10,14,.55);border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:6px 14px;font-size:13px;font-weight:700;color:#fff;text-shadow:0 1px 3px #000;white-space:nowrap}
#egWarn{position:absolute;left:50%;top:22%;transform:translateX(-50%);font-size:1.45rem;font-weight:900;color:#ff3b2a;text-shadow:0 0 14px rgba(0,0,0,.95),0 2px 2px #000;letter-spacing:.04em;white-space:nowrap;display:none}
#egWarn.on{display:block;animation:egBlink .45s steps(2) infinite}
@keyframes egBlink{50%{opacity:.35}}
#egFeed{position:absolute;right:12px;top:112px;text-align:right;font-size:12px;line-height:1.5;color:#fff;text-shadow:0 1px 3px #000,0 0 8px #000}
#egStat{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);background:rgba(8,10,14,.5);border-radius:9px;padding:4px 12px;font-size:12px;color:#d8dee8;white-space:nowrap;text-shadow:0 1px 2px #000}
#egCross{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border:2px solid rgba(140,255,170,.85);border-radius:50%;display:none}
#egCross:after{content:"";position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px;background:#8cffaa;border-radius:50%}
#egLock{position:absolute;width:64px;height:64px;margin:-32px 0 0 -32px;border:2px solid #ffcf40;display:none}
#egLock.lk{border-color:#ff3b2a;box-shadow:0 0 12px rgba(255,60,40,.6)}
#egLock .hp{position:absolute;left:-2px;right:-2px;bottom:-9px;height:4px;background:rgba(0,0,0,.6)}
#egLock .hp i{display:block;height:100%;background:#ff4a2a}
#egLock .nm{position:absolute;left:50%;top:-17px;transform:translateX(-50%);font-size:10px;font-weight:800;color:#ffd060;white-space:nowrap;text-shadow:0 1px 2px #000}
#egDot{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:rgba(255,255,255,.85);box-shadow:0 0 4px #000;display:none}
#egCtl{position:fixed;inset:0;z-index:4;display:none;pointer-events:none}
#egCtl.on{display:block}
#egCtl .zone{position:absolute;top:0;bottom:0;pointer-events:auto;touch-action:none}
#egCtl .zl{left:0;width:44%}
#egCtl .zr{right:0;width:56%}
#egStick{position:absolute;width:120px;height:120px;margin:-60px 0 0 -60px;border-radius:50%;border:2px solid rgba(255,255,255,.35);background:rgba(20,14,8,.25);display:none;pointer-events:none}
#egKnob{position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px;border-radius:50%;background:rgba(255,200,120,.55);border:2px solid rgba(255,230,180,.8)}
#egCtl .egb{position:absolute;pointer-events:auto;touch-action:none;border-radius:50%;border:2px solid rgba(255,200,100,.5);background:rgba(20,14,8,.5);color:#fff;font-weight:900;font-size:.95rem;-webkit-user-select:none;user-select:none;backdrop-filter:blur(4px);box-shadow:0 4px 16px rgba(0,0,0,.35);display:none}
#egCtl.fly .egb.f,#egCtl.walk .egb.w{display:block}
#egCtl .fire{right:16px;bottom:16px;width:96px;height:96px;background:rgba(160,30,20,.55);border-color:rgba(255,120,90,.6);font-size:1.1rem}
#egCtl .msl{right:124px;bottom:24px;width:72px;height:72px;background:rgba(150,90,10,.5);border-color:rgba(255,200,90,.6)}
#egCtl .up{right:30px;bottom:126px;width:66px;height:66px;background:rgba(30,90,150,.5);border-color:rgba(140,200,255,.55);font-size:1.4rem}
#egCtl .dn{right:118px;bottom:112px;width:58px;height:58px;background:rgba(30,60,110,.5);border-color:rgba(140,200,255,.45);font-size:1.25rem}
#egCtl .board{right:22px;bottom:30px;width:100px;height:100px;background:rgba(200,100,10,.6);border-color:rgba(255,210,120,.8)}
#egCtl .board.hide{display:none!important}
#egFade{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:7;transition:opacity .55s}
#egFade.on{opacity:1}
button#egGo{display:block;margin:0 auto 12px;border:0;border-radius:12px;padding:14px 26px;font-size:1.05rem;font-weight:900;color:#fff;cursor:pointer;background:linear-gradient(180deg,#e2452a,#9a1a0c);box-shadow:0 10px 28px rgba(220,60,20,.45);letter-spacing:.02em}
button#egGo[hidden]{display:none}
`;
  document.head.appendChild(css);
  const hud = document.createElement('div'); hud.id = 'egHud';
  hud.innerHTML = '<div id="egBoard"></div><div id="egObj"></div><div id="egWarn"></div><div id="egFeed"></div><div id="egStat"></div><div id="egCross"></div><div id="egDot"></div><div id="egLock"><div class="nm"></div><div class="hp"><i></i></div></div>';
  document.body.appendChild(hud);
  const ctl = document.createElement('div'); ctl.id = 'egCtl';
  ctl.innerHTML = '<div class="zone zl"></div><div class="zone zr"></div><div id="egStick"><div id="egKnob"></div></div>' +
    '<button class="egb f fire" data-b="fire">FIRE</button><button class="egb f msl" data-b="msl">MSL</button>' +
    '<button class="egb f up" data-b="up">▲</button><button class="egb f dn" data-b="dn">▼</button>' +
    '<button class="egb w board hide" data-b="board">BOARD</button>';
  document.body.appendChild(ctl);
  const fade = document.createElement('div'); fade.id = 'egFade'; document.body.appendChild(fade);
  const $ = (id) => document.getElementById(id);
  const el = { board: $('egBoard'), obj: $('egObj'), warn: $('egWarn'), feed: $('egFeed'), stat: $('egStat'), cross: $('egCross'), dot: $('egDot'), lock: $('egLock'),
    lockNm: hud.querySelector('#egLock .nm'), lockHp: hud.querySelector('#egLock .hp i'), stick: $('egStick'), knob: $('egKnob'), boardBtn: ctl.querySelector('.board') };

  // ---- touch input: left = virtual stick, right = look drag (walk), buttons
  const tin = { sx: 0, sy: 0, look: [0, 0], b: {}, stickId: null, lookId: null, ox: 0, oy: 0, lx: 0, ly: 0 };
  const zl = ctl.querySelector('.zl'), zr = ctl.querySelector('.zr');
  zl.addEventListener('touchstart', e => { e.preventDefault(); const t = e.changedTouches[0]; if (tin.stickId != null) return; tin.stickId = t.identifier; tin.ox = t.clientX; tin.oy = t.clientY; el.stick.style.display = 'block'; el.stick.style.left = t.clientX + 'px'; el.stick.style.top = t.clientY + 'px'; el.knob.style.transform = ''; }, { passive: false });
  const stickMove = e => { for (const t of e.changedTouches) if (t.identifier === tin.stickId) { e.preventDefault(); let dx = t.clientX - tin.ox, dy = t.clientY - tin.oy; const L = Math.hypot(dx, dy), R = 50; if (L > R) { dx *= R / L; dy *= R / L; } tin.sx = dx / R; tin.sy = dy / R; el.knob.style.transform = `translate(${dx}px,${dy}px)`; } };
  const stickEnd = e => { for (const t of e.changedTouches) if (t.identifier === tin.stickId) { tin.stickId = null; tin.sx = tin.sy = 0; el.stick.style.display = 'none'; } };
  zl.addEventListener('touchmove', stickMove, { passive: false }); zl.addEventListener('touchend', stickEnd); zl.addEventListener('touchcancel', stickEnd);
  zr.addEventListener('touchstart', e => { e.preventDefault(); const t = e.changedTouches[0]; if (tin.lookId != null) return; tin.lookId = t.identifier; tin.lx = t.clientX; tin.ly = t.clientY; }, { passive: false });
  zr.addEventListener('touchmove', e => { for (const t of e.changedTouches) if (t.identifier === tin.lookId) { e.preventDefault(); tin.look[0] += t.clientX - tin.lx; tin.look[1] += t.clientY - tin.ly; tin.lx = t.clientX; tin.ly = t.clientY; } }, { passive: false });
  const lookEnd = e => { for (const t of e.changedTouches) if (t.identifier === tin.lookId) tin.lookId = null; };
  zr.addEventListener('touchend', lookEnd); zr.addEventListener('touchcancel', lookEnd);
  ctl.querySelectorAll('.egb').forEach(b => {
    const k = b.dataset.b;
    const dn = e => { e.preventDefault(); e.stopPropagation(); tin.b[k] = true; if (k === 'msl') tin.mslEdge = true; if (k === 'board') tin.boardEdge = true; SFX.unlock && SFX.unlock(); };
    const up = e => { e.preventDefault(); tin.b[k] = false; };
    b.addEventListener('touchstart', dn, { passive: false }); b.addEventListener('touchend', up, { passive: false }); b.addEventListener('touchcancel', up, { passive: false });
    b.addEventListener('mousedown', dn); b.addEventListener('mouseup', up); b.addEventListener('mouseleave', up);
  });
  // ---- desktop: mouse look (pointer lock), LMB guns, RMB missile, E board
  const mouse = { dx: 0, dy: 0, l: false };
  const lockPtr = () => { try { const r = G.canvas.requestPointerLock && G.canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} };
  G.canvas.addEventListener('click', () => { if (active && phase !== 'over' && !TOUCH) lockPtr(); });
  addEventListener('mousemove', e => { if (active && document.pointerLockElement === G.canvas) { mouse.dx += e.movementX; mouse.dy += e.movementY; } });
  addEventListener('mousedown', e => { if (!active || document.pointerLockElement !== G.canvas) return; if (e.button === 0) mouse.l = true; if (e.button === 2) tin.mslEdge = true; });
  addEventListener('mouseup', e => { if (e.button === 0) mouse.l = false; });
  addEventListener('contextmenu', e => { if (active) e.preventDefault(); });
  addEventListener('keydown', e => { if (!active) return; if (e.code === 'KeyK' || e.code === 'KeyF') tin.mslEdge = true; if (e.code === 'KeyE' || e.code === 'Enter') tin.boardEdge = true; });

  // ======================================================================= textures / materials
  const canvasTex = (w, h, draw, srgb = true) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const radial = (stops) => canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); stops.forEach(([o, c]) => gr.addColorStop(o, c)); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
  const fireTex = radial([[0, 'rgba(255,255,230,1)'], [0.2, 'rgba(255,220,120,1)'], [0.45, 'rgba(255,120,30,.85)'], [0.75, 'rgba(160,40,10,.35)'], [1, 'rgba(0,0,0,0)']]);
  const smokeTex = radial([[0, 'rgba(70,66,62,.85)'], [0.5, 'rgba(60,56,52,.5)'], [1, 'rgba(40,40,40,0)']]);
  const dustTex = radial([[0, 'rgba(190,170,140,.75)'], [0.6, 'rgba(170,150,120,.35)'], [1, 'rgba(150,130,100,0)']]);
  const sparkTex = radial([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,230,140,.9)'], [1, 'rgba(255,120,0,0)']]);
  const olive = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#4a5228'; g.fillRect(0, 0, w, h);
    const id = g.getImageData(0, 0, w, h), d = id.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 18; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.6; }
    g.putImageData(id, 0, 0);
    g.strokeStyle = 'rgba(20,24,10,.55)'; g.lineWidth = 1.2;
    for (let i = 0; i < 9; i++) { const x = (i * 29 + 7) % w; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let i = 0; i < 6; i++) { const y = (i * 43 + 11) % h; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = 'rgba(30,30,20,.5)'; for (let i = 0; i < 160; i++) g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(20,18,10,${0.05 + Math.random() * 0.1})`; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 8 + Math.random() * 30, 3 + Math.random() * 8, Math.random() * 3, 0, 7); g.fill(); }
  });
  olive.wrapS = olive.wrapT = THREE.RepeatWrapping;
  const bodyMat = new THREE.MeshStandardMaterial({ map: olive, color: 0xffffff, roughness: 0.72, metalness: 0.28, envMapIntensity: 0.8 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1d1f1c, roughness: 0.55, metalness: 0.55 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.08, metalness: 0.9, envMapIntensity: 1.6 });
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });

  // ======================================================================= Apache AH-64 (procedural, ~6 draw calls)
  const APACHE = (() => {
    const B = [], D = [], Gl = [], T = [];
    const ni = (g) => (g.index ? g.toNonIndexed() : g);
    const keep = (g) => { g = ni(g); for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; };
    const prof = [[7.7, 1.2], [7.5, 1.95], [6.7, 2.45], [5.2, 2.85], [1.2, 3.25], [-1.8, 3.25], [-3.4, 2.9], [-4.9, 2.55], [-4.9, 1.5], [-2.4, 0.85], [4.6, 0.8], [6.8, 0.92]];
    const sh = new THREE.Shape(); prof.forEach(([z, y], i) => (i ? sh.lineTo(z, y) : sh.moveTo(z, y)));
    const fus = new THREE.ExtrudeGeometry(sh, { depth: 1.7, bevelEnabled: true, bevelThickness: 0.22, bevelSize: 0.2, bevelSegments: 2, steps: 1 });
    fus.translate(0, 0, -0.85); fus.rotateY(-Math.PI / 2);
    { const uv = fus.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.12, uv.getY(i) * 0.12); }
    B.push(fus);
    const box = (w, h, d, x, y, z, arr, rx = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(x, y, z); arr.push(g); return g; };
    const cylZ = (r0, r1, len, x, y, z, arr, seg = 10) => { const g = new THREE.CylinderGeometry(r0, r1, len, seg); g.rotateX(Math.PI / 2); g.translate(x, y, z); arr.push(g); return g; };
    // tandem canopy (gunner front-low, pilot behind-high) + frames
    box(1.45, 0.62, 1.9, 0, 3.05, 4.25, Gl, -0.28); box(1.5, 0.82, 2.0, 0, 3.45, 2.2, Gl, -0.18);
    box(1.55, 0.08, 0.1, 0, 3.4, 3.3, D); box(1.6, 0.08, 0.1, 0, 3.86, 1.25, D);
    // tail boom, fin, stabiliser, team colours
    cylZ(0.36, 0.66, 5.6, 0, 2.05, -7.6, B, 8);
    box(0.22, 2.9, 1.5, 0, 3.25, -10.15, B, -0.22); box(0.26, 0.55, 1.55, 0, 4.45, -10.45, T, -0.22);
    box(3.6, 0.12, 0.95, 0, 2.15, -9.7, B);
    box(1.98, 0.42, 4.6, 0, 2.15, -1.4, T);
    // engines + exhausts + intakes
    for (const s of [-1, 1]) { cylZ(0.6, 0.55, 3.6, s * 1.32, 2.95, -0.7, B, 12); cylZ(0.42, 0.42, 0.7, s * 1.32, 2.95, -2.75, D, 10); box(0.5, 0.8, 0.8, s * 1.15, 2.45, 0.9, B); }
    // mast + Longbow radar dome
    { const g = new THREE.CylinderGeometry(0.22, 0.3, 1.0, 8); g.translate(0, 3.85, 0.2); D.push(g); }
    { const g = new THREE.SphereGeometry(0.72, 14, 8); g.scale(1, 0.55, 1); g.translate(0, 5.0, 0.2); B.push(g); }
    // stub wings with rocket pods + Hellfire rails
    box(6.8, 0.2, 1.5, 0, 2.05, 0.35, B);
    for (const s of [-1, 1]) {
      cylZ(0.34, 0.34, 1.9, s * 2.05, 1.6, 0.55, D, 10); box(0.12, 0.35, 0.9, s * 2.05, 1.85, 0.5, D);
      for (const a of [-1, 1]) for (const b of [-1, 1]) cylZ(0.11, 0.11, 1.55, s * 3.05 + a * 0.16, 1.62 + b * 0.16, 0.7, D, 6);
      box(0.1, 0.3, 1.1, s * 3.05, 1.92, 0.55, D);
    }
    // chin gun + nose sensor turret
    { const g = new THREE.SphereGeometry(0.3, 10, 8); g.translate(0, 0.62, 5.3); D.push(g); }
    cylZ(0.075, 0.075, 1.7, 0, 0.55, 6.15, D, 6);
    box(0.85, 0.7, 0.55, 0, 1.25, 7.85, D); { const g = new THREE.SphereGeometry(0.28, 10, 8); g.translate(0.32, 1.2, 8.1); D.push(g); const g2 = g.clone(); g2.translate(-0.64, 0, 0); D.push(g2); }
    // landing gear
    for (const s of [-1, 1]) { const st = new THREE.CylinderGeometry(0.08, 0.08, 1.1, 6); st.rotateZ(s * 0.35); st.translate(s * 1.25, 0.65, 3.4); D.push(st); const w = new THREE.CylinderGeometry(0.42, 0.42, 0.28, 14); w.rotateZ(Math.PI / 2); w.translate(s * 1.5, 0.42, 3.45); D.push(w); }
    { const st = new THREE.CylinderGeometry(0.06, 0.06, 1.5, 6); st.translate(0, 1.05, -9.5); D.push(st); const w = new THREE.CylinderGeometry(0.24, 0.24, 0.16, 10); w.rotateZ(Math.PI / 2); w.translate(0, 0.24, -9.55); D.push(w); }
    const body = mergeGeometries(B.map(keep)), dark = mergeGeometries(D.map(keep)), glass = mergeGeometries(Gl.map(keep)), team = mergeGeometries(T.map(keep));
    const blades = []; for (let i = 0; i < 4; i++) { const g = new THREE.BoxGeometry(7.3, 0.07, 0.55); g.translate(3.95, 0, 0); g.rotateY(i * Math.PI / 2 + 0.03); blades.push(keep(g)); }
    blades.push(keep(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10)));
    const rotorG = mergeGeometries(blades);
    const tailG = mergeGeometries([keep(new THREE.BoxGeometry(0.06, 2.9, 0.26)), keep(new THREE.BoxGeometry(0.06, 0.26, 2.9))]);
    const discG = new THREE.CircleGeometry(11.2, 40); discG.rotateX(-Math.PI / 2);
    const tdiscG = new THREE.CircleGeometry(1.5, 20); tdiscG.rotateY(Math.PI / 2);
    return { body, dark, glass, team, rotorG, tailG, discG, tdiscG };
  })();
  function makeApache(col, tag) {
    const root = new THREE.Group(); root.rotation.order = 'YXZ';
    const tm = new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, metalness: 0.2, emissive: new THREE.Color(col).multiplyScalar(0.12) });
    const add = (g, m) => { const o = new THREE.Mesh(g, m); o.castShadow = !IS_MOBILE; o.receiveShadow = false; root.add(o); return o; };
    add(APACHE.body, bodyMat); add(APACHE.dark, darkMat); add(APACHE.glass, glassMat); add(APACHE.team, tm);
    const rotor = new THREE.Mesh(APACHE.rotorG, bladeMat); rotor.position.set(0, 4.55, 0.2); rotor.castShadow = !IS_MOBILE; root.add(rotor);
    const disc = new THREE.Mesh(APACHE.discG, new THREE.MeshBasicMaterial({ color: 0x101214, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    disc.position.copy(rotor.position); root.add(disc);
    const trotor = new THREE.Mesh(APACHE.tailG, bladeMat); trotor.position.set(0.32, 3.95, -10.35); root.add(trotor);
    const tdisc = new THREE.Mesh(APACHE.tdiscG, disc.material); tdisc.position.copy(trotor.position); root.add(tdisc);
    if (tag) { tag.scale.set(7.8, 1.95, 1); tag.position.set(0, 7.6, 0); root.add(tag); }
    scene.add(root);
    return { root, rotor, disc, trotor, tdisc, tm, tag };
  }

  // ======================================================================= pilot figure (walkers + ejected pilots)
  const PIL = (() => {
    const torso = new THREE.CapsuleGeometry(0.3, 0.55, 4, 10); torso.translate(0, 1.33, 0);
    const head = new THREE.SphereGeometry(0.25, 14, 10); head.translate(0, 1.95, 0);
    const visor = new THREE.BoxGeometry(0.34, 0.12, 0.12); visor.translate(0, 1.96, 0.2);
    const limb = new THREE.CapsuleGeometry(0.11, 0.62, 3, 8); limb.translate(0, -0.42, 0);
    const arm = new THREE.CapsuleGeometry(0.085, 0.5, 3, 8); arm.translate(0, -0.33, 0);
    const pants = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.85 });
    const vis = new THREE.MeshStandardMaterial({ color: 0xff8a1a, roughness: 0.1, metalness: 0.8 });
    return { torso, head, visor, limb, arm, pants, vis };
  })();
  // the real MX rider rig (MakeHuman body + procedural kit) on foot: loaded in the background once the race is up,
  // one skinned clone per racer; the capsule figure is only a fallback if that hasn't finished loading
  let KIT = null;
  try {
    Promise.all([new Promise((res, rej) => new G.GLTFLoader().load('./models/rider.glb', res, undefined, rej)), import('three/addons/utils/SkeletonUtils.js')])
      .then(([gltf, SU]) => { KIT = { gltf, SU }; }).catch(e => console.warn('[endgame] rider kit failed', e));
  } catch (e) { console.warn('[endgame] rider kit', e); }
  const ORG = new THREE.Color(1.0, 0.28, 0.02);
  function makeRig(R) {
    const sc = KIT.SU.clone(KIT.gltf.scene);
    sc.traverse(o => { if (o.isSkinnedMesh) o.geometry = o.geometry.clone(); });
    const rig = makeRider({ scene: sc }, THREE);
    const paint = new THREE.Color(R.col);
    rig.group.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = !IS_MOBILE; o.receiveShadow = false;
      if (o.isSkinnedMesh) { if (!R.player) o.material = makeGearMaterial(THREE, { name: R.name, num: R.num, main: R.col, accent: R.r ? R.r.acc : '#ffffff' }); o.frustumCulled = false; }
      else if (!R.player && o.material && o.material.vertexColors && o.geometry.attributes.color) {
        const g = o.geometry.clone(), ca = g.attributes.color;
        for (let k = 0; k < ca.count; k++) if (Math.abs(ca.getX(k) - ORG.r) < 0.05 && Math.abs(ca.getY(k) - ORG.g) < 0.05) ca.setXYZ(k, paint.r, paint.g, paint.b);
        o.geometry = g;
      } else if (!R.player && o.material && o.material.color && o.material.color.getHex() === 0xff5a00) { o.material = o.material.clone(); o.material.color.copy(paint); }
    });
    scene.add(rig.group);
    return { g: rig.group, rig, yawOff: Math.PI, ph: Math.random() * 6 };
  }
  function makePilot(R) {
    if (KIT) { try { return makeRig(R); } catch (e) { console.warn('[endgame] rig failed, capsule pilot', e); } }
    const col = R.col;
    const g = new THREE.Group();
    const jm = new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 });
    const add = (geo, m, p) => { const o = new THREE.Mesh(geo, m); o.castShadow = !IS_MOBILE; (p || g).add(o); return o; };
    add(PIL.torso, jm); add(PIL.head, jm); add(PIL.visor, PIL.vis);
    const limbs = [];
    for (const s of [-1, 1]) { const hip = new THREE.Group(); hip.position.set(s * 0.15, 0.95, 0); g.add(hip); add(PIL.limb, PIL.pants, hip); limbs.push(hip); }
    for (const s of [-1, 1]) { const sh = new THREE.Group(); sh.position.set(s * 0.4, 1.62, 0); g.add(sh); add(PIL.arm, jm, sh); limbs.push(sh); }
    g.scale.setScalar(1.15);
    scene.add(g);
    return { g, limbs, yawOff: 0, ph: Math.random() * 6 };
  }
  function poseWalk(P, dt, v) {
    P.ph += dt * v * 1.15;
    const amt = Math.min(1, v / 4.5);
    if (P.rig) { P.rig.walk(P.ph, amt, dt); return; }
    const a = Math.sin(P.ph) * 0.6 * amt; P.limbs[0].rotation.x = a; P.limbs[1].rotation.x = -a; P.limbs[2].rotation.x = -a * 0.8; P.limbs[3].rotation.x = a * 0.8; P.limbs[2].rotation.z = P.limbs[3].rotation.z = 0;
  }
  function poseFlail(P, dt) {
    P.ph += dt * 9;
    if (P.rig) { P.rig.flail(P.ph, dt); return; }
    const s = Math.sin(P.ph), c = Math.cos(P.ph * 1.3); P.limbs[0].rotation.x = 0.6 * s; P.limbs[1].rotation.x = -0.6 * s; P.limbs[2].rotation.set(-2.4 + 0.6 * c, 0, -0.6); P.limbs[3].rotation.set(-2.4 - 0.6 * c, 0, 0.6);
  }

  // ======================================================================= FX pools: fire/smoke/dust sprites, tracers, missiles
  const FX = [];
  const fxGroup = new THREE.Group(); scene.add(fxGroup);
  const NFX = IS_MOBILE ? 70 : 120;
  for (let i = 0; i < NFX; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false })); sp.visible = false; fxGroup.add(sp); FX.push({ sp, life: 0, max: 1, vel: new V3(), g0: 1, g1: 2, kind: 0 }); }
  let fxCur = 0;
  function fx(kind, p, size, life, vel) {
    const f = FX[fxCur]; fxCur = (fxCur + 1) % NFX;
    const m = f.sp.material; const add = kind === 1 || kind === 3;
    m.map = kind === 0 ? smokeTex : kind === 1 ? fireTex : kind === 2 ? dustTex : sparkTex;
    if (m.blending !== (add ? THREE.AdditiveBlending : THREE.NormalBlending)) { m.blending = add ? THREE.AdditiveBlending : THREE.NormalBlending; m.toneMapped = !add; m.needsUpdate = true; }
    f.sp.position.copy(p); f.sp.visible = true; f.life = f.max = life; f.kind = kind; f.g0 = size; f.g1 = size * (kind === 1 ? 2.2 : kind === 3 ? 0.6 : 3.2);
    if (vel) f.vel.copy(vel); else f.vel.set(0, 0, 0); m.rotation = Math.random() * 6; f.sp.scale.setScalar(size);
  }
  function fxUpdate(dt) {
    for (const f of FX) {
      if (f.life <= 0) continue; f.life -= dt; if (f.life <= 0) { f.sp.visible = false; continue; }
      const k = 1 - f.life / f.max; f.sp.position.addScaledVector(f.vel, dt); f.vel.multiplyScalar(Math.exp(-1.2 * dt)); if (f.kind === 0 || f.kind === 2) f.vel.y += 2 * dt;
      f.sp.scale.setScalar(lerp(f.g0, f.g1, Math.sqrt(k))); f.sp.material.opacity = (f.kind === 1 ? 1 - k * k : (1 - k)) * (f.kind === 0 ? 0.85 : 1);
    }
  }
  const ev = new V3(), ep = new V3();
  function explode(p, big) {
    const n = big ? (IS_MOBILE ? 12 : 18) : 5, s = big ? 14 : 4;
    const c = p.clone();
    for (let i = 0; i < n; i++) fx(1, ep.copy(c).add(ev.set(rnd(-1, 1), rnd(-0.5, 1), rnd(-1, 1)).multiplyScalar(s * 0.5)), s * rnd(0.6, 1.2), rnd(0.5, 1.0), ev.set(rnd(-1, 1), rnd(0, 1.5), rnd(-1, 1)).multiplyScalar(s * 0.8));
    for (let i = 0; i < n; i++) fx(0, ep.copy(c).add(ev.set(rnd(-1, 1), rnd(0, 1), rnd(-1, 1)).multiplyScalar(s * 0.6)), s * rnd(0.8, 1.3), rnd(1.8, 3.2), ev.set(rnd(-1, 1), rnd(0.5, 2), rnd(-1, 1)).multiplyScalar(s * 0.35));
    const d = camera.position.distanceTo(c); snd.boom(Math.max(0, 1 - d / (big ? 900 : 500)) * (big ? 1 : 0.6));
  }
  // tracers
  const tracerG = new THREE.BoxGeometry(0.22, 0.22, 9); const tracerM = new THREE.MeshBasicMaterial({ color: 0xffd36a, toneMapped: false });
  const TR = []; for (let i = 0; i < (IS_MOBILE ? 40 : 70); i++) { const m = new THREE.Mesh(tracerG, tracerM); m.visible = false; fxGroup.add(m); TR.push({ m, a: new V3(), b: new V3(), t: 0, T: 0, cb: null }); }
  let trCur = 0;
  function tracer(a, b, cb) { const r = TR[trCur]; trCur = (trCur + 1) % TR.length; if (r.cb && r.m.visible) { const c = r.cb; r.cb = null; c(); } r.a.copy(a); r.b.copy(b); r.t = 0; r.T = Math.max(0.05, a.distanceTo(b) / 1100); r.cb = cb; r.m.visible = true; r.m.position.copy(a); r.m.lookAt(b); }
  function tracerUpdate(dt) { for (const r of TR) { if (!r.m.visible) continue; r.t += dt; const k = r.t / r.T; if (k >= 1) { r.m.visible = false; const c = r.cb; r.cb = null; if (c) c(); continue; } r.m.position.lerpVectors(r.a, r.b, k); } }
  // missiles
  const mslG = (() => { const g = new THREE.CylinderGeometry(0.16, 0.16, 1.8, 8); g.rotateX(Math.PI / 2); return g; })();
  const MS = []; for (let i = 0; i < 18; i++) { const m = new THREE.Mesh(mslG, darkMat); const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); fl.position.z = -1.3; fl.scale.setScalar(2.2); m.add(fl); m.visible = false; fxGroup.add(m); MS.push({ m, pos: new V3(), vel: new V3(), tgt: null, owner: null, life: 0, smoke: 0 }); }
  const mv1 = new V3(), mv2 = new V3();
  function launchMissile(H, D) {
    const M = MS.find(m => m.life <= 0); if (!M) return;
    H.root.updateMatrixWorld(true);
    H.side = -(H.side || 1);
    M.pos.copy(H.root.localToWorld(mv1.set(H.side * 2.05, 1.5, 1.6)));
    M.vel.set(Math.sin(H.yaw), 0, Math.cos(H.yaw)).multiplyScalar(90).add(H.vel); M.tgt = D; M.owner = H.owner; M.life = 6; M.m.visible = true;
    if (H.owner.player) snd.missile(0.7); else snd.missile(Math.max(0, 1 - camera.position.distanceTo(M.pos) / 300) * 0.4);
  }
  function missileUpdate(dt) {
    for (const M of MS) {
      if (M.life <= 0) continue; M.life -= dt;
      const D = M.tgt && M.tgt.alive ? M.tgt : null;
      if (D) {
        mv1.subVectors(D.d.dpos, M.pos); const dist = mv1.length(); mv1.normalize(); const v = M.vel.length();
        M.vel.normalize().lerp(mv1, Math.min(1, 3.2 * dt)).normalize().multiplyScalar(Math.min(300, v + 260 * dt));
        if (dist < 16 * D.S) { explode(M.pos, false); damage(D, 70, M.owner, M.pos); M.life = 0; }
      } else M.vel.multiplyScalar(1 + 0.5 * dt);
      M.pos.addScaledVector(M.vel, dt); M.m.position.copy(M.pos); M.m.lookAt(mv2.copy(M.pos).add(M.vel));
      M.smoke -= dt; if (M.smoke <= 0) { M.smoke = IS_MOBILE ? 0.06 : 0.035; fx(0, M.pos, 1.6, 1.4, mv2.set(0, 0.5, 0)); }
      if (M.life > 0 && M.pos.y < TH(M.pos.x, M.pos.z) + 0.5) { explode(M.pos, false); M.life = 0; }
      if (M.life <= 0) M.m.visible = false;
    }
  }

  // ======================================================================= synth SFX (guns, missiles, explosions, rotor) on the game's audio bus
  const snd = (() => {
    let nb = null, rotor = null, lastGun = 0;
    const ok = () => SFX.ctx && SFX.ctx.state === 'running' && !SFX.muted && SFX.bus;
    const noise = (ctx) => { if (nb) return nb; nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return nb; };
    function burst(vol, f0, f1, dur, type = 'lowpass', q = 0.8) {
      if (!ok() || vol < 0.02) return; const c = SFX.ctx, t = c.currentTime;
      const s = c.createBufferSource(); s.buffer = noise(c); const f = c.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(SFX.bus); s.start(t, Math.random()); s.stop(t + dur + 0.05);
    }
    function thump(vol, f0, dur) { if (!ok() || vol < 0.02) return; const c = SFX.ctx, t = c.currentTime; const o = c.createOscillator(); o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.35, t + dur); const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(SFX.bus); o.start(t); o.stop(t + dur); }
    return {
      gun(vol) { const n = performance.now(); if (n - lastGun < 70) return; lastGun = n; burst(vol * 0.5, 2600, 500, 0.09, 'bandpass', 1.2); thump(vol * 0.35, 140, 0.07); },
      missile(vol) { burst(vol * 0.6, 900, 3200, 0.9, 'bandpass', 0.7); },
      boom(vol) { if (vol < 0.03) return; burst(Math.min(1, vol * 1.1), 1500, 60, 1.8); thump(Math.min(1, vol), 70, 0.9); },
      rotorStart() {
        try {
          if (rotor || !SFX.ctx || !SFX.bus) return; const c = SFX.ctx;
          const s = c.createBufferSource(); s.buffer = noise(c); s.loop = true;
          const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = 1.2;
          const am = c.createGain(); am.gain.value = 0.5; const lfo = c.createOscillator(); lfo.type = 'sawtooth'; lfo.frequency.value = 4; const lg = c.createGain(); lg.gain.value = 0.48; lfo.connect(lg); lg.connect(am.gain);
          const out = c.createGain(); out.gain.value = 0; s.connect(f); f.connect(am); am.connect(out); out.connect(SFX.bus);
          const hum = c.createOscillator(); hum.type = 'triangle'; hum.frequency.value = 62; const hg = c.createGain(); hg.gain.value = 0.05; hum.connect(hg); hg.connect(out);
          s.start(); lfo.start(); hum.start();
          rotor = { s, lfo, hum, out };
        } catch (e) { rotor = null; }
      },
      rotorSet(rpm, load) { if (!rotor) return; const t = SFX.ctx.currentTime; rotor.lfo.frequency.setTargetAtTime(2 + 16 * rpm, t, 0.2); rotor.out.gain.setTargetAtTime(0.22 * rpm * (0.8 + 0.3 * Math.min(1, load)), t, 0.2); rotor.hum.frequency.setTargetAtTime(40 + 40 * rpm, t, 0.3); },
      rotorStop() { if (!rotor) return; const r = rotor; rotor = null; try { r.out.gain.setTargetAtTime(0, SFX.ctx.currentTime, 0.15); setTimeout(() => { try { r.s.stop(); r.lfo.stop(); r.hum.stop(); } catch (e) {} }, 800); } catch (e) {} },
    };
  })();

  // ======================================================================= the stage: helipad on the summit
  let built = false, deckY = 0, hyPad = 0, STAGE = null;
  const F = new V3(), dP = new V3(), sP = new V3(), padC = new V3();
  const G0 = 16, DD = 56, WW = 96, SUMMIT_R = 24;
  const SPOTS = [[14, -11.5], [14, 11.5], [14, -34.5], [14, 34.5], [40, -23], [40, 0], [40, 23]];   // [depth past the deck edge, lateral]
  const toW = (u, v, y, out = new V3()) => out.set(F.x + dP.x * u + sP.x * v, y, F.z + dP.z * u + sP.z * v);
  const toL = (x, z) => { const ax = x - F.x, az = z - F.z; return [ax * dP.x + az * dP.z, ax * sP.x + az * sP.z]; };
  const onDeck = (u, v) => u >= G0 && u <= G0 + DD && Math.abs(v) <= WW / 2;
  const onRamp = (u, v) => u >= -2 && u <= G0 + 0.5 && Math.abs(v) <= 6.5;
  const deckAt = (x, z) => { const [u, v] = toL(x, z); return onDeck(u, v); };
  function floorAt(x, z) {   // walkable surface (deck, ramp, summit) or the mountain
    const [u, v] = toL(x, z);
    if (onDeck(u, v)) return deckY;
    if (onRamp(u, v) && u > 0) return Math.max(lerp(F.y, deckY, clamp(u / G0, 0, 1)), TH(x, z));
    if (Math.hypot(x - F.x, z - F.z) < SUMMIT_R + 6) return groundAt(x, z, FINISH_S).y;
    return TH(x, z);
  }
  const walkable = (x, z) => { const [u, v] = toL(x, z); return onDeck(u, v) || onRamp(u, v) || Math.hypot(x - F.x, z - F.z) < SUMMIT_R; };
  const RACERS = [], HELIS = [], DRAG = [], PILOTS = [];

  function buildStage() {
    const t = FINISH_S / TRACK_LEN, p = pathPoint(t);
    F.set(p.x, groundAt(p.x, p.z, FINISH_S).y, p.z);
    const pb = pathPoint(t - 30 / TRACK_LEN); const back = new V3(pb.x - p.x, 0, pb.z - p.z).normalize();
    // put the deck on the side of the summit where it clears the snow (lowest terrain under it), not back down the track
    let best = null;
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2, d = new V3(Math.cos(a), 0, Math.sin(a));
      if (d.dot(back) > 0.55) continue;
      const s = new V3(-d.z, 0, d.x); let mx = -1e9;
      for (let u = 0; u <= G0 + DD; u += 4) for (let v = -WW / 2; v <= WW / 2; v += 6) { if (u < G0 && Math.abs(v) > 6) continue; mx = Math.max(mx, TH(F.x + d.x * u + s.x * v, F.z + d.z * u + s.z * v)); }
      const score = Math.max(0, mx - F.y) + 0.5 * Math.max(0, d.dot(back));
      if (!best || score < best.score) best = { d, s, mx, score };
    }
    dP.copy(best.d); sP.copy(best.s);
    deckY = Math.max(F.y + 0.1, best.mx + 0.5);
    hyPad = Math.atan2(dP.x, dP.z);
    toW(G0 + DD / 2, 0, deckY, padC);
    const stage = new THREE.Group(); stage.name = 'helipad';
    const CW = 1024, CH = Math.round(1024 * DD / WW);
    const cols = ['#ff6a00'].concat(RIVALS.map(r => '#' + new THREE.Color(r.col).getHexString()));
    const deckTex = canvasTex(CW, CH, (g, w, h) => {
      g.fillStyle = '#6b6e70'; g.fillRect(0, 0, w, h);
      const id = g.getImageData(0, 0, w, h), d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 22; d[i] += n; d[i + 1] += n; d[i + 2] += n; } g.putImageData(id, 0, 0);
      g.strokeStyle = 'rgba(40,40,40,.35)'; g.lineWidth = 2; for (let x = 0; x < w; x += w / 12) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } for (let y = 0; y < h; y += h / 7) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(20,20,20,${0.05 + Math.random() * 0.08})`; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 60, 8 + Math.random() * 20, Math.random() * 3, 0, 7); g.fill(); }
      g.strokeStyle = '#f2c230'; g.lineWidth = 10; g.setLineDash([36, 18]); g.strokeRect(14, 14, w - 28, h - 28); g.setLineDash([]);
      // plane local +x points along -sP, texture top = near edge (toward the finish)
      const px = (v) => (WW / 2 - v) / WW * w, py = (u) => u / DD * h, sc = w / WW;
      SPOTS.forEach(([u, v], i) => {
        const x = px(v), y = py(u);
        g.strokeStyle = '#f4f4f0'; g.lineWidth = 0.55 * sc; g.beginPath(); g.arc(x, y, 9.2 * sc, 0, 7); g.stroke();
        g.strokeStyle = cols[i] || '#fff'; g.lineWidth = 0.4 * sc; g.beginPath(); g.arc(x, y, 10.2 * sc, 0, 7); g.stroke();
        g.fillStyle = 'rgba(250,250,245,.92)'; g.font = `900 ${Math.round(9 * sc)}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('H', x, y);
        g.fillStyle = cols[i] || '#fff'; g.font = `800 ${Math.round(2.6 * sc)}px Arial`; g.fillText(i === 0 ? '45 · YOU' : (RIVALS[i - 1] ? RIVALS[i - 1].num + ' ' + RIVALS[i - 1].name : ''), x, y - 6.6 * sc);
      });
      g.fillStyle = 'rgba(242,194,48,.9)'; g.font = `900 ${Math.round(3.2 * sc)}px Arial`; g.textAlign = 'center'; g.fillText('SUMMIT HELIPAD · 8848 M', w / 2, py(3.2));
    });
    const top = new THREE.Mesh(new THREE.PlaneGeometry(WW, DD).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.9, metalness: 0.05 }));
    top.position.copy(padC); top.position.y = deckY + 0.02; top.rotation.y = hyPad; top.receiveShadow = true; stage.add(top);
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.6, metalness: 0.6 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(WW, 1.4, DD), steel); slab.position.copy(padC); slab.position.y = deckY - 0.7; slab.rotation.y = hyPad; slab.castShadow = slab.receiveShadow = true; stage.add(slab);
    { // ramp/walkway from the finish to the deck
      const a = toW(-2, 0, F.y), b = toW(G0 + 0.5, 0, deckY); const len = a.distanceTo(b);
      const rm = new THREE.Mesh(new THREE.BoxGeometry(13, 0.5, len), new THREE.MeshStandardMaterial({ color: 0x55585a, roughness: 0.8, metalness: 0.3 }));
      rm.position.lerpVectors(a, b, 0.5); rm.position.y -= 0.24; rm.lookAt(b.x, b.y - 0.24, b.z); rm.receiveShadow = true; stage.add(rm);
    }
    const py = [], rail = [];
    for (let u = G0 + 2; u <= G0 + DD; u += 13.5) for (let v = -WW / 2 + 2; v <= WW / 2; v += 15.3) {
      const q = toW(u, v, 0), h = deckY - TH(q.x, q.z); if (h < 0.8) continue;
      const g = new THREE.CylinderGeometry(0.7, 0.9, h + 4, 8); g.translate(q.x, deckY - 1.4 - (h + 4) / 2 + 1.4, q.z); py.push(g);
    }
    const post = (q) => { const g = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 5); g.translate(q.x, deckY + 0.6, q.z); rail.push(g); };
    for (let u = G0; u <= G0 + DD + 0.1; u += 4) for (const v of [-WW / 2, WW / 2]) post(toW(u, v, 0));
    for (let v = -WW / 2; v <= WW / 2 + 0.1; v += 4) post(toW(G0 + DD, v, 0));
    if (py.length) { const m = new THREE.Mesh(mergeGeometries(py), steel); m.castShadow = true; stage.add(m); }
    if (rail.length) stage.add(new THREE.Mesh(mergeGeometries(rail), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.5, metalness: 0.4 })));
    { // windsock
      const q = toW(G0 + 3, WW / 2 - 3, deckY); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 7, 6), steel); pole.position.set(q.x, deckY + 3.5, q.z); stage.add(pole);
      const sock = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.6, 10, 1, true).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xff5a10, side: THREE.DoubleSide, roughness: 0.8 })); sock.position.set(q.x + 1.3, deckY + 6.6, q.z); stage.add(sock);
    }
    scene.add(stage);
    // orange beacon over YOUR Apache
    const bm = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 60, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7a10, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    const s0 = toW(G0 + SPOTS[0][0], SPOTS[0][1], deckY); bm.position.set(s0.x, deckY + 30, s0.z); scene.add(bm);
    STAGE = { stage, beacon: bm };
    // racers: YOU + the six rivals, each with an Apache on its own spot
    RACERS.push({ id: 0, name: 'YOU', num: '45', col: 0xff6a00, player: true, skill: 1 });
    RIVALS.forEach((r, i) => RACERS.push({ id: i + 1, name: r.name, num: r.num, col: r.col, skill: r.skill, ai: AI[i] || null, r }));
    RACERS.forEach((R, i) => {
      const tag = R.player ? null : makeNameTag({ col: R.col, num: R.num, name: R.name });
      const H = makeApache(R.col, tag);
      Object.assign(H, { owner: R, pos: new V3(), vel: new V3(), yaw: 0, pv: 0, rv: 0, rpm: 0, st: 'parked', t: 0, fireCd: 0, mslCd: 0, tgtD: null, targeted: null, spin: new V3(), side: 1, spot: SPOTS[i], retgt: 0 });
      R.heli = H; HELIS.push(H);
    });
    built = true;
  }

  // ======================================================================= game state
  let active = false, phase = 'off', clock = 0, goT = -1, result = null;
  const WAR_TIME = 300;
  const me = () => RACERS[0];
  const P = { pos: new V3(), yaw: 0, pitch: 0, bob: 0, boardT: 0 };   // you, on foot
  const STATS = { attacks: 0, commits: 0, grabs: 0, throws: 0, dodges: 0, breakFree: 0 };
  let lastPlayerAtt = -99, schedT = 0, lockD = null, gunD = null, ammo = 16, fallP = null;
  const camP = new V3(), camL = new V3();
  const feedMsgs = [];
  function feed(msg, col) { feedMsgs.unshift({ msg, col: col || '#fff', t: 6 }); if (feedMsgs.length > 5) feedMsgs.length = 5; hudT = 0; }
  const hex = (c) => '#' + new THREE.Color(c).getHexString();

  function resetHeli(H) {
    const [u, v] = H.spot; toW(G0 + u, v, deckY, H.pos); H.vel.set(0, 0, 0); H.yaw = hyPad; H.pv = H.rv = 0; H.rpm = 0; H.st = 'parked'; H.t = 0;
    H.tgtD = null; H.targeted = null; H.heldBy = null; H.fireCd = 0; H.mslCd = rnd(4, 9); H.ejected = false; H.retgt = 0; H.lastAtt = -99;
    H.root.visible = true; H.root.rotation.set(0, H.yaw, 0); H.root.position.copy(H.pos); H.disc.material.opacity = 0; if (H.tag) H.tag.visible = true;
    H.door = toW(G0 + u + 3.2, v, deckY).addScaledVector(tv.set(Math.cos(H.yaw), 0, -Math.sin(H.yaw)), 2.8);
  }
  function setupDragons() {
    DRAG.length = 0;
    const n = DRAGON.list.length;
    DRAGON.list.forEach((d, i) => {
      if (!d || !d.setExt) return;
      const S = d.cfg.size || 1;
      const ext = { w: 0.9, tuck: 0, reach: 0, omega: 4.2, roar: false, roll: 0, tumble: 0 };
      d.setExt(ext);
      const D = { d, S, ext, hp: 420 * S, max: 420 * S, alive: true, st: 'far', t: 0, cd: rnd(2, 8), tgt: null, held: null, spd: 70, ang: i / n * Math.PI * 2, rad: rnd(850, 1150), alt: rnd(170, 330), vel: new V3(), name: d.cfg.name, cOff: new V3(0, -8 * S, -5 * S), smoke: 0, gT: 0 };
      d.dpos.set(padC.x + Math.cos(D.ang) * D.rad, deckY + D.alt, padC.z + Math.sin(D.ang) * D.rad);
      d.dir.set(-Math.sin(D.ang), 0, Math.cos(D.ang));
      DRAG.push(D);
    });
  }

  function start() {
    try { DRAGON.cancel(); } catch (e) {}
    if (!built) buildStage();
    active = true; phase = 'walk'; clock = 0; goT = -1; result = null; lastPlayerAtt = -99; schedT = 0; ammo = 16; feedMsgs.length = 0; lockD = gunD = null;
    for (const R of RACERS) { R.kills = 0; R.out = false; R.pilot = null; }
    HELIS.forEach(resetHeli);
    PILOTS.forEach(p => { p.P.g.visible = false; }); PILOTS.length = 0;
    MS.forEach(m => { m.life = 0; m.m.visible = false; }); TR.forEach(r => { r.m.visible = false; r.cb = null; }); FX.forEach(f => { f.life = 0; f.sp.visible = false; });
    setupDragons();
    DRAGON_LOD.scale = IS_MOBILE ? 2.2 : 1.4;
    // everyone gets off the bike at the summit
    for (const a of AI) { if (!a.finished) { a.finished = true; a.s = Math.min(TRACK_LEN - 1.5, FINISH_S + 2); a.spd = 0; a.lat = a.latT = -9 + 3 * AI.indexOf(a); } a.dismounted = true; }
    try { G.aiPoseAll && G.aiPoseAll(); } catch (e) {}
    const rider = G.rider(); if (rider) rider.group.visible = false;
    // you: standing beside your bike, looking at the helipad
    P.pos.set(state.x + sP.x * 1.4, 0, state.z + sP.z * 1.4);
    if (!walkable(P.pos.x, P.pos.z)) P.pos.set(F.x, 0, F.z);
    P.pos.y = floorAt(P.pos.x, P.pos.z); P.yaw = Math.atan2(-(padC.x - P.pos.x), -(padC.z - P.pos.z)); P.pitch = -0.04; P.boardT = 0;
    RACERS.forEach((R, i) => {
      if (R.player) return;
      if (!R.walker || (KIT && !R.walker.rig)) { if (R.walker) { scene.remove(R.walker.g); } R.walker = makePilot(R); }
      const W = R.walker, a = R.ai;
      const sp = a ? a.root.position : toW(rnd(-4, 4), rnd(-6, 6), F.y);
      W.g.visible = true; W.g.rotation.set(0, W.yawOff, 0); W.g.position.set(sp.x + sP.x * 1.1, 0, sp.z + sP.z * 1.1);
      if (!walkable(W.g.position.x, W.g.position.z)) W.g.position.set(F.x + rnd(-3, 3), 0, F.z + rnd(-3, 3));
      W.g.position.y = floorAt(W.g.position.x, W.g.position.z);
      W.path = [toW(-1, clamp(toL(W.g.position.x, W.g.position.z)[1], -4, 4), 0), toW(G0 + 1, clamp(R.heli.spot[1] * 0.12, -4, 4), 0), R.heli.door.clone()];
      W.wp = 0; W.spd = rnd(4.4, 5.6); W.delay = 0.6 + i * 0.35; W.done = false;
    });
    STAGE.beacon.visible = true;
    hud.classList.add('on'); ctl.classList.add('walk'); ctl.classList.remove('fly'); if (TOUCH) ctl.classList.add('on');
    for (const id of ['stats', 'hint', 'mobile']) { const e = $(id); if (e) e.style.visibility = 'hidden'; }
    $('overlay').classList.add('hidden'); const eg = $('egGo'); if (eg) eg.hidden = true;
    fade.classList.add('on'); setTimeout(() => fade.classList.remove('on'), 380);
    toast('DISMOUNT · walk to your Apache', 2600);
    feed('Everyone is off the bikes — race to the choppers!', '#ffd060');
    if (!TOUCH) lockPtr();
  }
  function stop() {
    if (!built) { active = false; return; }
    active = false; phase = 'off'; snd.rotorStop();
    HELIS.forEach(H => { H.root.visible = false; }); RACERS.forEach(R => { if (R.walker) R.walker.g.visible = false; });
    PILOTS.forEach(p => { p.P.g.visible = false; }); PILOTS.length = 0;
    MS.forEach(m => { m.life = 0; m.m.visible = false; }); TR.forEach(r => { r.m.visible = false; r.cb = null; }); FX.forEach(f => { f.life = 0; f.sp.visible = false; });
    STAGE.beacon.visible = false;
    for (const D of DRAG) { try { D.d.setExt(null); } catch (e) {} } DRAG.length = 0;
    DRAGON_LOD.scale = 1;
    for (const a of AI) a.dismounted = false;
    const rider = G.rider(); if (rider) rider.group.visible = true;
    hud.classList.remove('on'); ctl.classList.remove('on', 'walk', 'fly');
    for (const id of ['stats', 'hint', 'mobile']) { const e = $(id); if (e) e.style.visibility = ''; }
    el.warn.classList.remove('on');
  }

  // ======================================================================= combat rules
  function damage(D, amt, owner, at) {
    if (!D.alive) return;
    D.hp -= amt; D.lastHit = owner;
    if (at) fx(3, at, 3.5 * D.S, 0.25);
    if (D.hp <= 0) kill(D, owner);
  }
  function kill(D, owner) {
    D.alive = false; D.st = 'dying'; D.t = 0; D.hp = 0;
    D.vel.copy(D.d.dir).multiplyScalar(Math.max(30, D.spd * 0.7)); D.vel.y = Math.min(D.vel.y, 5);
    Object.assign(D.ext, { w: 0.15, tuck: 0.7, reach: 0, roar: true, omega: 9 });
    if (owner) owner.kills = (owner.kills || 0) + 1;
    feed((owner ? (owner.player ? 'YOU' : owner.name) : '?') + ' shot down ' + D.name + (owner && owner.player ? '  (' + owner.kills + ')' : ''), owner && owner.player ? '#7dffb0' : hex(owner ? owner.col : 0xffffff));
    if (owner && owner.player) toast('WYVERN DOWN! · ' + owner.kills + (owner.kills === 1 ? ' kill' : ' kills'), 1600);
    if (D.tgt && D.tgt.targeted === D) D.tgt.targeted = null;
    if (D.held) {   // killed it while it had a chopper in its talons: the Apache drops free and recovers
      STATS.breakFree++; const H = D.held; D.held = null; H.heldBy = null; H.st = 'recover'; H.t = 0; H.vel.set(0, -4, 0);
      if (H.owner.player) { toast('BROKE FREE!', 1600); feed('YOU blasted free of ' + D.name + '!', '#7dffb0'); } else feed(H.owner.name + ' broke free!', hex(H.owner.col));
    }
    const dd = D.d.dpos.distanceTo(focus()); try { if (dd < 400) SFX.roar(Math.max(0.15, 1 - dd / 400)); } catch (e) {}
  }
  const focus = () => (phase === 'walk' ? P.pos : me().heli.pos);
  function grab(D, H) {
    STATS.grabs++; D.st = 'carry'; D.t = 0; D.held = H; H.st = 'held'; H.heldBy = D; H.t = 0; H.targeted = null;
    D.ext.reach = 1; D.ext.roar = true; D.ext.tuck = 0;
    if (H.owner.player) { toast('GRABBED! SHOOT TO BREAK FREE!', 2200); try { SFX.roar(1); } catch (e) {} }
    else feed(D.name + ' seized ' + H.owner.name + '\u2019s Apache!', '#ff9a7a');
  }
  function throwHeli(D, H) {
    STATS.throws++; D.held = null; D.st = 'circle'; D.cd = rnd(9, 14); D.t = 0; D.ext.reach = 0; D.ext.roar = false;
    H.heldBy = null; H.st = 'thrown'; H.t = 0; H.vel.copy(D.d.dir).multiplyScalar(48); H.vel.y = 14; H.spin.set(rnd(-2.5, 2.5), rnd(-3, 3), rnd(-2.5, 2.5));
    H.owner.out = true; H.ejected = false;
    if (H.owner.player) { phase = 'fall'; el.warn.classList.remove('on'); snd.rotorStop(); toast('THROWN! EJECTED!', 2400); ctl.classList.remove('on'); }
    feed('💀 ' + (H.owner.player ? 'YOU were' : H.owner.name + ' was') + ' hurled out of the sky by ' + D.name, '#ff6a5a');
  }
  function eject(H) {
    H.ejected = true;
    const Pi = H.owner.player ? (fallP && (fallP.rig || !KIT) ? fallP : (fallP = makePilot(H.owner))) : (H.owner.walker || makePilot(H.owner));
    Pi.g.visible = true; Pi.g.rotation.set(0, 0, 0); Pi.g.position.copy(H.pos).add(tv.set(0, 4, 0));
    const pil = { P: Pi, pos: Pi.g.position, vel: H.vel.clone().multiplyScalar(0.5).add(tv.set(rnd(-8, 8), 22, rnd(-8, 8))), owner: H.owner, landed: false, t: 0 };
    PILOTS.push(pil); H.owner.pilot = pil;
  }

  // ---- dragon flight
  function fly(D, target, spd, rate, dt, floor = 50) {
    const dp = D.d.dpos, dir = D.d.dir;
    tv.subVectors(target, dp); const dist = tv.length(); if (dist > 1e-3) tv.divideScalar(dist);
    dir.lerp(tv, Math.min(1, rate * dt)).normalize();
    D.spd += (spd - D.spd) * Math.min(1, dt * 1.4);
    dp.addScaledVector(dir, D.spd * dt);
    const g = TH(dp.x, dp.z) + floor; if (dp.y < g) dp.y += (g - dp.y) * Math.min(1, dt * 4);
    return dist;
  }
  const growlNear = (D, dt) => { D.gT -= dt; if (D.gT > 0) return; D.gT = 2.6 + Math.random(); const dd = D.d.dpos.distanceTo(me().heli.pos); if (dd < 260) try { SFX.growl(Math.min(1, 1.15 - dd / 260)); } catch (e) {} };
  const cw = new V3();
  function dragonStep(D, dt) {
    D.t += dt; D.cd -= dt; const dp = D.d.dpos, e = D.ext;
    if (D.st !== 'dying' && D.d.claw) { D.d.claw(cw); D.cOff.lerp(cw.sub(dp), 0.3); }
    if (D.st === 'far' || D.st === 'circle') {
      const far = D.st === 'far';
      if (!far && D.rad > 560) D.rad = rnd(260, 520);
      const sp = far ? 75 : 85, sgn = D.d.k % 2 ? -1 : 1;
      D.ang += sp / D.rad * dt * sgn;
      const a2 = D.ang + 0.3 * sgn;
      tv2.set(padC.x + Math.cos(a2) * D.rad, deckY + D.alt + 35 * Math.sin(clock * 0.3 + D.d.k), padC.z + Math.sin(a2) * D.rad);
      fly(D, tv2, sp, 0.9, dt, 60);
      e.reach = 0; e.roar = false; e.w = 0.9; e.tuck = 0;
    } else if (D.st === 'attack') {
      const H = D.tgt;
      if (!H || H.st !== 'fly' || H.owner.out) { D.st = 'circle'; D.cd = rnd(3, 6); if (H && H.targeted === D) H.targeted = null; return; }
      tv2.copy(H.pos).addScaledVector(H.vel, 0.7).sub(D.cOff); tv2.y += 6;
      const dist = fly(D, tv2, 100, 1.8, dt, 30);
      e.w = 1; e.roar = dist < 220;
      if (H.owner.player && dist < 260) growlNear(D, dt);
      if (dist < 140) {   // commit: the dive locks onto where the chopper WILL be; change course now to dodge
        STATS.commits++; D.st = 'commit'; D.t = 0; D.lockP = H.pos.clone().addScaledVector(H.vel, 0.9).sub(D.cOff);
        if (H.owner.player) { try { SFX.roar(0.9); } catch (er) {} }
      } else if (D.t > 16) { D.st = 'circle'; D.cd = rnd(4, 8); H.targeted = null; }
    } else if (D.st === 'commit') {
      const H = D.tgt;
      D.lockP.lerp(tv2.copy(H.pos).sub(D.cOff), Math.min(1, 0.35 * dt));
      fly(D, D.lockP, 128, 2.6, dt, 25);
      e.w = D.t > 0.7 ? 1 : 0.2; e.tuck = D.t > 0.7 ? 0 : 0.8; e.reach = 1; e.roar = true;
      if (D.d.claw) D.d.claw(cw);
      if (H.st === 'fly' && cw.distanceTo(tv2.copy(H.pos).add(tv.set(0, 3, 0))) < 10.5 * Math.max(1, D.S)) { grab(D, H); return; }
      tv.subVectors(D.lockP, dp);
      if (D.t > 2.3 || (D.t > 0.4 && tv.dot(D.d.dir) < 0) || H.st !== 'fly') {
        D.st = 'circle'; D.cd = rnd(6, 11); e.tuck = 0; e.reach = 0; if (H.targeted === D) H.targeted = null;
        if (H.owner.player && H.st === 'fly') { toast('DODGED!', 1100); feed('YOU dodged ' + D.name, '#9adfff'); }
      }
    } else if (D.st === 'carry') {
      const H = D.held; if (!H) { D.st = 'circle'; return; }
      const hf = tv2.set(D.d.dir.x, 0, D.d.dir.z); if (hf.lengthSq() < 1e-4) hf.set(1, 0, 0); hf.normalize();
      tv3.copy(dp).addScaledVector(hf, 100); tv3.y += 45;
      fly(D, tv3, 42, 1.0, dt, 60);
      e.w = 1; e.omega = 5; e.reach = 1; e.roar = D.t < 1.2;
      if (D.t > (H.owner.player ? 3.6 : 3.0)) throwHeli(D, H);
    } else if (D.st === 'dying') {
      D.vel.y -= 26 * dt; D.vel.multiplyScalar(Math.exp(-0.15 * dt));
      dp.addScaledVector(D.vel, dt); D.d.dir.copy(D.vel).normalize();
      e.roll += dt * 2.6; e.tumble = Math.min(1.1, e.tumble + dt * 0.5); e.roar = D.t < 1.5;
      D.smoke -= dt; if (D.smoke <= 0) { D.smoke = IS_MOBILE ? 0.08 : 0.045; fx(0, dp, 6 * D.S, 2.4, tv.set(0, 2, 0)); if (Math.random() < 0.5) fx(1, dp, 4 * D.S, 0.5); }
      if (dp.y < TH(dp.x, dp.z) + 4 || D.t > 14) {
        dp.y = Math.max(dp.y, TH(dp.x, dp.z) + 2); explode(dp, true);
        for (let i = 0; i < 6; i++) fx(2, tv.copy(dp).add(tv2.set(rnd(-12, 12), 0, rnd(-12, 12))), 14, 3, tv3.set(rnd(-6, 6), rnd(3, 8), rnd(-6, 6)));
        D.st = 'gone'; D.d.gone(); e.roll = e.tumble = 0;
      }
    }
  }
  function schedule(dt) {
    schedT -= dt; if (schedT > 0) return; schedT = 0.5;
    if (goT < 0) return;
    let att = 0; for (const D of DRAG) if (D.st === 'attack' || D.st === 'commit' || D.st === 'carry') att++;
    if (att >= (IS_MOBILE ? 2 : 3)) return;
    const free = DRAG.filter(D => D.alive && D.st === 'circle' && D.cd <= 0); if (!free.length) return;
    const war = clock - goT, cand = [];
    for (const H of HELIS) {
      if (H.st !== 'fly' || H.owner.out || H.targeted) continue;
      if (H.owner.player) { if (war > 11 && war - lastPlayerAtt > 12) cand.push([H, 1.3]); }
      else if (war > 6 && war - (H.lastAtt ?? -99) > 18) cand.push([H, 0.55]);
    }
    if (!cand.length) return;
    let r = Math.random() * cand.reduce((s, c) => s + c[1], 0), H = cand[cand.length - 1][0];
    for (const c of cand) { r -= c[1]; if (r <= 0) { H = c[0]; break; } }
    let D = free[0], bd = 1e18; for (const f of free) { const d = f.d.dpos.distanceToSquared(H.pos) * rnd(0.6, 1.4); if (d < bd) { bd = d; D = f; } }
    STATS.attacks++; D.st = 'attack'; D.t = 0; D.tgt = H; H.targeted = D; H.lastAtt = war;
    if (H.owner.player) { lastPlayerAtt = war; feed(D.name + ' is hunting YOU!', '#ff5a4a'); }
  }

  // ---- helicopters
  const heliFwd = (H, out) => out.set(Math.sin(H.yaw), 0, Math.cos(H.yaw));
  const heliFloor = (x, z) => (deckAt(x, z) ? deckY : TH(x, z) + 6);
  const crashFloor = (x, z) => (deckAt(x, z) ? deckY : TH(x, z));
  function heliMove(H, dt, vDes, lift, liftRate) {
    H.vel.x += (vDes.x - H.vel.x) * Math.min(1, 1.5 * dt); H.vel.z += (vDes.z - H.vel.z) * Math.min(1, 1.5 * dt);
    H.vel.y += (lift - H.vel.y) * Math.min(1, liftRate * dt);
    H.pos.addScaledVector(H.vel, dt);
    const fl = heliFloor(H.pos.x, H.pos.z); if (H.pos.y < fl) { H.pos.y += (fl - H.pos.y) * Math.min(1, dt * 8); if (H.vel.y < 0) H.vel.y = 0; }
    if (H.pos.y > deckY + 650) { H.pos.y = deckY + 650; H.vel.y = Math.min(0, H.vel.y); }
    const dx = H.pos.x - padC.x, dz = H.pos.z - padC.z, r = Math.hypot(dx, dz);
    if (r > 1250) { H.pos.x = padC.x + dx / r * 1250; H.pos.z = padC.z + dz / r * 1250; }
  }
  function heliPose(H, dt, fwdIn, turnIn) {
    H.pv += (clamp(fwdIn, -1, 1) * 0.2 - H.pv) * Math.min(1, 3 * dt); H.rv += (clamp(turnIn, -1, 1) * 0.32 - H.rv) * Math.min(1, 3 * dt);
    H.root.position.copy(H.pos); H.root.rotation.set(H.pv, H.yaw, H.rv);
  }
  function spinRotor(H, dt) {
    H.rotor.rotation.y += H.rpm * 26 * dt; H.trotor.rotation.x += H.rpm * 70 * dt;
    H.disc.material.opacity = 0.075 * H.rpm * H.rpm; H.tdisc.visible = H.rpm > 0.3;
  }
  const gp = new V3();
  function gunPos(H, out) { H.root.updateMatrixWorld(true); return H.root.localToWorld(out.set(0, 0.5, 7.2)); }
  function shoot(H, D, dmg, hitP) {
    const a = gunPos(H, new V3());
    let b, hit = false;
    if (D) { b = D.d.dpos.clone().add(gp.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(5 * D.S)); hit = Math.random() < hitP; if (!hit) b.add(gp.set(rnd(-1, 1), rnd(-0.5, 1), rnd(-1, 1)).multiplyScalar(26)); }
    else b = a.clone().add(heliFwd(H, gp).multiplyScalar(700)).add(tv2.set(0, -30, 0));
    tracer(a, b, hit ? () => damage(D, dmg, H.owner, b) : null);
    if (Math.random() < 0.5) fx(3, a, 1.4, 0.06);
  }
  // what's in front of a chopper: guns = narrow cone (auto-aim), missiles = wide cone (lock)
  const af = new V3(), ad = new V3();
  function acquire(H, cone, maxD, vert) {
    heliFwd(H, af); let best = null, bs = 1e9;
    for (const D of DRAG) {
      if (!D.alive) continue; ad.subVectors(D.d.dpos, H.pos); const dist = ad.length(); if (dist > maxD) continue;
      const h = Math.hypot(ad.x, ad.z); const ah = Math.acos(clamp((ad.x * af.x + ad.z * af.z) / Math.max(1e-3, h), -1, 1)); const av = Math.atan2(ad.y, h);
      if (ah > cone || Math.abs(av) > vert) continue;
      const s = ah * 4 + Math.abs(av) + dist / 2000; if (s < bs) { bs = s; best = D; }
    }
    return best;
  }
  const aDes = new V3(), aV = new V3(), aT = new V3();
  function aiHeli(H, dt) {
    const R = H.owner, sk = R.skill || 0.95;
    H.retgt -= dt;
    if (!H.tgtD || !H.tgtD.alive || H.retgt <= 0) { H.retgt = rnd(5, 9); let b = null, bd = 1e18; for (const D of DRAG) if (D.alive) { const d = D.d.dpos.distanceToSquared(H.pos) * rnd(0.7, 1.3); if (d < bd) { bd = d; b = D; } } H.tgtD = b; }
    const D = H.tgtD;
    aDes.copy(padC).add(aT.set(Math.cos(clock * 0.2 + R.id) * 120, 60, Math.sin(clock * 0.2 + R.id) * 120));
    if (D) {
      aT.subVectors(H.pos, D.d.dpos); aT.y = 0; if (aT.lengthSq() < 1) aT.set(1, 0, 0); aT.normalize();
      const sw = Math.sin(clock * 0.25 + R.id * 1.7) * 90;
      aDes.copy(D.d.dpos).addScaledVector(aT, 170 + 40 * Math.sin(clock * 0.4 + R.id)); aDes.x += -aT.z * sw; aDes.z += aT.x * sw;
      aDes.y = D.d.dpos.y - 10 + 25 * Math.sin(clock * 0.35 + R.id);
    }
    const thr = H.targeted;
    if (thr && (thr.st === 'commit' || (thr.st === 'attack' && thr.d.dpos.distanceTo(H.pos) < 200))) {
      if (H.dodgeRoll == null) H.dodgeRoll = Math.random() < clamp((sk - 0.9) * 9 + 0.2, 0.45, 0.85);
      if (H.dodgeRoll) { aT.subVectors(H.pos, thr.d.dpos).normalize(); aDes.copy(H.pos); aDes.x += -aT.z * 140; aDes.z += aT.x * 140; aDes.y += 40; }
    } else H.dodgeRoll = null;
    for (const O of HELIS) { if (O === H || O.st !== 'fly') continue; aT.subVectors(H.pos, O.pos); const d = aT.length(); if (d < 30 && d > 0.01) aDes.addScaledVector(aT, (30 - d) * 3 / d); }
    aV.subVectors(aDes, H.pos); const vy = clamp(aV.y * 0.8, -26, 26); aV.y = 0; const L = aV.length(); if (L > 1e-3) aV.multiplyScalar(Math.min(80, L * 0.8) / L);
    heliMove(H, dt, aV, vy, 1.6);
    let dy = 0;
    if (D) {
      const yd = Math.atan2(D.d.dpos.x - H.pos.x, D.d.dpos.z - H.pos.z); dy = yd - H.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      H.yaw += clamp(dy, -1.6 * dt, 1.6 * dt);
      const dist = D.d.dpos.distanceTo(H.pos);
      H.fireCd -= dt;
      if (Math.abs(dy) < 0.2 && dist < 560) { while (H.fireCd <= 0) { H.fireCd += 1 / 6; shoot(H, D, 2.4, 0.66 * sk); } }
      else H.fireCd = Math.max(H.fireCd, 0);
      H.mslCd -= dt; if (H.mslCd <= 0 && Math.abs(dy) < 0.5 && dist < 1100) { H.mslCd = rnd(8, 12); launchMissile(H, D); }
    }
    heliFwd(H, aT); heliPose(H, dt, (H.vel.x * aT.x + H.vel.z * aT.z) / 80, clamp(-dy * 2, -1, 1));
  }
  function heldHeli(H) {
    const D = H.heldBy; if (!D) { H.st = 'recover'; H.t = 0; return; }
    D.d.claw(aT); H.pos.copy(aT); H.pos.y -= 4.1; H.vel.copy(D.d.dir).multiplyScalar(D.spd);
    H.yaw = Math.atan2(D.d.dir.x, D.d.dir.z); H.root.position.copy(H.pos); H.root.rotation.set(0.25 * Math.sin(clock * 3.1), H.yaw, 0.35 * Math.sin(clock * 2.3));
  }
  function recoverHeli(H, dt) { H.t += dt; H.vel.y -= 18 * dt; heliMove(H, dt, aT.set(0, 0, 0), H.vel.y, 0.2); heliPose(H, dt, 0, 0); if (H.t > 0.8) H.st = 'fly'; }
  function thrownHeli(H, dt) {
    H.t += dt; H.vel.y -= 22 * dt; H.pos.addScaledVector(H.vel, dt); H.rpm = Math.max(0.2, H.rpm - dt * 0.4);
    H.root.position.copy(H.pos); H.root.rotation.x += H.spin.x * dt; H.root.rotation.y += H.spin.y * dt; H.root.rotation.z += H.spin.z * dt;
    H.smk = (H.smk || 0) - dt; if (H.smk <= 0) { H.smk = 0.07; fx(0, H.pos, 3, 2, aT.set(0, 1, 0)); if (Math.random() < 0.4) fx(1, H.pos, 2.4, 0.35); }
    if (!H.ejected && H.t > 0.45) eject(H);
    const fl = crashFloor(H.pos.x, H.pos.z);
    if (H.pos.y <= fl + 1) { H.pos.y = fl + 1; explode(H.pos, true); H.st = 'wreck'; H.root.visible = false; if (H.tag) H.tag.visible = false; }
  }
  function pilotStep(p, dt) {
    if (p.landed) return;
    p.t += dt; p.vel.y -= 24 * dt; if (p.vel.y < -58) p.vel.y = -58; p.vel.x *= Math.exp(-0.3 * dt); p.vel.z *= Math.exp(-0.3 * dt);
    p.pos.addScaledVector(p.vel, dt); poseFlail(p.P, dt); p.P.g.rotation.x += dt * 1.6; p.P.g.rotation.z += dt * 0.9;
    const fl = floorAt(p.pos.x, p.pos.z);
    if (p.pos.y <= fl + 0.3) {
      p.pos.y = fl + 0.25; p.landed = true; p.P.g.rotation.set(p.P.rig ? Math.PI / 2 : -Math.PI / 2, rnd(0, 6), 0);
      for (let i = 0; i < 5; i++) fx(2, aT.copy(p.pos).add(aV.set(rnd(-2, 2), 0, rnd(-2, 2))), 4, 2.2, aDes.set(rnd(-3, 3), rnd(2, 5), rnd(-3, 3)));
      if (p.owner.player) { snd.boom(0.35); endGame('lose'); } else feed(p.owner.name + ' hit the ground — eliminated', '#ff8a7a');
    }
  }

  // ======================================================================= per-phase updates
  function inputs() {
    const k = keys;
    const fwd = ((k.KeyW || k.ArrowUp) ? 1 : 0) - ((k.KeyS || k.ArrowDown) ? 1 : 0) - tin.sy;
    const side = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0) + tin.sx;
    const turn = (k.ArrowRight ? 1 : 0) - (k.ArrowLeft ? 1 : 0);
    const lift = ((k.Space || k.KeyE || tin.b.up) ? 1 : 0) - ((k.ShiftLeft || k.ShiftRight || k.KeyQ || k.KeyC || tin.b.dn) ? 1 : 0);
    const fire = !!(k.KeyJ || mouse.l || tin.b.fire);
    return { fwd: clamp(fwd, -1, 1), side: clamp(side, -1, 1), turn, lift, fire };
  }
  const wf = new V3(), wr = new V3(), wm = new V3();
  function walkUpdate(dt) {
    const I = inputs();
    P.yaw -= (mouse.dx * 0.0022 + tin.look[0] * 0.0055) + I.turn * 2.0 * dt; P.pitch = clamp(P.pitch - (mouse.dy * 0.0018 + tin.look[1] * 0.0045), -1.2, 1.1);
    mouse.dx = mouse.dy = 0; tin.look[0] = tin.look[1] = 0;
    wf.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)); wr.set(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
    wm.set(0, 0, 0).addScaledVector(wf, I.fwd).addScaledVector(wr, I.side); const L = wm.length(); if (L > 1) wm.divideScalar(L);
    const sp = 6.5; const nx = P.pos.x + wm.x * sp * dt, nz = P.pos.z + wm.z * sp * dt;
    if (walkable(nx, nz)) { P.pos.x = nx; P.pos.z = nz; } else if (walkable(nx, P.pos.z)) P.pos.x = nx; else if (walkable(P.pos.x, nz)) P.pos.z = nz;
    for (const H of HELIS) { const dx = P.pos.x - H.pos.x, dz = P.pos.z - H.pos.z, d = Math.hypot(dx, dz); if (d < 2.4 && d > 0.01) { P.pos.x = H.pos.x + dx / d * 2.4; P.pos.z = H.pos.z + dz / d * 2.4; } }
    const gy = floorAt(P.pos.x, P.pos.z); P.pos.y += (gy - P.pos.y) * Math.min(1, dt * 12);
    P.bob += Math.min(1, L) * dt * 9;
    camera.position.set(P.pos.x, P.pos.y + 1.75 + Math.sin(P.bob) * 0.05 * Math.min(1, L), P.pos.z);
    camera.up.set(0, 1, 0); camera.rotation.set(P.pitch, P.yaw, 0, 'YXZ');
    camera.fov += (72 - camera.fov) * Math.min(1, 4 * dt); camera.updateProjectionMatrix();
    const H = me().heli, near = Math.hypot(P.pos.x - H.door.x, P.pos.z - H.door.z) < 4.5 || Math.hypot(P.pos.x - H.pos.x, P.pos.z - H.pos.z) < 6;
    el.boardBtn.classList.toggle('hide', !near);
    if (near) P.boardT += dt; else P.boardT = 0;
    if (near && (tin.boardEdge || P.boardT > 2.2)) board();
    tin.boardEdge = false;
    if (phase === 'walk') el.obj.textContent = near ? (TOUCH ? 'Tap BOARD to climb into your Apache' : 'Press E to board your Apache') : 'Walk to your Apache (orange beacon) · ' + Math.round(Math.hypot(P.pos.x - H.pos.x, P.pos.z - H.pos.z)) + ' m';
    state.x = P.pos.x; state.y = P.pos.y; state.z = P.pos.z;
  }
  function board() {
    phase = 'fly'; const H = me().heli; H.st = 'spool'; H.t = 0;
    ctl.classList.remove('walk'); ctl.classList.add('fly'); el.boardBtn.classList.add('hide');
    STAGE.beacon.visible = false; snd.rotorStart();
    camP.copy(camera.position); heliFwd(H, aT); camL.copy(camera.position).addScaledVector(wf.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)), 20);
    toast('ROTORS SPINNING UP…', 1600);
  }
  function walkersUpdate(dt) {
    for (const R of RACERS) {
      const W = R.walker; if (!W || W.done) continue;
      if (W.delay > 0) { W.delay -= dt; poseWalk(W, dt, 0); continue; }
      const T = W.path[W.wp]; aT.set(T.x - W.g.position.x, 0, T.z - W.g.position.z); const d = aT.length();
      if (d < 0.8) { W.wp++; if (W.wp >= W.path.length) { W.done = true; W.g.visible = false; R.heli.st = 'spool'; R.heli.t = 0; feed(R.name + ' is in the cockpit', hex(R.col)); } continue; }
      aT.divideScalar(d); W.g.position.x += aT.x * W.spd * dt; W.g.position.z += aT.z * W.spd * dt;
      W.g.position.y = floorAt(W.g.position.x, W.g.position.z); W.g.rotation.y = Math.atan2(aT.x, aT.z) + W.yawOff; poseWalk(W, dt, W.spd);
    }
  }
  const cf = new V3(), cd = new V3();
  function playerFly(dt) {
    const H = me().heli, I = inputs();
    if (H.st === 'spool') {
      H.t += dt; H.rpm = Math.min(1, H.t / 1.6);
      if (H.t > 1.6) { H.st = 'fly'; toast(TOUCH ? 'TAKE OFF: hold ▲ · stick flies' : 'TAKE OFF: Space climbs · W/A/S/D fly', 3000); }
      heliPose(H, dt, 0, 0);
    } else if (H.st === 'held') heldHeli(H);
    else if (H.st === 'recover') recoverHeli(H, dt);
    else if (H.st === 'fly') {
      const turn = clamp(I.side + I.turn, -1, 1);
      H.yaw -= turn * 1.55 * dt + mouse.dx * 0.0025;
      const vmax = I.fwd >= 0 ? 88 : 34;
      heliFwd(H, cd).multiplyScalar(I.fwd * vmax);
      heliMove(H, dt, cd, I.lift * 30, 2.2);
      heliPose(H, dt, I.fwd, turn);
    }
    mouse.dx = mouse.dy = 0;
    // guns auto-aim in a narrow cone; missiles lock the best target in a wide cone; held = point-blank on the carrier
    gunD = H.st === 'held' ? H.heldBy : acquire(H, 0.2, 760, 0.9);
    lockD = H.st === 'held' ? null : acquire(H, 0.55, 1400, 1.0);
    if ((H.st === 'fly' || H.st === 'held') && I.fire) {
      H.fireCd -= dt;
      while (H.fireCd <= 0) { H.fireCd += 0.1; shoot(H, gunD, H.st === 'held' ? 16 : 3.2, H.st === 'held' ? 1 : 0.85); snd.gun(0.6); }
    } else H.fireCd = Math.max(0, H.fireCd);
    H.mslCd -= dt;
    if (tin.mslEdge && H.st === 'fly' && H.mslCd <= 0 && ammo > 0) { H.mslCd = 2.2; ammo--; launchMissile(H, lockD); }
    tin.mslEdge = false;
    snd.rotorSet(H.rpm, Math.abs(I.lift) + Math.abs(I.fwd));
    // chase camera
    heliFwd(H, cf);
    const held = H.st === 'held', back = held ? 46 : 30, up = held ? 7 : 9.5;
    cd.copy(H.pos).addScaledVector(cf, -back); cd.y += up; cd.y = Math.max(cd.y, TH(cd.x, cd.z) + 3);
    camP.lerp(cd, 1 - Math.exp(-5 * dt));
    cd.copy(H.pos).addScaledVector(cf, 30); cd.y += held ? 0 : 4;
    camL.lerp(cd, 1 - Math.exp(-8 * dt));
    camera.position.copy(camP); camera.up.set(0, 1, 0); camera.lookAt(camL);
    camera.fov += (66 + Math.min(10, H.vel.length() * 0.08) - camera.fov) * Math.min(1, 3 * dt); camera.updateProjectionMatrix();
    state.x = H.pos.x; state.y = H.pos.y; state.z = H.pos.z;
  }
  function fallCam(dt) {
    const p = me().pilot, target = p ? p.pos : me().heli.pos;
    cd.copy(target).add(aT.set(10, 9, 10)); cd.y = Math.max(cd.y, TH(cd.x, cd.z) + 3);
    camP.lerp(cd, 1 - Math.exp(-3 * dt)); camera.position.copy(camP); camL.lerp(target, 1 - Math.exp(-8 * dt)); camera.lookAt(camL);
    state.x = target.x; state.y = target.y; state.z = target.z;
  }
  function overCam(dt) {
    const t = clock * 0.12, c = (result && result.focus) || padC;
    cd.set(c.x + Math.cos(t) * 110, c.y + 55, c.z + Math.sin(t) * 110); cd.y = Math.max(cd.y, TH(cd.x, cd.z) + 10);
    camP.lerp(cd, 1 - Math.exp(-1.5 * dt)); camera.position.copy(camP); camL.lerp(c, 0.05); camera.lookAt(camL);
  }

  function endGame(kind) {
    if (phase === 'over') return;
    const alive = RACERS.filter(R => !R.out);
    const top = alive.length ? Math.max(...alive.map(R => R.kills)) : 0;
    const winners = alive.filter(R => R.kills === top && top > 0);
    const youWin = kind !== 'lose' && !me().out && winners.includes(me());
    result = { kind, youWin, winners, focus: ((me().pilot && me().pilot.pos) || me().heli.pos).clone() };
    phase = 'over'; snd.rotorStop(); el.warn.classList.remove('on'); ctl.classList.remove('on');
    document.exitPointerLock?.();
    setTimeout(showResult, kind === 'lose' ? 1400 : 2200);
  }
  function showResult() {
    if (!active || !result) return;
    const ov = $('overlay'); ov.classList.remove('hidden');
    const h1 = ov.querySelector('h1'), p = ov.querySelector('p');
    const left = DRAG.filter(D => D.alive).length;
    if (result.kind === 'lose') h1.textContent = 'YOU FELL — GAME OVER';
    else if (result.youWin) h1.textContent = result.winners.length > 1 ? 'TIED FOR THE WIN!' : 'YOU WIN THE DRAGON WAR!';
    else h1.textContent = result.winners.length ? result.winners.map(w => w.name).join(' & ') + ' WINS' : 'NOBODY WINS';
    const board = RACERS.slice().sort((a, b) => (b.kills - a.kills) || (a.out - b.out)).map((R, i) => (i + 1) + '. ' + (R.player ? '<b>45 YOU</b>' : R.num + ' ' + R.name) + ' — <b>' + R.kills + '</b>' + (R.out ? ' 💀' : '')).join(' &nbsp; ');
    p.innerHTML = (result.kind === 'lose' ? 'A wyvern ripped your Apache out of the sky and you hit the mountain. ' : (result.kind === 'time' ? 'Time\u2019s up. ' : 'Every wyvern is down. ')) +
      'You shot down <b>' + me().kills + '</b> ' + (me().kills === 1 ? 'dragon' : 'dragons') + (left ? ' · ' + left + ' still flying' : '') + '.<br><span style="font-size:.85em;opacity:.9">' + board + '</span>';
    const eg = $('egGo'); if (eg) { eg.hidden = false; eg.textContent = 'REMATCH THE DRAGONS'; }
    const go = $('go'); if (go) go.textContent = 'RIDE AGAIN';
  }

  // ======================================================================= HUD
  const vp = new V3(), hp1 = new V3(), hp2 = new V3();
  function screen(p) { vp.copy(p).project(camera); return vp.z < 1 && Math.abs(vp.x) < 1.3 && Math.abs(vp.y) < 1.3 ? [(vp.x * 0.5 + 0.5) * innerWidth, (-vp.y * 0.5 + 0.5) * innerHeight] : null; }
  let hudT = 0;
  function hudUpdate(dt) {
    hudT -= dt;
    for (const m of feedMsgs) m.t -= dt;
    while (feedMsgs.length && feedMsgs[feedMsgs.length - 1].t <= 0) feedMsgs.pop();
    if (hudT <= 0) {
      hudT = 0.2;
      const left = DRAG.filter(D => D.alive).length;
      const tleft = goT >= 0 ? Math.max(0, WAR_TIME - (clock - goT)) : WAR_TIME;
      el.board.innerHTML = '<div class="t">DRAGON WAR · ' + left + '/' + DRAG.length + ' WYVERNS · ' + Math.floor(tleft / 60) + ':' + String(Math.floor(tleft % 60)).padStart(2, '0') + '</div>' +
        RACERS.slice().sort((a, b) => b.kills - a.kills).map(R => '<div class="r' + (R.player ? ' me' : '') + (R.out ? ' out' : '') + '"><i style="background:' + hex(R.col) + '"></i>' + (R.player ? '45 YOU' : R.num + ' ' + R.name) + '<b>' + R.kills + '</b></div>').join('');
      el.feed.innerHTML = feedMsgs.map(m => '<div style="color:' + m.col + ';opacity:' + Math.min(1, m.t).toFixed(2) + '">' + m.msg + '</div>').join('');
      if (phase === 'fly') {
        const H = me().heli;
        el.obj.textContent = goT < 0 ? (H.st === 'spool' ? 'Rotors spinning up…' : 'Lift off to start the war') : (H.st === 'held' ? 'GRABBED — SHOOT IT POINT-BLANK!' : 'Shoot down the most wyverns');
        el.stat.textContent = 'ALT ' + altShown(H.pos.x, H.pos.y).toLocaleString() + ' m · ' + Math.round(H.vel.length() * 3.6) + ' km/h · MSL ' + (ammo > 0 ? ammo + (H.mslCd > 0 ? ' (reload)' : ' READY') : 'EMPTY');
      } else if (phase === 'walk') el.stat.textContent = TOUCH ? 'Left thumb: walk · Right thumb: look' : 'W/A/S/D walk · mouse look (click) · E board';
      else if (phase === 'fall') { el.obj.textContent = 'EJECTED!'; el.stat.textContent = ''; }
    }
    let warn = '';
    if (phase === 'fly') {
      const H = me().heli;
      if (H.st === 'held') warn = 'GRABBED! FIRE TO BREAK FREE';
      else if (H.targeted) { const D = H.targeted, d = D.d.dpos.distanceTo(H.pos); if (D.st === 'commit') warn = '⚠ DIVING ON YOU — CHANGE COURSE!'; else if (d < 420) warn = '⚠ WYVERN INBOUND ' + Math.round(d) + ' m'; }
    }
    if (el.warn.textContent !== warn) el.warn.textContent = warn;
    el.warn.classList.toggle('on', !!warn);
    const showAim = phase === 'fly' && me().heli.st !== 'spool';
    let cp = null;
    if (showAim) { const H = me().heli; cp = screen(hp1.copy(H.pos).addScaledVector(heliFwd(H, hp2), 160).add(hp2.set(0, 4, 0))); }
    el.cross.style.display = cp ? 'block' : 'none';
    if (cp) { el.cross.style.left = cp[0] + 'px'; el.cross.style.top = cp[1] + 'px'; el.cross.style.borderColor = gunD ? '#ff5a3a' : 'rgba(140,255,170,.85)'; }
    const LD = showAim ? (gunD || lockD) : null, lp = LD ? screen(LD.d.dpos) : null;
    el.lock.style.display = lp ? 'block' : 'none';
    if (lp) { el.lock.style.left = lp[0] + 'px'; el.lock.style.top = lp[1] + 'px'; el.lock.classList.toggle('lk', LD === lockD); el.lockNm.textContent = LD.name.toUpperCase() + ' · ' + Math.round(LD.d.dpos.distanceTo(me().heli.pos)) + ' m'; el.lockHp.style.width = Math.max(0, LD.hp / LD.max * 100) + '%'; }
    el.dot.style.display = phase === 'walk' ? 'block' : 'none';
  }

  // ======================================================================= main update (called every frame instead of the race physics/camera)
  function update(dt) {
    if (!active) return;
    clock += dt;
    for (const H of HELIS) {
      if (H.owner.player) continue;
      if (H.st === 'spool') { H.t += dt; H.rpm = Math.min(1, H.t / 2); if (H.t > 2.2) { H.st = 'hover'; H.t = 0; } heliPose(H, dt, 0, 0); }
      else if (H.st === 'hover') { H.t += dt; heliMove(H, dt, aT.set(0, 0, 0), clamp((deckY + 28 + H.owner.id * 3 - H.pos.y) * 0.6, -6, 14), 1.5); H.yaw += Math.sin(clock * 0.3 + H.owner.id) * 0.1 * dt; heliPose(H, dt, 0, 0); if (goT >= 0 && H.t > 0.5) H.st = 'fly'; }
      else if (H.st === 'fly') aiHeli(H, dt);
      else if (H.st === 'held') heldHeli(H);
      else if (H.st === 'recover') recoverHeli(H, dt);
      else if (H.st === 'thrown') thrownHeli(H, dt);
      if (H.root.visible) spinRotor(H, dt);
    }
    const MH = me().heli;
    if (phase === 'walk') { walkUpdate(dt); walkersUpdate(dt); }
    else if (phase === 'fly') {
      walkersUpdate(dt); playerFly(dt);
      if (goT < 0 && MH.st === 'fly' && MH.pos.y > deckY + 10) {
        goT = clock; feed('WYVERNS INBOUND — shoot them down!', '#ffd060'); toast('WYVERNS INBOUND!', 1800);
        for (const D of DRAG) if (D.st === 'far') { D.st = 'circle'; D.cd = rnd(3, 10); }
        for (const R of RACERS) if (R.walker && !R.walker.done) { R.walker.done = true; R.walker.g.visible = false; R.heli.st = 'spool'; R.heli.t = 0; }
      }
    } else if (phase === 'fall') { if (MH.st === 'thrown') thrownHeli(MH, dt); fallCam(dt); }
    else if (phase === 'over') { if (MH.st === 'thrown') thrownHeli(MH, dt); overCam(dt); }
    if (MH.root.visible) spinRotor(MH, dt);
    for (const D of DRAG) if (D.st !== 'gone') dragonStep(D, dt);
    schedule(dt);
    missileUpdate(dt); tracerUpdate(dt); fxUpdate(dt);
    for (const p of PILOTS) pilotStep(p, dt);
    if (phase === 'fly' || phase === 'fall') {
      if (DRAG.length && DRAG.every(D => D.st === 'gone')) endGame('cleared');
      else if (goT >= 0 && clock - goT > WAR_TIME) endGame('time');
    }
    hudUpdate(dt);
  }
  // test / preview hooks
  const dbg = {
    board, endGame, tin, STATS, get phase() { return phase; }, get P() { return P; }, get HELIS() { return HELIS; }, get DRAG() { return DRAG; }, get RACERS() { return RACERS; },
    get padC() { return padC; }, get deckY() { return deckY; }, get F() { return F; }, get dP() { return dP; }, get sP() { return sP; }, get goT() { return goT; }, get camP() { return camP; },
    kill: (i, by = 0) => { const D = DRAG[i]; if (D && D.alive) kill(D, RACERS[by]); },
    attackMe: (i = 0) => { const D = DRAG[i], H = me().heli; D.st = 'attack'; D.t = 0; D.tgt = H; H.targeted = D; },
    grabMe: (i = 0) => grab(DRAG[i], me().heli),
  };
  return { start, stop, update, get active() { return active; }, get phase() { return phase; }, dbg };
}
