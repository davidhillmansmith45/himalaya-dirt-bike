// Pro MX rider: CC0 MakeHuman/MPFB base body (Innerscene "Human base mesh with editable 53-bone rig"),
// dressed procedurally in MX gear (jersey/pants/boots/gloves, helmet + goggles + neck brace),
// posed on the bike with analytic two-bone IK so hands stay on the grips and boots on the pegs.
// Bike-root space: travel -Z, right +X, up +Y (same as finalizeGlbBike).
export function makeRider(gltf, THREE, opts = {}) {
  const S = opts.scale || 1.23;
  const P = Object.assign({
    pelvis: [0, 1.28, 0.28],          // hips (standing attack, butt just over the seat)
    gripL: [-0.415, 1.215, -0.425], gripR: [0.415, 1.215, -0.425],
    pegL: [-0.27, 0.43, -0.02], pegR: [0.27, 0.43, -0.02],
    lean: 1.32, headUp: 1.15
  }, opts.pose || {});
  const root = gltf.scene;
  let mesh = null; const bones = {};
  root.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; if (o.isBone) bones[o.name] = o; });
  root.updateMatrixWorld(true);

  // ---------- bind-space data (root frame, metres, facing +Z)
  const bindQ = {}, bindP = {};
  for (const n in bones) { bindQ[n] = bones[n].getWorldQuaternion(new THREE.Quaternion()); bindP[n] = bones[n].getWorldPosition(new THREE.Vector3()); }
  const restQ = {}; for (const n in bones) restQ[n] = bones[n].quaternion.clone();
  const sub = (a, b) => bindP[a].clone().sub(bindP[b]).normalize();

  // ---------- dress the body: inflate gear along normals + per-region shader colours
  const geo = mesh.geometry;
  // de-interleave (GLTFLoader may hand us interleaved attributes)
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.attributes[name];
    if (a.isInterleavedBufferAttribute) {
      const arr = new a.array.constructor(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.getComponent ? a.getComponent(i, c) : [a.getX(i), a.getY(i), a.getZ(i), a.getW(i)][c];
      geo.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
    }
  }
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const bind = new Float32Array(pos.array);
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ax = Math.abs(x);
    let d;
    if (ax > 0.43 && y > 0.8) d = 0.007;                                   // gloves
    else if (y > 1.44) d = 0.0;                                             // head (under helmet)
    else if (y > 0.97 || ax > 0.28) {                                       // jersey (+ chest/back protector)
      d = 0.014 + 0.012 * ss(1.05, 1.2, y) * (1 - ss(1.36, 1.42, y)) * (ax < 0.2 ? 1 : 0.4);
      if (ax > 0.2 && ax < 0.42) d += 0.006;                                // baggy sleeves
    } else if (y > 0.43) {                                                  // pants (+ knee braces)
      d = 0.017 + 0.022 * ss(0.40, 0.47, y) * (1 - ss(0.56, 0.66, y));
    } else {                                                                // boots
      d = 0.03 + 0.01 * (1 - ss(0.05, 0.15, y)) - 0.012 * ss(0.36, 0.43, y) * 0;
    }
    pos.setXYZ(i, x + nor.getX(i) * d, y + nor.getY(i) * d, z + nor.getZ(i) * d);
  }
  pos.needsUpdate = true;
  geo.setAttribute('aBind', new THREE.BufferAttribute(bind, 3));
  geo.computeBoundingSphere();

  const gearMat = makeGearMaterial(THREE, opts.gear || {});
  mesh.material = gearMat;
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;

  // ---------- helmet / goggles / neck brace in bind space, parented to bones
  const attach = (boneName, obj) => {
    const holder = new THREE.Object3D();
    const inv = bones[boneName].matrixWorld.clone().invert();
    inv.decompose(holder.position, holder.quaternion, holder.scale);
    holder.add(obj); bones[boneName].add(holder); return holder;
  };
  const C = new THREE.Vector3(0, 1.588, 0.035);
  const helmet = new THREE.Group();
  {
    const g = new THREE.SphereGeometry(1, 56, 40);
    const pa = g.attributes.position; const col = [];
    const ORG = [1.0, 0.28, 0.02], BLK = [0.03, 0.03, 0.035], WHT = [0.9, 0.9, 0.9];
    for (let i = 0; i < pa.count; i++) {
      let dx = pa.getX(i), dy = pa.getY(i), dz = pa.getZ(i);
      let x = dx * 0.138, y = dy * 0.152, z = dz * 0.168;
      // chin bar: pull the lower front forward + down into a beak
      const chin = Math.max(0, dz) * Math.max(0, 0.15 - dy) ;
      z += chin * 0.085; y -= chin * 0.03;
      x *= 1 - 0.25 * Math.max(0, dz) * Math.max(0, -dy);           // taper the chin
      // flat open bottom
      y = Math.max(y, -0.118 + Math.max(0, dz) * -0.02);
      // slight rear spoiler lip
      if (dz < -0.5 && dy < -0.3 && dy > -0.6) z -= 0.008;
      pa.setXYZ(i, x + C.x, y + C.y, z + C.z);
      let c = WHT;
      if (Math.abs(dx) < 0.2 && dy > -0.1) c = ORG;                 // top centre stripe
      if (Math.abs(dx) > 0.2 && Math.abs(dx) < 0.27 && dy > 0) c = BLK;
      if (dy < -0.35 && dz < 0.5) c = BLK;                            // lower shell
      if (dz > 0.55 && dy < 0.0) c = ORG;                             // chin bar
      if (dz > 0.8 && dy < -0.15 && dy > -0.45 && Math.abs(dx) < 0.22) c = [0.12, 0.12, 0.12]; // mouth vent
      col.push(...c);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const shell = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.1 }));
    shell.castShadow = true; helmet.add(shell);
    // goggles: frame + iridium lens over the eye port, strap round the shell
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.5 });
    const lensMat = new THREE.MeshPhysicalMaterial({ color: 0xffa040, metalness: 0.75, roughness: 0.06, clearcoat: 1, envMapIntensity: 2.0, emissive: 0x401800, emissiveIntensity: 0.6 });
    const lensG = new THREE.SphereGeometry(1, 32, 12, Math.PI / 2 - 0.62, 1.24, Math.PI / 2 - 0.30, 0.34);
    lensG.scale(0.152, 0.164, 0.198); lensG.translate(C.x, C.y + 0.004, C.z);
    // SphereGeometry phi measured from +X around Y; rotate so the patch faces +Z
    const lens = new THREE.Mesh(lensG, lensMat); lens.rotation.y = 0; helmet.add(lens);
    const frameG = new THREE.SphereGeometry(1, 32, 14, Math.PI / 2 - 0.70, 1.40, Math.PI / 2 - 0.36, 0.46);
    frameG.scale(0.149, 0.161, 0.192); frameG.translate(C.x, C.y + 0.004, C.z);
    helmet.add(new THREE.Mesh(frameG, frameMat));
    const strap = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.032, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.7, side: THREE.DoubleSide }));
    strap.scale.set(0.141, 1, 0.162); strap.position.set(C.x, C.y + 0.004, C.z - 0.004); helmet.add(strap);
    // peak visor
    const vg = new THREE.BufferGeometry(); const vp = [], vi = []; const NU = 14, NV = 6;
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
      const u = i / NU * 2 - 1, v = j / NV;
      const w = 0.14 - 0.025 * v;
      const x = u * w, z = C.z + 0.10 + v * 0.15 - 0.075 * u * u, y = C.y + 0.10 + v * 0.045 - 0.014 * u * u + 0.012 * v * v;
      vp.push(x, y, z);
    }
    const NV1 = (NU + 1) * (NV + 1);
    for (let k = 0; k < NV1; k++) vp.push(vp[k * 3], vp[k * 3 + 1] - 0.012, vp[k * 3 + 2] - 0.004);
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1; vi.push(a, c, b, b, c, d); vi.push(a + NV1, b + NV1, c + NV1, b + NV1, d + NV1, c + NV1); }
    for (let i = 0; i < NU; i++) { const a = NV * (NU + 1) + i, b = a + 1; vi.push(a, b, a + NV1, b, b + NV1, a + NV1); }
    for (let j = 0; j < NV; j++) for (const i of [0, NU]) { const a = j * (NU + 1) + i, c = a + NU + 1; vi.push(a, a + NV1, c, c, a + NV1, c + NV1); }
    vg.setAttribute('position', new THREE.Float32BufferAttribute(vp, 3)); vg.setIndex(vi); vg.computeVertexNormals();
    const peak = new THREE.Mesh(vg, new THREE.MeshPhysicalMaterial({ color: 0xff5a00, roughness: 0.3, clearcoat: 1, side: THREE.DoubleSide }));
    peak.castShadow = true; helmet.add(peak);
  }
  attach('head', helmet);
  const brace = new THREE.Mesh(new THREE.TorusGeometry(0.092, 0.03, 10, 28), new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.45 }));
  brace.rotation.x = Math.PI / 2 - 0.35; brace.scale.set(1.15, 1, 1); brace.position.set(0, 1.405, 0.012);
  const braceBk = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.025), brace.material); braceBk.position.set(0, 1.33, -0.105); braceBk.rotation.x = 0.15;
  const braceG = new THREE.Group(); braceG.add(brace); attach('spine_03', braceG);

  // ---------- assemble
  const inner = new THREE.Group(); inner.rotation.y = Math.PI; inner.scale.setScalar(S); inner.add(root);
  const group = new THREE.Group(); group.add(inner); group.name = 'rider';
  group.traverse(o => { if (o.isMesh) o.castShadow = true; });

  // ---------- posing helpers (all in world space)
  const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
  const t1 = V(), t2 = V(), t3 = V(), t4 = V(), q1 = Q(), q2 = Q(), q3 = Q(), m1 = new THREE.Matrix4(), m2 = new THREE.Matrix4();
  const wp = (n, out) => bones[n].getWorldPosition(out);
  const setWorldQ = (b, qw) => { b.parent.getWorldQuaternion(q3).invert(); b.quaternion.copy(q3.multiply(qw)); b.updateMatrixWorld(true); };
  const rotWorld = (n, axisW, ang) => {
    const b = bones[n]; b.parent.getWorldQuaternion(q1); const ax = t4.copy(axisW).applyQuaternion(q2.copy(q1).invert());
    b.quaternion.premultiply(q2.setFromAxisAngle(ax, ang)); b.updateMatrixWorld(true);
  };
  const aim = (n, childPosW, targetW) => {
    const b = bones[n]; const bp = b.getWorldPosition(t1);
    const cur = t2.copy(childPosW).sub(bp).normalize(), des = t3.copy(targetW).sub(bp).normalize();
    const qd = q1.setFromUnitVectors(cur, des);
    b.getWorldQuaternion(q2); setWorldQ(b, q2.premultiply(qd));
  };
  const pa_ = V(), pb_ = V(), pc_ = V(), el = V(), dir = V(), pl = V();
  const ik = (a, b, c, target, pole) => {
    wp(a, pa_); wp(b, pb_); wp(c, pc_);
    const la = pa_.distanceTo(pb_), lb = pb_.distanceTo(pc_);
    let d = pa_.distanceTo(target); d = Math.min(Math.max(d, Math.abs(la - lb) + 1e-4), la + lb - 1e-4);
    dir.copy(target).sub(pa_).normalize();
    pl.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
    const cosA = (la * la + d * d - lb * lb) / (2 * la * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    el.copy(pa_).addScaledVector(dir, la * cosA).addScaledVector(pl, la * sinA);
    aim(a, pb_, el); wp(c, pc_); aim(b, pc_, target);
  };
  // orient a bone so two bind-space reference vectors map onto two desired world vectors
  const basis = (a, b, out) => { const x = V().copy(a).normalize(); const z = V().crossVectors(x, b).normalize(); const y = V().crossVectors(z, x); return out.makeBasis(x, y, z); };
  const orient = (n, aBind, bBind, aDesW, bDesW) => {
    inner.getWorldQuaternion(q1);
    const aW = V().copy(aBind).applyQuaternion(q1), bW = V().copy(bBind).applyQuaternion(q1);
    basis(aW, bW, m1); basis(aDesW, bDesW, m2);
    const R = q2.setFromRotationMatrix(m2.multiply(m1.transpose()));
    const qw = Q().copy(q1).multiply(bindQ[n]).premultiply(R);
    setWorldQ(bones[n], qw);
  };
  const handDirL = sub('middle_01_l', 'hand_l'), handAcrL = sub('index_01_l', 'pinky_01_l');
  const handDirR = sub('middle_01_r', 'hand_r'), handAcrR = sub('index_01_r', 'pinky_01_r');
  const footDirL = sub('ball_l', 'foot_l'), footDirR = sub('ball_r', 'foot_r');
  const up0 = new THREE.Vector3(0, 1, 0);
  const fingers = ['index', 'middle', 'ring', 'pinky'];

  const toW = (arr, out) => out.set(arr[0], arr[1], arr[2]).applyMatrix4(group.matrixWorld);
  const gq = new THREE.Quaternion();
  const dirW = (x, y, z, out) => out.set(x, y, z).applyQuaternion(gq);
  const Pp = V(), tg = V(), pole = V(), axX = V(), axZ = V(), axY = V(), dA = V(), dB = V();
  // ---------- motion: damped springs driven by bike physics (nothing snaps)
  // x'' = w²(target - x) - 2ζw x' (+ impulses). ζ < 1 gives a little natural overshoot/rebound.
  const spring = (w, z) => ({ x: 0, v: 0, w, z });
  const stepS = (s, target, h) => { s.v += (s.w * s.w * (target - s.x) - 2 * s.z * s.w * s.v) * h; s.x += s.v * h; };
  const sLat = spring(8, 0.55);     // body/hip lean + weight shift into the turn (+ = rider's right)
  const sFA = spring(6, 0.5);       // fore/aft weight (+ = back: throttle / wheelie, - = forward: brake dive)
  const sCmp = spring(10.5, 0.4);   // vertical: + = compressed (landings, whoops, jump-face tuck), - = extended
  const sSteer = spring(9, 0.7);    // shoulders / elbows / head following the bars
  const sWhip = spring(6, 0.55);    // in-air hip whip / scrub
  const sHead = spring(3, 0.8);     // idle look-around
  const sIdle = spring(2.5, 1.0);   // 0 riding .. 1 stopped (relaxed posture)
  let time = 0, lastAir = 0;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const motion = { lat: 0, fa: 0, cmp: 0, steer: 0, whip: 0, idle: 0 };

  function update(st, dt) {
    dt = Math.min(dt || 0.016, 0.05);
    time += dt;
    const spd = st.speed || 0, grounded = st.grounded !== false, airT = st.airTime || 0;
    const steer = st.steer || 0;
    // --- targets
    const rollN = clamp(-(st.roll || 0) / 0.32, -1, 1);                 // bike lean, + = right
    const tLat = grounded ? clamp(rollN * 0.8 + steer * 0.3 * clamp(spd / 12, 0, 1), -1.1, 1.1) : rollN * 0.4;
    let tFA = clamp((st.aLong || 0) / 40, -1, 1);
    if (st.gas && grounded) tFA = Math.max(tFA, 0.35 * clamp(1 - spd / 40, 0.2, 1));
    if (st.brake && grounded && spd > 3) tFA = Math.min(tFA, -0.75);
    if (!grounded) tFA = 0.15;                                         // neutral-centred in the air
    const air = grounded ? 0 : clamp((airT - 0.08) * 4, 0, 1);
    const pitch = st.pitch || 0;
    // extend legs/arms in the air; on the way down pull back to a ready-to-absorb stance
    let tCmp = -0.5 * air * ((st.vy || 0) < -4 ? 0.35 : 1);
    if (grounded && pitch > 0.12 && spd > 14) tCmp += 0.45 * clamp((pitch - 0.12) / 0.3, 0, 1);  // tuck on jump face
    const idleT = grounded ? clamp(1 - spd / 3.5, 0, 1) : 0;
    let tWhip = 0;
    if (!grounded && airT > 0.18) {
      const w = clamp((airT - 0.18) * 3, 0, 1);
      tWhip = w * (steer * 0.9 + 0.35 * Math.sin(airT * 3.6));
    }
    // --- impulses: landings (scaled by impact) and terrain chatter / whoops
    if (st.land > 0) sCmp.v += 2.5 + clamp(st.land / 20, 0, 1.3) * 9.0;
    if (grounded && st.aVert) sCmp.v += clamp(st.aVert, -260, 260) * 0.0042 * dt * 60 * 0.25;
    if (grounded && lastAir > 0.25 && !(st.land > 0)) sCmp.v += 1.5;    // touch-down without a reported impact
    lastAir = grounded ? 0 : airT;
    // --- integrate (sub-stepped so long frames stay stable)
    const n = Math.max(1, Math.ceil(dt / 0.0125)), h = dt / n;
    for (let i = 0; i < n; i++) {
      stepS(sLat, tLat, h); stepS(sFA, tFA, h); stepS(sCmp, tCmp, h); stepS(sSteer, steer * (grounded ? 1 : 0.4), h);
      stepS(sWhip, tWhip, h); stepS(sIdle, idleT, h);
      stepS(sHead, idleT * 0.45 * Math.sin(time * 0.37) * Math.sin(time * 0.13 + 1.0), h);
    }
    sCmp.x = clamp(sCmp.x, -0.75, 1.15); if (Math.abs(sCmp.x) >= 1.15) sCmp.v *= 0.5;
    const lat = sLat.x, fa = sFA.x, cmp = sCmp.x, str = sSteer.x, whip = sWhip.x, idle = clamp(sIdle.x, 0, 1);
    Object.assign(motion, { lat, fa, cmp, steer: str, whip, idle });
    // small alive-ness: breathing when stopped, engine/terrain chatter with speed
    const breath = Math.sin(time * 1.7) * (0.006 + 0.008 * idle);
    const chat = grounded ? (Math.sin(time * 23.0) * 0.6 + Math.sin(time * 37.0 + 1.3) * 0.4) * 0.0055 * clamp(spd / 30, 0, 1) : 0;

    for (const n in restQ) bones[n].quaternion.copy(restQ[n]);
    // place hips: shift into the turn, back on the gas / forward on the brakes, down when compressed
    const px = P.pelvis[0] + lat * 0.085 - whip * 0.05;
    const py = P.pelvis[1] - cmp * 0.17 - idle * 0.06 + breath + chat;
    const pz = P.pelvis[2] + fa * 0.075 + cmp * 0.05 + idle * 0.05;
    inner.position.set(px, py, pz).sub(t1.set(0, bindP.pelvis.y * S, -bindP.pelvis.z * S));
    group.updateMatrixWorld(true); group.getWorldQuaternion(gq);
    dirW(1, 0, 0, axX); dirW(0, 0, -1, axZ); dirW(0, 1, 0, axY);
    // hips: whip yaw/roll in the air
    rotWorld('pelvis', axY, -whip * 0.22); rotWorld('pelvis', axZ, whip * 0.10);
    // torso: attack position; more forward under braking / compression, more upright on the gas & when idle
    const lean = P.lean + cmp * 0.22 - fa * (fa > 0 ? 0.30 : 0.17) - idle * 0.35 + breath * 2.0;
    rotWorld('pelvis', axX, -lean * 0.32);
    rotWorld('spine_01', axX, -lean * 0.26); rotWorld('spine_02', axX, -lean * 0.24); rotWorld('spine_03', axX, -lean * (0.18 + breath * 3));
    // lean the upper body into the turn (axZ points forward, so -angle = roll right)
    rotWorld('spine_01', axZ, -lat * 0.09); rotWorld('spine_02', axZ, -lat * 0.10); rotWorld('spine_03', axZ, -lat * 0.05);
    // shoulders follow the bars (twist into the turn); whip counter-twist
    rotWorld('spine_02', axY, -str * 0.07 + whip * 0.10); rotWorld('spine_03', axY, -str * 0.09 + whip * 0.08);
    // head: eyes up, level-ish horizon, look into the turn; idle glances around
    rotWorld('neck_01', axX, P.headUp * 0.45 - idle * 0.1); rotWorld('head', axX, P.headUp * 0.55 - pitch * 0.5 - idle * 0.15 + Math.max(0, -fa) * 0.2 + Math.max(0, cmp) * 0.15);
    rotWorld('neck_01', axZ, lat * 0.10 + (st.roll || 0) * 0.35);
    rotWorld('head', axY, -str * 0.30 - sHead.x * 0.9 + whip * 0.25);
    rotWorld('clavicle_l', axZ, -0.12 - 0.04 * Math.max(0, -fa)); rotWorld('clavicle_r', axZ, 0.12 + 0.04 * Math.max(0, -fa));
    // legs: boots stay on the pegs; inside knee opens toward the turn, knees grip when compressed
    const kneeOutL = 0.12 + Math.max(0, -lat) * 0.35 + idle * 0.1, kneeOutR = 0.12 + Math.max(0, lat) * 0.35 + idle * 0.1;
    toW(P.pegL, tg); ik('thigh_l', 'calf_l', 'foot_l', tg.add(dirW(0, 0.10, 0.02, t4)), dirW(-kneeOutL, 0.15, -1, pole));
    toW(P.pegR, tg); ik('thigh_r', 'calf_r', 'foot_r', tg.add(dirW(0, 0.10, 0.02, t4)), dirW(kneeOutR, 0.15, -1, pole));
    orient('foot_l', footDirL, up0, dirW(-0.12, -0.25, -1, dA), dirW(0, 1, 0, dB));
    orient('foot_r', footDirR, up0, dirW(0.12, -0.25, -1, dA), dirW(0, 1, 0, dB));
    // arms: hands locked on the grips; elbows up and out (outside elbow higher in turns, braced under braking)
    const brace = Math.max(0, -fa) * 0.35 + Math.max(0, cmp) * 0.25 - idle * 0.5;
    const eL = 1.1 + brace + str * 0.45, eR = 1.1 + brace - str * 0.45;
    toW(P.gripL, tg); tg.add(dirW(0.03, 0.035, 0.075, t4)); ik('upperarm_l', 'lowerarm_l', 'hand_l', tg, dirW(-1, eL, 0.25, pole));
    toW(P.gripR, tg); tg.add(dirW(-0.03, 0.035, 0.075, t4)); ik('upperarm_r', 'lowerarm_r', 'hand_r', tg, dirW(1, eR, 0.25, pole));
    orient('hand_l', handDirL, handAcrL, dirW(-0.05, -0.55, -1, dA), dirW(1, 0, 0, dB));
    orient('hand_r', handDirR, handAcrR, dirW(0.05, -0.55, -1, dA), dirW(-1, 0, 0, dB));
    for (const f of fingers) for (const s of ['l', 'r']) for (const j of ['01', '02', '03']) rotWorld(f + '_' + j + '_' + s, axX, -(j === '01' ? 0.75 : 0.9));
    for (const s of ['l', 'r']) { rotWorld('thumb_02_' + s, axX, -0.5); rotWorld('thumb_03_' + s, axX, -0.5); }
  }
  // ---------- on foot (summit finale): walk cycle + free-fall flail, same IK helpers, standing on y = 0
  const loc = (n, out) => out.set(-bindP[n].x * S, bindP[n].y * S, -bindP[n].z * S);
  const armLen = (bindP.upperarm_l.distanceTo(bindP.lowerarm_l) + bindP.lowerarm_l.distanceTo(bindP.hand_l)) * S;
  const lF = V(), lH = V(), lS = V();
  const L2W = (v, out) => out.copy(v).applyMatrix4(group.matrixWorld);
  function footPose(ph, amt, dt, mode) {
    time += dt || 0;
    for (const n in restQ) bones[n].quaternion.copy(restQ[n]);
    const fl = mode === 'flail';
    const bob = fl ? 0 : (Math.abs(Math.cos(ph)) - 0.5) * 0.035 * amt;
    inner.position.set(0, fl ? 0 : -0.035 - 0.03 * amt + bob, 0);
    group.updateMatrixWorld(true); group.getWorldQuaternion(gq);
    dirW(1, 0, 0, axX); dirW(0, 0, -1, axZ); dirW(0, 1, 0, axY);
    rotWorld('spine_01', axX, fl ? 0.15 * Math.sin(ph * 0.7) : -0.06 * amt);
    rotWorld('pelvis', axY, Math.sin(ph) * 0.08 * amt); rotWorld('spine_03', axY, -Math.sin(ph) * 0.12 * amt);
    rotWorld('head', axX, fl ? -0.3 : 0.05);
    for (const side of ['l', 'r']) {
      const p = ph + (side === 'l' ? 0 : Math.PI);
      loc('foot_' + side, lF);
      if (fl) { lF.z += Math.sin(p * 1.3) * 0.35; lF.y += 0.25 + 0.2 * Math.cos(p); }
      else { lF.z += -Math.sin(p) * 0.34 * amt; lF.y += Math.max(0, Math.cos(p)) * 0.11 * amt; }
      ik('thigh_' + side, 'calf_' + side, 'foot_' + side, L2W(lF, tg), dirW(0, 0.1, -1, pole));
      orient('foot_' + side, side === 'l' ? footDirL : footDirR, up0, dirW(0, fl ? -0.6 : -0.05 - 0.25 * Math.max(0, Math.cos(p)) * amt, -1, dA), dirW(0, 1, 0, dB));
      loc('upperarm_' + side, lS); const sx = Math.sign(lS.x) || 1;
      if (fl) lH.set(lS.x + sx * (0.45 + 0.15 * Math.sin(p * 1.7)), lS.y + armLen * 0.55 + 0.2 * Math.sin(p * 2.1), lS.z + 0.25 * Math.cos(p * 1.9));
      else lH.set(lS.x + sx * 0.09, lS.y - armLen * 0.93, lS.z + Math.sin(p) * 0.24 * amt + 0.04);
      ik('upperarm_' + side, 'lowerarm_' + side, 'hand_' + side, L2W(lH, tg), dirW(sx * 0.3, fl ? -0.5 : 0, fl ? -0.4 : 1, pole));
    }
  }
  // ---------- natural gait (walk -> jog blend): planted stance feet that match ground speed (no skating), heel strike /
  // roll / toe-off foot pitch, swing arc with knee lift, pelvis bob + sway + yaw with thorax counter-rotation, opposite
  // arm swing (elbows bend as it becomes a jog), forward lean with speed, lean into turns, stabilised head, idle breathing.
  const legLen = (bindP.thigh_l.distanceTo(bindP.calf_l) + bindP.calf_l.distanceTo(bindP.foot_l)) * S;
  const footLen = bindP.foot_l.distanceTo(bindP.ball_l) * S;
  const toe0 = Math.asin(clamp(-footDirL.y, -0.9, 0.9));
  const GT = { ph: 0, run: 0, amt: 0, turn: 0, acc: 0, lv: 0, look: 0 };
  const sstep = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const fz = { l: 0, r: 0 }, fy = { l: 0, r: 0 }, fp = { l: 0, r: 0 }, stm = { l: 0, r: 0 };
  function gait(v, dt, o = {}) {
    dt = Math.min(dt || 0.016, 0.05); time += dt;
    v = Math.max(0, v || 0);
    GT.run += (clamp((v - 2.8) / 1.8, 0, 1) - GT.run) * Math.min(1, dt * 3.5);
    GT.amt += (clamp(v / 1.1, 0, 1) - GT.amt) * Math.min(1, dt * 6);
    GT.turn += (clamp(o.turn || 0, -3, 3) - GT.turn) * Math.min(1, dt * 5);
    GT.acc += (clamp((v - GT.lv) / Math.max(dt, 1e-3), -8, 8) - GT.acc) * Math.min(1, dt * 4); GT.lv = v;
    GT.look += ((o.look || 0) - GT.look) * Math.min(1, dt * 3);
    const run = GT.run, amt = GT.amt;
    const f = lerp(0.82, 1.36, run) * lerp(0.85, 1.12, clamp(v / 6, 0, 1));          // stride cycles / s
    const beta = lerp(0.61, 0.38, run);                                               // stance fraction
    const A = Math.min(v * beta / (2 * f), legLen * 0.46);                            // half stance travel (feet stay planted)
    const prev = GT.ph; if (amt > 0.03) GT.ph = (GT.ph + dt * f) % 1;
    let strikes = 0;
    for (const side of ['l', 'r']) {
      const off = side === 'l' ? 0 : 0.5, s = (GT.ph + off) % 1, s0 = (prev + off) % 1;
      if (amt > 0.03 && s < s0) strikes++;
      let z, y = 0, p = 0, st = 0;
      if (s < beta) {
        const k = s / beta; z = -A + 2 * A * k; st = Math.sin(Math.PI * k);
        if (k < 0.18) p = -0.28 * (1 - k / 0.18) * (1 - 0.6 * run);                 // heel strike: toes up
        else if (k > 0.62) p = 0.62 * sstep((k - 0.62) / 0.38) * (1 - 0.3 * run);   // heel off -> toe off
        if (p > 0) y += footLen * (Math.sin(toe0 + p) - Math.sin(toe0));             // pivot on the ball
      } else {
        const k = (s - beta) / (1 - beta);
        z = A - 2 * A * sstep(k);
        const h = lerp(0.09, 0.3, run) * Math.min(1, A / 0.3 + 0.25);
        y = h * Math.sin(Math.PI * Math.pow(k, lerp(1, 0.7, run)));
        z += run * 0.22 * Math.sin(Math.PI * Math.min(1, k * 1.6)) * Math.min(1, A / 0.4);   // heel kicks up behind when jogging
        p = k < 0.35 ? 0.55 * (1 - k / 0.35) : -0.22 * sstep((k - 0.6) / 0.4);
      }
      fz[side] = z * amt; fy[side] = y * amt; fp[side] = p * amt; stm[side] = st;
    }
    // pelvis: inverted-pendulum bob when walking, compress-at-midstance when jogging, sway over the stance foot
    const mStance = Math.max(stm.l, stm.r);
    const bob = ((mStance - 0.55) * 0.05 * (1 - run) + (0.45 - mStance) * 0.075 * run) * amt;
    const drop = (legLen - Math.sqrt(Math.max(0.01, legLen * legLen - A * A))) * 0.55 + 0.03 * run * amt;
    loc('foot_l', lF); const sL = Math.sign(lF.x) || -1;
    const sway = (stm.l * sL - stm.r * sL) * 0.03 * (1 - run) * amt + Math.sin(time * 0.45) * 0.012 * (1 - amt);
    for (const n in restQ) bones[n].quaternion.copy(restQ[n]);
    const breath = Math.sin(time * 1.6) * 0.006 * (1 - amt * 0.5);
    inner.position.set(sway, -0.03 - drop + bob + breath * 0.3, 0);
    group.updateMatrixWorld(true); group.getWorldQuaternion(gq);
    dirW(1, 0, 0, axX); dirW(0, 0, -1, axZ); dirW(0, 1, 0, axY);
    const yaw = sL * 0.13 * (-(fz.l) / Math.max(0.15, A)) * Math.min(1, A / 0.35);
    const leanF = (0.03 + 0.15 * run) * amt + clamp(GT.acc * 0.02, -0.08, 0.1);
    const leanT = clamp(-GT.turn * 0.045 * clamp(v / 3, 0.3, 1.4), -0.12, 0.12);
    rotWorld('pelvis', axY, yaw); rotWorld('pelvis', axZ, leanT - (stm.l - stm.r) * 0.035 * (1 - run) * amt * sL);
    rotWorld('pelvis', axX, -leanF * 0.4);
    rotWorld('spine_01', axX, -leanF * 0.3 - breath); rotWorld('spine_02', axX, -leanF * 0.3); rotWorld('spine_03', axX, breath * 2);
    rotWorld('spine_02', axY, -yaw * 0.6 + GT.look * 0.15); rotWorld('spine_03', axY, -yaw * 0.75 + GT.look * 0.15);
    rotWorld('spine_02', axZ, -leanT * 0.4);
    rotWorld('neck_01', axX, leanF * 0.55); rotWorld('head', axX, leanF * 0.35 + 0.04 - bob * 1.5);
    rotWorld('head', axY, yaw * 0.25 + GT.look * 0.7);
    rotWorld('clavicle_l', axZ, -0.06); rotWorld('clavicle_r', axZ, 0.06);
    for (const side of ['l', 'r']) {
      loc('foot_' + side, lF); const sx = Math.sign(lF.x) || 1;
      lF.x *= lerp(1, 0.78, run * amt); lF.z += fz[side]; lF.y += fy[side];
      ik('thigh_' + side, 'calf_' + side, 'foot_' + side, L2W(lF, tg), dirW(sx * 0.12, 0.1, -1, pole));
      const pp = toe0 + fp[side];
      orient('foot_' + side, side === 'l' ? footDirL : footDirR, up0, dirW(sx * 0.08, -Math.sin(pp), -Math.cos(pp), dA), dirW(0, 1, 0, dB));
      // arms swing opposite to the legs; bent elbows when jogging
      loc('upperarm_' + side, lS);
      const sw = lerp(0.2, 0.3, run) * amt * Math.min(1, A / 0.3 + 0.2);
      const zN = fz[side === 'l' ? 'r' : 'l'] / Math.max(0.15, A * amt || 0.15);
      const hz = lS.z + zN * sw - 0.05 * run * amt + 0.02;
      const hy = lS.y - armLen * lerp(0.93, 0.6, run * amt) + Math.max(0, -zN) * 0.06 * run;
      lH.set(lS.x + sx * lerp(0.1, 0.06, run), hy, hz);
      ik('upperarm_' + side, 'lowerarm_' + side, 'hand_' + side, L2W(lH, tg), dirW(sx * 0.35, -0.1, 1, pole));
    }
    return strikes;
  }
  return { group, update, bones, mesh, motion, gait, gaitState: GT, walk: (ph, amt, dt) => footPose(ph, amt, dt, 'walk'), flail: (ph, dt) => footPose(ph, 1, dt, 'flail') };
}

// MX gear material (jersey/pants/boots colours + back name/number decal); opts: { name, num, main: THREE.Color, accent: css }
export function makeGearMaterial(THREE, o = {}) {
  const NAME = o.name || 'SMITH', NUM = o.num || '45', ACCENT = o.accent || '#ff6a00';
  const MAIN = o.main ? new THREE.Color(o.main) : new THREE.Vector3(1.0, 0.30, 0.02);
  const decal = (() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
    g.clearRect(0, 0, 512, 256);
    // left half: back (name + number) ; right half: chest logo
    g.textAlign = 'center'; g.fillStyle = '#ffffff'; g.strokeStyle = '#111'; g.lineWidth = 8;
    g.font = 'bold 44px Arial Black, Arial, sans-serif'; g.font = 'bold ' + (NAME.length > 8 ? 34 : 44) + 'px Arial Black, Arial, sans-serif'; g.strokeText(NAME, 128, 58); g.fillText(NAME, 128, 58);
    g.font = 'bold 150px Arial Black, Arial, sans-serif'; g.lineWidth = 12; g.strokeText(NUM, 128, 210); g.fillText(NUM, 128, 210);
    g.font = 'italic bold 46px Arial Black, Arial, sans-serif'; g.lineWidth = 7; g.strokeText('HIMALAYA', 384, 120); g.fillText('HIMALAYA', 384, 120);
    g.fillStyle = ACCENT; g.font = 'italic bold 30px Arial, sans-serif'; g.fillText('MX RACING', 384, 160);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  })();

  const gearMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, envMapIntensity: 0.8 });
  gearMat.onBeforeCompile = (sh) => {
    sh.uniforms.uDecal = { value: decal };
    sh.uniforms.uMain = { value: MAIN };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aBind;\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = aBind;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
  varying vec3 vBind; uniform sampler2D uDecal; uniform vec3 uMain; float gearRough;
  float h3(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float vn(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
  vec3 gear(vec3 p){
  vec3 ORG = uMain, BLK = vec3(0.025,0.025,0.03), WHT = vec3(0.86,0.86,0.84), GRY = vec3(0.16,0.16,0.17);
  float ax = abs(p.x); vec3 c; gearRough = 0.8;
  if (ax > 0.43 && p.y > 0.8) {                       // gloves
    c = BLK; gearRough = 0.65;
    if (p.z > 0.21 && ax < 0.52 && p.y > 0.96) c = ORG;   // knuckle panel
    if (ax < 0.45) c = WHT;                                // cuff
  } else if (p.y > 1.44) { c = vec3(0.05); }
  else if (p.y > 0.97 || ax > 0.28) {                 // jersey
    c = ORG;
    if (ax > 0.11 && ax < 0.24 && p.y < 1.33) c = BLK;            // side panels
    if (p.y > 1.31 && ax < 0.24) c = WHT;                          // shoulder yoke
    if (p.y > 1.335 && p.y < 1.355 && ax < 0.24) c = BLK;
    if (ax >= 0.24) {                                              // sleeves
      c = BLK; float u = ax;
      if (u > 0.30 && u < 0.33) c = ORG;
      if (u > 0.33 && u < 0.345) c = WHT;
      if (u > 0.405) c = WHT;                                      // cuff
    }
    if (p.y < 1.02 && ax < 0.24) c = BLK;                          // hem band
    // back: name + number, chest: logo
    if (p.z < 0.0 && ax < 0.17 && p.y > 1.04 && p.y < 1.33) {
      vec4 d = texture2D(uDecal, vec2(0.25 - p.x/0.34*0.5, (p.y-1.04)/0.29));
      c = mix(c, d.rgb, d.a);
    }
    if (p.z > 0.05 && ax < 0.16 && p.y > 1.14 && p.y < 1.30) {
      vec4 d = texture2D(uDecal, vec2(0.75 + p.x/0.32*0.5, (p.y-1.14)/0.16));
      c = mix(c, d.rgb, d.a);
    }
  } else if (p.y > 0.43) {                            // pants
    c = BLK; gearRough = 0.7;
    if (p.y > 0.88) c = WHT;                                       // waist yoke
    if (p.y > 0.91) c = BLK;
    if (p.y > 0.62 && p.y < 0.86 && ax > 0.15) c = ORG;            // outer thigh panel
    if (p.y > 0.66 && p.y < 0.84 && ax > 0.15 && ax < 0.165) c = WHT;
    if (p.y > 0.45 && p.y < 0.62 && p.z > 0.04) { c = GRY; gearRough = 0.55; }  // leather knee
    if (p.y < 0.6 && ax < 0.13) { c = vec3(0.30,0.28,0.26); gearRough = 0.6; } // inner-knee heat guard
  } else {                                           // boots
    c = WHT; gearRough = 0.38;
    if (p.y < 0.035) { c = BLK; gearRough = 0.9; }                 // sole
    if (p.y > 0.035 && p.y < 0.09 && p.z > 0.06) c = GRY;          // toe
    float b1 = abs(p.y - 0.16), b2 = abs(p.y - 0.25), b3 = abs(p.y - 0.34);
    if ((b1 < 0.012 || b2 < 0.012 || b3 < 0.012) && p.z > -0.02) { c = BLK; gearRough = 0.3; }  // buckles
    if (p.y > 0.395) c = ORG;                                      // top band
    if (ax < 0.12 && p.y > 0.08 && p.y < 0.4) c = vec3(0.55,0.55,0.55);   // inner heat shield
  }
  float n = vn(p*180.0)*0.5 + vn(p*45.0)*0.5;
  c *= 0.86 + 0.22*n;
  return c;
  }`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = gear(vBind);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gearRough;');
  };
  gearMat.customProgramCacheKey = () => 'mxGearV1';

  return gearMat;
}
