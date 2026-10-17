// Level 2 zombies: rotting climbers that scale the Great Wall faces, haul themselves over the parapet,
// lurk at the walkway edge and lunge at passing racers. Procedural rig (10 parts), pooled, LOD by distance.
export function createZombies(C) {
  const { THREE, scene, frame, HW, PAR, D, inGap, towerAt, pads, IS_MOBILE, SFX, camera } = C;
  const V3 = THREE.Vector3, rnd = (a, b) => a + Math.random() * (b - a), clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const _f = { x: 0, z: 0, y: 0, tx: 0, tz: 1, rx: 0, rz: 0, g: 0 };
  // ---------------------------------------------------------------- materials (rotting skin, torn cloth)
  const canvasTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  const skinTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#7d8a6a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { const v = rnd(-28, 22); g.fillStyle = `rgba(${110 + v},${120 + v},${92 + v},0.35)`; g.fillRect(rnd(0, w), rnd(0, h), rnd(2, 7), rnd(2, 7)); }
    for (let i = 0; i < 40; i++) { const x = rnd(0, w), y = rnd(0, h), r = rnd(6, 22); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(70,58,40,.75)'); gr.addColorStop(1, 'rgba(70,58,40,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
    for (let i = 0; i < 14; i++) { const x = rnd(0, w), y = rnd(0, h), r = rnd(4, 11); g.fillStyle = 'rgba(95,18,16,.85)'; g.beginPath(); g.ellipse(x, y, r, r * rnd(0.4, 0.9), rnd(0, 3), 0, 7); g.fill(); g.fillStyle = 'rgba(160,140,110,.6)'; g.beginPath(); g.ellipse(x, y, r * 0.4, r * 0.25, 0, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(60,40,70,.35)'; g.lineWidth = 1.2; for (let i = 0; i < 30; i++) { g.beginPath(); let x = rnd(0, w), y = rnd(0, h); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += rnd(-12, 12); y += rnd(-12, 12); g.lineTo(x, y); } g.stroke(); }
  });
  const clothTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#3b3a33'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { const v = rnd(-14, 14); g.fillStyle = `rgba(${55 + v},${52 + v},${44 + v},.5)`; g.fillRect(rnd(0, w), rnd(0, h), rnd(1, 3), rnd(4, 12)); }
    for (let i = 0; i < 30; i++) { const x = rnd(0, w), y = rnd(0, h), r = rnd(8, 26); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(70,14,10,.7)'); gr.addColorStop(1, 'rgba(40,30,20,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
    g.globalCompositeOperation = 'destination-out';   // holes and ragged hems
    for (let i = 0; i < 26; i++) { g.beginPath(); g.ellipse(rnd(0, w), rnd(0, h), rnd(4, 14), rnd(3, 9), rnd(0, 3), 0, 7); g.fill(); }
    for (let x = 0; x < w; x += 6) { g.fillRect(x, h - rnd(4, 26), 6, 30); }
  });
  const skin = new THREE.MeshStandardMaterial({ map: skinTex, roughness: 0.72, metalness: 0, color: 0x9aa48c });
  const cloth = new THREE.MeshStandardMaterial({ map: clothTex, roughness: 0.95, alphaTest: 0.5, side: THREE.DoubleSide });
  const eyeM = new THREE.MeshBasicMaterial({ color: 0xd8e6a0, toneMapped: false });
  const mouthM = new THREE.MeshStandardMaterial({ color: 0x2a0c0a, roughness: 0.6 });
  // ---------------------------------------------------------------- geometry (shared)
  const cap = (r, l, s = 8) => new THREE.CapsuleGeometry(r, l, 3, s);
  const G = {
    torso: (() => { const g = cap(0.2, 0.42, 10); g.scale(1.15, 1, 0.75); return g; })(),
    shirt: (() => { const g = new THREE.CylinderGeometry(0.255, 0.27, 0.62, 12, 1, true); g.scale(1.1, 1, 0.78); return g; })(),
    head: (() => { const g = new THREE.SphereGeometry(0.135, 14, 12); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i), z = p.getZ(i); p.setY(i, y * 1.18 + (y < -0.05 && z > 0 ? -0.03 : 0)); p.setX(i, p.getX(i) * (y < 0 ? 0.86 : 1)); p.setZ(i, z * 1.02 + Math.sin(i * 12.9) * 0.008); } g.computeVertexNormals(); return g; })(),
    jaw: (() => { const g = new THREE.BoxGeometry(0.15, 0.05, 0.1); g.translate(0, -0.03, 0.04); return g; })(),
    eye: new THREE.SphereGeometry(0.018, 6, 5),
    upper: (() => { const g = cap(0.055, 0.25); g.translate(0, -0.16, 0); return g; })(),
    fore: (() => { const g = cap(0.045, 0.24); g.translate(0, -0.15, 0); const h = new THREE.BoxGeometry(0.07, 0.12, 0.035); h.translate(0, -0.34, 0); return mergeTwo(g, h); })(),
    thigh: (() => { const g = cap(0.075, 0.32); g.translate(0, -0.21, 0); return g; })(),
    shin: (() => { const g = cap(0.06, 0.34); g.translate(0, -0.22, 0); const f = new THREE.BoxGeometry(0.09, 0.06, 0.2); f.translate(0, -0.44, 0.05); return mergeTwo(g, f); })(),
  };
  function mergeTwo(a, b) { // tiny merge without addons (both non-indexed after toNonIndexed)
    const A = a.index ? a.toNonIndexed() : a, B = b.index ? b.toNonIndexed() : b, out = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv']) { const x = A.attributes[k].array, y = B.attributes[k].array, z = new Float32Array(x.length + y.length); z.set(x); z.set(y, x.length); out.setAttribute(k, new THREE.BufferAttribute(z, A.attributes[k].itemSize)); }
    return out;
  }
  function makeZombie(i) {
    const root = new THREE.Group(), hips = new THREE.Group(); root.add(hips); hips.position.y = 0.92;
    const torso = new THREE.Group(); hips.add(torso);
    const tm = new THREE.Mesh(G.torso, skin); tm.position.y = 0.33; torso.add(tm);
    const sh = new THREE.Mesh(G.shirt, cloth); sh.position.y = 0.3; torso.add(sh);
    const neck = new THREE.Group(); neck.position.set(0, 0.66, 0.02); torso.add(neck);
    const head = new THREE.Mesh(G.head, skin); head.position.y = 0.12; neck.add(head);
    const jaw = new THREE.Mesh(G.jaw, mouthM); jaw.position.set(0, 0.04, 0.06); neck.add(jaw);
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(G.eye, eyeM); e.position.set(sx * 0.048, 0.15, 0.118); neck.add(e); }
    const limb = (parent, geo, mat, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); g.add(new THREE.Mesh(geo, mat)); parent.add(g); return g; };
    const arms = [-1, 1].map(sx => { const u = limb(torso, G.upper, skin, sx * 0.27, 0.58, 0); const f = limb(u, G.fore, skin, 0, -0.32, 0); return { u, f, sx }; });
    const legs = [-1, 1].map(sx => { const t = limb(hips, G.thigh, cloth, sx * 0.12, 0, 0); const s = limb(t, G.shin, skin, 0, -0.42, 0); return { t, s, sx }; });
    const k = 0.92 + (i % 5) * 0.04; root.scale.setScalar(k);
    root.traverse(o => { if (o.isMesh) { o.castShadow = !IS_MOBILE; o.frustumCulled = true; } });
    root.visible = false; scene.add(root);
    return { root, hips, torso, neck, jaw, arms, legs, st: 'off', t: 0, ph: Math.random() * 6, sp: null };
  }
  // ---------------------------------------------------------------- spawn points (never near gaps/ramps/towers/pads/start/finish)
  const SP = [];
  {
    const bad = (s) => D.gaps.some(g => s > g[0] - 95 && s < g[1] + 25) || D.ramps.some(r => s > r[0] - 95 && s < r[1] + 25) || towerAt(s) || D.towers.some(t => Math.abs(s - t) < 12)
      || (pads || []).some(p => Math.abs(p.s - s) < 16) || (D.tables || []).some(t => s > t[0] - 60 && s < t[3] + 15) || s < D.start + 70 || s > D.finish - 35;
    let h = 0;
    for (let s = D.start + 75; s < D.finish - 35; s += rnd(38, 60)) if (!bad(s)) { const horde = (h++ % 4) === 2; SP.push({ s, sd: Math.random() < 0.5 ? -1 : 1, used: false, n: horde ? (IS_MOBILE ? 4 : 5) : (Math.random() < 0.3 ? 2 : 1), horde }); }
  }
  const NMAX = IS_MOBILE ? 12 : 20;
  const Z = []; for (let i = 0; i < NMAX; i++) Z.push(makeZombie(i));
  const STATS = { leaps: 0, hordes: 0, spawned: 0, grabs: 0, aiGrabs: 0, knocks: 0, shaken: 0, groans: 0 };
  // ---------------------------------------------------------------- audio: low formant groan, positional by distance
  function groan(pos, vol = 0.5) {
    const ac = SFX && SFX.ctx, bus = SFX && SFX.bus; if (!ac || !bus || SFX.muted) return;
    const d = pos.distanceTo(camera.position), k = Math.max(0, 1 - d / 75); if (k <= 0.02) return; STATS.groans++;
    try {
      const t = ac.currentTime, len = rnd(0.9, 1.6), o = ac.createOscillator(), o2 = ac.createOscillator(); o.type = 'sawtooth'; o2.type = 'square';
      const f0 = rnd(70, 105); o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * rnd(0.7, 0.85), t + len); o2.frequency.setValueAtTime(f0 * 0.5, t);
      const vib = ac.createOscillator(), vg = ac.createGain(); vib.frequency.value = rnd(5, 8); vg.gain.value = f0 * 0.06; vib.connect(vg).connect(o.frequency);
      const n = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate), nd = n.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * 0.5; const ns = ac.createBufferSource(); ns.buffer = n;
      const mix = ac.createGain(); mix.gain.value = 1;
      const f1 = ac.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = rnd(420, 600); f1.Q.value = 5;
      const f2 = ac.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = rnd(950, 1250); f2.Q.value = 7;
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * k * k * 1.4, t + 0.18); g.gain.setTargetAtTime(0.0001, t + len * 0.6, len * 0.2);
      const og = ac.createGain(); og.gain.value = 0.35;
      o.connect(mix); o2.connect(og).connect(mix); ns.connect(mix); mix.connect(f1).connect(g); mix.connect(f2).connect(g); g.connect(bus);
      [o, o2, vib, ns].forEach(x => { x.start(t); x.stop(t + len + 0.6); });
    } catch (e) {}
  }
  // ---------------------------------------------------------------- pose helpers
  const tmp = new V3();
  function place(z, s, lat, y, faceX, faceZ) {
    const f = frame(s, _f); z.root.position.set(f.x + f.rx * lat, y, f.z + f.rz * lat); z.root.rotation.set(0, Math.atan2(faceX, faceZ), 0); return f;
  }
  function poseClimb(z, t, speed) {
    const a = t * 5.2 * speed, s1 = Math.sin(a), s2 = Math.sin(a + Math.PI);
    z.torso.rotation.set(-0.12, 0, Math.sin(a) * 0.08); z.hips.rotation.set(0.15, 0, 0); z.neck.rotation.set(-0.45, Math.sin(a * 0.5) * 0.3, 0);
    z.arms[0].u.rotation.set(-2.6 - s1 * 0.5, 0, -0.2); z.arms[0].f.rotation.set(-0.5 - Math.max(0, s1) * 0.8, 0, 0);
    z.arms[1].u.rotation.set(-2.6 - s2 * 0.5, 0, 0.2); z.arms[1].f.rotation.set(-0.5 - Math.max(0, s2) * 0.8, 0, 0);
    z.legs[0].t.rotation.set(-0.9 - s2 * 0.5, 0, 0); z.legs[0].s.rotation.set(1.3 + s2 * 0.3, 0, 0);
    z.legs[1].t.rotation.set(-0.9 - s1 * 0.5, 0, 0); z.legs[1].s.rotation.set(1.3 + s1 * 0.3, 0, 0);
    z.jaw.rotation.x = 0.25 + Math.max(0, Math.sin(t * 3)) * 0.35;
  }
  function posePerch(z, t) {   // elbows on the coping, head swaying over the edge
    z.torso.rotation.set(0.25, 0, Math.sin(t * 1.7) * 0.06); z.hips.rotation.set(0, 0, 0); z.neck.rotation.set(-0.2 + Math.sin(t * 2.3) * 0.15, Math.sin(t * 1.3) * 0.5, 0.2 * Math.sin(t));
    for (const A of z.arms) { A.u.rotation.set(-1.75 + Math.sin(t * 3 + A.sx) * 0.12, 0, -A.sx * 0.15); A.f.rotation.set(-0.9, 0, 0); }
    for (const L of z.legs) { L.t.rotation.set(-0.4, 0, 0); L.s.rotation.set(0.9, 0, 0); }
    z.jaw.rotation.x = 0.3 + Math.max(0, Math.sin(t * 4)) * 0.4;
  }
  function poseLurk(z, t, reach) {   // hunched, arms forward, shuffling sway; reach 0..1 = lunge
    z.torso.rotation.set(0.35 + reach * 0.35, 0, Math.sin(t * 1.4) * 0.12); z.hips.rotation.set(-0.1, 0, Math.sin(t * 1.4) * 0.06);
    z.neck.rotation.set(-0.3 - reach * 0.2, Math.sin(t * 0.9) * 0.4 * (1 - reach), -0.25);
    for (const A of z.arms) { A.u.rotation.set(-1.25 - reach * 0.35 + Math.sin(t * 2.2 + A.sx * 1.4) * 0.18, 0, -A.sx * (0.12 - reach * 0.1)); A.f.rotation.set(-0.35 + reach * 0.3, 0, 0); }
    const w = Math.sin(t * 2.4); z.legs[0].t.rotation.set(-0.15 + w * 0.15 - reach * 0.4, 0, 0); z.legs[1].t.rotation.set(-0.15 - w * 0.15 + reach * 0.3, 0, 0);
    for (const L of z.legs) L.s.rotation.set(0.35, 0, 0);
    z.jaw.rotation.x = 0.2 + reach * 0.5 + Math.max(0, Math.sin(t * 5)) * 0.2;
  }
  function poseCling(z, t) { z.torso.rotation.set(0.7, 0, 0.3 * Math.sin(t * 9)); for (const A of z.arms) { A.u.rotation.set(-1.9 + Math.sin(t * 14 + A.sx) * 0.2, 0, -A.sx * 0.4); A.f.rotation.set(-0.8, 0, 0); } for (const L of z.legs) { L.t.rotation.set(0.5 + Math.sin(t * 7 + L.sx) * 0.4, 0, 0); L.s.rotation.set(0.6, 0, 0); } z.jaw.rotation.x = 0.6; }
  function poseFlail(z, t) { z.torso.rotation.set(Math.sin(t * 6) * 0.6, 0, Math.cos(t * 5) * 0.6); for (const A of z.arms) { A.u.rotation.set(-2 + Math.sin(t * 11 + A.sx * 2) * 1.2, 0, -A.sx * 1); A.f.rotation.set(-0.6, 0, 0); } for (const L of z.legs) { L.t.rotation.set(Math.sin(t * 9 + L.sx * 2) * 0.9, 0, 0); L.s.rotation.set(0.8, 0, 0); } z.jaw.rotation.x = 0.7; }
  // ---------------------------------------------------------------- racers interface: { s, lat, speed, boost, player, grabbedBy, y }
  function knockOff(z, R, hard) {
    z.st = 'fall'; z.t = 0; z.grab = null; STATS.knocks++;
    const f = frame(z.s, _f), out = z.sd; // fly outward over the parapet
    z.v = new V3(f.rx * out * rnd(5, 8) + f.tx * (R ? Math.min(14, R.speed * 0.45) : 2), rnd(4, 7) + (hard ? 3 : 0), f.rz * out * rnd(5, 8) + f.tz * (R ? Math.min(14, R.speed * 0.45) : 2));
    z.spin = new V3(rnd(-6, 6), rnd(-4, 4), rnd(-6, 6)); groan(z.root.position, 0.6);
  }
  function activate(sp) {
    sp.used = true; if (sp.horde) STATS.hordes++;
    for (let k = 0; k < (sp.n || 1); k++) {
      const z = Z.find(q => q.st === 'off'); if (!z) break;
      STATS.spawned++;
      const sd = k === 0 ? sp.sd : (k % 2 ? -sp.sd : sp.sd), ss = sp.s + (k === 0 ? 0 : rnd(-6, 6));
      Object.assign(z, { st: 'climb', t: 0, s: ss, sd, sp, lat: sd * (HW + PAR + 0.32), life: 0, grab: null, warned: false, reach: 0, lunge: 0, lungeSnd: false,
        leaper: Math.random() < (sp.horde ? 0.45 : 0.35), climbK: rnd(1.15, 1.6) });
      const f = frame(z.s, _f); z.deck = f.y; z.y0 = f.y - rnd(2.6, 4.0) - k * 0.5; z.y = z.y0; z.root.visible = true; z.root.rotation.set(0, 0, 0);
    }
    return true;
  }
  function reset() { for (const z of Z) { z.st = 'off'; z.root.visible = false; z.grab = null; } for (const p of SP) p.used = false; }
  // ---------------------------------------------------------------- update
  function update(dt, racers, onGrab) {
    // trigger spawns ~70-120 m ahead of any racer
    for (const sp of SP) { if (sp.used) continue; for (const R of racers) { const d = sp.s - R.s; if (d > 55 && d < 120 && !R.finished) { activate(sp); break; } } }
    for (const z of Z) {
      if (z.st === 'off') continue;
      z.t += dt; z.life += dt;
      const camD = z.root.position.distanceTo(camera.position);
      z.root.visible = camD < (IS_MOBILE ? 140 : 220);
      const anim = z.root.visible;
      const f = frame(z.s, _f), inX = -z.sd * f.rx, inZ = -z.sd * f.rz;   // facing into the walkway
      if (z.st === 'climb') {
        const top = z.deck + 0.05, k = z.climbK || 1.3;
        z.y = Math.min(top - 0.95, z.y + k * dt);
        z.root.position.set(f.x + f.rx * z.lat, z.y, f.z + f.rz * z.lat); z.root.rotation.set(0, Math.atan2(inX, inZ), 0);
        if (anim) poseClimb(z, z.t, k);
        if (z.y >= top - 0.95) { z.st = 'perch'; z.t = 0; z.perchT = rnd(0.35, 0.8); groan(z.root.position, 0.55); }
      } else if (z.st === 'perch') {
        z.root.position.set(f.x + f.rx * z.lat, z.deck - 0.55 + Math.sin(z.t * 2) * 0.03, f.z + f.rz * z.lat); z.root.rotation.set(0, Math.atan2(inX, inZ), 0);
        if (anim) posePerch(z, z.t);
        if (z.leaper) {   // wait on the parapet and leap at a rider coming past
          let tgt = null; for (const R of racers) { const ds = z.s - R.s; if (ds > 4 && ds < 26 && !R.finished && !R.grabbedBy) { tgt = R; break; } }
          if (tgt) { const tt = 0.75, sAt = tgt.s + tgt.speed * tt; z.st = 'leap'; z.t = 0; z.T = tt; z.lat0 = z.lat; z.s0 = z.s;
            z.s1 = clamp(sAt, z.s - 8, z.s + 4); z.lat1 = clamp(tgt.lat, -HW + 0.6, HW - 0.6); STATS.leaps++; groan(z.root.position, 0.8); }
          else if (z.t > 9) { z.st = 'over'; z.t = 0; }
        } else if (z.t > z.perchT) { z.st = 'over'; z.t = 0; }
      } else if (z.st === 'leap') {
        const u = Math.min(1, z.t / z.T); z.s = z.s0 + (z.s1 - z.s0) * u; z.lat = z.lat0 + (z.lat1 - z.lat0) * u;
        const ff = frame(z.s, _f); z.deck = ff.y;
        z.root.position.set(ff.x + ff.rx * z.lat, ff.y + 0.4 * (1 - u) + Math.sin(u * Math.PI) * 1.15, ff.z + ff.rz * z.lat);
        z.root.rotation.set(-0.5 * Math.sin(u * Math.PI), Math.atan2(-z.sd * ff.rx, -z.sd * ff.rz), 0);
        if (anim) { poseLurk(z, z.t * 2, 1); for (const L of z.legs) L.t.rotation.x = -1.1 * Math.sin(u * Math.PI); }
        for (const R of racers) {   // tackle mid-air
          if (R.grabbedBy || R.finished || !R.grounded) continue;
          if (Math.abs(R.s - z.s) < 1.8 && Math.abs(R.lat - z.lat) < 1.8) {
            if (R.speed > 30 || R.boost > 0) { knockOff(z, R, R.boost > 0); onGrab && onGrab(R, 'knock', z); }
            else { z.st = 'grab'; z.t = 0; z.grab = R; R.grabbedBy = z; if (R.player) STATS.grabs++; else STATS.aiGrabs++; groan(z.root.position, 0.9); onGrab && onGrab(R, 'grab', z); }
            break;
          }
        }
        if (z.st === 'leap' && u >= 1) { z.st = 'lunge'; z.t = 0; z.reach = 1; }
      } else if (z.st === 'over') {   // haul over the parapet onto the walkway edge
        const u = Math.min(1, z.t / 0.9), e = u * u * (3 - 2 * u);
        const lat0 = z.sd * (HW + PAR + 0.32), lat1 = z.sd * (HW - 0.5);
        z.lat = lat0 + (lat1 - lat0) * e;
        const yy = z.deck - 0.55 + Math.sin(u * Math.PI) * 1.75 + e * 0.55;
        z.root.position.set(f.x + f.rx * z.lat, yy, f.z + f.rz * z.lat); z.root.rotation.set(0, Math.atan2(inX, inZ), 0);
        if (anim) { posePerch(z, z.t * 3); z.torso.rotation.x = 0.9 - e * 0.6; for (const L of z.legs) L.t.rotation.x = -1.6 * Math.sin(u * Math.PI); }
        if (u >= 1) { z.st = 'lurk'; z.t = 0; }
      } else if (z.st === 'lurk' || z.st === 'lunge') {
        // face the nearest oncoming racer
        let best = null, bd = 1e9; for (const R of racers) { const ds = z.s - R.s; if (ds > -3 && ds < 35 && Math.abs(ds) < bd && !R.grabbedBy) { bd = Math.abs(ds); best = R; } }
        const latEdge = z.sd * (HW - 0.5);
        if (best && z.s - best.s < 18 && z.s - best.s > -1.5) {   // sprinting lunge into the racer's line
          z.st = 'lunge'; z.reach = Math.min(1, z.reach + dt * 4);
          const tl = clamp(best.lat, -HW + 0.5, HW - 0.5), want = latEdge + clamp(tl - latEdge, -5.5, 5.5);
          z.lat += clamp(want - z.lat, -6.5 * dt, 6.5 * dt); z.s -= Math.min(3.5 * dt, Math.max(0, z.s - best.s - 1)); if (!z.lungeSnd) { z.lungeSnd = true; groan(z.root.position, 0.7); }
        } else { z.st = 'lurk'; z.reach = Math.max(0, z.reach - dt * 2); z.lat += (latEdge - z.lat) * Math.min(1, 0.6 * dt); }
        const fx = best ? (frame(best.s, { ..._f }).x + f.rx * best.lat) - z.root.position.x : inX, fz = best ? (frame(best.s, { ..._f }).z + f.rz * best.lat) - z.root.position.z : inZ;
        { const ff = frame(z.s, _f); z.deck = ff.y; z.root.position.set(ff.x + ff.rx * z.lat, z.deck, ff.z + ff.rz * z.lat); }
        const ty = Math.atan2(fx, fz); let dy = ty - z.root.rotation.y; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; z.root.rotation.y += dy * Math.min(1, 5 * dt);
        if (anim) poseLurk(z, z.t, z.reach);
        // contact
        for (const R of racers) {
          if (R.grabbedBy || R.finished || !R.grounded) continue;
          if (Math.abs(R.s - z.s) < 1.6 && Math.abs(R.lat - z.lat) < 1.5 + z.reach * 0.6) {
            if (R.speed > 30 || R.boost > 0) { knockOff(z, R, R.boost > 0); onGrab && onGrab(R, 'knock', z); }
            else { z.st = 'grab'; z.t = 0; z.grab = R; R.grabbedBy = z; if (R.player) STATS.grabs++; else STATS.aiGrabs++; groan(z.root.position, 0.8); onGrab && onGrab(R, 'grab', z); }
            break;
          }
        }
        // give up and drop back over the side once everyone is well past (or after a long wait)
        if (z.st === 'lurk' && (racers.every(R => R.s > z.s + 25 || R.finished) || z.life > 40)) { z.st = 'drop'; z.t = 0; }
      } else if (z.st === 'grab') {   // clinging to the bike: hold position at the racer's side
        const R = z.grab; if (!R || R.grabbedBy !== z) { knockOff(z, null, false); continue; }
        const fr = frame(R.s, _f), side = R.lat > 0 ? 1 : -1;
        z.s = R.s; z.lat = R.lat + z.sd * 0.72;
        z.root.position.set(fr.x + fr.rx * z.lat - fr.tx * 0.45, (R.y != null ? R.y : fr.y) - 0.15, fr.z + fr.rz * z.lat - fr.tz * 0.45);
        z.root.rotation.set(0, Math.atan2(-z.sd * fr.rx + fr.tx * 0.3, -z.sd * fr.rz + fr.tz * 0.3), 0);
        if (anim) poseCling(z, z.t);
      } else if (z.st === 'fall') {
        z.v.y -= 24 * dt; z.root.position.addScaledVector(z.v, dt);
        z.root.rotation.x += z.spin.x * dt; z.root.rotation.y += z.spin.y * dt; z.root.rotation.z += z.spin.z * dt;
        if (anim) poseFlail(z, z.t);
        if (z.t > 3.5) { z.st = 'off'; z.root.visible = false; }
      } else if (z.st === 'drop') {
        const u = Math.min(1, z.t / 1.0); z.lat += (z.sd * (HW + PAR + 0.6) - z.lat) * Math.min(1, 4 * dt);
        z.root.position.set(f.x + f.rx * z.lat, z.deck + Math.sin(u * Math.PI) * 0.8 - u * u * 4, f.z + f.rz * z.lat);
        if (anim) posePerch(z, z.t * 2);
        if (u >= 1) { z.st = 'off'; z.root.visible = false; }
      }
    }
  }
  function release(R, how) {   // racer shook it off
    const z = R.grabbedBy; if (!z) return; R.grabbedBy = null; z.grab = null; if (how === 'shake') STATS.shaken++; knockOff(z, R, false);
  }
  return { update, reset, release, Z, SP, STATS, groan };
}
