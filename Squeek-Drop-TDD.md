# 轮次补给站技术设计

版本 2.0，规则 `ss-2.0.0`。以当前代码和本文件为准，原四模式后端方案已撤换。

## 1. 运行架构

Node 24 + Fastify 5 单进程提供静态前端和 REST API；Node 内置 SQLite 持久化；两个 worker_threads 执行回放；viem 2 处理签名、链读取、部署和测试。Solidity 0.8.26 + OpenZeppelin + Foundry 提供单一成绩合约。

沿用原生 ESM/Canvas 前端，无 React 迁移、无前端构建依赖。`npm start` 默认启动 `127.0.0.1:8080`。工作目录为仓库根目录。Ctrl+C/SIGTERM 关闭 HTTP、定时器和 worker；无需数据库容器、Redis 或单独静态服务。

SQLite WAL 适用于当前单实例服务。数据库路径默认为 `data/squeek.sqlite`，必须挂载持久卷。当前不支持多进程共享数据库运行服务：启动恢复逻辑会重置中断的 verifying run；横向扩容前需迁移任务占用和限流机制。不要把 serverless 临时文件系统当作持久化环境。

## 2. 共享规则与版本

当前引擎：`squeek-drop-frontend/squeek-drop/js/engine.js`。当前映射：同目录 `challenge.js`。服务端直接 import 同一文件，不重复实现物理/计分。规则修改必须更改 RULES_VERSION；旧版 `sd-1.0.0` 保存在 `engines/sd-1.0.0/`。

输入格式：`[tick,code,x?]`。0=DROP（0–400 整数），1=SWAP，2=SHAKE，3=DELIVER。仅成功操作入日志；交付候选选择由引擎确定，不接受客户端指定球 ID。每局最多 10,800 tick、2,500 条输入，HTTP body 上限 256KiB。

digest 是跨端状态一致性的轻量校验，不是密码学证明。服务端必须实际回放并比对 score、ticks、merges、maxLevel、blocks（旧内部名，对应能量奖励次数）、deliveries、deliveryScore、completedMissions、phaseDelivered、rulesVersion 和 digest。主动结束时不依赖客户端 over 标识；回放的 ticks 必须等于 endTick。

## 3. 挑战发布与来源

`GET /v1/challenges/today` 触发当天首次发布。请求合并防止同一进程重复生成；SQLite day 唯一键使已发布配置不可覆盖。

验证官方核心合约身份、chainId、installationId 一致、schemaVersion、数值字符串、轮次边界、时间以及 safe 区块范围。最新部署在 2026-10-30 官方 `/v1/core` 返回 `0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44`，已与一条官方结算交易回执交叉核对；原文档 `0x7466…119f` 是旧地址。可通过 SQUEEK_CORE_ADDRESS 明确配置，身份变化时停止新赛题发布，不自动信任任意新合约。

来源以官方 API 的安全确认投影为信任来源，并保留交易、日志位置和安全高度；运行时不逐条向 RPC 重新验证官方结算。不要把它描述为完全无需信任的独立链索引器。

- challengeId = keccak256(`squeek-supply:${RULES_VERSION}:${UTC日期}`)
- seed = keccak256(canonical({day,records}))
- configHash = keccak256(canonical({challengeId,config,source}))
- canonical 对对象键排序，数组顺序保留。
- config 包括 rulesVersion、seed、durationTicks、完整 phases。
- source 包括 API、core、chainId、installationId、safeThroughBlock、records、fetchedAt。

首次发布时刻可能晚于 UTC 午夜；同一部署之后始终复用该配置。独立部署数据库可能在同日选择不同数据，因此生产只应有一个权威发布数据库；合约也锁定一个 challengeId 对应的 configHash。未来分布式部署应增加预发布任务和共享配置存储。

## 4. 数据模型

| 表 | 用途 |
|---|---|
| challenges | UTC day 主键、唯一 challengeId、完整不可变 JSON |
| nonces | 完整登录消息、地址、有效截止时间；成功验证时原子删除 |
| runs | 身份、匿名访问令牌摘要、限流键、开局时间、状态、输入、结果、得分、交付数、存证 hash/status |
| settings | 本地开发持久 JWT 密钥；生产使用环境变量 |

排行榜用 SQLite 窗口函数，每地址取最高分，同分按最早 finished/id。结果和排名更新在事务内完成。没有预置玩家或占位分数。输入日志保留供审计；已登录的 verified 局通过公开 proof API 可查，匿名局不公开。

## 5. 鉴权、限流和回放

服务端配置 PUBLIC_ORIGIN 用于签名消息域名/URI和 JWT issuer，不信任客户端 Host 生成签名域。消息含 Sepolia chainId、随机 nonce、签发和到期时间，有效 5 分钟。viem verifyMessage 恢复签名地址；当前支持 EOA personal_sign，不实现 ERC-1271。

JWT HS256 有效 24 小时，sub=小写钱包地址。nonce 成功校验后原子删除，竞争请求仅一个成功。

游客开局返回 32 字节随机 runToken，数据库只保存 SHA-256；后续通过 x-run-token 验证。已登录局必须使用原地址 JWT，runToken 不能绕过身份检查。

全局每 IP 180 请求/分钟，nonce 12/分钟，verify 20/分钟，start 20/分钟；每地址/匿名 IP 每 UTC 日最多 200 局。反向代理默认不信任转发 IP，部署时需结合可信代理或边缘限流，不应盲目信任任意 X-Forwarded-For。

finish 先校验日志形状，原子占用状态 started→verifying，交给两个有界 worker。等待队列最多16；每个执行15秒超时后重建 worker。过期15分钟、模拟时间超过墙钟+3秒、回放失败或摘要不一致则拒绝。回放系统故障恢复为 started，可重试。

重复相同 payload 返回已保存结果；不同 payload 返回409。进程意外停止后 verifying 在下次启动恢复为 started。真实验证是确定性重放，不是人类证明；公开挑战允许机器人搜索，不应直接加上有价值奖池。

## 6. 成绩合约

`src/SqueekSupplyBoard.sol`，EIP-712 domain：name=`SqueekSupply`，version=`2`，chainId=11155111，verifyingContract=部署地址。

```
ScoreAttestation(bytes32 runId,bytes32 challengeId,bytes32 configHash,address player,uint64 score,uint32 deliveries,uint64 deadline)
pinScore(bytes32,bytes32,bytes32,uint64,uint32,uint64,bytes)
```

player 使用 msg.sender；签名截止24小时；score 必须比个人链上最佳高且大于0；runId 单次使用；challengeConfig 首次有效存证后锁定。不接受零标识。OpenZeppelin ECDSA 拒绝非规范签名。Ownable2Step 管理签名者轮换，无升级、无存款、无提款、无代币授权或发奖。

API 只为验证通过、已登录、当前个人最佳生成证明。签名前检查 RPC chainId、合约 signer 与配置一致、链上最佳分数。私钥只读环境变量，不发送给前端；此版本不包含 KMS 服务，生产应限制签名服务部署权限。

未配置 RPC/合约/签名者时，排行榜和验证仍工作，证明接口503；前端清楚说明暂未配置。不生成零签名或模拟交易哈希。

## 7. 交易确认

用户钱包发送交易后立即保存 hash，并向 API 报告。API 检查 receipt.status、目标合约、ScorePinned 事件、玩家、runId、challengeId、configHash、score 和 deliveries，以及区块哈希与规范链一致性。12次确认后才显示 confirmed。

每15秒重查最近100笔非失败的已报告存证，包括已确认记录，以捕获短链重组；回执消失降为 pending。它是范围明确的回执确认器，不是覆盖全部历史合约事件的完整索引器。超过100笔的历史重组追踪、外部直接调用合约未报告的交易自动发现，留作后续扩展；用户重新报告可再次校验。

## 8. 配置与部署

配置见 `.env.example`。必须 Node24。生产设置 NODE_ENV=production、JWT_SECRET、PUBLIC_ORIGIN、CORS_ORIGINS，HTTPS反向代理、持久 data 卷、数据库备份。默认仅监听本机；容器使用 HOST=0.0.0.0。

`npm run deploy` 仅显示步骤，不发送交易。`npm run deploy -- --broadcast` 明确使用环境中的部署账户，验证为 Sepolia后广播，写入公共 `deployments/sepolia.json`。服务端与部署账户应分开；主应用不需要 DEPLOYER_PRIVATE_KEY。

## 9. 验证

- `npm test`：规则、交付、阶段、API身份、持久化、篡改、匿名、并发nonce、浏览器ABI一致性。
- `npm run test:contracts`：有效签名、过期、重放、换人、配置篡改、NotHigher、权限、fuzz。
- `npm run test:chain`：独立临时 Anvil + 临时 SQLite，真实 HTTP 和真实 EVM 端到端，验证12确认与重组撤回；finally 清理进程和端口，不使用用户钱包或公共链。
- 浏览器验证：官方数据发布、匿名每日局提交、练习、任务按钮与键盘、榜单空态、语言切换、390px布局和控制台。
- 本地链测试不等于 Sepolia 已部署、真实用户钱包签名测试或公网压测。跨浏览器位级浮点一致性需随支持范围继续回归；当前 Node 与 Chrome 实际联调可验证当前引擎。

### 本次执行记录（2026-10-30）

- Node v24.13.0：21项当前引擎/API/数据源/客户端/ABI测试全部通过；27个JS文件语法检查通过。
- Foundry v1.7.1：8项合约测试通过，其中fuzz运行128次。
- Anvil HTTP→签名→合约→12确认→重组回退端到端通过，临时监听端口释放。
- Chrome连接真实官方数据：匿名每日局交付L4获得160分，服务端回放通过，真实排行榜仍为空；没有加入模拟玩家。
- 浏览器检查：结算刷新恢复、自由练习本地结算、中英切换、390×844无横向溢出，交付按钮及底部工具可见；检查期间没有控制台错误或警告。
- 旧sd-1.0.0引擎六组原始回放回归通过。
- 未执行：真实钱包Sepolia广播、公网部署/压测、Docker构建、远程GitHub Actions运行。CI和Dockerfile作为可用部署/验证配置交付，未把这些准备工作计为已部署。
