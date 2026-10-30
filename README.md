# Squeek Supply Station · 轮次补给站

用真实 Squeekchain 结算记录生成每日三阶段合成挑战。交付指定等级的仓鼠可以腾出空间、获得补给分；继续合成可能失去任务材料。**游戏不挖真实区块、不生成 SQK。**

本期：每日挑战、自由练习、真实持久排行榜、可选 Sepolia 成绩存证。奶酪锅和 NFT 杯延期。主流程没有 Mock 排行榜、假钱包、假验证或假交易。

## 启动

需要 Node.js 24 或更新版本。PowerShell 在项目根目录执行：

```powershell
npm install
npm start
```

打开 [http://localhost:8080](http://localhost:8080)。前后端同端口，无需额外数据库服务。Ctrl+C停止。

不配置密钥也能玩、使用真实赛题、验证匿名局；用浏览器钱包签名登录后再开局可进真实榜单。当前仓库没有部署地址或用户签名私钥，所以默认明确显示“成绩存证暂未配置”，不会模拟上链。

配置示例：`.env.example`。需要定制时复制为 `.env`，已有配置应保留。SQLite自动写入 `data/squeek.sqlite`，重启保留赛题、成绩与登录密钥，目录被Git忽略。

## 操作

- 点击/触摸盘面投放；方向键或A/D瞄准，空格投放。
- E交付绿色圈出的指定等级；C储存/交换；X摇晃。
- 每段60秒，共三段。交付数达到配额额外+200，提前准备下一阶段。
- 登录必须在开局前完成；游客局不会因为途中登录而自动进入排行榜。

## 检查

```powershell
npm run check
npm test
npm run test:contracts
npm run test:chain
```

后两项需要安装 [Foundry](https://getfoundry.sh/)，其中`test:chain`需先有合约构建产物（运行test:contracts或contracts:build会生成）。测试启动独立临时Anvil与HTTP端口、SQLite和测试账户，完成真实交易/12确认/重组检查后清理。不会访问用户钱包或向Sepolia广播。

## 启用 Sepolia 存证

1. `npm run contracts:build`。
2. 在`.env`设置SEPOLIA_RPC_URL、DEPLOYER_PRIVATE_KEY、OWNER_ADDRESS、SIGNER_ADDRESS；部署钱包需Sepolia测试ETH。
3. `npm run deploy`查看说明；明确执行`npm run deploy -- --broadcast`才会发送部署交易。
4. 将输出地址填入BOARD_ADDRESS，并提供与SIGNER_ADDRESS匹配的SIGNER_PRIVATE_KEY；主服务不使用部署私钥。
5. 重启服务。用户用自己的钱包登录、游玩并提交，个人最佳可在结算页存证。

合约只记录服务端签名认可的成绩，不执行游戏回放、不保证玩家是真人、不托管资金。签名包含runId、challengeId、configHash、player、score、deliveries、deadline。12确认后显示链上已确认。

## 来源与公平性

赛题第一次成功发布后按UTC日期冻结到数据库，之后所有玩家的种子、任务、物理参数和计分完全相同。官方数据不可用时不伪造天气；已冻结挑战仍可玩，未发布挑战提供自由练习。

来源是官方[结算API](https://docs.squeekchain.com/developers/api/#settlement-history-get-v1settlements)，保存历史轮次范围、工作量、区块数、安全高度和交易链接。当前核心地址以2026-10-30官方API及结算回执核验为准，与最初PRD里的旧部署不同。详细映射和信任边界见PRD/TDD。

## 结构

```
squeek-drop-frontend/squeek-drop/  原生前端及共享引擎
engines/sd-1.0.0/                旧版规则快照
server/                          Fastify、SQLite、挑战发布、回放池、签名/确认
src/                             Solidity成绩合约（IMD要求的根目录）
contracts/                       Foundry测试及本地构建输出
tests/                           引擎、API、ABI测试
scripts/                         语法检查、本地链联调、显式部署
```

## 公网交付前

当前服务为单实例SQLite实现，生产需要持久data卷、备份、HTTPS反向代理、PUBLIC_ORIGIN/CORS_ORIGINS和独立JWT_SECRET。配置NODE_ENV=production可强制要求JWT_SECRET。默认127.0.0.1；容器设HOST=0.0.0.0。不能直接部署到无持久卷的临时serverless文件系统。

尚需自行提供公网托管和Sepolia签名/部署配置，并用真实钱包实测。官方IMD归属、首个job付款与Genesis提交由项目拥有者完成；本项目不会自动提交或保证徽章。不要为凑交易数量增加无意义的代币授权。

产品定义见`Squeek-Drop-PRD.md`，实现见`Squeek-Drop-TDD.md`，接口和验收见`Squeek-Drop-联调文档.md`。
