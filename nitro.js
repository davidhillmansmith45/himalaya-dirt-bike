// Shared nitro FX: pad texture, blue exhaust flame, speed lines overlay, whoosh
export function createNitroFx(THREE, getSFX) {
  function padTex() {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256; const g = cv.getContext('2d');
    g.fillStyle = 'rgba(10,40,90,0.85)'; g.fillRect(0, 0, 128, 256);
    g.strokeStyle = '#7fe3ff'; g.lineWidth = 6; g.strokeRect(5, 5, 118, 246);
    for (let k = 0; k < 3; k++) { const y = 200 - k * 70; g.fillStyle = k === 1 ? '#bff4ff' : '#33bbff';
      g.beginPath(); g.moveTo(14, y); g.lineTo(64, y - 46); g.lineTo(114, y); g.lineTo(114, y + 22); g.lineTo(64, y - 24); g.lineTo(14, y + 22); g.closePath(); g.fill(); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const padMat = new THREE.MeshBasicMaterial({ map: padTex(), transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x46c8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  function makeFlame() {
    const g = new THREE.Group();
    const m1 = new THREE.MeshBasicMaterial({ color: 0x4fb8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const m2 = new THREE.MeshBasicMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const c1 = new THREE.Mesh(new THREE.ConeGeometry(0.13, 1.1, 10, 1, true), m1); c1.rotation.z = Math.PI / 2; c1.position.x = -0.55;
    const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.55, 8, 1, true), m2); c2.rotation.z = Math.PI / 2; c2.position.x = -0.28;
    g.add(c1, c2); g.visible = false; return g;
  }
  function attachFlame(root) {
    if (!root) return null; if (root.userData.nitroFlame) return root.userData.nitroFlame;
    let anc = root.userData.exhaustAnchor; if (!anc) root.traverse(o => { if (!anc && o.userData && o.userData.exhaustAnchor) anc = o.userData.exhaustAnchor; });
    const fl = makeFlame(); (anc || root).add(fl); if (!anc) fl.position.set(0, 0.4, 1.0);
    root.userData.nitroFlame = fl; return fl;
  }
  function flame(fl, on) {
    if (!fl) return; fl.visible = on; if (!on) return;
    const k = 1.5 + Math.random() * 0.7; fl.scale.set(k, 1.5 + Math.random() * 0.4, 1.5 + Math.random() * 0.4);
  }
  let lines = null, linesT = 0;
  function speedLines(a) {
    if (!lines) { lines = document.createElement('div'); lines.id = 'nitroLines';
      lines.style.cssText = 'position:fixed;inset:-20%;pointer-events:none;z-index:15;opacity:0;transition:opacity .25s;background:repeating-conic-gradient(from 0deg at 50% 50%,rgba(200,240,255,0) 0deg 3.2deg,rgba(200,240,255,.55) 3.4deg 3.7deg,rgba(200,240,255,0) 3.9deg 7deg);-webkit-mask-image:radial-gradient(circle at 50% 50%,transparent 32%,#000 62%);mask-image:radial-gradient(circle at 50% 50%,transparent 32%,#000 62%)';
      document.body.appendChild(lines);
      setInterval(() => { if (performance.now() - linesT > 300 && lines.style.opacity !== '0') lines.style.opacity = '0'; }, 250); }
    linesT = performance.now();
    lines.style.opacity = a.toFixed(2); if (a > 0) lines.style.transform = 'rotate(' + (Math.random() * 6).toFixed(1) + 'deg) scale(' + (1 + Math.random() * 0.04).toFixed(3) + ')';
  }
  function whoosh(vol = 0.7) {
    const S = getSFX && getSFX(); if (!S || S.muted) return; const ac = S.ctx, bus = S.bus; if (!ac || !bus) return;
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
  return { padMat, glowMat, attachFlame, flame, speedLines, whoosh, BOOST_T: 2.6 };
}
