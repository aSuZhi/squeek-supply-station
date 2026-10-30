let lang = localStorage.getItem("ss.lang") || "zh";
const pairs = {
  nextStage: ["下一段", "Next stage"],
  lastStage: [
    "最后一段，把握交付机会。",
    "Final stage. Make your deliveries count.",
  ],
  missions: ["完成任务", "Missions completed"],
  skip: ["跳到内容", "Skip to content"],
  station: ["轮次补给站", "SUPPLY STATION"],
  play: ["挑战", "Play"],
  leaderboard: ["排行榜", "Leaderboard"],
  help: ["怎么玩", "How to play"],
  connect: ["连接钱包", "Connect wallet"],
  headline: [
    "每一次合成，\n都要做点选择。",
    "Every merge.\nA little decision.",
  ],
  intro: [
    "把真实仓鼠的轮次记录，变成你的三分钟补给挑战。继续合成，还是现在交付？",
    "Real hamster settlements become your three-minute supply challenge. Keep merging, or deliver now?",
  ],
  daily: ["开始每日挑战", "Play daily challenge"],
  practice: ["自由练习", "Free practice"],
  anonymousHint: [
    "无需钱包也能玩；开局前登录可进入真实排行榜。",
    "No wallet needed. Sign in before starting to join the real leaderboard.",
  ],
  objective: ["合成 · 储存 · 交付", "MERGE · STORE · DELIVER"],
  heroTask: ["空出空间，也别错过机会。", "Make room. Make the moment."],
  heroDescription: [
    "交付指定等级的仓鼠获得补给分。继续合成可以冲高分，但会失去当前任务需要的材料。",
    "Deliver the requested level for supply points. A bigger merge might cost the materials you need now.",
  ],
  frozenLabel: [
    "真实结算记录 / 固定赛题",
    "REAL SETTLEMENTS / FIXED CHALLENGE",
  ],
  today: ["今日轮次挑战", "Today's supply route"],
  loading: ["正在加载…", "Loading…"],
  sourceTitle: ["赛题来源与映射规则", "Sources and mapping rules"],
  sourceRule: [
    "每段历史结算压缩为 60 秒游戏阶段。工作量决定阶段与目标等级，已完成区块数决定交付数量。这是游戏映射，不是链的原生规则。",
    "Each historical settlement becomes a 60-second stage. Work sets activity and target level; completed blocks set the quota. This is a game mapping, not a native chain rule.",
  ],
  retry: ["重试", "Retry"],
  rule1: ["先合成，再决定", "Merge, then decide"],
  rule1body: [
    "相同等级接触会合成。绿色虚线圈出可交付的目标；交付后会离开盘面。",
    "Matching levels merge on contact. A green ring marks a delivery candidate; delivering removes it.",
  ],
  rule2: ["同一赛题，公平比较", "One challenge. Equal conditions."],
  rule2body: [
    "每日挑战固定掉落序列、三段任务和计分规则，不随实时天气变化。",
    "Daily drops, missions and scoring are frozen. Live weather never changes ranked conditions.",
  ],
  rule3: ["每一分，都能回放", "Every point can be replayed"],
  rule3body: [
    "服务端重放操作后记录成绩。个人最佳可在配置好的 Sepolia 合约存证。",
    "The server replays inputs before saving scores. Personal bests can be pinned to a configured Sepolia contract.",
  ],
  finish: ["结束并结算", "Finish run"],
  journey: ["三段补给路线", "YOUR THREE-STAGE ROUTE"],
  gameNotice: [
    "盘面能量、补给和合成均为游戏内数值，不会挖出真实区块或产生 SQK。",
    "Energy and supplies are game values. Playing does not mine real blocks or create SQK.",
  ],
  score: ["总分", "Score"],
  delivered: ["已交付", "Delivered"],
  remaining: ["剩余", "Time left"],
  energy: ["游戏能量", "Game energy"],
  controls: [
    "点击投放 · ← → 瞄准 · 空格投放 · E 交付 · C 储存 · X 摇晃",
    "Tap to drop · ← → Aim · Space Drop · E Deliver · C Store · X Shake",
  ],
  deliver: ["交付补给 E", "Deliver E"],
  next: ["接下来", "Up next"],
  pouch: ["腮帮袋 C", "Pouch C"],
  shake: ["摇晃 X", "Shake X"],
  verifiedBoard: [
    "仅记录服务端验证的真实成绩",
    "REAL SCORES VERIFIED BY SERVER REPLAY",
  ],
  date: ["UTC 日期", "UTC date"],
  boardRules: [
    "每个钱包保留最高分；同分按首次取得该分数的时间排序。链上确认与服务端验证分别显示。",
    "One best per wallet. Ties use the earliest completion time. Server verification and chain confirmation are separate.",
  ],
  rank: ["名次", "Rank"],
  player: ["玩家", "Player"],
  proof: ["验证记录", "Evidence"],
  refresh: ["刷新榜单", "Refresh board"],
  footer: [
    "来自真实结算的游戏挑战 · 不产生真实 SQK · 服务端回放验证",
    "Challenges from real settlements · No real SQK generated · Server replay verified",
  ],
  official: ["Squeekchain 官网 ↗", "Squeekchain ↗"],
  runComplete: ["本次补给结束", "SUPPLY RUN COMPLETE"],
  viewTx: ["查看交易 ↗", "View transaction ↗"],
  retryFinish: ["重试提交", "Retry submission"],
  pin: ["存证到 Sepolia", "Pin on Sepolia"],
  again: ["再挑战一次", "Play again"],
  back: ["返回大厅", "Back to station"],
  trust: [
    "链上记录证明签名方认可此成绩；合约不重算游戏，也不证明操作者是真人。",
    "The record proves the signer accepted this score. The contract does not rerun the game or prove a human played.",
  ],
  close: ["关闭", "Close"],
  NAP: ["休整", "Restock"],
  JOG: ["运输", "Transport"],
  ZOOMIES: ["加急", "Express"],
  phase: ["阶段", "Stage"],
  rounds: ["历史轮次", "Historical rounds"],
  quota: ["交付", "Deliver"],
  bonus: ["任务完成额外 +200", "Mission bonus +200"],
  waiting: [
    "准备目标等级；出生满 70 tick 后可交付。",
    "Prepare the target level. It must be 70 ticks old to deliver.",
  ],
  ready: ["绿色虚线圈中的目标可交付。", "The green-ringed hamster is ready."],
  missionDone: [
    "任务完成！可为下一段保留材料。",
    "Mission complete! Save supplies for the next stage.",
  ],
  ranked: ["已登录 · 本局计入排行榜", "Signed in · Ranked run"],
  unranked: ["游客体验 · 本局不计入排行榜", "Guest · Not ranked"],
  practiceHint: [
    "本地练习 · 人工配置 · 不提交成绩",
    "Local practice · Synthetic configuration · No submission",
  ],
  verified: ["服务端回放验证通过", "Server replay verified"],
  verifying: ["正在提交并回放验证…", "Submitting and verifying replay…"],
  localComplete: [
    "本地练习已完成，未提交服务器。",
    "Local practice complete. No server submission.",
  ],
  empty: [
    "还没有真实成绩。成为第一位补给员吧。",
    "No real scores yet. Be the first supply runner.",
  ],
  unavailable: [
    "今日赛题暂不可用。可重试或进入自由练习。",
    "Daily challenge unavailable. Retry or play practice.",
  ],
  frozen: [
    "赛题已发布并冻结，所有人使用相同配置。",
    "Published and frozen. Everyone receives the same configuration.",
  ],
  chainMissing: [
    "成绩存证暂未配置。服务端验证与真实排行榜仍可使用。",
    "Score attestation is not configured. Verification and rankings are available.",
  ],
  anonResult: [
    "本局为游客体验。登录后重新开局可参与排名。",
    "Guest run. Sign in before your next run to rank.",
  ],
  confirmed: ["链上已确认", "Confirmed on-chain"],
  pending: [
    "交易已提交，等待链上确认",
    "Transaction submitted; awaiting confirmation",
  ],
  notPinned: ["服务端已验证", "Server verified"],
  you: ["你", "You"],
  replay: ["回放数据", "Replay data"],
  sessionChanged: [
    "钱包已变更，请重新登录。游客局不会自动转为排位局。",
    "Wallet changed. Sign in again. Guest runs do not become ranked mid-game.",
  ],
  loginFirst: [
    "请使用开局时的钱包重新登录。",
    "Sign in with the wallet used to start this run.",
  ],
  network_error: [
    "网络连接失败。请检查后端是否启动，再重试。",
    "Connection failed. Check the backend, then retry.",
  ],
  auth_required: [
    "登录已过期，请重新连接钱包。",
    "Session expired. Reconnect your wallet.",
  ],
  challenge_changed: [
    "UTC 日期已更新，请重新加载挑战。",
    "UTC date changed. Reload the challenge.",
  ],
  rules_version_mismatch: [
    "规则已更新，请刷新页面。",
    "Rules changed. Refresh the page.",
  ],
  attestation_not_configured: [
    "成绩合约或签名服务尚未配置。",
    "Contract or signer is not configured.",
  ],
  score_already_pinned: [
    "此分数或更高分数已存证。",
    "This score or a higher score is already pinned.",
  ],
  not_personal_best: [
    "只有当前个人最佳可以申请存证。",
    "Only your current personal best can be attested.",
  ],
  wrong_rpc_chain: ["后端 RPC 网络不匹配。", "Backend RPC network mismatch."],
  signer_mismatch: [
    "合约签名者与后端配置不匹配。",
    "Contract signer and backend configuration differ.",
  ],
  challenge_not_found: [
    "该日期尚无已发布赛题。",
    "No published challenge for that date.",
  ],
  rejected: ["验证未通过", "Verification rejected"],
  noWallet: [
    "未检测到浏览器钱包。仍可匿名挑战或自由练习。",
    "No browser wallet found. Guest play and practice remain available.",
  ],
  restored: [
    "已恢复上次结算，请重试提交或查看存证状态。",
    "Previous result restored. Retry submission or check the pin status.",
  ],
  helpContent: [
    "<ol><li>点击盘面或空格投放，同级接触合成。</li><li>三段任务，每段 60 秒。提前查看下一段目标，保留材料。</li><li>E 或交付按钮送走指定等级的成熟仓鼠。每只等级 ×40 分，达到数量再加 200 分。</li><li>C 储存/交换，X 摇晃。每段重置次数：休整两次，其他一次。</li><li>堆过红线持续两秒结束。满能量触发 10 秒双倍合成分，与真实出块无关。</li><li>每日赛题基于官方安全结算并冻结，练习为人工配置。登录后开局才计入真实排行榜。</li></ol>",
    "<ol><li>Tap or Space to drop. Matching levels merge on contact.</li><li>Three 60-second missions. Save materials for the next target.</li><li>E delivers one mature hamster at the exact requested level. Earn level ×40 per delivery and +200 for the quota.</li><li>C stores/swaps; X shakes. Charges reset each stage: two for Restock, one otherwise.</li><li>Two seconds above the red line ends the run. Full game energy doubles merge points for 10 seconds, not real blocks.</li><li>Daily challenges are frozen from safe official settlements. Practice is synthetic. Sign in before starting to rank.</li></ol>",
  ],
};
export const t = (key) => pairs[key]?.[lang === "zh" ? 0 : 1] || key;
export const getLang = () => lang;
export function toggleLang() {
  lang = lang === "zh" ? "en" : "zh";
  localStorage.setItem("ss.lang", lang);
  applyI18n();
}
export function applyI18n() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document
    .querySelectorAll("[data-i18n]")
    .forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelector("#langBtn").textContent = lang === "zh" ? "EN" : "中";
}
