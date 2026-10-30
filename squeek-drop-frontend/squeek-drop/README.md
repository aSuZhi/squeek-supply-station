# 轮次补给站前端

当前规则 `ss-2.0.0`，沿用原生ESM/Canvas。请从仓库根目录执行 `npm install`、`npm start`，访问 http://localhost:8080 。不再使用旧MockApi。

engine.js和challenge.js由浏览器和后端共享。当前测试位于根目录tests；本目录tests/engine.test.mjs仅用于旧版引擎快照回归。

独立静态发布可通过window.SQUEEK_DROP_CONFIG.apiBase配置后端。服务不可用时自由练习仍可运行；每日挑战、榜单和存证不能以模拟数据替代。完整运行和部署说明见根目录README.md。
