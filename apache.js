// AH-64D Apache Longbow, built procedurally at real proportions (metres, then x1.2 to match the game's rider scale).
// Lofted superellipse fuselage / sponsons / nacelles / boom, faceted tandem canopy with 3D frames and a crew inside,
// TADS/PNVS nose, M230 chin gun, stub wings with Hydra pods + Hellfire racks, trailing-arm main gear, tail wheel,
// swept-tip main blades, scissor tail rotor, Longbow radome, nav/strobe lights. PBR: generated olive-drab albedo with
// panel lines + rivets, matching normal map and roughness/metal map. Two LODs (hi near, lo far) share one rotor.
// Local frame: nose +Z, up +Y, wheels on y = 0.
export function buildApacheKit(THREE, mergeGeometries, { mobile = false } = {}) {
  const K = 1.2;                 // metres -> game units
  const UVS = 3.0;               // metres per texture repeat
  const V3 = THREE.Vector3;
  const sgnpow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
  const keep = (g) => { if (g.index) g = g.toNonIndexed(); for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; };
  const merge = (arr) => { const g = mergeGeometries(arr.map(keep)); g.scale(K, K, K); g.computeBoundingSphere(); return g; };

  // ---------------------------------------------------------------- loft: stations [z, yc, w, ht, hb, n, xc]
  function interp(st, sub) {
    if (sub <= 1) return st.map(s => s.slice());
    const out = [];
    const N = st.length, P = (i) => st[Math.max(0, Math.min(N - 1, i))];
    for (let i = 0; i < N - 1; i++) for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t, a = P(i - 1), b = P(i), c = P(i + 1), d = P(i + 2);
      const row = [];
      for (let j = 0; j < b.length; j++) {
        if (j === 5) { row.push(b[j] + (c[j] - b[j]) * t); continue; }
        // centripetal-ish Catmull-Rom, clamped so tapers don't overshoot negative
        let v = 0.5 * ((2 * b[j]) + (-a[j] + c[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t2 + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * t3);
        if (j >= 2 && j <= 4) v = Math.max(0.003, Math.min(v, Math.max(b[j], c[j]) * 1.04));
        row.push(v);
      }
      out.push(row);
    }
    out.push(st[N - 1].slice());
    return out;
  }
  function loft(stations, seg, { sub = 3, capA = true, capB = true, shape = null } = {}) {
    const st = interp(stations.map(s => [s[0], s[1], s[2], s[3], s[4], s[5] ?? 3, s[6] ?? 0]), sub);
    const pos = [], uv = [], idx = [];
    const ring = (s) => {
      const [z, yc, w, ht, hb, n, xc] = s; const pts = [];
      for (let j = 0; j <= seg; j++) {
        if (shape) { const [x, y] = shape(j % seg, seg, s); pts.push([xc + x, yc + y, z]); continue; }
        const th = (j % seg) / seg * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
        pts.push([xc + w * sgnpow(c, 2 / n), yc + (sn >= 0 ? ht : hb) * sgnpow(sn, 2 / n), z]);
      }
      return pts;
    };
    const rings = st.map(ring);
    let along = 0;
    rings.forEach((r, i) => {
      if (i) { const a = rings[i - 1][0], b = r[0]; along += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); }
      let arc = 0;
      r.forEach((p, j) => { if (j) arc += Math.hypot(p[0] - r[j - 1][0], p[1] - r[j - 1][1]); pos.push(p[0], p[1], p[2]); uv.push(arc / UVS, along / UVS); });
    });
    const R = seg + 1;
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) { const a = i * R + j, b = a + 1, c = a + R, d = c + 1; idx.push(a, c, b, b, c, d); }
    const cap = (i, nb) => {
      const r = rings[i]; let cx = 0, cy = 0; for (let j = 0; j < seg; j++) { cx += r[j][0]; cy += r[j][1]; } cx /= seg; cy /= seg;
      const want = Math.sign(r[0][2] - rings[nb][0][2]) || 1;
      // fan winding: (c, p0, p1) normal z sign = sign of cross((p0-c),(p1-c)).z
      let area = 0; for (let j = 0; j < seg; j++) { const a = r[j], b = r[(j + 1) % seg]; area += (a[0] - cx) * (b[1] - cy) - (a[1] - cy) * (b[0] - cx); }
      const rev = Math.sign(area) !== want;
      const ci = pos.length / 3; pos.push(cx, cy, r[0][2]); uv.push(0, 0);
      const base = pos.length / 3; for (let j = 0; j < seg; j++) { pos.push(r[j][0], r[j][1], r[j][2]); uv.push((r[j][0] - cx) / UVS, (r[j][1] - cy) / UVS); }
      for (let j = 0; j < seg; j++) { const a = base + j, b = base + (j + 1) % seg; if (rev) idx.push(ci, b, a); else idx.push(ci, a, b); }
    };
    // orientation check: first side quad normal must point away from the ring centre
    const p = (k) => new V3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
    const mid = Math.floor(rings.length / 2) * R, q = Math.floor(seg / 4);
    const nrm = new V3().subVectors(p(mid + R + q), p(mid + q)).cross(new V3().subVectors(p(mid + q + 1), p(mid + q)));
    let cx = 0, cy = 0; for (let j = 0; j < seg; j++) { cx += pos[(mid + j) * 3]; cy += pos[(mid + j) * 3 + 1]; } cx /= seg; cy /= seg;
    const out = new V3(pos[(mid + q) * 3] - cx, pos[(mid + q) * 3 + 1] - cy, 0);
    const flip = nrm.dot(out) < 0;
    if (flip) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    if (capA) cap(0, 1);
    if (capB) cap(rings.length - 1, rings.length - 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    // weld seam normals
    const nm = g.attributes.normal;
    for (let i = 0; i < rings.length; i++) { const a = i * R, b = a + seg; const x = nm.getX(a) + nm.getX(b), y = nm.getY(a) + nm.getY(b), z = nm.getZ(a) + nm.getZ(b), L = Math.hypot(x, y, z) || 1; nm.setXYZ(a, x / L, y / L, z / L); nm.setXYZ(b, x / L, y / L, z / L); }
    return g;
  }
  // primitives with box-projected UVs so the panel texture has consistent density everywhere
  const boxUV = (g) => {
    g = g.index ? g.toNonIndexed() : g; g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      let u, v; if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); } else if (ay >= az) { u = p.getX(i); v = p.getZ(i); } else { u = p.getX(i); v = p.getY(i); }
      uv[i * 2] = u / UVS; uv[i * 2 + 1] = v / UVS;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g;
  };
  const box = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz); g.translate(x, y, z); return boxUV(g); };
  const cylZ = (r0, r1, len, x, y, z, seg = 12) => { const g = new THREE.CylinderGeometry(r1, r0, len, seg); g.rotateX(Math.PI / 2); g.translate(x, y, z); return boxUV(g); };   // r0 at -z end, r1 at +z end
  const cylX = (r, len, x, y, z, seg = 14) => { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); g.translate(x, y, z); return boxUV(g); };
  const sph = (r, x, y, z, sx = 1, sy = 1, sz = 1, ws = 14, hs = 10) => { const g = new THREE.SphereGeometry(r, ws, hs); g.scale(sx, sy, sz); g.translate(x, y, z); return boxUV(g); };
  const bar = (a, b, r, seg = 5) => { const d = new V3().subVectors(b, a), L = d.length(); const g = new THREE.CylinderGeometry(r, r, L, seg, 1, true); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d.normalize())); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); return boxUV(g); };
  const _unusedMirror = (g) => { const m = g.clone(); m.scale(-1, 1, 1); const p = m.index ? null : m.attributes.position; if (m.index) { const ix = m.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; } } else { const pa = m.attributes.position, na = m.attributes.normal, ua = m.attributes.uv; for (let k = 0; k < pa.count; k += 3) for (const a of [pa, na, ua].filter(Boolean)) { for (let c = 0; c < a.itemSize; c++) { const t = a.getComponent ? a.getComponent(k + 1, c) : a.array[(k + 1) * a.itemSize + c]; a.array[(k + 1) * a.itemSize + c] = a.array[(k + 2) * a.itemSize + c]; a.array[(k + 2) * a.itemSize + c] = t; } } } m.computeVertexNormals(); return m; };
  const both = (fn, arr) => { for (const s of [-1, 1]) { const r = fn(s); if (Array.isArray(r)) arr.push(...r); else arr.push(r); } };

  // ---------------------------------------------------------------- fuselage
  const BODY_ST = [
    [6.42, 1.24, 0.16, 0.20, 0.24, 2.6], [6.15, 1.28, 0.36, 0.36, 0.44, 3], [5.5, 1.36, 0.47, 0.48, 0.56, 3.6], [4.6, 1.42, 0.50, 0.53, 0.62, 4],
    [3.2, 1.48, 0.52, 0.58, 0.66, 4], [2.2, 1.56, 0.55, 0.68, 0.72, 4], [1.0, 1.66, 0.6, 0.92, 0.8, 4], [0.0, 1.70, 0.62, 1.02, 0.84, 4],
    [-1.2, 1.72, 0.58, 0.94, 0.80, 4], [-2.4, 1.75, 0.47, 0.64, 0.56, 3.5], [-3.5, 1.80, 0.36, 0.45, 0.38, 3], [-5.5, 1.89, 0.27, 0.34, 0.27, 3],
    [-7.4, 1.98, 0.21, 0.27, 0.21, 3], [-8.45, 2.02, 0.15, 0.20, 0.15, 3]];
  const bodyAt = (z) => { for (let i = 0; i < BODY_ST.length - 1; i++) { const a = BODY_ST[i], b = BODY_ST[i + 1]; if (z <= a[0] && z >= b[0]) { const t = (a[0] - z) / (a[0] - b[0]); return a.map((v, k) => v + (b[k] - v) * t); } } return BODY_ST[0]; };
  const SPON_ST = [[4.35, 1.22, 0.04, 0.18, 0.18, 3], [3.8, 1.2, 0.26, 0.36, 0.36, 3.5], [1.2, 1.22, 0.32, 0.42, 0.38, 3.8], [-0.3, 1.3, 0.28, 0.40, 0.36, 3.5], [-0.95, 1.36, 0.06, 0.2, 0.2, 3]];
  const NAC_ST = (s) => [[1.05, 2.33, 0.25, 0.25, 0.24, 2.4, s * 0.93], [0.82, 2.35, 0.36, 0.37, 0.36, 2.6, s * 0.93], [-1.25, 2.36, 0.38, 0.38, 0.37, 2.6, s * 0.93], [-1.95, 2.34, 0.33, 0.33, 0.31, 2.6, s * 0.95], [-2.15, 2.33, 0.28, 0.27, 0.26, 3, s * 0.96]];
  const EXH_ST = (s) => [[-1.98, 2.4, 0.24, 0.3, 0.26, 5, s * 0.98], [-2.45, 2.44, 0.27, 0.32, 0.27, 6, s * 1.2], [-2.92, 2.48, 0.29, 0.31, 0.26, 6, s * 1.44]];
  const DOG_ST = [[1.25, 2.55, 0.18, 0.2, 0.2, 3], [0.9, 2.62, 0.44, 0.42, 0.25, 3.4], [-1.1, 2.66, 0.46, 0.42, 0.28, 3.4], [-2.2, 2.55, 0.32, 0.22, 0.2, 3], [-2.7, 2.45, 0.1, 0.1, 0.1, 3]];
  const FIN_ST = (sh) => [[-6.9, 2.02, 0.06, 0.12, 0.1, 2.6], [-7.35, 2.5, 0.08, 0.5, 0.5, 2.6], [-8.0, 3.15, 0.08, 0.6, 0.6, 2.6], [-8.55, 3.55, 0.07, 0.34, 0.32, 2.6], [-8.88, 3.74, 0.04, 0.13, 0.13, 2.2]];

  function canopyGlass(seg = 8) {
    // faceted tandem canopy: trapezoid section, flat panes; sill follows the fuselage
    const CAN = [[5.3, 0.30, 0.03], [4.78, 0.44, 0.40], [3.45, 0.47, 0.44], [3.22, 0.48, 0.46], [2.8, 0.49, 0.75], [1.6, 0.49, 0.73], [0.98, 0.45, 0.52]];
    const st = CAN.map(([z, w, ht]) => { const b = bodyAt(z), sill = b[1] + b[3] * Math.pow(1 - Math.pow(Math.min(0.99, w / b[2]), b[5]), 1 / b[5]) - 0.03; return [z, sill, w, ht, 0.22, 3, 0]; });
    const shape = (j, n, s) => {
      const [, , w, ht, hb] = s; const P = [[w, 0], [w * 0.7, ht * 0.9], [w * 0.22, ht], [-w * 0.22, ht], [-w * 0.7, ht * 0.9], [-w, 0], [-w * 0.8, -hb], [w * 0.8, -hb]];
      return P[j % P.length];
    };
    let g = loft(st, 8, { sub: 1, shape });
    g = g.toNonIndexed(); g.computeVertexNormals();   // flat panes
    // frames: along the pane edges + across the bulkheads
    const fr = [];
    const pt = (s, j) => { const [x, y] = shape(j, 8, s); return new V3(x, s[1] + y, s[0]); };
    for (let i = 0; i < st.length - 1; i++) for (const j of [0, 1, 2, 3, 4, 5]) fr.push(bar(pt(st[i], j), pt(st[i + 1], j), 0.028));
    for (const i of [1, 3, 4, st.length - 1]) for (let j = 0; j < 5; j++) fr.push(bar(pt(st[i], j), pt(st[i], j + 1), 0.032));
    // pilot/gunner side door frames
    for (const s of [-1, 1]) for (const z of [4.1, 2.2]) { const b = st.find(q => q[0] < z) || st[st.length - 1]; const y0 = b[1], h = b[3] * 0.9; fr.push(bar(new V3(s * b[2] * 1.0, y0, z), new V3(s * b[2] * 0.7, y0 + h, z), 0.022)); }
    return { glass: g, frames: fr, st };
  }

  function weapons(s) {
    const D = [], B = [], M = [], Gl = [];
    // pylons
    for (const px of [1.38, 2.18]) B.push(box(0.12, 0.34, 0.78, s * px, 1.52, 0.3));
    // inboard: M261 19-shot Hydra pod
    { const x = s * 1.38, y = 1.13, z = 0.32, L = 1.56;
      B.push(cylZ(0.2, 0.2, L, x, y, z, 16)); B.push(sph(0.2, x, y, z + L / 2, 1, 1, 0.35, 16, 8)); D.push(cylZ(0.2, 0.17, 0.14, x, y, z - L / 2 - 0.07, 16));
      const hx = [[0, 0]]; for (let k = 0; k < 6; k++) hx.push([Math.cos(k * Math.PI / 3) * 0.075, Math.sin(k * Math.PI / 3) * 0.075]); for (let k = 0; k < 12; k++) hx.push([Math.cos(k * Math.PI / 6 + 0.26) * 0.145, Math.sin(k * Math.PI / 6 + 0.26) * 0.145]);
      for (const [a, b] of hx) D.push(cylZ(0.028, 0.028, 0.05, x + a, y + b, z + L / 2 + 0.05, 6));
      B.push(box(0.05, 0.42, 0.06, x, y, z + 0.5)); B.push(box(0.05, 0.42, 0.06, x, y, z - 0.5)); }
    // outboard: M299 launcher, 4 x AGM-114 Hellfire
    { const x = s * 2.18, z = 0.3;
      D.push(box(0.1, 0.62, 0.9, x, 1.12, z)); D.push(box(0.56, 0.06, 1.25, x, 1.2, z)); D.push(box(0.56, 0.06, 1.25, x, 0.86, z));
      for (const dx of [-0.17, 0.17]) for (const y of [1.08, 0.74]) {
        const mx = x + dx, L = 1.63, z0 = z - 0.12;
        M.push(cylZ(0.089, 0.089, L, mx, y, z0, 10));
        Gl.push(sph(0.089, mx, y, z0 + L / 2, 1, 1, 1.25, 10, 6));
        for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; M.push(box(0.012, 0.12, 0.2, mx + Math.cos(a) * 0.12, y + Math.sin(a) * 0.12, z0 + L / 2 - 0.35, 0, 0, a)); M.push(box(0.012, 0.15, 0.24, mx + Math.cos(a) * 0.13, y + Math.sin(a) * 0.13, z0 - L / 2 + 0.16, 0, 0, a)); }
        M.push(cylZ(0.092, 0.092, 0.05, mx, y, z0 + 0.25, 10));   // band
      } }
    return { D, B, M, Gl };
  }

  function mainGear(s) {
    const D = [], R = [], B = [];
    const ax = new V3(s * 1.0, 0.4, 2.72);
    const top = new V3(s * 0.66, 1.0, 3.2), brace = new V3(s * 0.66, 0.92, 2.35);
    B.push(box(0.26, 0.24, 0.5, s * 0.66, 0.98, 3.05));
    { const g = bar(top, new V3().lerpVectors(top, ax, 0.55), 0.085, 10); D.push(g); D.push(bar(new V3().lerpVectors(top, ax, 0.5), ax, 0.058, 10)); }
    D.push(bar(brace, ax, 0.05, 8));
    const tire = new THREE.TorusGeometry(0.3, 0.105, 12, 26); tire.rotateY(Math.PI / 2); tire.translate(ax.x + s * 0.07, ax.y, ax.z); R.push(tire);
    D.push(cylX(0.215, 0.2, ax.x + s * 0.07, ax.y, ax.z, 16)); D.push(cylX(0.08, 0.26, ax.x + s * 0.07, ax.y, ax.z, 8));
    return { D, R, B };
  }

  function buildHi() {
    const B = [], D = [], Gl = [], M = [], R = [], T = [], L = [];
    const body = loft(BODY_ST, 28, { sub: 4 }); B.push(body);
    both(s => loft(SPON_ST.map(r => [...r, s * 0.53]), 22, { sub: 3 }), B);
    both(s => loft(NAC_ST(s), 20, { sub: 3 }), B);
    both(s => loft(EXH_ST(s), 12, { sub: 2 }), B);
    both(s => box(0.5, 0.52, 0.03, s * 1.44, 2.48, -2.935), D);                         // black-hole exhaust openings
    both(s => cylZ(0.21, 0.21, 0.06, s * 0.93, 2.33, 1.07, 16), D);   // intakes + engine shoulders
    both(s => box(0.42, 0.34, 2.0, s * 0.72, 2.2, -0.45), B);
    B.push(loft(DOG_ST, 18, { sub: 2 }));
    // mast, hub plumbing
    { const g = new THREE.CylinderGeometry(0.15, 0.2, 0.9, 12); g.translate(0, 3.35, 0); D.push(boxUV(g)); }
    // Longbow radome on the mast
    { const g = new THREE.CylinderGeometry(0.09, 0.11, 0.55, 8); g.translate(0, 4.15, 0); D.push(boxUV(g)); }
    B.push(sph(0.5, 0, 4.58, 0, 1, 0.5, 1, 22, 12)); { const g = new THREE.CylinderGeometry(0.5, 0.42, 0.2, 22); g.translate(0, 4.42, 0); B.push(boxUV(g)); }
    // IR jammer + antennas + wire cutters
    { const g = new THREE.CylinderGeometry(0.17, 0.17, 0.32, 10); g.translate(0, 3.12, -1.75); D.push(boxUV(g)); }
    D.push(box(0.025, 0.2, 0.28, 0, 2.36, -3.4, 0.35)); D.push(box(0.025, 0.18, 0.25, 0, 0.82, 1.0, -0.35)); D.push(box(0.025, 0.16, 0.24, 0, 1.55, -5.0, -0.35));
    D.push(box(0.04, 0.34, 0.08, 0, 2.18, 5.15, -0.5)); D.push(box(0.04, 0.3, 0.07, 0, 0.62, 5.25, 0.6));
    // canopy + frames + cockpit tub, crew
    const can = canopyGlass(); Gl.push(can.glass); B.push(...can.frames);
    D.push(box(0.84, 0.3, 4.0, 0, can.st[2][1] - 0.05, 3.1));
    for (const [z, y] of [[4.0, can.st[2][1] - 0.02], [2.15, can.st[5][1] + 0.18]]) {
      D.push(box(0.5, 0.75, 0.12, 0, y - 0.25, z - 0.32));                 // seat back
      M.push(sph(0.145, 0, y + 0.26, z - 0.04, 1, 1.08, 1.12, 12, 8));      // helmet
      D.push(box(0.38, 0.5, 0.26, 0, y - 0.1, z - 0.12));                    // torso
      D.push(box(0.5, 0.12, 0.3, 0, y - 0.05, z + 0.55));                    // glareshield/panel
    }
    // nose: TADS turret + day/night sensor ears + PNVS
    D.push(cylX(0.28, 0.48, 0, 1.1, 6.6, 22));
    for (const s of [-1, 1]) { B.push(box(0.16, 0.4, 0.5, s * 0.32, 1.1, 6.6)); B.push(cylX(0.2, 0.16, s * 0.32, 1.1, 6.62, 14)); Gl.push(box(0.12, 0.14, 0.03, s * 0.32, 1.16, 6.86)); Gl.push(box(0.08, 0.08, 0.03, s * 0.32, 0.98, 6.86)); }
    B.push(sph(0.2, 0, 1.62, 6.42, 1, 1, 1, 14, 10)); Gl.push(box(0.16, 0.12, 0.03, 0, 1.62, 6.62));
    B.push(box(0.36, 0.16, 0.4, 0, 1.48, 6.3));
    // M230 chain gun
    D.push(sph(0.24, 0, 0.78, 4.5, 1, 0.9, 1, 14, 10)); D.push(box(0.2, 0.2, 0.7, 0, 0.72, 4.95));
    D.push(cylZ(0.05, 0.05, 1.3, 0, 0.72, 5.75, 10)); D.push(cylZ(0.072, 0.072, 0.24, 0, 0.72, 6.35, 10)); D.push(box(0.12, 0.08, 1.2, 0.12, 0.92, 4.0));
    // stub wings (span along x) + tip lights
    { const w = loft([[-2.62, 0, 0.42, 0.06, 0.05, 2.4], [-1.6, 0, 0.47, 0.07, 0.06, 2.4], [0, 0, 0.5, 0.08, 0.07, 2.4], [1.6, 0, 0.47, 0.07, 0.06, 2.4], [2.62, 0, 0.42, 0.06, 0.05, 2.4]], 14, { sub: 1 });
      w.rotateY(Math.PI / 2); w.translate(0, 1.74, 0.28); B.push(w); }
    for (const s of [-1, 1]) { T.push(box(0.06, 0.13, 0.86, s * 2.64, 1.74, 0.28)); L.push(sph(0.05, s * 2.68, 1.74, 0.62, 1, 1, 1.5, 8, 6), s > 0 ? 'r' : 'g'); }
    both(s => { const w = weapons(s); D.push(...w.D); M.push(...w.M); Gl.push(...w.Gl); return w.B; }, B);
    // landing gear
    both(s => { const g = mainGear(s); D.push(...g.D); R.push(...g.R); return g.B; }, B);
    { D.push(bar(new V3(0, 1.85, -7.25), new V3(0, 0.22, -7.62), 0.075, 8)); B.push(box(0.16, 0.5, 0.42, 0, 1.62, -7.3, -0.2)); D.push(box(0.2, 0.08, 0.45, 0, 0.28, -7.6)); const t = new THREE.TorusGeometry(0.15, 0.065, 10, 18); t.rotateY(Math.PI / 2); t.translate(0, 0.22, -7.62); R.push(t); D.push(cylX(0.1, 0.12, 0, 0.22, -7.62, 10)); }
    // steps / handholds / pitot
    for (const s of [-1, 1]) { D.push(box(0.12, 0.04, 0.3, s * 0.86, 1.05, 3.6)); D.push(box(0.12, 0.04, 0.3, s * 0.88, 1.45, 2.4)); D.push(bar(new V3(s * 0.45, 2.15, 4.6), new V3(s * 0.62, 2.18, 5.3), 0.018, 5)); }
    // tail: vertical fin (swept), tail-rotor gearbox, stabilator, team band + fin tip
    { const f = loft(FIN_ST(1), 10, { sub: 2 }); B.push(f); }
    B.push(sph(0.2, 0.2, 3.2, -8.15, 1, 1, 1.3, 12, 8));
    { const s = loft([[-1.7, 0, 0.35, 0.05, 0.04, 2.4], [1.7, 0, 0.36, 0.05, 0.04, 2.4]], 10, { sub: 1 }); s.rotateY(Math.PI / 2); s.translate(0, 1.62, -8.6); B.push(s); }
    for (const s of [-1, 1]) B.push(box(0.05, 0.28, 0.72, s * 1.7, 1.68, -8.6));
    B.push(box(0.12, 0.34, 0.5, 0, 1.8, -8.5));
    { const b = bodyAt(-6.0); T.push(loft([[-5.8, b[1], b[2] + 0.012, b[3] + 0.012, b[4] + 0.012, 3], [-6.4, b[1] + 0.02, b[2] + 0.004, b[3] + 0.004, b[4] + 0.004, 3]], 24, { sub: 1, capA: false, capB: false })); }
    T.push(loft([[-8.62, 3.62, 0.12, 0.2, 0.2, 2.2], [-8.95, 3.78, 0.07, 0.1, 0.1, 2]], 10, { sub: 1 }));
    L.push(sph(0.06, 0, 3.92, -8.95, 1, 1, 1, 8, 6), 'w'); L.push(sph(0.05, 0, 0.62, -1.5, 1, 0.6, 1, 8, 6), 'a');
    // lights get vertex colours
    const lg = []; for (let i = 0; i < L.length; i += 2) { const g = keep(L[i]); const c = { r: [1, 0.08, 0.05], g: [0.1, 1, 0.25], w: [1, 1, 1], a: [1, 0.15, 0.08] }[L[i + 1]]; const col = new Float32Array(g.attributes.position.count * 3); for (let k = 0; k < col.length; k += 3) col.set(c, k); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); lg.push(g); }
    const lights = mergeGeometries(lg); lights.scale(K, K, K);
    return { body: merge(B), dark: merge(D), glass: merge(Gl), missile: merge(M), rubber: merge(R), team: merge(T), lights };
  }

  function buildLo() {
    const B = [], D = [], Gl = [];
    B.push(loft(BODY_ST, 10, { sub: 1 }));
    both(s => loft(SPON_ST.map(r => [...r, s * 0.53]), 8, { sub: 1 }), B);
    both(s => loft(NAC_ST(s), 8, { sub: 1 }), B);
    B.push(loft(DOG_ST, 8, { sub: 1 }));
    B.push(loft(FIN_ST(1), 6, { sub: 1 }));
    B.push(sph(0.5, 0, 4.58, 0, 1, 0.5, 1, 10, 6));
    B.push(box(5.24, 0.12, 0.92, 0, 1.74, 0.28)); B.push(box(3.4, 0.08, 0.7, 0, 1.6, -8.55));
    for (const s of [-1, 1]) { D.push(box(0.4, 0.4, 1.6, s * 1.38, 1.13, 0.32)); D.push(box(0.5, 0.5, 1.6, s * 2.18, 0.95, 0.3)); D.push(box(0.2, 0.75, 0.75, s * 1.05, 0.4, 2.72)); }
    D.push(box(0.75, 0.6, 0.6, 0, 1.12, 6.62)); D.push(box(0.12, 0.12, 1.4, 0, 0.72, 5.5));
    { const c = canopyGlass(); Gl.push(c.glass); }
    return { body: merge(B), dark: merge(D), glass: merge(Gl) };
  }

  // ---------------------------------------------------------------- rotors (shared by LODs; spin in the game loop)
  function blade(len, chord, thick, r0, sweep, droop) {
    const st = [[r0, 0, chord * 0.3, thick * 0.9, thick * 0.9, 2.2, 0], [r0 + 0.25, 0, chord * 0.5, thick, thick * 0.8, 2.2, 0],
      [len - 0.55, -droop * 0.85, chord * 0.5, thick * 0.75, thick * 0.5, 2.2, 0], [len - 0.2, -droop * 0.97, chord * 0.42, thick * 0.6, thick * 0.4, 2.2, -sweep * 0.6], [len, -droop, chord * 0.2, thick * 0.4, thick * 0.3, 2.2, -sweep]];
    return loft(st, 10, { sub: 2 });
  }
  function buildRotor(lo) {
    const parts = [];
    for (let i = 0; i < 4; i++) { const g = blade(7.31, 0.53, 0.045, 0.75, 0.22, 0.12); g.rotateY(Math.PI / 2); g.rotateY(i * Math.PI / 2 + 0.03); parts.push(g); }
    if (!lo) {
      { const g = new THREE.CylinderGeometry(0.32, 0.36, 0.26, 16); parts.push(boxUV(g)); }
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.03; const g = new THREE.BoxGeometry(0.62, 0.16, 0.2); g.translate(0.55, 0, 0); g.rotateY(a); parts.push(boxUV(g));
        const pl = new THREE.CylinderGeometry(0.025, 0.025, 0.38, 5); pl.translate(0.42, -0.25, 0.14); pl.rotateY(a); parts.push(boxUV(pl)); }
      { const g = new THREE.CylinderGeometry(0.42, 0.42, 0.06, 18); g.translate(0, -0.42, 0); parts.push(boxUV(g)); }
    }
    const g = mergeGeometries(parts.map(keep)); g.scale(K, K, K); g.computeBoundingSphere(); return g;
  }
  function buildTail() {
    const parts = [];
    // scissor rotor: two 2-blade pairs at 55 deg, blades in the YZ plane (axis = X)
    for (const [a0, off] of [[0, -0.05], [55 * Math.PI / 180, 0.05]]) for (const k of [0, Math.PI]) {
      const g = loft([[0.16, 0, 0.03, 0.12, 0.12, 2.2], [1.25, 0, 0.022, 0.125, 0.125, 2.2], [1.4, 0, 0.015, 0.09, 0.09, 2.2]], 8, { sub: 1 });
      g.rotateX(-Math.PI / 2); g.rotateX(a0 + k); g.translate(off, 0, 0); parts.push(g);
    }
    { const g = new THREE.CylinderGeometry(0.13, 0.13, 0.26, 10); g.rotateZ(Math.PI / 2); parts.push(boxUV(g)); }
    const g = mergeGeometries(parts.map(keep)); g.scale(K, K, K); return g;
  }

  // ---------------------------------------------------------------- textures (generated once)
  const TS = mobile ? 512 : 1024;
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  let seed = 7; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  function panelTextures() {
    const S = TS, f = S / 1024;
    const alb = mk(S, S), hgt = mk(S, S), orm = mk(S, S);
    const a = alb.getContext('2d', { willReadFrequently: true }), h = hgt.getContext('2d', { willReadFrequently: true }), o = orm.getContext('2d');
    a.fillStyle = '#3e4428'; a.fillRect(0, 0, S, S);
    h.fillStyle = '#808080'; h.fillRect(0, 0, S, S);
    o.fillStyle = 'rgb(255,168,26)'; o.fillRect(0, 0, S, S);       // R unused, G roughness ~0.66, B metal ~0.1
    const wrap = (fn) => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) fn(dx, dy); };
    // mottled paint (low-frequency), faded patches, darker grime
    for (let i = 0; i < 260; i++) {
      const x = rand() * S, y = rand() * S, r = (30 + rand() * 140) * f, l = rand();
      wrap((dx, dy) => { const g = a.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r); const c = l < 0.45 ? `rgba(18,22,8,${0.05 + rand() * 0.08})` : l < 0.85 ? `rgba(92,98,62,${0.04 + rand() * 0.07})` : `rgba(70,60,40,${0.06 + rand() * 0.06})`; g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)'); a.fillStyle = g; a.fillRect(x + dx - r, y + dy - r, r * 2, r * 2); });
      wrap((dx, dy) => { const g = o.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r); g.addColorStop(0, l < 0.5 ? 'rgba(255,200,26,.25)' : 'rgba(255,130,26,.2)'); g.addColorStop(1, 'rgba(255,168,26,0)'); o.fillStyle = g; o.fillRect(x + dx - r, y + dy - r, r * 2, r * 2); });
    }
    // fine paint grain
    { const id = a.getImageData(0, 0, S, S), d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (rand() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.7; } a.putImageData(id, 0, 0); }
    { const id = h.getImageData(0, 0, S, S), d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (rand() - 0.5) * 6; d[i] += n; d[i + 1] += n; d[i + 2] += n; } h.putImageData(id, 0, 0); }
    // panels: seamless columns of random-height panels; recessed seams, rivet rows, scuffs along edges
    const line = (x0, y0, x1, y1) => wrap((dx, dy) => {
      a.strokeStyle = 'rgba(12,14,6,.75)'; a.lineWidth = 2.2 * f; a.beginPath(); a.moveTo(x0 + dx, y0 + dy); a.lineTo(x1 + dx, y1 + dy); a.stroke();
      a.strokeStyle = 'rgba(110,116,80,.35)'; a.lineWidth = 1.2 * f; a.beginPath(); a.moveTo(x0 + dx + 1.6 * f, y0 + dy + 1.6 * f); a.lineTo(x1 + dx + 1.6 * f, y1 + dy + 1.6 * f); a.stroke();
      h.strokeStyle = '#2a2a2a'; h.lineWidth = 3 * f; h.beginPath(); h.moveTo(x0 + dx, y0 + dy); h.lineTo(x1 + dx, y1 + dy); h.stroke();
      o.strokeStyle = 'rgb(255,220,26)'; o.lineWidth = 3 * f; o.beginPath(); o.moveTo(x0 + dx, y0 + dy); o.lineTo(x1 + dx, y1 + dy); o.stroke();
    });
    const rivets = (x0, y0, x1, y1, off) => { const L = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(L / (11 * f)); const nx = -(y1 - y0) / L * off, ny = (x1 - x0) / L * off; for (let k = 1; k < n; k++) { const t = k / n, x = x0 + (x1 - x0) * t + nx, y = y0 + (y1 - y0) * t + ny; wrap((dx, dy) => { h.fillStyle = '#c8c8c8'; h.beginPath(); h.arc(x + dx, y + dy, 1.6 * f, 0, 7); h.fill(); a.fillStyle = 'rgba(80,86,56,.55)'; a.fillRect(x + dx - f, y + dy - f, 2 * f, 2 * f); }); } };
    const cols = []; { let x = 0; while (x < S - 60 * f) { cols.push(x); x += (90 + rand() * 170) * f; } }
    cols.forEach((x, i) => {
      const x1 = i + 1 < cols.length ? cols[i + 1] : S;
      line(x, 0, x, S); rivets(x, 0, x, S, 5 * f); if (rand() < 0.5) rivets(x, 0, x, S, -5 * f);
      let y = rand() * 80 * f; while (y < S) { const y1 = y + (80 + rand() * 220) * f; line(x, y, x1, y); rivets(x, y, x1, y, 5 * f); 
        if (rand() < 0.35) { const px = x + (x1 - x) * (0.2 + rand() * 0.5), py = y + 20 * f, pw = (20 + rand() * 40) * f, ph = (14 + rand() * 30) * f; line(px, py, px + pw, py); line(px + pw, py, px + pw, py + ph); line(px + pw, py + ph, px, py + ph); line(px, py + ph, px, py); for (const [qx, qy] of [[px + 4 * f, py + 4 * f], [px + pw - 4 * f, py + 4 * f], [px + 4 * f, py + ph - 4 * f], [px + pw - 4 * f, py + ph - 4 * f]]) wrap((dx, dy) => { h.fillStyle = '#d0d0d0'; h.beginPath(); h.arc(qx + dx, qy + dy, 2.2 * f, 0, 7); h.fill(); }); }
        y = y1; }
    });
    // edge wear + scratches (bare-ish metal, smoother)
    for (let i = 0; i < 140; i++) { const x = rand() * S, y = rand() * S, L = (6 + rand() * 40) * f, ang = rand() * 6.28; wrap((dx, dy) => { a.strokeStyle = `rgba(120,118,98,${0.15 + rand() * 0.25})`; a.lineWidth = 0.8 * f; a.beginPath(); a.moveTo(x + dx, y + dy); a.lineTo(x + dx + Math.cos(ang) * L, y + dy + Math.sin(ang) * L); a.stroke(); o.strokeStyle = 'rgb(255,110,130)'; o.lineWidth = 0.8 * f; o.beginPath(); o.moveTo(x + dx, y + dy); o.lineTo(x + dx + Math.cos(ang) * L, y + dy + Math.sin(ang) * L); o.stroke(); }); }
    // oil/exhaust streaks running along one axis
    for (let i = 0; i < 40; i++) { const x = rand() * S, y = rand() * S, L = (60 + rand() * 260) * f, w = (2 + rand() * 7) * f; wrap((dx, dy) => { const g = a.createLinearGradient(x + dx, y + dy, x + dx, y + dy + L); g.addColorStop(0, 'rgba(14,14,8,.22)'); g.addColorStop(1, 'rgba(14,14,8,0)'); a.fillStyle = g; a.fillRect(x + dx, y + dy, w, L); }); }
    // height -> normal map
    const nrm = mk(S, S); { const hd = h.getImageData(0, 0, S, S).data, nc = nrm.getContext('2d'), id = nc.createImageData(S, S), d = id.data; const H = (x, y) => hd[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255; const st = 3.2;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const dx = (H(x - 1, y) - H(x + 1, y)) * st, dy = (H(x, y - 1) - H(x, y + 1)) * st; const L = Math.hypot(dx, dy, 1), k = (y * S + x) * 4; d[k] = (dx / L * 0.5 + 0.5) * 255; d[k + 1] = (-dy / L * 0.5 + 0.5) * 255; d[k + 2] = (1 / L * 0.5 + 0.5) * 255; d[k + 3] = 255; }
      nc.putImageData(id, 0, 0); }
    const T = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = mobile ? 4 : 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; return t; };
    return { map: T(alb, true), normalMap: T(nrm, false), ormMap: T(orm, false) };
  }
  const tex = panelTextures();
  const bodyMat = new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), roughnessMap: tex.ormMap, metalnessMap: tex.ormMap, roughness: 1, metalness: 1, envMapIntensity: 0.85 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x23251f, roughness: 0.42, metalness: 0.7, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 0.9 });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.93, metalness: 0 });
  const missileMat = new THREE.MeshStandardMaterial({ color: 0x4a4f30, roughness: 0.55, metalness: 0.25, envMapIntensity: 0.9 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x16242a, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.62, envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.04, specularIntensity: 1, depthWrite: false });
  const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x1c1e1c, roughness: 0.5, metalness: 0.35, side: THREE.DoubleSide, envMapIntensity: 0.8 });
  const glassLoMat = new THREE.MeshStandardMaterial({ color: 0x0e1418, roughness: 0.1, metalness: 0.85, envMapIntensity: 1.5 });

  const HI = buildHi(), LO = buildLo();
  const rotorG = buildRotor(false), rotorLoG = buildRotor(true), tailG = buildTail();
  const discG = new THREE.CircleGeometry(7.4 * K, 48); discG.rotateX(-Math.PI / 2);
  const tdiscG = new THREE.CircleGeometry(1.42 * K, 24); tdiscG.rotateY(Math.PI / 2);
  const ROTOR_POS = new V3(0, 3.86 * K, 0), TROTOR_POS = new V3(0.42 * K, 3.2 * K, -8.15 * K);

  // per-heli tail-boom decal: tactical number in team colour + stencil text
  function decalTex(num, name, col) {
    const c = mk(512, 112), g = c.getContext('2d');
    const hex = '#' + new THREE.Color(col).getHexString();
    g.font = '900 96px "Arial Black", Arial, sans-serif'; g.textBaseline = 'middle';
    g.lineWidth = 8; g.strokeStyle = hex; g.strokeText(String(num), 10, 60); g.fillStyle = '#121410'; g.fillText(String(num), 10, 60);
    g.fillStyle = 'rgba(18,20,14,.92)'; g.font = '800 26px "Arial Narrow", Arial, sans-serif'; g.fillText('HIMALAYA AIR CAV', 210, 38);
    g.font = '700 20px Arial, sans-serif'; g.fillText(String(name).toUpperCase() + '  ·  AH-64D', 210, 74);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  }
  const decalG = (() => {
    const b = bodyAt(-4.6), ps = [];
    for (const s of [-1, 1]) { const g = new THREE.PlaneGeometry(2.3, 0.56); g.rotateY(s * Math.PI / 2);
      const w = b[2] * Math.pow(1 - Math.pow(0.2, b[5]), 1 / b[5]) + 0.012; g.rotateY(s * 0.045); g.translate(s * w, b[1] + 0.06, -4.6); ps.push(g); }
    const g = mergeGeometries(ps); g.scale(K, K, K); return g;
  })();

  function make(col, num, name, shadows) {
    const root = new THREE.Group(); root.rotation.order = 'YXZ';
    const lod = new THREE.LOD(); root.add(lod);
    const hi = new THREE.Group(), lo = new THREE.Group();
    const tm = new THREE.MeshStandardMaterial({ color: col, roughness: 0.45, metalness: 0.15, emissive: new THREE.Color(col).multiplyScalar(0.1) });
    const add = (grp, g, m, cast) => { const o = new THREE.Mesh(g, m); o.castShadow = !!cast && shadows; o.receiveShadow = false; grp.add(o); return o; };
    add(hi, HI.body, bodyMat, true); add(hi, HI.dark, darkMat, true); add(hi, HI.rubber, rubberMat); add(hi, HI.missile, missileMat, true); add(hi, HI.team, tm);
    const strobe = add(hi, HI.lights, lightMat);
    const dm = new THREE.MeshStandardMaterial({ map: decalTex(num, name, col), transparent: true, roughness: 0.6, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
    add(hi, decalG, dm);
    add(hi, HI.glass, glassMat).renderOrder = 2;
    add(lo, LO.body, bodyMat, true); add(lo, LO.dark, darkMat); add(lo, LO.glass, glassLoMat);
    lod.addLevel(hi, 0); lod.addLevel(lo, mobile ? 150 : 260);
    const rotor = new THREE.Mesh(rotorG, bladeMat); rotor.position.copy(ROTOR_POS); rotor.castShadow = shadows; root.add(rotor);
    const trotor = new THREE.Mesh(tailG, bladeMat); trotor.position.copy(TROTOR_POS); root.add(trotor);
    return { root, rotor, trotor, tm, lod, hi, lo, strobe };
  }
  return { make, discG, tdiscG, ROTOR_POS, TROTOR_POS, K, rotorLoG, mats: { bodyMat, darkMat, glassMat, bladeMat } };
}
