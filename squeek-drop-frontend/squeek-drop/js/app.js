import { CONFIG } from "./config.js";
import { api } from "./api.js";
import { Sim, INPUT, RULES_VERSION, MAX_TICKS, W, WEATHER } from "./engine.js";
import { practiceConfig } from "./challenge.js";
import { Renderer, ballIcon } from "./render.js";
import { wallet, chainCalls, short } from "./wallet.js";
import { t, toggleLang, applyI18n } from "./i18n.js";
import { sfx } from "./audio.js";

const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const roundLabel = (value) => String(value).replace(/^(\d+)–\1$/, "$1");
const state = {
  view: "lobby",
  challenge: null,
  address: null,
  sim: null,
  run: null,
  mode: null,
  playing: false,
  starting: false,
  ending: false,
  aim: 200,
  inputs: [],
  renderer: null,
  result: null,
  payload: null,
  txHash: null,
};
let raf = 0,
  lastTime = 0,
  accumulator = 0,
  lastPhase = -1,
  lastQueue = "",
  pinTimer = null;
const text = (id, value) => {
  const el = $(id);
  if (el.textContent !== String(value)) el.textContent = value;
};
function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 6000);
}
function errorMessage(e) {
  if (e.status === 401) {
    state.address = null;
    updateWallet();
  }
  return t(e.code || e.message || "request_failed");
}
function show(view) {
  state.view = view;
  document.body.dataset.view = view;
  for (const id of ["lobby", "gameView", "boardView"])
    $("#" + id).hidden = id !== view;
  window.scrollTo({ top: 0 });
}
function updateWallet() {
  text("#walletBtn", state.address ? short(state.address) : t("connect"));
  text("#entryHint", state.address ? t("ranked") : t("anonymousHint"));
}
async function connect() {
  if (!wallet.provider) {
    toast(t("noWallet"));
    return false;
  }
  $("#walletBtn").disabled = true;
  try {
    const address = await wallet.connect();
    await wallet.ensureSepolia();
    const result = await api.login(address, (m) => wallet.signMessage(m));
    if (wallet.address?.toLowerCase() !== result.address)
      throw new Error("sessionChanged");
    state.address = result.address;
    updateWallet();
    return true;
  } catch (e) {
    api.logout();
    state.address = null;
    updateWallet();
    toast(errorMessage(e));
    return false;
  } finally {
    $("#walletBtn").disabled = false;
  }
}
wallet.onChange(() => {
  if (
    state.address &&
    (wallet.address?.toLowerCase() !== state.address ||
      wallet.chainId?.toLowerCase() !== CONFIG.chain.hex)
  ) {
    api.logout();
    state.address = null;
    updateWallet();
    toast(t("sessionChanged"));
  }
});
$("#walletBtn").onclick = () => {
  if (state.address) {
    api.logout();
    state.address = null;
    wallet.disconnect();
    updateWallet();
  } else connect();
};

function renderChallenge() {
  const c = state.challenge;
  if (!c) return;
  text("#challengeDate", c.day + " UTC");
  text("#challengeStatus", t("frozen"));
  $("#phaseCards").innerHTML = c.config.phases
    .map(
      (p, i) =>
        `<article class="phase-card"><span class="eyebrow">${t("phase")} 0${i + 1} · ${t(p.weather)}</span><b>L${p.targetLevel} × ${p.quota}</b><p>${t("rounds")} ${esc(roundLabel(p.roundLabel))}</p><p>${p.reward} / ${t("quota")} · ${t("bonus")}</p><a href="https://sepolia.etherscan.io/tx/${esc(c.source.records[i].transactionHash)}" target="_blank" rel="noopener">${t("viewTx")}</a></article>`,
    )
    .join("");
  $("#sourceBody").innerHTML =
    `<p>UTC ${esc(c.publishedAt)} · ${esc(c.config.rulesVersion)}</p><p>Config: <code>${esc(c.configHash)}</code></p><ul>${c.source.records.map((r) => `<li>${t("rounds")} ${esc(r.afterRound)} → ${esc(r.throughRound)} · work ${esc(r.workAdded)} · blocks ${esc(r.completedBlocks)} · ${esc(r.settledAt)}</li>`).join("")}</ul><a href="${CONFIG.apiBase}/v1/challenges/${c.challengeId}" target="_blank" rel="noopener">JSON ↗</a>`;
}
async function loadChallenge() {
  $("#dailyBtn").disabled = true;
  $("#retryChallenge").hidden = true;
  text("#challengeStatus", t("loading"));
  try {
    state.challenge = await api.request("/v1/challenges/today", {
      publicRead: true,
    });
    if (state.challenge.config.rulesVersion !== RULES_VERSION)
      throw new Error("rules_version_mismatch");
    renderChallenge();
    $("#dailyBtn").disabled = false;
    $("#boardDate").value = state.challenge.day;
  } catch (e) {
    text("#challengeStatus", t("unavailable") + " " + errorMessage(e));
    $("#retryChallenge").hidden = false;
  }
}
$("#retryChallenge").onclick = loadChallenge;
async function start(mode) {
  if (state.starting || state.playing || state.submitting) return;
  state.starting = true;
  $("#dailyBtn").disabled = true;
  $("#practiceBtn").disabled = true;
  sfx.unlock();
  try {
    let config,
      run = null;
    if (mode === "daily") {
      if (!state.challenge) throw new Error("unavailable");
      run = await api.request("/v1/runs", {
        method: "POST",
        body: {
          mode,
          challengeId: state.challenge.challengeId,
          clientRulesVersion: RULES_VERSION,
        },
      });
      config = run.challenge.config;
      run.address = state.address;
    } else config = practiceConfig("practice:" + crypto.randomUUID());
    state.mode = mode;
    state.run = run;
    state.result = null;
    state.payload = null;
    state.txHash = null;
    state.sim = new Sim(config);
    state.inputs = [];
    state.aim = W / 2;
    state.ending = false;
    state.playing = true;
    sessionStorage.removeItem("ss.pending");
    clearInterval(pinTimer);
    $("#resultDialog").close();
    show("gameView");
    state.renderer = new Renderer($("#game"));
    lastPhase = -1;
    lastQueue = "";
    updateHUD();
    renderQueue();
    text("#runMode", t(mode === "daily" ? "today" : "practice"));
    text(
      "#rankedLabel",
      t(mode === "free" ? "practiceHint" : run.ranked ? "ranked" : "unranked"),
    );
    $("#game").focus({ preventScroll: true });
    lastTime = performance.now();
    accumulator = 0;
    raf = requestAnimationFrame(frame);
  } catch (e) {
    toast(errorMessage(e));
    if (e.code === "challenge_changed") await loadChallenge();
  } finally {
    state.starting = false;
    $("#dailyBtn").disabled = !state.challenge;
    $("#practiceBtn").disabled = false;
  }
}
$("#dailyBtn").onclick = () => start("daily");
$("#practiceBtn").onclick = () => start("free");
function frame(now) {
  if (!state.playing) return;
  const sim = state.sim;
  let dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  accumulator += dt;
  let steps = 0;
  while (accumulator >= 1 / 60 && steps < 6 && !sim.over) {
    for (const [code, x] of state.inputs.splice(0)) sim.apply(code, x);
    sim.step();
    accumulator -= 1 / 60;
    steps++;
    state.renderer.onEvents(sim.events);
    for (const event of sim.events) {
      if (event.t === "drop") sfx.drop();
      else if (event.t === "merge" || event.t === "delivery")
        sfx.merge(event.lv);
      else if (event.t === "block") sfx.block();
      else if (event.t === "shake") sfx.shake();
      else if (event.t === "swap") sfx.swap();
    }
    sim.events.length = 0;
  }
  state.renderer.draw(sim, state.aim, dt, true);
  updateHUD();
  renderQueue();
  if (sim.over) {
    finish();
    return;
  }
  raf = requestAnimationFrame(frame);
}
document.addEventListener("visibilitychange", () => {
  lastTime = performance.now();
  accumulator = 0;
});
function updateHUD() {
  const s = state.sim;
  if (!s) return;
  const p = s.phase;
  text("#score", s.score.toLocaleString());
  text("#delivered", s.deliveries);
  const seconds = Math.ceil((MAX_TICKS - s.tick) / 60);
  text(
    "#time",
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
  );
  text("#shakes", s.shakes);
  $("#energyBar").style.width = s.blockBar / 1e7 + "%";
  text("#fever", s.fever > 0 ? "FEVER ×2" : "");
  $("#deliverBtn").disabled = !s.deliveryCandidate || !state.playing;
  $("#pouchBtn").disabled = s.swapLocked;
  $("#shakeBtn").disabled = !s.shakes || !s.balls.length;
  text(
    "#phaseTitle",
    `${t("phase")} ${s.phaseIndex + 1}/3 · ${t(p.weather)} · ${Math.ceil((p.endTick - s.tick) / 60)}s`,
  );
  text("#missionTitle", `${t("quota")} L${p.targetLevel}`);
  text(
    "#missionProgress",
    `${s.phaseDelivered[s.phaseIndex]} / ${p.quota} · ${t("quota")}`,
  );
  text("#missionReward", `${p.reward} / ${t("quota")} · ${t("bonus")}`);
  text(
    "#deliveryHint",
    t(
      s.phaseDelivered[s.phaseIndex] >= p.quota
        ? "missionDone"
        : s.deliveryCandidate
          ? "ready"
          : "waiting",
    ),
  );
  const next = s.cfg.phases[s.phaseIndex + 1];
  text(
    "#nextMission",
    next
      ? `${t("nextStage")}: ${t(next.weather)} · L${next.targetLevel} × ${next.quota}`
      : t("lastStage"),
  );
  if (lastPhase !== s.phaseIndex) {
    lastPhase = s.phaseIndex;
    $("#journey").innerHTML = s.cfg.phases
      .map(
        (phase, i) =>
          `<li class="${i === s.phaseIndex ? "active" : ""}"><b>${i + 1}. ${t(phase.weather)} · L${phase.targetLevel} × ${phase.quota}</b><span>${t("rounds")} ${esc(roundLabel(phase.roundLabel))}</span></li>`,
      )
      .join("");
  }
}
function renderQueue() {
  const s = state.sim;
  if (!s) return;
  const n = 1 + WEATHER[s.phase.weather].preview;
  const key = s.queue.slice(0, n).join(",") + ":" + s.pouch;
  if (key === lastQueue) return;
  lastQueue = key;
  $("#queue").innerHTML = "";
  s.queue.slice(0, n).forEach((lv) => {
    const c = document.createElement("canvas");
    c.setAttribute("aria-label", "L" + lv);
    $("#queue").append(c);
    ballIcon(c, lv, 48);
  });
  ballIcon($("#pouchIcon"), s.pouch < 0 ? 1 : s.pouch, 38);
  $("#pouchIcon").style.opacity = s.pouch < 0 ? 0.25 : 1;
}
function input(code) {
  if (!state.playing || state.inputs.some((a) => a[0] === code)) return;
  state.inputs.push([
    code,
    code === INPUT.DROP
      ? Math.round(Math.max(0, Math.min(W, state.aim)))
      : undefined,
  ]);
}
let pointer = false;
const canvas = $("#game");
canvas.onpointerdown = (e) => {
  if (!state.playing) return;
  pointer = true;
  canvas.setPointerCapture(e.pointerId);
  state.aim = state.renderer.toWorldX(e.clientX);
};
canvas.onpointermove = (e) => {
  if (state.renderer) state.aim = state.renderer.toWorldX(e.clientX);
};
canvas.onpointerup = (e) => {
  if (pointer) {
    pointer = false;
    state.aim = state.renderer.toWorldX(e.clientX);
    input(INPUT.DROP);
  }
};
canvas.onpointercancel = () => {
  pointer = false;
};
document.addEventListener("keydown", (e) => {
  if (
    !state.playing ||
    $("dialog[open]") ||
    /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)
  )
    return;
  const key = e.key.toLowerCase();
  if (key === "arrowleft" || key === "a") {
    state.aim = Math.max(0, state.aim - 16);
    e.preventDefault();
  } else if (key === "arrowright" || key === "d") {
    state.aim = Math.min(W, state.aim + 16);
    e.preventDefault();
  } else if (key === " " && e.target.tagName !== "BUTTON") {
    input(INPUT.DROP);
    e.preventDefault();
  } else if (key === "e") {
    input(INPUT.DELIVER);
    e.preventDefault();
  } else if (key === "c") {
    input(INPUT.SWAP);
    e.preventDefault();
  } else if (key === "x") {
    input(INPUT.SHAKE);
    e.preventDefault();
  }
});
$("#deliverBtn").onclick = () => input(INPUT.DELIVER);
$("#pouchBtn").onclick = () => input(INPUT.SWAP);
$("#shakeBtn").onclick = () => input(INPUT.SHAKE);
window.addEventListener("resize", () => state.renderer?.resize());
function savePending() {
  if (state.run)
    sessionStorage.setItem(
      "ss.pending",
      JSON.stringify({
        run: state.run,
        mode: state.mode,
        payload: state.payload,
        result: state.result,
        txHash: state.txHash,
      }),
    );
}
async function finish() {
  if (state.ending) return;
  state.ending = true;
  state.playing = false;
  cancelAnimationFrame(raf);
  state.payload = {
    inputs: state.sim.inputs,
    endTick: state.sim.tick,
    clientSummary: state.sim.summary(),
  };
  savePending();
  showResult();
  if (state.run) await submit();
}
function showResult() {
  const s = state.payload.clientSummary;
  text("#resultScore", s.score.toLocaleString());
  text(
    "#resultStats",
    `${t("delivered")} ${s.deliveries} · ${t("missions")} ${s.completedMissions}/3 · ${s.maxLevel ? "L" + s.maxLevel : "—"}`,
  );
  text("#resultRank", "");
  text("#chainStatus", "");
  $("#txLink").hidden = true;
  $("#pinBtn").hidden = true;
  $("#pinBtn").disabled = false;
  $("#retryFinish").hidden = true;
  text("#resultStatus", t(state.run ? "verifying" : "localComplete"));
  $("#resultStatus").className = "";
  $("#resultConnect").hidden =
    !state.run?.ranked || state.address === state.run?.address;
  if (!$("#resultDialog").open) $("#resultDialog").showModal();
  if (state.result) renderResult();
}
async function submit() {
  if (state.submitting) return;
  state.submitting = true;
  $("#againBtn").disabled = true;
  $("#retryFinish").hidden = true;
  text("#resultStatus", t("verifying"));
  try {
    state.result = await api.request(`/v1/runs/${state.run.runId}/finish`, {
      method: "POST",
      body: state.payload,
      runToken: state.run.runToken,
      publicRead: !state.run.ranked,
    });
    savePending();
    renderResult();
  } catch (e) {
    text("#resultStatus", errorMessage(e));
    $("#resultStatus").className = "bad";
    $("#retryFinish").hidden = false;
    $("#resultConnect").hidden = !state.run.ranked;
  } finally {
    state.submitting = false;
    $("#againBtn").disabled = false;
  }
}
function renderResult() {
  const r = state.result;
  if (!r) return;
  text(
    "#resultStatus",
    r.status === "verified" ? t("verified") : `${t("rejected")} · ${r.reason}`,
  );
  $("#resultStatus").className = r.status === "verified" ? "ok" : "bad";
  text(
    "#resultRank",
    r.ranked ? (r.rank ? `${t("rank")} #${r.rank}` : "") : t("anonResult"),
  );
  $("#pinBtn").hidden = !(
    r.status === "verified" &&
    r.ranked &&
    r.isNewBest &&
    r.summary.score > 0 &&
    CONFIG.attestationConfigured
  );
  if (r.ranked && !CONFIG.attestationConfigured)
    text("#chainStatus", t("chainMissing"));
  if (state.txHash) {
    showTx();
    pollPin();
    clearInterval(pinTimer);
    pinTimer = setInterval(pollPin, 15000);
  }
}
function showTx() {
  text("#chainStatus", t("pending"));
  $("#pinBtn").disabled = true;
  $("#txLink").hidden = false;
  $("#txLink").href = CONFIG.chain.explorer + "/tx/" + state.txHash;
}
async function pollPin() {
  if (!state.txHash || !state.run || !api.token) return;
  try {
    const result = await api.request(`/v1/runs/${state.run.runId}/pin`, {
      method: "POST",
      body: { txHash: state.txHash },
    });
    text(
      "#chainStatus",
      t(result.status === "confirmed" ? "confirmed" : "pending"),
    );
    if (result.status === "confirmed") clearInterval(pinTimer);
  } catch (e) {
    text("#chainStatus", errorMessage(e));
    if (e.code === "invalid_pin_transaction") {
      clearInterval(pinTimer);
      state.txHash = null;
      savePending();
      $("#pinBtn").disabled = false;
    }
  }
}
$("#pinBtn").onclick = async () => {
  if (!state.address || state.address !== state.run.address) {
    toast(t("loginFirst"));
    return;
  }
  $("#pinBtn").disabled = true;
  try {
    await wallet.ensureSepolia();
    const accounts = await wallet.provider.request({ method: "eth_accounts" });
    if (accounts[0]?.toLowerCase() !== state.run.address)
      throw new Error("loginFirst");
    const att = await api.request(`/v1/runs/${state.run.runId}/attestation`, {
      method: "POST",
    });
    state.txHash = await chainCalls.pinScore(att);
    savePending();
    showTx();
    await pollPin();
    clearInterval(pinTimer);
    pinTimer = setInterval(pollPin, 15000);
  } catch (e) {
    text("#chainStatus", errorMessage(e));
    $("#pinBtn").disabled = false;
  }
};
$("#quitBtn").onclick = finish;
$("#retryFinish").onclick = submit;
$("#resultConnect").onclick = async () => {
  if (await connect()) {
    $("#resultConnect").hidden = state.address === state.run?.address;
    if (!state.result && state.address === state.run?.address) await submit();
  }
};
$("#againBtn").onclick = () => {
  const mode = state.mode;
  $("#resultDialog").close();
  start(mode);
};
$("#resultHome").onclick = () => {
  $("#resultDialog").close();
  show("lobby");
};
async function navigate(view) {
  if (state.playing) {
    await finish();
    return;
  }
  show(view);
  if (view === "boardView") loadBoard();
}
$("#homeBtn").onclick = () => navigate("lobby");
$("#lobbyBtn").onclick = () => navigate("lobby");
$("#boardBtn").onclick = () => navigate("boardView");
let boardRequest = 0;
async function loadBoard() {
  const request = ++boardRequest;
  $("#boardBody").innerHTML =
    `<tr><td class="empty" colspan="5">${t("loading")}</td></tr>`;
  try {
    const date = $("#boardDate").value || "today";
    const r = await api.request("/v1/leaderboards/" + date);
    if (request !== boardRequest) return;
    $("#boardBody").innerHTML = r.entries.length
      ? r.entries
          .map(
            (e) =>
              `<tr class="${e.you ? "you" : ""}"><td>${e.rank}</td><td title="${esc(e.address)}">${e.you ? t("you") + " · " : ""}${short(e.address)}</td><td>${e.score.toLocaleString()}</td><td>${e.deliveries}</td><td><a href="${CONFIG.apiBase}/v1/proofs/${e.runId}" target="_blank" rel="noopener">${t("replay")}</a><small>${t(e.pinned ? "confirmed" : e.pinStatus === "pending" ? "pending" : "notPinned")}</small></td></tr>`,
          )
          .join("")
      : `<tr><td class="empty" colspan="5">${t("empty")}</td></tr>`;
  } catch (e) {
    if (request === boardRequest)
      $("#boardBody").innerHTML =
        `<tr><td class="empty" colspan="5">${esc(errorMessage(e))}</td></tr>`;
  }
}
$("#refreshBoard").onclick = loadBoard;
$("#boardDate").onchange = loadBoard;
$("#helpBtn").onclick = () => {
  $("#helpBody").innerHTML = t("helpContent");
  $("#helpDialog").showModal();
};
$("#closeHelp").onclick = () => $("#helpDialog").close();
$("#muteBtn").onclick = () => {
  sfx.unlock();
  text("#muteBtn", sfx.toggle() ? "🔇" : "🔊");
};
text("#muteBtn", sfx.muted ? "🔇" : "🔊");
$("#langBtn").onclick = () => {
  toggleLang();
  updateWallet();
  renderChallenge();
  lastPhase = -1;
  updateHUD();
  $("#helpBody").innerHTML = t("helpContent");
  if (state.mode) {
    text("#runMode", t(state.mode === "daily" ? "today" : "practice"));
    text(
      "#rankedLabel",
      t(
        state.mode === "free"
          ? "practiceHint"
          : state.run?.ranked
            ? "ranked"
            : "unranked",
      ),
    );
  }
  if (state.view === "boardView") loadBoard();
  if (state.payload && $("#resultDialog").open) showResult();
};
applyI18n();
ballIcon($("#brandIcon"), 2, 38);
ballIcon($("#heroIcon"), 7, 134);
updateWallet();
async function boot() {
  try {
    const config = await api.request("/v1/config", { publicRead: true });
    CONFIG.contracts.board = config.contracts.board;
    CONFIG.attestationConfigured = config.attestationConfigured;
  } catch (e) {
    toast(errorMessage(e));
  }
  if (api.token && wallet.provider) {
    try {
      const accounts = await wallet.provider.request({
        method: "eth_accounts",
      });
      const me = await api.request("/v1/me");
      if (accounts[0]?.toLowerCase() === me.address) {
        await wallet.connect();
        state.address = me.address;
        updateWallet();
      } else api.logout();
    } catch {
      api.logout();
    }
  } else if (api.token) api.logout();
  await loadChallenge();
  try {
    const pending = JSON.parse(sessionStorage.getItem("ss.pending"));
    if (pending?.run && pending.payload) {
      Object.assign(state, pending);
      state.ending = true;
      showResult();
      if (!state.result) text("#resultStatus", t("restored"));
      $("#retryFinish").hidden = !!state.result;
    }
  } catch {
    sessionStorage.removeItem("ss.pending");
  }
}
boot();
