// Graphics pass: outdoor reflection environment, post pipeline (MSAA + bloom + grade + sharpen),
// texel-snapped tight sun shadows, contact shadows, and an adaptive quality governor for phones.
import * as THREE from 'three';

/* ---------- Outdoor IBL: sky dome + Himalayan skyline + valley floor, prefiltered with PMREM ---------- */
export function makeOutdoorEnv(renderer, sunDir) {
  const pm = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false,
    uniforms: { uSun: { value: sunDir.clone().normalize() } },
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 uSun; varying vec3 vD;
      float h1(float x){ return fract(sin(x * 127.1) * 43758.5453); }
      float n1(float x){ float i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f); return mix(h1(i), h1(i+1.0), f); }
      void main(){
        vec3 d = normalize(vD);
        float y = d.y;
        // sky (linear radiance)
        vec3 zen = vec3(0.62, 0.70, 0.88), hor = vec3(1.32, 1.24, 1.10);
        vec3 c = mix(hor, zen, pow(max(y, 0.0), 0.45));
        float mu = max(dot(d, uSun), 0.0);
        c += vec3(1.0, 0.88, 0.66) * (0.25 * pow(mu, 6.0) + 1.2 * pow(mu, 80.0));
        c += vec3(1.0, 0.95, 0.85) * 22.0 * smoothstep(0.9990, 0.9996, mu);
        // jagged skyline ring: rock + snow caps, sun side lit
        float az = atan(d.z, d.x);
        float ridge = 0.03 + 0.10 * n1(az * 3.0) + 0.06 * n1(az * 9.0 + 3.1) + 0.025 * n1(az * 27.0 + 7.7);
        if (y < ridge) {
          float lit = 0.55 + 0.45 * max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0);
          float snow = smoothstep(ridge - 0.05, ridge - 0.015, y);
          vec3 rock = vec3(0.50, 0.44, 0.38) * lit;
          vec3 sn = vec3(1.15, 1.17, 1.22) * lit;
          vec3 m = mix(rock, sn, snow);
          m = mix(m, hor * 0.8, 0.35);                  // aerial haze on the far ring
          c = m;
        }
        if (y < 0.0) {                                  // valley floor: dusty brown/green ground bounce
          vec3 g = mix(vec3(0.70, 0.56, 0.40), vec3(0.50, 0.48, 0.32), 0.5 + 0.5 * n1(az * 5.0));
          c = mix(c, g, smoothstep(0.0, -0.08, y));
        }
        gl_FragColor = vec4(c, 1.0);
      }`
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), mat);
  s.add(m);
  const rt = pm.fromScene(s, 0.0, 0.1, 100);
  m.geometry.dispose(); mat.dispose(); pm.dispose();
  return rt.texture;
}

/* ---------- Post pipeline ---------- */
const FS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export function makePost(renderer, { mobile }) {
  const gl = renderer.getContext();
  const isGL2 = renderer.capabilities.isWebGL2;
  if (!isGL2) return null;
  const hf = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
  gl.getExtension('OES_texture_float_linear');
  const maxS = Math.min(4, renderer.capabilities.maxSamples || 4);
  // probe: can this GPU render multisampled RGBA16F? (otherwise fall back to RGBA8, always MSAA-capable)
  const probe = (fmt) => {
    let ok = false; const fb = gl.createFramebuffer(), rb = gl.createRenderbuffer();
    try {
      while (gl.getError() !== gl.NO_ERROR) {}
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, maxS, fmt, 4, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
      ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR;
    } catch (e) { ok = false; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.deleteFramebuffer(fb); gl.deleteRenderbuffer(rb);
    return ok;
  };
  const useHF = hf && probe(gl.RGBA16F);
  const TYPE = useHF ? THREE.HalfFloatType : THREE.UnsignedByteType;

  const P = {
    enabled: true, bloom: true, samples: maxS, auto: true, level: 0,
    bloomStrength: mobile ? 0.14 : 0.16, bloomThreshold: 0.97, sharpen: mobile ? 0.32 : 0.22,
    basePR: renderer.getPixelRatio(), hf: useHF, mobile, fps: 0, frames: 0, blackChecks: 0,
  };
  let W = 1, H = 1;
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: TYPE, samples: P.samples, depthBuffer: true, colorSpace: THREE.SRGBColorSpace });
  // Materials keep their own tone mapping + sRGB output inside this target (renderer treats it like the
  // canvas), so the post pass works on the exact image the game already rendered: no look drift.
  sceneRT.isXRRenderTarget = true;
  sceneRT.texture.colorSpace = THREE.SRGBColorSpace;
  sceneRT.texture.generateMipmaps = false;

  const NB = mobile ? 4 : 5;
  const blooms = [];
  for (let i = 0; i < NB; i++) {
    const t = new THREE.WebGLRenderTarget(1, 1, { type: TYPE, depthBuffer: false });
    t.texture.generateMipmaps = false; t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;
    blooms.push(t);
  }
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const quad = new THREE.Mesh(tri); quad.frustumCulled = false;
  const pScene = new THREE.Scene(); pScene.add(quad);

  const prefilter = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThr: { value: P.bloomThreshold } },
    vertexShader: FS_VERT, depthTest: false, depthWrite: false,
    fragmentShader: `uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThr; varying vec2 vUv;
      vec3 f(vec2 o){ vec3 c = texture2D(tSrc, vUv + o * uTexel).rgb; float l = max(c.r, max(c.g, c.b));
        float k = clamp(l - uThr + 0.12, 0.0, 0.24); k = k * k / 0.48; return c * max(k, l - uThr) / max(l, 1e-4); }
      void main(){ vec3 c = 0.25 * (f(vec2(-1.0,-1.0)) + f(vec2(1.0,-1.0)) + f(vec2(-1.0,1.0)) + f(vec2(1.0,1.0)));
        gl_FragColor = vec4(min(c, vec3(8.0)), 1.0); }`
  });
  const down = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
    vertexShader: FS_VERT, depthTest: false, depthWrite: false,
    fragmentShader: `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      void main(){ vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
        c += texture2D(tSrc, vUv + uTexel * vec2(-1.0,-1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0,-1.0)).rgb;
        c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
        gl_FragColor = vec4(c / 8.0, 1.0); }`
  });
  const up = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
    vertexShader: FS_VERT, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true,
    fragmentShader: `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
      void main(){ vec2 t = uTexel;
        vec3 c = texture2D(tSrc, vUv + vec2(-t.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(t.x, 0.0)).rgb
               + texture2D(tSrc, vUv + vec2(0.0, -t.y)).rgb + texture2D(tSrc, vUv + vec2(0.0, t.y)).rgb;
        c = c * 0.1667 + (texture2D(tSrc, vUv + t * 0.5).rgb + texture2D(tSrc, vUv - t * 0.5).rgb) * 0.1667;
        gl_FragColor = vec4(c * 0.85, 1.0); }`
  });
  const comp = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: sceneRT.texture }, tBloom: { value: blooms[0].texture }, uTexel: { value: new THREE.Vector2() },
      uBloom: { value: P.bloomStrength }, uSharp: { value: P.sharpen }, uAspect: { value: 1 }, uTime: { value: 0 } },
    vertexShader: FS_VERT, depthTest: false, depthWrite: false,
    fragmentShader: `uniform sampler2D tScene, tBloom; uniform vec2 uTexel; uniform float uBloom, uSharp, uAspect, uTime; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tScene, vUv).rgb;
        // light contrast-adaptive sharpen (recovers texture crispness lost to MSAA resolve / mip filtering)
        vec3 n = texture2D(tScene, vUv + vec2(0.0, uTexel.y)).rgb, s = texture2D(tScene, vUv - vec2(0.0, uTexel.y)).rgb;
        vec3 e = texture2D(tScene, vUv + vec2(uTexel.x, 0.0)).rgb, w = texture2D(tScene, vUv - vec2(uTexel.x, 0.0)).rgb;
        vec3 mn = min(c, min(min(n, s), min(e, w))), mx = max(c, max(max(n, s), max(e, w)));
        vec3 amp = clamp(min(mn, 1.0 - min(mx, 1.0)) / max(mx, 1e-3), 0.0, 1.0);
        vec3 wgt = -sqrt(amp) * uSharp * 0.2;
        c = clamp((c + (n + s + e + w) * wgt) / (1.0 + 4.0 * wgt), mn, mx);
        // bloom (sun, snow glints, chrome highlights, dragon eyes, warning rings)
        vec3 b = texture2D(tBloom, vUv).rgb;
        c += b * uBloom;
        c = min(c, vec3(1.0));
        // grade: gentle filmic S-curve, a touch more saturation, warm highlights / cool shadows
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = clamp((c - 0.45) * 1.06 + 0.45, 0.0, 1.0);   // a touch more punch around the midtones
        c = mix(vec3(l), c, 1.08);
        c *= mix(vec3(1.0), vec3(1.025, 1.0, 0.975), smoothstep(0.25, 0.85, l));
        // vignette
        vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
        c *= mix(1.0, smoothstep(1.2, 0.4, length(q)), 0.22);
        // dither to kill banding in the sky
        c += (fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`
  });

  function pass(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(pScene, ortho);
  }
  function setSize(w, h) {
    W = Math.max(1, Math.floor(w)); H = Math.max(1, Math.floor(h));
    sceneRT.setSize(W, H);
    let bw = Math.max(1, W >> (mobile ? 2 : 1)), bh = Math.max(1, H >> (mobile ? 2 : 1));
    for (const b of blooms) { b.setSize(bw, bh); bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1); }
    comp.uniforms.uTexel.value.set(1 / W, 1 / H);
    comp.uniforms.uAspect.value = W / H;
  }
  function render(scene, camera) {
    const prevAuto = renderer.autoClear;
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);
    renderer.autoClear = true;
    if (P.bloom) {
      prefilter.uniforms.tSrc.value = sceneRT.texture;
      prefilter.uniforms.uTexel.value.set(1 / W, 1 / H);
      prefilter.uniforms.uThr.value = P.bloomThreshold;
      pass(prefilter, blooms[0]);
      for (let i = 1; i < blooms.length; i++) {
        down.uniforms.tSrc.value = blooms[i - 1].texture;
        down.uniforms.uTexel.value.set(1 / blooms[i - 1].width, 1 / blooms[i - 1].height);
        pass(down, blooms[i]);
      }
      renderer.autoClear = false;
      for (let i = blooms.length - 1; i > 0; i--) {
        up.uniforms.tSrc.value = blooms[i].texture;
        up.uniforms.uTexel.value.set(1 / blooms[i].width, 1 / blooms[i].height);
        pass(up, blooms[i - 1]);
      }
      renderer.autoClear = true;
    }
    comp.uniforms.uBloom.value = P.bloom ? P.bloomStrength : 0;
    comp.uniforms.uSharp.value = P.sharpen;
    comp.uniforms.uTime.value = (comp.uniforms.uTime.value + 1.37) % 1000;
    pass(comp, null);
    renderer.autoClear = prevAuto;
    // safety net: if the composited frame comes out black (driver can't do this pipeline), give up on post
    P.frames++;
    if (P.frames === 12 || P.frames === 40 || P.frames === 90) {
      const px = new Uint8Array(4);
      gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight - 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (px[0] + px[1] + px[2] === 0) { if (++P.blackChecks >= 2) { P.enabled = false; console.warn('[gfx] post produced black frames; disabled'); } }
    }
  }
  function setSamples(n) {
    n = Math.max(0, Math.min(maxS, n | 0));
    if (n === sceneRT.samples) return;
    sceneRT.samples = n; sceneRT.dispose();   // re-created at the next render with the new sample count
  }
  P.sceneRT = sceneRT; P.render = render; P.setSize = setSize; P.setSamples = setSamples;
  return P;
}

/* ---------- Contact shadow decal (soft dark oval with tyre contact patches) ---------- */
let _blobTex = null;
export function contactShadow(len = 2.2, wid = 0.95, opacity = 0.6) {
  if (!_blobTex) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const g = c.getContext('2d');
    const rg = (x, y, r, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 128); };
    g.save(); g.translate(32, 64); g.scale(1, 2); g.translate(-32, -32); rg(32, 32, 30, 0.55); g.restore();
    rg(32, 22, 13, 0.75); rg(32, 106, 13, 0.75);   // front / rear tyre contact
    _blobTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(wid, len),
    new THREE.MeshBasicMaterial({ map: _blobTex, color: 0x000000, transparent: true, opacity, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false, fog: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.03; m.renderOrder = 1; m.name = 'contact-shadow';
  m.userData.baseOpacity = opacity;
  return m;
}

/* ---------- Adaptive quality: step down (never up) when the phone can't hold ~40 fps ---------- */
export function makeGovernor(P, renderer, apply) {
  let acc = 0, n = 0, warm = 0;
  return function tick(dt, active) {
    if (!P || !P.auto || !active || document.hidden) { acc = 0; n = 0; warm = 0; return; }
    warm += dt; if (warm < 4) return;           // ignore load / shader-compile hitches right after start
    acc += dt; n++;
    if (acc < 3) return;
    const avg = acc / n; acc = 0; n = 0;
    P.fps = 1 / avg;
    if (avg > 1 / 38 && P.level < 5) { P.level++; apply(P.level); warm = 2; }
  };
}
