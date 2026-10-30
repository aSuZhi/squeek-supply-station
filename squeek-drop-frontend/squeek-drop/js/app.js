import { CONFIG, isMock } from './config.js';
import { Sim, INPUT, LEVELS, W, MAX_LEVEL, WEATHER, RULES_VERSION } from './engine.js';
import { Renderer, ballIcon, drawBall } from './render.js';
import { wheel } from './wheel.js';
import { api } from './api.js';
import { wallet, chainCalls, short } from './wallet.js';
import { t, levelName, applyI18n, getLang, setLang } from './i18n.js';
import { sfx } from './audio.js';
import { BOARDS } from './rules.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const WX_EMOJI = { NAP: '💤', JOG: '🐾', ZOOMIES: '🔥' };
const state = { view: 'lobby', run: null, sim: null, renderer: null, aimX: W / 2, pending: [], loopId: 0, lastT: 0, acc: 0, best: 0, result: null, board: 'daily', authed: false, pinned: false };

// ---------- Toasts ----------
function toast(html, ms = 3200) {
  const el = document.createElement('div'); el.className = 'toast'; el.innerHTML = html;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), ms);
}
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n).toLocaleString(getLang() === 'zh' ? 'zh-CN' : 'en-US');
const sqk = (base) => { const v = BigInt(base || 0); const whole = v / 10n ** 18n; const frac = (v % 10n ** 18n) / 10n ** 16n; return `${fmt(whole)}${frac ? '.' + String(frac).padStart(2, '0') : ''} SQK`; };

// ---------- Views & modals ----------
function show(view) {
  state.view = view;
  for (const v of ['lobby', 'game', 'board']) $('#view-' + v).hidden = v !== view;
  $$('.nav [data-go]').forEach(b => b.setAttribute('aria-current', b.dataset.go === (view === 'game' ? 'lobby' : view) ? 'page' : 'false'));
  if (view !== 'game') stopLoop();
  if (view === 'board') loadBoard(state.board);
  window.scrollTo({ top: 0 });
}
function openModal(id) { const m = $('#modal-' + id); m.hidden = false; const f = m.querySelector('button:not([hidden])'); f && f.focus(); }
function closeModal(el) { (el.closest ? el.closest('.modal') : el).hidden = true; }
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]'); if (go) { if (go.hasAttribute('data-close')) closeModal(go); show(go.dataset.go); return; }
  const op = e.target.closest('[data-open]'); if (op) { op.dataset.open === 'pot' ? openPot() : openModal(op.dataset.open); return; }
  const cl = e.target.closest('[data-close]'); if (cl) { closeModal(cl); return; }
  const md = e.target.closest('[data-mode]'); if (md) { startMode(md.dataset.mode); return; }
  if (e.target.classList.contains('modal') && e.target.id !== 'modal-over') e.target.hidden = true;
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.modal').forEach(m => { if (!m.hidden && m.id !== 'modal-over') m.hidden = true; }); });

// ---------- Wheel cards ----------
const wheelCanvases = [];
function renderWheelCards(s) {
  $$('[data-wheel]').forEach(el => {
    const compact = el.dataset.wheel === 'mini';
    if (!el.dataset.built) {
      el.dataset.built = '1';
      el.innerHTML = `
        <div class="wheel-head"><h3>🐹 <span data-i18n="wheel_title">${t('wheel_title')}</span></h3><span class="live"></span></div>
        <div class="wheel-body"><canvas class="wheel-viz" aria-hidden="true"></canvas>
          <div class="wheel-stats">
            <div class="kv"><span data-i18n="wheel_rpm">${t('wheel_rpm')}</span><b class="w-rpm">—</b></div>
            <div class="kv"><span data-i18n="wheel_height">${t('wheel_height')}</span><b class="w-h">—</b></div>
            ${compact ? '' : `<div class="kv"><span data-i18n="wheel_round">${t('wheel_round')}</span><b class="w-round">—</b></div>`}
            <div><div class="kv"><span data-i18n="wheel_progress">${t('wheel_progress')}</span><b class="w-p">—</b></div><div class="bar"><div class="bar-fill w-bar"></div></div></div>
          </div></div>
        <div class="wx-badge"><span class="wx-emoji"></span><div><b class="wx-name"></b><p class="wx-desc"></p></div></div>
        <div class="wheel-foot"><span class="w-src"></span><a href="${CONFIG.streamUrl}" target="_blank" rel="noopener" data-i18n="wheel_watch">${t('wheel_watch')}</a></div>`;
      wheelCanvases.push(el.querySelector('canvas'));
    }
    if (!s) return;
    el.querySelector('.live').className = 'live' + (s.simulated ? ' sim' : '');
    el.querySelector('.live').textContent = s.simulated ? 'SIM' : 'LIVE';
    el.querySelector('.w-rpm').textContent = `${s.rpm.toFixed(1)} rpm`;
    el.querySelector('.w-h').textContent = s.blockHeight != null ? '#' + fmt(s.blockHeight) : '—';
    const r = el.querySelector('.w-round'); if (r) r.textContent = s.settledRound != null ? fmt(s.settledRound) : '—';
    const pct = Math.min(100, s.blockProgress / 1e7);
    el.querySelector('.w-p').textContent = pct.toFixed(1) + '%';
    el.querySelector('.w-bar').style.width = pct + '%';
    const b = el.querySelector('.wx-badge'); b.className = 'wx-badge wx-' + s.weather;
    el.querySelector('.wx-emoji').textContent = WX_EMOJI[s.weather];
    el.querySelector('.wx-name').textContent = t('w_' + s.weather);
    el.querySelector('.wx-desc').textContent = t('wd_' + s.weather);
    el.querySelector('.w-src').textContent = s.simulated ? t('wheel_sim') : t('wheel_live');
  });
}
let wheelAngle = 0, wheelLast = performance.now();
function animateWheels(now) {
  const dt = Math.min(0.1, (now - wheelLast) / 1000); wheelLast = now;
  const s = wheel.state; const rpm = s ? s.rpm : 0;
  wheelAngle += (rpm / 60) * Math.PI * 2 * dt * 0.5;
  for (const c of wheelCanvases) {
    if (!c.offsetParent) continue;
    const size = c.clientWidth, dpr = Math.min(2, devicePixelRatio || 1);
    if (c.width !== size * dpr) { c.width = size * dpr; c.height = size * dpr; }
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size, size);
    const R = size / 2 - 4, cx = size / 2, cy = size / 2;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(wheelAngle);
    ctx.strokeStyle = '#C69C72'; ctx.lineWidth = Math.max(3, size * 0.05);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = Math.max(1.5, size * 0.02); ctx.strokeStyle = '#E0C29E';
    for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * .15, Math.sin(a) * R * .15); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = '#8A6A4E'; ctx.beginPath(); ctx.arc(cx, cy, size * 0.05, 0, Math.PI * 2); ctx.fill();
    const bob = rpm > 1 ? Math.sin(now / (120 - Math.min(80, rpm))) * size * 0.02 : 0;
    drawBall(ctx, s && s.weather === 'NAP' ? 1 : 2, cx, cy + R - size * 0.17 + bob, size * 0.15, rpm > 1 ? -0.2 : 0, s && s.weather === 'NAP' ? 0 : now / 1000);
    if (s && s.weather === 'NAP') { ctx.fillStyle = '#7E6957'; ctx.font = `800 ${size * 0.14}px system-ui`; ctx.fillText('z', cx + size * 0.12, cy + R - size * 0.32); ctx.font = `800 ${size * 0.1}px system-ui`; ctx.fillText('z', cx + size * 0.2, cy + R - size * 0.42); }
  }
  requestAnimationFrame(animateWheels);
}

// ---------- Wallet ----------
function updateWalletBtn() {
  const btn = $('#walletBtn');
  btn.classList.toggle('connected', !!wallet.address && state.authed);
  $('#walletLabel').textContent = wallet.address && state.authed ? short(wallet.address) : t('connect');
  $('#walletLabel').toggleAttribute('data-i18n', !(wallet.address && state.authed));
}
async function connectWallet() {
  if (!wallet.provider) {
    if (isMock()) { // demo wallet so reviewers can try every flow without an extension
      wallet.address = '0xdemo' + Math.random().toString(16).slice(2, 10).padEnd(36, '0');
      wallet.signMessage = async () => '0xdemo';
      await api.login(wallet.address, wallet.signMessage.bind(wallet));
      state.authed = true; updateWalletBtn(); toast('Demo wallet connected'); return true;
    }
    toast(t('noProvider')); return false;
  }
  try {
    await wallet.connect();
    await wallet.ensureSepolia().catch(() => toast(t('wrongChain')));
    await api.login(wallet.address, (m) => wallet.signMessage(m));
    state.authed = true; updateWalletBtn(); return true;
  } catch (e) { console.warn(e); toast(esc(e.message || 'wallet_error')); return false; }
}
$('#walletBtn').addEventListener('click', async () => {
  if (wallet.address && state.authed) { api.logout(); wallet.disconnect(); state.authed = false; updateWalletBtn(); return; }
  connectWallet();
});
wallet.onChange(() => { if (!wallet.address) state.authed = false; updateWalletBtn(); });

// ---------- Modes ----------
async function startMode(mode) {
  sfx.unlock();
  $$('.modal').forEach(m => m.hidden = true);
  if (mode === 'holder') {
    if (!state.authed && !(await connectWallet())) { toast(t('needWallet')); return; }
    try {
      const { items } = await api.holderSqueeks();
      const list = $('#captainList');
      if (!items.length) { list.innerHTML = `<p class="muted">${t('noSqueek')}</p>`; openModal('captain'); return; }
      list.innerHTML = items.map(s => `<button data-cap="${esc(s.tokenId)}" data-lv="${Number(s.level)}"><canvas width="40" height="40"></canvas><span><b>Squeek #${esc(s.tokenId)}</b><br><span class="muted small">L${Number(s.level)} · +${Math.min(25, s.level * 2.5)}% score</span></span></button>`).join('');
      list.querySelectorAll('button').forEach(b => { ballIcon(b.querySelector('canvas'), Math.min(MAX_LEVEL, Number(b.dataset.lv)), 40); b.onclick = () => { closeModal(b); startRun('holder', { captainTokenId: b.dataset.cap, captainLevel: Number(b.dataset.lv) }); }; });
      openModal('captain');
    } catch (e) { toast(esc(e.code || e.message)); }
    return;
  }
  if (mode === 'pot') { openPot(); return; }
  startRun(mode);
}

async function startRun(mode, opts = {}) {
  let run;
  try {
    if (mode === 'free') {
      const s = await wheel.ready();
      run = { runId: null, mode, board: 0, seed: 'free:' + Math.random().toString(36).slice(2, 12), weather: s ? s.weather : 'NAP', blockStart: Math.floor(s?.blockProgress || 0), captainLevel: 0, rulesVersion: RULES_VERSION };
    } else {
      if ((mode === 'pot') && !state.authed && !(await connectWallet())) return;
      run = await api.startRun(mode, opts);
      if (run.rulesVersion !== RULES_VERSION) { toast('Game updated — reloading'); setTimeout(() => location.reload(), 1200); return; }
    }
  } catch (e) { toast(esc(e.code === 'auth_required' ? t('needWallet') : (e.code || e.message))); return; }
  state.run = run; state.result = null; state.pinned = false;
  state.sim = new Sim({ seed: run.seed, weather: run.weather, blockStart: run.blockStart, captainLevel: run.captainLevel });
  state.pending = []; state.aimX = W / 2;
  state.best = Number(localStorage.getItem('sd.best.' + mode) || 0);
  $('#runMode').textContent = t('m_' + mode);
  $('#runWeather').textContent = `${WX_EMOJI[run.weather]} ${t('w_' + run.weather)}`;
  $('#runWeatherDesc').textContent = t('wd_' + run.weather);
  $('#hudWeather').textContent = `${WX_EMOJI[run.weather]} ${t('w_' + run.weather)}`;
  $('#runSeed').textContent = run.seed.length > 18 ? run.seed.slice(0, 18) + '…' : run.seed;
  $('#captainRow').hidden = !run.captainLevel;
  if (run.captainLevel) $('#runCaptain').textContent = `#${opts.captainTokenId} · L${run.captainLevel}`;
  $('#modal-over').hidden = true;
  show('game');
  sizeStage();
  if (!state.renderer) state.renderer = new Renderer($('#game')); else state.renderer.resize();
  renderQueue(true);
  $('.mini-board .card-title').textContent = t(mode === 'pot' ? 'b_pot' : mode === 'holder' ? 'b_holder' : 'b_daily');
  loadMiniBoard();
  $('#game').focus({ preventScroll: true });
  startLoop();
}

// ---------- Game loop ----------
function startLoop() {
  stopLoop(); state.lastT = performance.now(); state.acc = 0;
  const id = ++state.loopId;
  const frame = (now) => {
    if (id !== state.loopId) return;
    const sim = state.sim;
    let dt = (now - state.lastT) / 1000; state.lastT = now;
    if (dt > 0.25) dt = 1 / 60; // tab was hidden: resume without fast-forward
    state.acc += dt;
    let steps = 0;
    while (state.acc >= 1 / 60 && steps < 5 && !sim.over) {
      while (state.pending.length) { const [code, x] = state.pending.shift(); sim.apply(code, x); }
      sim.step(); steps++; state.acc -= 1 / 60;
      handleEvents(sim.events); sim.events.length = 0;
    }
    if (steps === 5) state.acc = 0;
    state.renderer.draw(sim, state.aimX, dt, true);
    updateHud();
    if (sim.over) { endRun(); return; }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
function stopLoop() { state.loopId++; }
function handleEvents(evs) {
  state.renderer.onEvents(evs);
  for (const e of evs) {
    if (e.t === 'drop') { sfx.drop(); renderQueue(); }
    else if (e.t === 'merge') sfx.merge(e.lv);
    else if (e.t === 'block') { sfx.block(); renderQueue(); }
    else if (e.t === 'shake') sfx.shake();
    else if (e.t === 'swap') { sfx.swap(); renderQueue(); }
    else if (e.t === 'over') sfx.over();
  }
}
let hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function updateHud() {
  const s = state.sim;
  setText('#hudScore', fmt(s.score));
  setText('#hudBest', fmt(Math.max(state.best, s.score)));
  setText('#hudCombo', s.combo > 0 ? '×' + (s.combo + 1) : '—');
  setText('#hudBlocks', String(s.blocks));
  setText('#shakeCount', String(s.shakes));
  $('#hudBar').style.width = (s.blockBar / 1e7).toFixed(2) + '%';
  $('#feverBadge').hidden = !(s.fever > 0);
  $('#shakeBtn').disabled = s.shakes <= 0;
  $('#pouchBtn').disabled = s.swapLocked;
}
function renderQueue(force) {
  const s = state.sim; if (!s) return;
  const n = 1 + WEATHER[s.cfg.weather].preview;
  const q = $('#queue');
  if (force || q.children.length !== n) { q.innerHTML = ''; for (let i = 0; i < n; i++) { const c = document.createElement('canvas'); if (i) c.className = 'small'; q.appendChild(c); } }
  [...q.children].forEach((c, i) => { const lv = s.queue[i]; ballIcon(c, lv, i === 0 ? 72 : 52); c.title = levelName(lv); c.setAttribute('aria-label', levelName(lv)); });
  ballIcon($('#pouchIcon'), s.pouch === -1 ? 1 : s.pouch, 44);
  $('#pouchIcon').style.opacity = s.pouch === -1 ? 0.2 : 1;
}
function sizeStage() {
  // Fit the board in the viewport height on desktop.
  const mobile = window.innerWidth <= 760;
  const top = $('#stage').getBoundingClientRect().top + window.scrollY;
  const avail = window.innerHeight - top - (mobile ? 128 : 48);
  const w = Math.max(260, Math.min(mobile ? window.innerWidth - 32 : 440, Math.floor(avail * 400 / 640)));
  document.documentElement.style.setProperty('--stageW', w + 'px');
}
window.addEventListener('resize', () => { if (state.view === 'game') { sizeStage(); state.renderer && state.renderer.resize(); } });

// ---------- Input ----------
const cv = $('#game');
let pointerDown = false;
cv.addEventListener('pointermove', (e) => { state.aimX = state.renderer ? state.renderer.toWorldX(e.clientX) : W / 2; });
cv.addEventListener('pointerdown', (e) => { sfx.unlock(); pointerDown = true; cv.setPointerCapture(e.pointerId); state.aimX = state.renderer.toWorldX(e.clientX); });
cv.addEventListener('pointerup', (e) => { if (!pointerDown) return; pointerDown = false; state.aimX = state.renderer.toWorldX(e.clientX); queueInput(INPUT.DROP); });
function queueInput(code) {
  const s = state.sim; if (!s || s.over) return;
  if (code === INPUT.DROP) { if (!s.canDrop() || state.pending.some(p => p[0] === INPUT.DROP)) return; state.pending.push([code, Math.max(0, Math.min(W, Math.round(state.aimX)))]); }
  else state.pending.push([code]);
}
$('#pouchBtn').addEventListener('click', () => queueInput(INPUT.SWAP));
$('#shakeBtn').addEventListener('click', () => queueInput(INPUT.SHAKE));
$('#quitBtn').addEventListener('click', () => { if (state.sim && !state.sim.over) { state.sim.over = true; } });
document.addEventListener('keydown', (e) => {
  if (state.view !== 'game' || !state.sim || state.sim.over || !$('#modal-over').hidden) return;
  if (e.key === 'ArrowLeft' || e.key === 'a') { state.aimX = Math.max(0, state.aimX - 14); e.preventDefault(); }
  else if (e.key === 'ArrowRight' || e.key === 'd') { state.aimX = Math.min(W, state.aimX + 14); e.preventDefault(); }
  else if (e.key === ' ' || e.key === 'Enter') { queueInput(INPUT.DROP); e.preventDefault(); }
  else if (e.key === 'c' || e.key === 'C') queueInput(INPUT.SWAP);
  else if (e.key === 'x' || e.key === 'X') queueInput(INPUT.SHAKE);
});

// ---------- End of run ----------
async function endRun() {
  const s = state.sim, run = state.run;
  const summary = s.summary();
  if (s.score > state.best) localStorage.setItem('sd.best.' + run.mode, String(s.score));
  $('#overScore').textContent = fmt(s.score);
  $('#overLv').textContent = s.maxLevel ? `L${s.maxLevel} ${levelName(s.maxLevel)}` : '—';
  $('#overBlocks').textContent = String(s.blocks);
  $('#overRank').textContent = '—';
  $('#overBest').hidden = true;
  $('#pinBtn').hidden = true;
  ballIcon($('#overIcon'), Math.max(1, s.maxLevel), 96);
  const st = $('#overStatus');
  openModal('over');
  if (!run.runId) { st.className = 'status-line'; st.textContent = t('m_free'); $('#overBest').hidden = !(s.score > state.best); return; }
  st.className = 'status-line'; st.textContent = t('verifying');
  try {
    const res = await api.finishRun(run.runId, { inputs: s.inputs, endTick: s.tick, clientSummary: summary });
    state.result = res;
    if (res.status === 'verified') {
      st.className = 'status-line ok'; st.textContent = '✓ ' + t('verified') + (isMock() ? ' (demo)' : '');
      $('#overRank').textContent = res.rank ? '#' + res.rank : '—';
      $('#overBest').hidden = !res.isNewBest;
      $('#pinBtn').hidden = !(res.attestation && res.isNewBest);
    } else { st.className = 'status-line bad'; st.textContent = '✕ ' + t('rejected') + ' · ' + (res.reason || ''); }
  } catch (e) { st.className = 'status-line bad'; st.textContent = '✕ ' + esc(e.code || e.message); }
}
$('#againBtn').addEventListener('click', () => { $('#modal-over').hidden = true; startMode(state.run?.mode === 'holder' ? 'daily' : state.run?.mode || 'daily'); });
$('#shareBtn').addEventListener('click', () => {
  const s = state.sim; if (!s) return;
  const text = `I scored ${s.score} in Squeek Drop ${WX_EMOJI[state.run.weather]} (${t('w_' + state.run.weather)}) and merged up to ${levelName(s.maxLevel || 1)}! Mined ${s.blocks} Squeek blocks with @squeekchain's hamster.`;
  window.open('https://x.com/intent/post?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(location.origin + location.pathname), '_blank', 'noopener');
});
$('#pinBtn').addEventListener('click', async () => {
  const att = state.result?.attestation; if (!att || state.pinned) return;
  const btn = $('#pinBtn'); btn.disabled = true;
  try {
    let hash;
    if (att.mock || isMock()) { await new Promise(r => setTimeout(r, 1200)); hash = '0x' + 'd'.repeat(64); }
    else {
      if (!wallet.address && !(await connectWallet())) throw new Error(t('needWallet'));
      hash = await chainCalls.pinScore(att);
      toast(`${t('txSent')} · <a href="${CONFIG.chain.explorer}/tx/${hash}" target="_blank" rel="noopener">${t('viewTx')}</a>`, 6000);
      const rc = await wallet.waitReceipt(hash);
      if (rc.status !== '0x1') throw new Error(t('txFail'));
    }
    await api.reportPin(att.runId, hash);
    state.pinned = true; btn.textContent = '✓ ' + t('pinned');
  } catch (e) { toast(esc(e.message || t('txFail'))); btn.disabled = false; }
});

// ---------- Leaderboards ----------
const MEDAL = ['🥇', '🥈', '🥉'];
async function loadBoard(board) {
  state.board = board;
  $$('.tabs [data-board]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.board === board)));
  const body = $('#boardBody'); body.innerHTML = `<tr><td colspan="5" class="muted">…</td></tr>`;
  try {
    const r = await api.leaderboard(board);
    if (!r.entries.length) { body.innerHTML = `<tr><td colspan="5" class="muted">${t('empty')}</td></tr>`; return; }
    body.innerHTML = r.entries.map(e => `<tr class="${e.you ? 'you' : ''}"><td>${e.rank <= 3 ? `<span class="rank-medal">${MEDAL[e.rank - 1]}</span>` : e.rank}</td>
      <td>${e.you ? `<b>${t('you')}</b>` : esc(e.name || short(e.address))}${e.pinned ? `<span class="tag-pin">⛓ ${t('pinned')}</span>` : ''}</td>
      <td><span class="lv-cell"><canvas data-lv="${Number(e.maxLevel)}"></canvas>L${Number(e.maxLevel)}</span></td>
      <td>${WX_EMOJI[e.weather] || ''} ${t('w_' + e.weather)}</td><td class="num">${fmt(e.score)}</td></tr>`).join('');
    body.querySelectorAll('canvas[data-lv]').forEach(c => ballIcon(c, Math.min(MAX_LEVEL, Number(c.dataset.lv)), 28));
  } catch (e) { body.innerHTML = `<tr><td colspan="5" class="muted">${esc(e.code || e.message)}</td></tr>`; }
}
$$('.tabs [data-board]').forEach(b => b.addEventListener('click', () => loadBoard(b.dataset.board)));
async function loadMiniBoard() {
  try {
    const r = await api.leaderboard(state.run?.mode === 'pot' ? 'pot' : state.run?.mode === 'holder' ? 'holder' : 'daily');
    $('#miniBoard').innerHTML = r.entries.slice(0, 6).map(e => `<li class="${e.you ? 'you' : ''}"><span class="nm">${e.rank}. ${e.you ? t('you') : esc(e.name || short(e.address))}</span><b>${fmt(e.score)}</b></li>`).join('');
  } catch { $('#miniBoard').innerHTML = ''; }
}

// ---------- Cheese Pot ----------
async function openPot() {
  openModal('pot');
  const st = $('#potStatus'); st.textContent = ''; st.className = 'status-line';
  try {
    const p = await api.pot();
    $('#potWeek').textContent = p.weekLabel || ('#' + p.week);
    $('#potSize').textContent = sqk(p.potBaseUnits);
    $('#potFee').textContent = sqk(p.entryFeeBaseUnits);
    $('#potEntrants').textContent = fmt(p.entrants);
    $('#potEnds').textContent = new Date(p.endsAt).toLocaleString(getLang() === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    $('#potApprove').hidden = p.entered; $('#potEnter').hidden = p.entered; $('#potPlay').hidden = !p.entered;
    if (p.entered) { st.className = 'status-line ok'; st.textContent = '✓ ' + t('potEntered'); }
    state.pot = p;
    if (wallet.address && !isMock()) chainCalls.sqkBalance(wallet.address).then(b => $('#potBal').textContent = sqk(b)).catch(() => {});
    else $('#potBal').textContent = isMock() ? '1,000 SQK (demo)' : '—';
  } catch (e) { st.className = 'status-line bad'; st.textContent = esc(e.code || e.message); }
}
$('#potApprove').addEventListener('click', async () => {
  const st = $('#potStatus');
  if (!state.authed && !(await connectWallet())) return;
  try {
    if (isMock()) { await new Promise(r => setTimeout(r, 700)); }
    else { const h = await chainCalls.approveSqk(CONFIG.contracts.pot, BigInt(state.pot.entryFeeBaseUnits)); st.textContent = t('txSent'); await wallet.waitReceipt(h); }
    st.className = 'status-line ok'; st.textContent = '✓ SQK approved';
  } catch (e) { st.className = 'status-line bad'; st.textContent = esc(e.message || t('txFail')); }
});
$('#potEnter').addEventListener('click', async () => {
  const st = $('#potStatus');
  if (!state.authed && !(await connectWallet())) return;
  try {
    if (isMock()) { await new Promise(r => setTimeout(r, 900)); await api.mockEnterPot(); }
    else {
      const allowance = await chainCalls.sqkAllowance(wallet.address, CONFIG.contracts.pot);
      if (allowance < BigInt(state.pot.entryFeeBaseUnits)) { st.className = 'status-line bad'; st.textContent = t('potApprove'); return; }
      const h = await chainCalls.enterPot(state.pot.week); st.textContent = t('txSent'); const rc = await wallet.waitReceipt(h); if (rc.status !== '0x1') throw new Error(t('txFail'));
    }
    openPot();
  } catch (e) { st.className = 'status-line bad'; st.textContent = esc(e.message || t('txFail')); }
});
$('#potPlay').addEventListener('click', () => { $('#modal-pot').hidden = true; startRun('pot'); });

// ---------- Boot ----------
function buildLadder() {
  $('#ladder').innerHTML = Array.from({ length: 12 }, (_, i) => {
    const lv = i === 11 ? 0 : i + 1;
    return `<div class="rung" role="listitem"><canvas data-lv="${lv}"></canvas><span>${levelName(lv)}</span><small>${lv ? 'L' + lv : '★'}</small></div>`;
  }).join('');
  $$('#ladder canvas').forEach(c => ballIcon(c, Number(c.dataset.lv), 52));
}
function refreshLang() {
  $('#langBtn').textContent = getLang() === 'zh' ? 'EN' : '中';
  applyI18n(); buildLadder(); updateWalletBtn();
  if (wheel.state) renderWheelCards(wheel.state);
  if (state.view === 'board') loadBoard(state.board);
}
$('#langBtn').addEventListener('click', () => { setLang(getLang() === 'zh' ? 'en' : 'zh'); refreshLang(); });
$('#muteBtn').addEventListener('click', () => { const m = sfx.toggle(); $('#muteBtn').textContent = m ? '🔇' : '🔊'; });
$('#muteBtn').textContent = sfx.muted ? '🔇' : '🔊';

(async function boot() {
  ballIcon($('#brandIcon'), 2, 36);
  refreshLang();
  renderWheelCards(null);
  wheel.subscribe(renderWheelCards);
  wheel.start();
  requestAnimationFrame(animateWheels);
  $('#demoBadge').hidden = !isMock();
  try {
    const cfg = await api.config();
    if (cfg.contracts) Object.assign(CONFIG.contracts, { board: cfg.contracts.board || CONFIG.contracts.board, pot: cfg.contracts.pot || CONFIG.contracts.pot });
  } catch (e) { console.warn('config', e); }
  const hash = location.hash.replace('#', '');
  if (hash === 'board') show('board'); else if (['daily', 'free'].includes(hash)) startMode(hash);
})();
