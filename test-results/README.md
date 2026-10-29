# 本次发布验证证据

## 当前最终回归与人工汇总

- final-unit.txt：55/55项自动测试通过。
- final-build.txt：前后端构建通过，仅有已有的较大分包提示。
- final-integration.txt、integration.json：28/28组真实MongoDB API测试通过，较早26组新增2组删除问卷回归。
- manual-verification.json：用户5份人工答卷的只读汇总复核，不包含原始答卷或身份标识；错误输入的人工截图不在此证据范围。

下方release-*为先前发布记录，保留历史；最新结果以上述final-*为准。数据库迁移备份、真实答卷、私有诊断文件均不上传。

人工演示初始化的后续验证：manual-seed.json、manual-seed-test.txt。使用独立测试库验证6账号、9题定义、不生成答卷、重复执行保护和密码冲突保护；不代表用户人工填写测试已经通过。

2026-10-22 在现有安装环境中执行：

- release-unit.txt：npm.cmd test，55/55通过。
- release-build.txt：npm.cmd run build，前后端通过；Element Plus分包体积警告仍存在。
- release-integration.txt：npm.cmd run test:integration，26/26组通过。
- integration.json：真实MongoDB独立测试库及逐组结果。

首次受限环境的数据库连接失败后，允许本机连接并重跑成功；此目录保留最终日志。旧文档中其他日志指当时本机记录，不全部上传。正式草稿清单、会话信息和真实数据库不上传。

## 第二阶段验证证据（2026-10-28）

- phase2-baseline-unit.txt、phase2-baseline-build.txt：修改前55项测试和构建通过。
- phase2-baseline-integration.txt/json：从原提交37a8fb4运行28组真实数据库基线。
- phase2-final-unit.txt、phase2-final-build.txt：当前55项测试和完整构建通过。
- phase2-legacy-regression.txt/json：当前代码运行原28组API回归。
- phase2-integration.txt/json：第二阶段22组API回归。

均为独立MongoDB测试库。基线及初轮使用MongoDB7.0.43独立27019副本集；用户开启Docker后，final API证据以Docker27018独立测试库复测为准，正式业务数据库不参与。说明见docs/第二阶段演化记录.md。初始化中途失败和首次修正前日志未计为通过；本次未做第二阶段前端或浏览器验收。

最终环境补充：用户开启Docker后，在项目rs0副本集上以独立测试库再次运行22/22组第二阶段和28/28组第一阶段API回归，全部通过。最终phase2-integration与phase2-legacy-regression日志对应Docker环境；原提交baseline对应原生27019隔离环境。测试环境版本记录见test-results/phase2-environment.json。未启动正式应用3000，未修改正式业务数据，也未推送Git。

“我发出的分享”补充后，最新phase2-integration.txt/json为24/24组（原22组＋2组）。sent-shares-build.txt为本轮后端构建，sent-shares-unit.txt为本轮55项测试。本轮没有重跑原28组API和完整前端构建，历史日志仍按原时间保留。

2026-10-29 使用情况空间隔离修复证据：`usage-scope-build.txt`、`usage-scope-unit.txt`、`usage-scope-integration.txt/json`、`usage-scope-phase2.txt/json`、`usage-scope-legacy.txt/json`。专项9组，原第二阶段24组，旧API28组，单元58项实际通过；前端原usage-gap.json保留为修复前证据，不代表修复后仍有泄漏。详见docs/第二阶段测试用例与结果.md。

2026-10-29前端联调：usage-ui-build.txt、usage-ui-unit.txt、usage-ui-browser.json、usage-ui-requests.json、usage-ui-request-audit.txt/json。全部为独立测试库；usage-scope-*为此前后端专项，phase2-frontend-usage-gap.json为修复前历史，不混用证据。

2026-10-29 四项后端补充：`backend-additions-build.txt`、`backend-additions-unit.txt`、`backend-additions-integration.txt/json`、`backend-additions-phase2.txt/json`、`backend-additions-usage.txt/json`、`backend-additions-legacy.txt/json`。独立库新增9组、原第二阶段24组、空间9组、旧API28组、当前单元59项实际通过。首次端口失败未计为成功，本轮未做浏览器验收。接口示例与步骤见第二阶段契约第8节及测试记录。

2026-10-29易用性调整：editorial-ui-build.txt、editorial-ui-unit.txt、editorial-ui-browser.json、editorial-ui-audit.txt/json。独立库3110，19项浏览器操作、8项实际结果只读审计，截图design-preview/editorial/；未执行专项见对应验收文档。

2026-10-29广场/社区专项：`square-community-build.txt`、`square-community-unit.txt`、`square-community-integration.txt/json`、`square-community-additions.txt/json`、`square-community-phase2.txt/json`、`square-community-usage.txt/json`、`square-community-legacy.txt/json`为本轮实际构建及回归。`square-community-service.json`和service-start.txt记录3107旧进程与重启后的真实响应；`square-community-browser-checks.json`、browser-audit.json/txt、browser-requests.json记录另一独立库的页面与网络事实。截图在design-preview/phase2-square。数量/范围见docs/第二阶段前端接入与验收.md最新章节，旧证据不改写为新结果。
