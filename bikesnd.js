// Quiet dirt-bike audio: real CC0 engine loops (idle + high-rev) crossfaded/pitched by RPM, skid noise, landing thud,
// faint AI engines by distance. Everything runs through the game's master bus, so the mute button covers it.
export function createBikeSound(SFX, base = './assets/sfx/') {
  const VOL = 0.11;            // master level for all bike sounds (dragons / whoosh run near 0.6-1.0)
  let ctx = null, out = null, bufs = null, loading = false, P = null, AIV = [], skid = null, rpm = 0, air = 0, wasG = true, on = false;
  function load() {
    if (loading || !SFX.ctx || !SFX.bus) return; loading = true; ctx = SFX.ctx;
    out = ctx.createGain(); out.gain.value = 0; out.connect(SFX.bus);
    Promise.all(['engine_idle.mp3', 'engine_rev.mp3'].map(f => fetch(base + f).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b))))
      .then(([idle, rev]) => { bufs = { idle, rev }; build(); }).catch(e => console.warn('[bikesnd]', e));
  }
  function loopSrc(buf, g) {
    const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = 0.06; s.loopEnd = buf.duration - 0.06;
    const gn = ctx.createGain(); gn.gain.value = 0; s.connect(gn).connect(g); s.start(ctx.currentTime, Math.random() * buf.duration * 0.8); return { s, g: gn };
  }
  function build() {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800; lp.connect(out);   // take the edge off the rasp
    P = { idle: loopSrc(bufs.idle, lp), rev: loopSrc(bufs.rev, lp), lp };
    for (let i = 0; i < 2; i++) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1500; f.connect(out); AIV.push({ v: loopSrc(bufs.rev, f), f }); }
    const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = n.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource(); s.buffer = n; s.loop = true; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.value = 0; s.connect(bp).connect(g).connect(out); s.start(); skid = { g };
  }
  const set = (p, v, tc = 0.06) => p.setTargetAtTime(v, ctx.currentTime, tc);
  function thud(k) {
    if (!ctx) return; const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9 * k, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.35);
  }
  // st: { active, gas, brake, speed, vmax, grounded, sliding }, ais: [{ pos, spd }], cam: Vector3
  function update(dt, st, ais, cam) {
    if (!ctx) { load(); return; }
    if (!P) return;
    const want = st.active ? VOL : 0; if (want !== (on ? VOL : 0)) { set(out.gain, want, 0.25); on = !!st.active; }
    if (!st.active) { air = 0; wasG = true; return; }
    // rpm: follows wheel speed with throttle flare; drops on the brake / in the air with no throttle
    const sp = Math.min(1, st.speed / (st.vmax || 34));
    const tgt = st.grounded ? Math.min(1, 0.12 + sp * 0.7 + (st.gas ? 0.22 : -0.05)) : (st.gas ? 0.95 : 0.35);
    rpm += (tgt - rpm) * Math.min(1, (tgt > rpm ? 4 : 2.5) * dt);
    const x = Math.max(0, Math.min(1, (rpm - 0.25) / 0.5));
    set(P.idle.g.gain, (1 - x) * 0.9, 0.08); set(P.rev.g.gain, x * (st.gas ? 0.9 : 0.6), 0.08);
    set(P.idle.s.playbackRate, 0.85 + rpm * 0.7, 0.05); set(P.rev.s.playbackRate, 0.72 + rpm * 0.42, 0.05);
    set(skid.g.gain, (st.brake || st.sliding) && st.grounded && st.speed > 5 ? Math.min(0.35, st.speed / 60) : 0, 0.05);
    if (!st.grounded) air += dt; else { if (!wasG && air > 0.35) thud(Math.min(1, 0.4 + air * 0.4)); air = 0; }
    wasG = st.grounded;
    // AI: the two nearest rivals, very faint, fading out by 70 m
    const near = ais.map(a => ({ a, d: a.pos.distanceTo(cam) })).sort((u, v) => u.d - v.d);
    AIV.forEach((V, i) => { const n = near[i]; const k = n ? Math.max(0, 1 - n.d / 70) : 0;
      set(V.v.g.gain, k * k * 0.22, 0.15); if (n) set(V.v.s.playbackRate, 0.75 + Math.min(1, (n.a.spd || 0) / 35) * 0.4, 0.1); });
  }
  return { update, get loaded() { return !!P; }, VOL };
}
