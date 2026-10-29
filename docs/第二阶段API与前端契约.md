# 第二阶段 API 与前端接入契约

目标仓库：CMS_PJ1_2。本文是第二阶段后端当前契约；第一阶段接口继续存在，权限新增社区分支。前端已接入题库、共享、社区和跨问卷统计；2026-10-29空间隔离联调已完成，实际浏览器范围与证据见《第二阶段前端接入与验收》。下文接口与权限仍以后端契约为准。

## 通用约定

所有路径以下均带 `/api` 前缀，均需现有Cookie会话；用户身份从会话取得，不接受客户端指定创建者／修改者。GET/PUT/DELETE成功200，POST成功201；400为定义／参数错误，401未登录，404资源不存在或无权访问，409为版本冲突或状态不允许。来源资源与版本必须匹配。

MongoDB ObjectId按服务端返回的24位小写十六进制字符串传递（非规范大小写拒绝，避免字符串外键与幂等键产生别名）；问卷实例ID另由服务端生成32位随机字符串。列表使用 `page`（默认1、每页20、最大100000），返回 `{page,pageSize,total,rows}`。保留输入后处理409，禁止自动覆盖服务器最新版。

## 1. 三种身份与题目内容

- `question._id`：题目资源，归属个人或社区。
- `version._id`：不可变内容版本。`number`为该题v1、v2等，`parentVersionId`记录上一个最新版本。
- `survey.draft.questions[].id`：问卷实例，作为答案键及跳转目标；同一来源可多次出现，每次ID独立。

题库content只接受并保存以下7个内容字段，支持全部九题型；不保存问卷实例ID、source和jumpRules。选项ID与矩阵行ID应稳定保留，不能只为修改文字就重新生成，否则可能使规则失效。

```json
{
  "type": "single_choice",
  "title": "今天的心情？",
  "description": "",
  "required": true,
  "options": [
    { "id": "happy", "label": "开心" },
    { "id": "plain", "label": "一般" }
  ],
  "rows": [],
  "validation": {}
}
```

其他题型content沿用第一阶段字段：multiple_choice的minSelections/maxSelections；text的长度与格式；number的min/max/integerOnly；matrix的options/rows；ranking的完整选项；time的mode及上下界；slider的min/max/step/端点标签；color的HEX答案。题型校验共用原领域引擎。

## 2. 题库与版本接口

| 方法与路径                                              | 输入                               | 行为                                                                       |
| ------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| POST /questions                                         | `{content,communityId?}`           | 不传communityId为个人题；传入则必须当前成员，生成v1                        |
| GET /questions                                          | `communityId?&search?&type?&page?` | 默认个人题库；搜索为转义后的标题包含匹配                                   |
| GET /questions/:id                                      | `versionId?`                       | 默认最新；返回`{question,version}`                                         |
| GET /questions/:id/versions                             | `page?`                            | 不可变历史，最新在前                                                       |
| PUT /questions/:id                                      | `{revision,content}`               | 生成新版本；revision为题目资源当前revision                                 |
| POST /questions/:id/restore                             | `{revision,versionId}`             | 从历史内容生成新最新版本，保留原历史                                       |
| POST /questions/:id/copy                                | `{versionId}`                      | 有权访问者主动转存个人独立副本，记录provenance                             |
| POST /surveys/:id/questions/:instanceId/save-to-library | `{revision,communityId?}`          | 有问卷管理权，问卷revision匹配；存当前草稿或发布定义中的题目；剥离跨题跳转 |

创建／修改返回：

```json
{
  "question": {
    "_id": "111111111111111111111111",
    "scopeKey": "personal:222222222222222222222222",
    "ownerId": "222222222222222222222222",
    "createdBy": "222222222222222222222222",
    "revision": 2,
    "latestVersionId": "333333333333333333333333",
    "title": "今天的心情？",
    "type": "single_choice",
    "dataVersion": 1
  },
  "version": {
    "_id": "333333333333333333333333",
    "questionId": "111111111111111111111111",
    "number": 2,
    "parentVersionId": "444444444444444444444444",
    "authorId": "222222222222222222222222",
    "contentSchemaVersion": 1,
    "content": {
      "type": "single_choice",
      "title": "今天的心情？",
      "description": "",
      "required": true,
      "options": [
        { "id": "happy", "label": "开心" },
        { "id": "plain", "label": "一般" }
      ],
      "rows": [],
      "validation": {}
    }
  }
}
```

恢复产生新版本：例如当前v3恢复v1，返回v4，`parentVersionId=v3._id`、`restoredFromVersionId=v1._id`。副本的questionId、v1和owner均独立，question.provenance保存原questionId、versionId、channel（共享转存另有shareId）；来源不授予读原作者题库或其他版本的权限。

## 3. 问卷选题、升级与脱离

| 方法与路径                                      | 输入                                     | 响应／约束                                                                                   |
| ----------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| POST /surveys/:id/library-instances             | `{revision,questionId,versionId,index?}` | index默认末尾，0起算；返回`{survey,instanceId}`，保留内容并新建实例                          |
| GET /surveys/:id/question-upgrades              | 无                                       | `{revision,rows}`，逐实例给出latestVersionId、hasUpdate、options/rows差异、canUpgrade及error |
| POST /surveys/:id/instances/:instanceId/upgrade | `{revision,versionId}`                   | 明确选择同资源某版，保留实例ID和原跳转规则；校验完整定义后返回`{survey,instanceId}`          |
| POST /surveys/:id/instances/:instanceId/detach  | `{revision}`                             | 显式去除source，成为本地题；返回更新后问卷                                                   |

实例的source为：

```json
{
  "id": "9c7ed754a37f4dd7b27eea10ea14aa71",
  "source": { "questionId": "111111111111111111111111", "versionId": "333333333333333333333333" }
}
```

实际实例还包含全部题目内容及jumpRules。填写只用发布快照，不实时读题库；新版不会自动修改草稿。

普通PUT保存草稿不能自行添加／替换source，新增绑定必须走选题接口；既有引用题的content必须与固定版本一致。删除既有source需要先调用detach，不是直接在请求中删字段。内容修改的两条合法流程：

1. 先PUT题库生成新版本，再POST实例upgrade，最后保存问卷中的跳转设置。
2. 先POST实例detach，再PUT草稿保存本地内容。

`SOURCE_ATTACH_REQUIRED`、`SOURCE_DETACH_REQUIRED`、`SOURCE_CONTENT_MISMATCH`均为400。已发布问卷不能选题、升级或脱离。升级保留原规则，删除／变更选项后若规则引用无效则拒绝，不能静默删规则；前端先看差异，再由用户修正草稿规则并重试。当前跳转不支持引用矩阵行条件，但行变化也明确列在预览中。

失去原社区权限后，已持有问卷快照继续固定；可以编辑自己的其他本地内容，不能借save-to-library接口直接转存仍绑定原社区的题。

## 4. 用户ID投递、分享链接与广场

| 方法与路径                 | 输入                            | 行为                                                       |
| -------------------------- | ------------------------------- | ---------------------------------------------------------- |
| GET /users/:id             | 无                              | 仅`{id,username}`，用于投递／邀请前确认，不返回密码、会话  |
| POST /questions/:id/shares | `{kind,versionId,recipientId?}` | kind为delivery/link/public；delivery必须指定接收者         |
| GET /deliveries            | `status?&page?`                 | 默认pending；可accepted/rejected；仅本人接收，撤回项不返回 |
| GET /shares/:id            | 链接类型另需`token`             | 固定版本详情，投递仅接收者可读                             |
| GET /question-links/:token | 无                              | 登录后读取固定版本；令牌为48位随机十六进制                 |
| POST /shares/:id/accept    | 链接类型传`{token}`，其他`{}`   | 转存个人独立副本；同一共享同一接收者幂等返回相同题目       |
| POST /shares/:id/reject    | `{}`                            | 仅投递接收者；拒绝后不能接受，接受后不能拒绝               |
| DELETE /shares/:id         | 无                              | 发送者撤回，阻止未来读取／接收，不删除已有副本             |
| GET /square                | `search?&type?&mine=true?&page?`              | 一个全局广场；mine=true是本人的发布项筛选                  |

示例投递：

```json
{
  "kind": "delivery",
  "versionId": "333333333333333333333333",
  "recipientId": "555555555555555555555555"
}
```

创建分享返回共享记录（`_id,kind,questionId,versionId,senderId,status`，链接另有token，投递另有recipientId）。接受返回`{question,version,alreadyAccepted}`，新副本v1且含provenance。重复接收返回首次创建时的题目元数据和v1（不是副本后来编辑的最新版），需要查看副本最新状态时另GET /questions/:id。链接读出share._id和token后，接受请求必须带token，不能只凭共享记录ID绕过链接凭证。单个接收者的拒绝不会使其他人公共共享失效。

当前外部共享面向个人题；社区成员可先POST copy主动转存个人副本，再对外共享该副本。直接共享社区资源返回400 `SHARE_PERSONAL_REQUIRED`，避免链接绕过成员退出边界。这不批量归档社区题，也不授予原题修改权。

### 我发出的分享（新增）

`GET /api/shares?direction=sent&kind=link&page=1`

- direction必须显式为sent；kind可省略以查询三种类型，或取delivery、link、public中的一种。
- 可选status为pending、accepted、rejected、active、revoked。默认不筛状态，包含已接受、已拒绝和已撤回记录，便于刷新后管理。
- 身份只来自Cookie会话；客户端senderId不能改变查询范围。未登录401，不合法direction/kind/status/page为400。
- page默认1，每页固定20；按createdAt倒序、_id倒序排序。页码超出结果返回空rows但保留total。持续新增记录时可刷新第一页，分页不是跨请求锁定的快照。
- version为分享时固定的题目版本，含_id、questionId、number、content；不会读取题库最新版。recipient仅投递存在，只有id和username；账号不存在时保留id、username为null。
- link仅链接类型存在，包含token和API相对path；这里不生成前端页面URL。令牌只在发送者自己的结果内返回。
- 撤回项仍可在发送者列表查看，但其读取／接受接口继续拒绝；本接口不恢复分享，不返回密码、会话、私人问卷或答卷信息。

响应示例（一个链接记录）：

```json
{
  "page": 1,
  "pageSize": 20,
  "total": 1,
  "rows": [
    {
      "_id": "666666666666666666666666",
      "kind": "link",
      "questionId": "111111111111111111111111",
      "versionId": "333333333333333333333333",
      "status": "active",
      "createdAt": "2026-10-28T07:00:00.000Z",
      "updatedAt": "2026-10-28T07:00:00.000Z",
      "version": {
        "_id": "333333333333333333333333",
        "questionId": "111111111111111111111111",
        "number": 1,
        "content": {
          "type": "text",
          "title": "分享时的标题",
          "description": "",
          "required": true,
          "options": [],
          "rows": [],
          "validation": {}
        }
      },
      "link": {
        "token": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "path": "/api/question-links/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    }
  ]
}
```

投递记录改为带`recipient:{id,username}`，没有link字段；公开记录两个字段都没有。前端可据_id调用既有DELETE /shares/:id撤回，再刷新当前列表。发送者列表提供固定内容，无需借用接收者专用的私人投递详情接口。

## 5. 社区接口与冲突

| 方法与路径                              | 输入            | 行为                                                   |
| --------------------------------------- | --------------- | ------------------------------------------------------ |
| POST /communities                       | `{name}`        | 创建者成为唯一管理员                                   |
| GET /communities                        | `page?`         | 当前参加的社区                                         |
| GET /communities/:id/members            | `page?`         | 当前成员列表，含userId、role、username                 |
| POST /communities/:id/invitations       | `{recipientId}` | 仅管理员；重复待接收邀请返回原项，重新邀请提升revision |
| GET /community-invitations              | `page?`         | 本人收到的邀请及状态                                   |
| POST /community-invitations/:id/accept  | `{revision}`    | 仅接收者，revision取当前邀请                           |
| POST /community-invitations/:id/reject  | `{revision}`    | 仅接收者                                               |
| POST /communities/:id/leave             | `{}`            | 成员退出，管理员被禁止退出                             |
| DELETE /communities/:id/members/:userId | 无              | 仅管理员移除成员，不能移除管理员自己                   |

邀请响应含`_id,communityId,senderId,recipientId,status,revision`。接受不是实时协同编辑；所有题目修改仍携带题目revision，后提交者409，前端须保留未提交输入并显示重新读取／比较功能。邀请未接受没有权限；重复接受旧的已接受邀请不恢复离开的成员，重新加入需管理员新邀请及最新revision。

退出和依赖成员身份的写操作都在事务中写同一社区writeSerial栅栏。并发操作按提交顺序线性化：若写先提交，它发生于移除之前；若移除先提交，旧快照写触发重试，重新检查成员后404。不可能在已移除状态下继续创建版本或转存。

## 6. 社区问卷权限

`POST /surveys`保留`{title}`为个人问卷，新增`{title,communityId}`为社区问卷（创建时需当前成员）。问卷归属创建后不能通过草稿内容改写。使用社区题不改变个人问卷归属。

`GET /surveys`默认本人个人问卷；`GET /surveys?communityId=...`列该社区可见摘要。编辑详情、保存、选题、发布、截止、关闭、删除和路由管理仅创建者且仍为成员，或当前管理员；整卷统计、逐题统计、填写内容分页允许当前成员。退出的原创建者同样受限。公开填写及匿名／限次保持原规则，不要求填写者为社区成员。

前端需分别展示manage和statistics入口，不把“当前成员可看统计”误当“所有成员可编辑问卷”。当前响应不提供自动按钮权限布尔值，可用会话user.id、community.adminId、survey.ownerId及当前成员关系计算，后端仍最终校验。

## 7. 使用查询与跨问卷统计

| 方法与路径                    | 参数                                  | 响应                                                                                                        |
| ----------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| GET /questions/:id/usage      | `versionId`必传，`communityId?&page?` | `{page,pageSize,total,rows,visibility}`，rows含surveyId、title、kind、instanceId，发布项另有surveyVersionId |
| GET /questions/:id/statistics | `versionId`必传，`communityId?&page?` | 固定资源及版本的实例回答统计，见下                                                                          |

usage按所选空间列出草稿、发布及归档快照，kind仍为draft/published/archived。未传communityId时仅限当前用户本人拥有且不属于社区的问卷（兼容字段缺失或null）；传communityId时仅限该社区，调用者必须是当前成员，包括本人创建的社区问卷也不会出现在个人空间。未接受邀请、退出或被移除均无该社区访问权。资源所有者不因来源关系获得别人私人问卷权限。

空间、权限及精确题目/版本匹配在MongoDB聚合内完成，再通过同一facet计算total和分页rows；每页20条，其他空间的引用不占分页位置，不返回其名称、数量或拥有者等信息。响应结构和visibility字段保持兼容，不新增scope请求参数。社区成员可通过社区固定实例获得私人来源版本的使用查询权限，不获得原作者私人题库及其他版本权限；退出后自己的个人问卷持有的固定实例仍按个人空间授权。

例如个人请求：`GET /api/questions/:id/usage?versionId=:versionId&page=1`；社区请求：`GET /api/questions/:id/usage?versionId=:versionId&communityId=:communityId&page=1`。无引用返回`{page:1,pageSize:20,total:0,rows:[],visibility:"仅列有权访问的问卷，不返回隐藏引用数量或身份"}`。

统计默认只包括本人个人问卷；传communityId则只包括该社区问卷，当前成员才可请求。对于社区问卷内的私人来源实例，成员只凭该固定可见实例获得对应版本的本社区统计权，不获得私人题库或其他版本权限。退出后仍可统计自己既有个人问卷的固定实例，但不能再查询社区空间。

```json
{
  "questionId": "111111111111111111111111",
  "versionId": "333333333333333333333333",
  "scope": "personal",
  "unit": "instance-answer",
  "description": "同题重复实例按实例回答次数统计，不是去重人数；不同版本和独立副本不合并",
  "answerCount": 2,
  "page": 1,
  "pageSize": 20,
  "distribution": [{ "_id": "happy", "count": 2 }],
  "distributionTotal": 1
}
```

题型分支：单／多选、日期／时间、色彩返回distribution及distinct值总数，分页每页20；文本返回rows（value、submittedAt），分页20；数字／评分返回numeric（answerCount、average、min、max），无数据值为null；矩阵返回matrix（row/option/count）；排序返回ranking（averageRank、firstCount）与rankDistribution（option/rank/count）。统计数据由MongoDB聚合产生，不把全部答卷读入应用内存。

只连接正式responses、对应发布快照、当前有权的未删除问卷；只纳入activePath中的实例且实际存在非null答案。候选区和未提交过程不进入统计。百分比分母用answerCount，多选百分比可超过100%；同一题在一卷重复出现按实例次数计。

## 原后端交付时的前端待办（历史记录）

此段原指第二阶段首次后端交付；现有前端已增量接入题库、共享、社区等页面，实际范围及验收以《第二阶段前端接入与验收》为准。下文第8节新增后端能力仍需前端接入，不应将历史待办解读为当前全部未实现。


## 8. 2026-10-29 补充：用户查找、邀请提醒、编辑另存和社区概览

以下接口均需有效Cookie会话。保留原ID查询、复制、题目修改、邀请处理和社区列表响应字段；新增字段为兼容扩展。身份从会话取得，不接受客户端指定拥有者／修改者。

### 8.1 用户名与用户ID精确查询

| 请求 | 成功响应 | 失败 |
| --- | --- | --- |
| `GET /api/users?username=ReceiverCase` | `{ "id":"222222222222222222222222", "username":"ReceiverCase" }` | 无结果404；缺失、空或非法用户名400；未登录401 |
| `GET /api/users/:id` | 同上，原接口不变 | 无结果／非法ID404；未登录401 |

用户名沿用注册／登录的 `toLowerCase()` 规范化键精确匹配，大小写不敏感；返回注册时保留的展示用户名。不做模糊匹配，不支持空关键词列举；沿用3～24位中文、字母、数字、下划线或短横线限制，不自动去除空格或增加其他Unicode规范化。重名校验仍由现有唯一索引保证。

前端选择“用户名／用户ID”查找，确认展示结果后，将返回的 `id` 写入原有 `recipientId`，用于 `POST /api/questions/:id/shares`（kind=delivery）或 `POST /api/communities/:id/invitations`。用户名字符串本身不作为投递／邀请身份字段。

### 8.2 可读邀请与信封数量

`GET /api/community-invitations?page=1` 保留全状态分页，每页20，新增 `pendingCount`（当前接收者全部待处理数量，不局限当前页），以及每行的最小展示对象：

```json
{
  "page": 1,
  "pageSize": 20,
  "total": 22,
  "pendingCount": 21,
  "rows": [{
    "_id": "333333333333333333333333",
    "communityId": "444444444444444444444444",
    "senderId": "111111111111111111111111",
    "recipientId": "222222222222222222222222",
    "status": "pending",
    "revision": 1,
    "community": { "id": "444444444444444444444444", "name": "可读社区" },
    "inviter": { "id": "111111111111111111111111", "username": "OwnerCase" }
  }]
}
```

原有createdAt／updatedAt字段仍返回；若关联资源缺失，展示对象为null，前端用“社区不可用／用户不可用”兜底，不能据此补查其他私人数据。total是所有状态邀请数，pendingCount只计算pending；两者含义不同。服务端按会话recipientId查询，不接受客户端替换接收者。

信封单独请求 `GET /api/community-invitations/pending-count`，响应 `{ "pendingCount": 21 }`，不需要下载列表。读取这两个GET都不改变状态。接受／拒绝仍调用原接口并携带revision，成功后重新请求数量和列表；409保留界面并刷新该邀请，404提示无权处理。信封以pendingCount>0展示提醒，打开信封不清零。这是待处理邀请提醒，不是通用消息已读系统；没有推送或实时通知。登录／进入页面、处理成功及主动刷新时重新读取即可。

### 8.3 编辑内容后另存为独立题目

`POST /api/questions/:id/save-as`，路径id是来源题目ID，`versionId`是编辑基于的固定来源版本，`content`是当前尚未保存的完整合法内容，`communityId`是可选的目标社区。默认另存个人题库。

```json
{
  "versionId": "555555555555555555555555",
  "content": {
    "type": "text",
    "title": "编辑后另存的昵称题",
    "description": "",
    "required": true,
    "options": [],
    "rows": [],
    "validation": { "minLength": 1, "maxLength": 10 }
  }
}
```

响应201为原有创建题目结构 `{question,version}`：question具有新的_id、revision=1、会话用户身份及独立归属；version具有新_id、number=1和编辑后的content。来源由服务端生成：

```json
{
  "questionId": "111111111111111111111111",
  "versionId": "555555555555555555555555",
  "channel": "library-save-as"
}
```

该对象位于 `question.provenance`。来源与版本必须匹配，用户须当前有该来源题库的访问权。社区来源读取／转存与目标社区写入均沿用事务和共同写栅栏，不能用旧成员身份在退出后另存。仅凭社区固定实例统计权不授予私人题库另存权；分享接收者先按原接受流程获得自己的副本，再编辑该副本。目标communityId仅支持当前成员社区；不传则个人，传空串／null非法。来源版本可以不是最新版本，因其不可变，不需要来源revision；无覆盖原题的操作，不因原题出现新版而静默改用新版。原题、所有原版本和既有快照均不修改。

顶层仅允许versionId/content/communityId，伪造provenance、source、ownerId或authorId等参数400；版本不匹配、无来源或目标社区权限404；内容不合法400；未登录401。content使用现有九题型统一校验和字段白名单，实例ID、source和跨题跳转不会复制进独立内容。数据库失败事务回滚，不创建半份题目。此创建操作没有幂等键，前端须防止重复点击；请求结果不明时先确认是否创建成功，不应盲目重复创建。

与已有接口的区别：

- “保存修改”：`PUT /api/questions/:id`，传revision与content，原题生成新版本，409保留编辑输入并重新读取比较。
- “复制已保存版本”：原 `POST /api/questions/:id/copy` 保持不变，复制versionId的已保存内容到个人题库。
- “另存为新题目”：新save-as接收当前编辑内容，成功后可以跳转新题详情，原编辑输入在成功前保留；不先调用PUT，避免意外修改原题。

### 8.4 社区概览

`GET /api/communities/:id/overview`，仅当前成员可请求；未登录401，非成员／邀请未接受／退出／被移除404。原 `GET /api/communities` 保持不变。概览示例：

```json
{
  "id": "444444444444444444444444",
  "name": "可读社区",
  "role": "member",
  "memberCount": 2,
  "questionCount": 2,
  "surveyCount": 1,
  "permissions": {
    "viewLibrary": true,
    "viewSurveys": true,
    "viewMembers": true,
    "manageMembers": false
  },
  "endpoints": {
    "library": "/api/questions?communityId=444444444444444444444444",
    "surveys": "/api/surveys?communityId=444444444444444444444444",
    "members": "/api/communities/444444444444444444444444/members"
  }
}
```

memberCount为active成员数；questionCount为该社区独立题目资源数，不累加版本数或个人副本；surveyCount为该社区未软删除问卷数，包含草稿、发布及关闭，不统计发布快照份数。每次实时数据库计数，不是假数据或缓存；并发写入时不同计数可能反映稍有差异的读取时刻，不承诺实时一致快照。返回前再次验证成员身份。endpoints是数据接口，不是前端路由；前端用communityId导航已有题库、问卷、成员页面。管理员可管理成员，普通成员可查看成员；问卷各项管理仍执行“创建者且仍为成员，或管理员”的既有规则，不能用概览viewSurveys推断有权编辑全部问卷。

本节最初为后端补充契约。前端已于2026-10-29接入用户名模式、信封提醒、编辑另存和概览；本轮真实浏览器范围见《第二阶段易用性调整与验收》，不以原后端测试代替页面验收。

## 9. 2026-10-29 广场筛选与社区接口故障排查

### 广场筛选契约

扩展 `GET /api/square?search=关键词&type=single_choice&mine=true&page=1`，原有 `{page,pageSize,total,rows}` 和每行 `version` 数组结构不变。

- `search` 可省略或空串表示全部；须为字符串，最多120字符。按分享记录固定versionId对应的 `question_versions.content.title` 做包含搜索，大小写不敏感，正则元字符转义为字面量。不查原题最新版标题。
- `type` 可省略表示全部；合法值为 `single_choice`、`multiple_choice`、`text`、`number`、`matrix`、`ranking`、`time`、`slider`、`color`。传空串或非法值返回400，code=TYPE，message=不支持的题型；前端空选择不发送参数。
- 保留mine=true仅本人公开项；仅kind=public、status=active，撤回项不出现；需登录，原有权限不变。三种筛选可组合。
- 在MongoDB中按固定资源/版本关联并筛选，再统一facet计数和分页。每页20，其他题型/标题/发送者记录不占本页位置，total与rows使用相同条件。没有结果时total=0、rows=[]，越过末页时total保留、rows=[]。
- 不影响 `/deliveries`、`/shares?direction=sent` 的筛选及固定版本含义。无数据迁移或任何版本号变化。

例如搜索固定旧标题：`GET /api/square?search=%E5%9B%BA%E5%AE%9A%E6%97%A7%E6%A0%87%E9%A2%98&type=text&page=1`。原题另存新版标题后，旧公开分享仍只按旧标题检索；如需公开新版本仍须主动创建新分享。

前端采用确认搜索：输入后按搜索或回车生效；题型和“我公开的”即时生效，应用条件后回到第一页，翻页携带所有已应用参数。重置清空关键词、题型和mine。沿用usePage的请求代次隔离晚到响应；加载、错误重试和无结果分别展示，不用本地过滤当前页冒充全库查询。

### 区分路由404与资源权限404

| 响应 | 含义与处理 |
| --- | --- |
| 404，`code=REQUEST`，`message=Cannot GET /api/...` | 服务当前路由表没有此路径。检查实际监听进程、工作目录、构建和代理，不把它当无邀请或非成员 |
| 404，`code=NOT_FOUND`，`message=资源不存在或无权访问` | 路由存在，但资源不存在或当前会话无权限。移除对应社区操作入口，不绕过成员限制 |
| 401，`code=UNAUTHORIZED` | 路由存在，需登录，沿用原会话处理 |
| 网络失败／其他错误 | 展示不可用状态和重试入口，不展示虚构计数 |

本轮3107实际是旧进程61296，工作目录为本项目apps/api、命令node dist/main.js，连接 `survey_studio_usage_ui_20261029` 独立库，启动于10:53，早于当前构建。构建文件有路由不代表旧进程内存路由表更新。已在构建后仅重启该进程为67132，沿用同端口、同MongoDB连接，控制器仍为Api和LibraryApi；启动日志确认映射两条路由。无批量结束Node、数据库重置或权限放宽。

现有3108测试代理保留/api路径转发3107；直接3107请求也曾返回Cannot GET，因此此次不是该代理改写路径造成。Vite5173开发代理仍指向3000，未改为3107。`test-results/square-community-service.json` 保存进程、磁盘构建哈希和实际响应，不保存密码或Cookie。

重启后scope_owner查询邀请数为200/pendingCount=0，其真实所属“空间 A 编辑部”概览为200，role=admin、memberCount=1、questionCount=0、surveyCount=1；不存在社区仍404/NOT_FOUND，未登录仍401。此0是接口真实结果，不是前端吞掉错误生成的数据。

### 信封及社区错误交互

邀请数量或列表失败时停止自动刷新，数量不可确认时显示未知／错误状态及问号，不显示“没有邀请”；提供手动重试。正常60秒调度，页面隐藏时取消定时器、回来重试一次，退出登录和卸载取消并隔离晚到响应。持续失败时切换页面不会反复重试；服务恢复后可手动重试或重新回到可见页面。仍是待处理邀请提醒，没有通用消息已读或实时恢复检测。

社区概览按卡片独立记录错误和重试；单卡失败不阻断其他卡片，计数只使用成功响应。确认NOT_FOUND时去掉该卡片进入入口或详情操作、清除当前失效空间；路由REQUEST错误提示核对服务版本，不冒充成员失效。详情路由切换也隔离旧响应。

## 2026-10-29 补充：草稿问卷修改归属

本节取代前文“创建后归属不可修改”的草稿限制；已发布/关闭问卷仍不可迁移。新增 `PATCH /api/surveys/:id/space`，请求 `{revision,communityId}`：communityId为实际社区ID，`null`明确表示移回个人空间，不接受空字符串或其他字段。

仅仍具有原空间管理权的问卷创建者可操作；社区管理员不能迁移他人问卷。目标社区必须是创建者当前所在社区；事务触及原/目标社区写栅栏，使用问卷revision乐观锁。只有从未发布的draft允许，publishedVersionId存在也拒绝；原ownerId不变，题目/实例/source/跳转/答案及schemaVersion不改。个人归属使用unset移除communityId，兼容既有数据库验证器。成功返回完整survey和新revision；冲突409 CONFLICT、权限404 NOT_FOUND、已发布400 PUBLISHED。普通draft保存不能修改归属。

公开题库选用复用GET /square（search/page）→POST /shares/:id/accept→POST /surveys/:id/library-instances，先生成/获取个人独立副本，再引用其返回的question和version；不读取公开来源的私人题目详情或历史。两次操作不是原子事务，若选入失败，已接受个人副本保留，可重试，不伪装已选入成功。
