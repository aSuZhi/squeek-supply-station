// User-operated only. No private keys, silent sends, backend custody or automatic retries.
const $ = (s) => document.querySelector(s);
let config,
  account,
  busy = false;
const provider = () => window.ethereum;
const say = (message) => ($("#status").textContent = message);
const key = () =>
  `squeek.imd.first.${config.payer.toLowerCase()}.${config.repoUrl.toLowerCase()}`;
const rpc = (method, params = []) => provider().request({ method, params });
const word = (a) => a.slice(2).toLowerCase().padStart(64, "0");
function link(hash, label) {
  const p = document.createElement("p"),
    a = document.createElement("a");
  a.href = "https://etherscan.io/tx/" + hash;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = label + " " + hash;
  p.append(a);
  $("#links").append(p);
}
function validTime() {
  return Date.now() < config.expiresAt * 1000;
}
function state() {
  const ready = !!account && !busy && validTime();
  $("#connect").disabled = busy || !validTime();
  $("#approve").disabled = !ready;
  $("#submit").disabled = true;
  if (!validTime()) say("报价已过期。请让我刷新请求后再操作；不要沿用旧交易。");
}
async function assertWallet() {
  const accounts = await rpc("eth_accounts");
  if (accounts[0]?.toLowerCase() !== config.payer.toLowerCase())
    throw Error("请使用 Genesis 已验证的钱包 " + config.payer);
  if ((await rpc("eth_chainId")) !== "0x1")
    throw Error("付款必须在 Ethereum 主网；游戏部署才使用 Sepolia。");
  if (!validTime()) throw Error("报价已过期，请刷新报价后再操作。");
}
async function allowance() {
  return BigInt(
    await rpc("eth_call", [
      {
        to: config.asset,
        data: "0xdd62ed3e" + word(account) + word(config.intake),
      },
      "latest",
    ]),
  );
}
async function refresh() {
  state();
  if (!account || busy || !validTime()) return;
  const already = localStorage.getItem(key() + ".request");
  if (already) {
    $("#approve").disabled = true;
    $("#submit").disabled = true;
    say("已保存提交交易，请勿再次付款：" + already);
    return;
  }
  const amount = await allowance();
  $("#approve").disabled = amount >= BigInt(config.amount);
  $("#submit").disabled = amount < BigInt(config.amount);
  say(
    amount >= BigInt(config.amount)
      ? "当前授权足够。核对请求后，可由你点击第 3 步发起工作流。"
      : "已连接正确钱包。下一步由你授权最多 0.5 IMD。",
  );
}
async function receipt(hash) {
  for (let i = 0; i < 120; i++) {
    const r = await rpc("eth_getTransactionReceipt", [hash]);
    if (r) {
      if (r.status !== "0x1") throw Error("交易失败：" + hash);
      return r;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw Error("交易尚未确认，请保留哈希，不要重复付款。");
}
async function send(tx) {
  await assertWallet();
  const gas = await rpc("eth_estimateGas", [
    { from: account, to: tx.to, data: tx.data, value: "0x0" },
  ]);
  return rpc("eth_sendTransaction", [
    {
      from: account,
      to: tx.to,
      data: tx.data,
      value: "0x0",
      gas: "0x" + ((BigInt(gas) * 120n) / 100n).toString(16),
    },
  ]);
}
$("#connect").onclick = async () => {
  try {
    if (!provider()) throw Error("请使用安装了 MetaMask 或 Rabby 的浏览器。");
    const accounts = await rpc("eth_requestAccounts");
    account = accounts[0];
    if (account?.toLowerCase() !== config.payer.toLowerCase())
      throw Error("请切换到已验证的钱包 " + config.payer);
    if ((await rpc("eth_chainId")) !== "0x1")
      await rpc("wallet_switchEthereumChain", [{ chainId: "0x1" }]);
    account = (await rpc("eth_accounts"))[0];
    await assertWallet();
    const balance = BigInt(
      await rpc("eth_call", [
        { to: config.asset, data: "0x70a08231" + word(account) },
        "latest",
      ]),
    );
    if (balance < BigInt(config.amount))
      throw Error("此钱包在 Ethereum 主网的 IMD 不足 0.5。");
    await refresh();
  } catch (e) {
    account = null;
    state();
    say(e.message);
  }
};
$("#approve").onclick = async () => {
  busy = true;
  state();
  try {
    const hash = await send(config.approve);
    localStorage.setItem(key() + ".approval", hash);
    link(hash, "授权交易");
    say("授权已发送，等待确认。");
    await receipt(hash);
    busy = false;
    await refresh();
  } catch (e) {
    busy = false;
    state();
    say(e.message);
  }
};
$("#submit").onclick = async () => {
  busy = true;
  state();
  let hash;
  try {
    if (localStorage.getItem(key() + ".request"))
      throw Error("已有提交记录，请勿重复付款。");
    await assertWallet();
    if ((await allowance()) < BigInt(config.amount))
      throw Error("授权额度不足。");
    hash = await send(config.request);
    localStorage.setItem(key() + ".request", hash);
    link(hash, "工作流提交交易");
    say("提交已发送。请保留哈希，等待确认；不要重复支付。");
    await receipt(hash);
    say("链上付款交易成功，等待 IMD 受理。请把该交易哈希发给我：" + hash);
  } catch (e) {
    say(e.message);
  } finally {
    busy = false;
    state();
    if (hash || localStorage.getItem(key() + ".request")) {
      $("#approve").disabled = true;
      $("#submit").disabled = true;
    }
  }
};
try {
  config = await (
    await fetch("transaction.json", { cache: "no-store" })
  ).json();
  for (const k of ["payer", "asset", "intake", "commit"])
    $("#" + k).textContent = config[k];
  $("#expires").textContent = new Date(
    config.expiresAt * 1000,
  ).toLocaleString();
  const old = localStorage.getItem(key() + ".request");
  if (old) link(old, "已保存提交交易");
  state();
  if (validTime()) say("请核对金额和请求。连接钱包本身不会付款。");
  provider()?.on?.("accountsChanged", () => {
    account = null;
    state();
    say("钱包账号已变化，请重新连接并核对。");
  });
  provider()?.on?.("chainChanged", () => {
    account = null;
    state();
    say("网络已变化，请重新连接并核对。");
  });
  setInterval(() => {
    if (!validTime()) state();
  }, 1000);
} catch (e) {
  say("加载失败：" + e.message);
}
