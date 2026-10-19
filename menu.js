// Level select (classic script, runs before the game module). Progress persists in localStorage 'hdb-progress'.
(function () {
  const KEY = 'hdb-progress';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const save = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} };
  const P = window.HDBProgress = {
    get: load,
    // l1: Everest race finished; dw: Dragon War completed (survived to the end); l2: Great Wall race finished; l3: rescued (Tsunami)
    mark(id, info) { const p = load(); const o = p[id] || {}; o.done = true; o.n = (o.n || 0) + 1;
      if (info && info.time != null) o.best = o.best == null ? info.time : Math.min(o.best, info.time);
      if (info && info.place != null) o.bestPlace = o.bestPlace == null ? info.place : Math.min(o.bestPlace, info.place);
      if (info && info.kills != null) o.bestKills = Math.max(o.bestKills || 0, info.kills);
      if (info && info.win) o.won = true;
      p[id] = o; save(p); },
    reset() { try { localStorage.removeItem(KEY); } catch (e) {} },
    unlocked(id) { const p = load(); return id === 'l1' || (id === 'dw' && !!(p.l1 && p.l1.done)) || (id === 'l2' && !!(p.dw && p.dw.done)) || (id === 'l3' && !!(p.l2 && p.l2.done)); },
  };
  const LV = [
    { id: 'l1', n: 'LEVEL 1', name: 'Himalayas', sub: 'Race to Everest', img: 'assets/menu/l1.jpg',
      desc: 'Imja-valley MX circuit, then the hill climb over Kongma La, the Icefall and Lhotse Face to the 8848 m summit. Wyverns, kidnap dragons, buffalo.',
      need: '' },
    { id: 'dw', n: 'FINALE', name: 'Dragon War', sub: 'Apache showdown', img: 'assets/menu/dw.jpg',
      desc: 'On the summit: walk to the AH-64 Apaches and shoot down the wyverns. Most kills wins — get thrown to the ground and you lose.',
      need: 'Finish the Everest race to unlock' },
    { id: 'l2', n: 'LEVEL 2', name: 'Great Wall', sub: 'Jinshanling ridge, China', img: 'assets/menu/l2.jpg',
      desc: 'Fly in by Apache and race on top of the Great Wall: gap jumps, tabletops, watchtowers, nitro pads — and zombies climbing the walls.',
      need: 'Complete the Dragon War to unlock' },
    { id: 'l3', n: 'LEVEL 3', name: 'Tsunami', sub: 'Pacific coast', img: 'assets/menu/l3.jpg',
      desc: 'Beach race on wet and soft sand, dunes and boardwalk — until the sea pulls back. Outrun the tsunami to high ground, then swim for the rescue boat through ten sharks.',
      need: 'Finish the Great Wall race to unlock' },
  ];
  const css = `
#lvMenu{position:fixed;inset:0;z-index:7;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2.2vh;
  background:radial-gradient(ellipse at 50% 30%,rgba(60,40,16,.55),rgba(6,5,4,.94)),url(assets/menu/l1.jpg) center/cover;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#fff;
  padding:max(10px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(10px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));box-sizing:border-box}
#lvMenu.hidden{display:none}
#lvMenu .ttl{text-align:center;line-height:1.05}
#lvMenu .ttl h1{margin:0;font-size:clamp(1.3rem,4.2vw,2.6rem);font-weight:900;letter-spacing:.06em;text-shadow:0 4px 24px rgba(0,0,0,.7);background:linear-gradient(180deg,#fff,#ffd27a);-webkit-background-clip:text;background-clip:text;color:transparent}
#lvMenu .ttl small{display:block;font-size:clamp(.6rem,1.5vw,.85rem);letter-spacing:.35em;opacity:.7;margin-top:.4em}
#lvMenu .row{display:flex;gap:clamp(8px,1.6vw,22px);width:min(1100px,100%);justify-content:center}
.lvc{position:relative;flex:1 1 0;max-width:340px;border-radius:16px;overflow:hidden;background:rgba(20,15,10,.78);border:2px solid rgba(255,200,110,.18);
  box-shadow:0 12px 40px rgba(0,0,0,.5);cursor:pointer;transition:transform .15s,border-color .15s,box-shadow .15s;display:flex;flex-direction:column;outline:none;-webkit-tap-highlight-color:transparent}
.lvc.sel{transform:translateY(-4px) scale(1.025);border-color:#ffb43a;box-shadow:0 16px 46px rgba(255,150,30,.35),0 0 0 1px rgba(255,190,90,.5) inset}
.lvc .th{position:relative;aspect-ratio:16/8.2;background:#222 center/cover}
.lvc .th::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 45%,rgba(10,7,4,.9))}
.lvc .num{position:absolute;left:10px;top:8px;z-index:1;font-size:.62rem;font-weight:900;letter-spacing:.2em;padding:3px 8px;border-radius:6px;background:rgba(0,0,0,.55);color:#ffd27a}
.lvc .st{position:absolute;right:8px;top:7px;z-index:1;font-size:.66rem;font-weight:800;padding:3px 8px;border-radius:6px;background:rgba(0,0,0,.6)}
.lvc .st.done{background:#1f7a3a;color:#eaffef}
.lvc .bd{padding:8px 12px 10px;display:flex;flex-direction:column;gap:4px;flex:1}
.lvc h2{margin:0;font-size:clamp(.95rem,2vw,1.25rem);font-weight:900}
.lvc h2 span{font-size:.62em;font-weight:700;opacity:.65;margin-left:.4em}
.lvc p{margin:0;font-size:clamp(.6rem,1.15vw,.78rem);line-height:1.3;opacity:.82;flex:1}
.lvc .best{font-size:clamp(.6rem,1.15vw,.76rem);color:#ffd27a;font-weight:700;min-height:1.2em}
.lvc .play{margin-top:4px;border:0;border-radius:10px;padding:9px 0;font-weight:900;font-size:clamp(.75rem,1.4vw,.95rem);letter-spacing:.06em;color:#1a1008;cursor:pointer;
  background:linear-gradient(180deg,#ffd060,#ff9a20);box-shadow:0 6px 18px rgba(255,140,20,.35)}
.lvc.locked{filter:grayscale(1) brightness(.62);cursor:not-allowed}
.lvc.locked .play{background:#555;color:#ccc;box-shadow:none}
.lvc .lock{position:absolute;inset:0;display:none;align-items:center;justify-content:center;z-index:2;font-size:2.6rem;text-shadow:0 4px 18px rgba(0,0,0,.8)}
.lvc.locked .lock{display:flex}
#lvMenu .foot{display:flex;gap:18px;align-items:center;font-size:clamp(.58rem,1.1vw,.75rem);opacity:.75}
#lvMenu .foot kbd{background:rgba(255,255,255,.12);border-radius:4px;padding:1px 5px}
#lvReset{background:none;border:1px solid rgba(255,255,255,.25);color:#ddd;border-radius:8px;padding:4px 10px;font-size:inherit;cursor:pointer}
@media (max-aspect-ratio:1/1){ #lvMenu .row{flex-wrap:wrap} .lvc{flex:1 1 42%;max-width:48%} .lvc p{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden} }
@media (max-height:430px){ #lvMenu{gap:1.2vh} .lvc p{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden} .lvc .play{padding:7px 0} #lvMenu .ttl small{display:none} }
`;
  const fmt = (s) => { s = +s; const m = Math.floor(s / 60); return (m ? m + ':' + String((s % 60).toFixed(1)).padStart(4, '0') : s.toFixed(1) + 's'); };
  let sel = 0, root = null;
  function status(L) {
    const p = load()[L.id], un = P.unlocked(L.id);
    if (!un) return { st: '🔒 LOCKED', cls: '', best: L.need };
    if (p && p.done) {
      let b = '';
      if (L.id === 'dw') b = 'Best: ' + (p.bestKills || 0) + ' kills' + (p.won ? ' · WON' : '');
      else b = 'Best: ' + (p.best != null ? fmt(p.best) : '—') + (p.bestPlace ? ' · P' + p.bestPlace : '');
      return { st: '✔ COMPLETE', cls: 'done', best: b };
    }
    return { st: 'NEW', cls: '', best: L.id === 'l1' ? 'Not finished yet' : 'Unlocked — not completed yet' };
  }
  function render() {
    const row = root.querySelector('.row'); row.innerHTML = '';
    LV.forEach((L, i) => {
      const S = status(L), un = P.unlocked(L.id);
      const c = document.createElement('div'); c.className = 'lvc' + (un ? '' : ' locked') + (i === sel ? ' sel' : ''); c.tabIndex = 0; c.dataset.id = L.id;
      c.innerHTML = `<div class="th" style="background-image:url(${L.img})"><span class="num">${L.n}</span><span class="st ${S.cls}">${S.st}</span></div>
        <div class="lock">🔒</div><div class="bd"><h2>${L.name}<span>${L.sub}</span></h2><p>${L.desc}</p><div class="best">${S.best}</div>
        <button class="play">${un ? (window.__gameReady ? (load()[L.id] && load()[L.id].done ? 'PLAY AGAIN' : 'PLAY') : 'LOADING…') : 'LOCKED'}</button></div>`;
      c.addEventListener('pointerenter', () => { if (sel !== i) { sel = i; mark(); } });
      c.addEventListener('click', (e) => { sel = i; mark(); launch(L); });
      row.appendChild(c);
    });
  }
  function mark() { root.querySelectorAll('.lvc').forEach((c, i) => c.classList.toggle('sel', i === sel)); }
  function hide() { root.classList.add('hidden'); }
  function waitReady(fn) { if (window.__gameReady && window.__levelReady && window.__levelReady()) return fn(); const b = root.querySelectorAll('.play')[sel]; if (b) b.textContent = 'LOADING… ' ; const t = setInterval(() => { if (window.__gameReady && window.__levelReady && window.__levelReady()) { clearInterval(t); fn(); } }, 200); }
  function launch(L) {
    if (!P.unlocked(L.id)) { const c = root.querySelectorAll('.lvc')[sel]; if (c) { c.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 260 }); } return; }
    try { window.SFXunlock && window.SFXunlock(); } catch (e) {}
    if (L.id === 'l1') { hide(); const go = document.getElementById('go'); if (go) go.click(); return; }
    waitReady(() => { hide(); if (L.id === 'dw') window.__launchDragonWar(); else if (L.id === 'l3') window.__startLevel3({}); else window.__startLevel2({}); });
  }
  function show() { root.classList.remove('hidden'); render(); }
  window.HDBMenu = { show, hide, render, get visible() { return root && !root.classList.contains('hidden'); } };
  function init() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    root = document.createElement('div'); root.id = 'lvMenu';
    root.innerHTML = `<div class="ttl"><h1>HIMALAYA DIRT BIKE</h1><small>SELECT LEVEL</small></div><div class="row"></div>
      <div class="foot"><span><kbd>←</kbd><kbd>→</kbd> choose · <kbd>Enter</kbd> play</span><button id="lvReset">Reset progress</button></div>`;
    document.body.appendChild(root);
    root.querySelector('#lvReset').onclick = (e) => { e.stopPropagation(); if (confirm('Reset all level progress? Later levels will lock again.')) { P.reset(); sel = 0; render(); } };
    addEventListener('keydown', (e) => { if (root.classList.contains('hidden')) return;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { sel = (sel + 1) % LV.length; mark(); e.preventDefault(); }
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { sel = (sel + LV.length - 1) % LV.length; mark(); e.preventDefault(); }
      else if (e.code === 'Enter' || e.code === 'Space') { launch(LV[sel]); e.preventDefault(); e.stopPropagation(); } }, true);
    const qp = new URLSearchParams(location.search); if (qp.get('level')) hide(); else render();
    const t = setInterval(() => { if (window.__gameReady) { clearInterval(t); if (!root.classList.contains('hidden')) render(); } }, 300);
  }
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
})();
