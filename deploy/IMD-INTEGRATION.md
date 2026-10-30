# IMD 接入与部署记录

核实日期：2026-10-31（Asia/Shanghai）。此文件是本项目的具体交付约束；模板不是已提交的工作单。

## 已核实的规则

- Genesis当前提交弹窗只接受IMD job链接/ID；自有域名直接提交暂停。首个job付款人必须是Genesis已验证的普通EOA钱包。归属验证后仍需团队审核。
- 本项目付款钱包由用户确认：`0x51404e4a699e4e338e143fb2a45c5cdc96392575`。尚未创建IMD job。
- IMD的job是付费工作单，记录需求、执行、审查和交付。workflow是包含合约job、部署服务、前端job及发布验证的完整流程。
- 当前workflow.open报价0.5 IMD，HTTP支付网络为Ethereum主网，游戏合约目标为Sepolia。付款网络和部署网络不同。以付款时重新获取的quote为准，不向文档中的地址直接转账。
- 现有公开GitHub仓库可通过POST /requests/import解析为repoUrl/baseCommit，然后POST /requests/check免费预检。两步不等于付费发起工作。
- 后续更新使用最新project.head的job.continue并由原付款钱包支付。不要用新的job.open误建第二个项目。

官方来源：

- https://squeekchain.com/genesis/code#how-building-works （已登录页面实查FAQ与提交弹窗）
- https://imd.fun/skill/jobs.md （导入与续作）
- https://imd.fun/skill/workflows.md （两阶段工作流）
- https://api.imd.fun/requests/capabilities （实时价格与网络能力）
- https://imd.fun/docs/#from-your-repository （Foundry导入要求）

## 本项目路径

1. 将已授权源码公开到aSuZhi/squeek-supply-station，并锁定最终提交。
2. 在用户已有VPS托管Node API和持久SQLite，配置HTTPS。若无现有VPS，可选带持久磁盘的托管服务。Vercel可以作为替代，但需要远程数据库、无状态请求及后台任务适配；当前版本不能原样使用Vercel临时文件系统持久化SQLite。
3. 配置一个独立的成绩签名者，只将其公开地址交给IMD；私钥留在后端环境。付款钱包无需向代码或IMD提供私钥。
4. import kind=contracts 解析公开仓库，保存返回的精确repoUrl和baseCommit。工作流必须保留整个monorepo中的前端和共享引擎。
5. 使用imd-workflow.example.json填入真实来源、API origin和公开签名者地址，再免费check。当前模板尚有占位符，不可直接付费。
6. 预检无blockers后读取实际quote和重建后的计划；确认合约+前端都包含且不发币。由用户用已验证钱包确认0.5 IMD付款（金额若变化需重新确认）。
7. IMD审查并部署SqueekSupplyBoard，然后用真实部署地址与外部API发布静态前端。工作流会生成其要求的launch.json、dist/imd-deployment.json等，不要伪造这些交付记录。
8. 部署合约地址回填后端BOARD_ADDRESS；配置与构造参数一致的SIGNER_PRIVATE_KEY；将实际返回的前端origin加入CORS_ORIGINS。真实钱包验证完整链路。
9. 保存workflowId、contracts jobId、frontend jobId、仓库交付commit、合约地址、网站地址。Genesis提交入口接收job ID/URL，不要将workflow ID当job ID粘贴；预览canonical record，核实paidBy和来源后再提交归属。

## 工程适配

- 根foundry.toml及src/SqueekSupplyBoard.sol供IMD识别，设置bytecode_hash="none"。首次免费导入发现仅指定嵌套src路径仍被判no_sources，因此已将实际合约移至根src，统一使用根Foundry配置。本机测试工具为Foundry1.7.1；IMD文档的验证器版本为1.8.3，需以远端导入/审查结果确认兼容，未擅自升级本机全局工具。
- 使用`onchain:evm_contracts`，不使用默认带代币的evm_project，也不创建池、代币经济或SQK授权。
- 唯一构造函数：SqueekSupplyBoard(initialOwner,initialSigner)，两项都是静态address，符合该部署类型。owner必须是用户EOA，不能意外留给部署工厂；signer是独立后端签名者。
- 前端目录为`squeek-drop-frontend/squeek-drop/`；共享引擎路径与规则版本保持不变。
- `SITE_API_BASE=https://实际API域名 npm run build:site`生成dist静态包。PowerShell先设置`$env:SITE_API_BASE`。输出目录必须为空，可用`-- --out artifacts/site-v2`选新目录；不会自动删除已有发布目录。
- 只复制index.html、js、css和runtime-config.js。Node服务、数据库、.env、私钥、测试数据不进入前端包。
- IPFS不运行我们的Node后端；IMD静态发布成功不等于API已托管。

## VPS部署

需用户提供主机/IP、SSH用户及已有登录方式、API域名。部署前检查操作系统、Docker、现有80/443监听、域名解析和已有服务；有反向代理时接入现有代理，不覆盖或停止其他业务。

`compose.yaml`适用于专用/空闲80和443端口的主机，使用Caddy管理TLS，后端8080不直接暴露到公网。SQLite及证书持久化到独立命名卷。

```sh
cd deploy
cp production.env.example production.env
# Fill actual non-secret origins and server-side secrets securely.
docker compose --env-file production.env up -d --build
docker compose --env-file production.env ps
```

PUBLIC_ORIGIN建议为稳定API origin，用作登录消息身份域；CORS_ORIGINS包含真实浏览器前端origin。JWT_SECRET在部署主机生成至少32字符；签名私钥与Genesis钱包分开。空配置不构成可部署环境。

备份需覆盖SQLite完整一致快照（包含WAL状态），不能只随手复制活动数据库的主文件。此仓库未执行远程部署或Docker构建，直到主机和域名已提供并实际验证。

## 验收

- import成功且精确commit存在，check无blockers；quote实际计划正确。
- VPS HTTPS /healthz与/v1/challenges/today可读，重启不丢赛题/成绩。
- IMD网站没有Mock，匿名/登录区分明确，回放验证通过，真实排行榜持久。
- 合约owner/signer正确；用户成绩成功存证并达到确认数。
- IMD workflow completed与validation passed；Genesis显示正确归属，之后等待团队审核。

The Tester是另一个徽章：官方要求向Squeekchain合约发交易。自建成绩合约的交易不能未经核实就宣称满足它。本次以The Buildooooor项目归属与产品审核为目标。
