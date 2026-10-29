// Dedicated disposable browser fixture. Never points at the normal application port.
const fs = require('node:fs');
const base = 'http://127.0.0.1:3107/api';
class Client {
  cookie = '';
  async call(url, method = 'GET', body) {
    const r = await fetch(base + url, {
      method,
      headers: {
        Cookie: this.cookie,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw Error(url + JSON.stringify(data));
    if (r.headers.get('set-cookie')) this.cookie = r.headers.get('set-cookie').split(';')[0];
    return data;
  }
  async login(name, register = false) {
    if (register)
      await this.call('/auth/register', 'POST', { username: name, password: 'TestPass123!' });
    this.user = await this.call('/auth/login', 'POST', {
      username: name,
      password: 'TestPass123!',
    });
  }
}
const content = (type, title) => ({
  type,
  title,
  description: '仅独立测试数据库的浏览器夹具',
  required: true,
  options: [],
  rows: [],
  validation: {},
});
(async () => {
  const a = new Client(),
    b = new Client();
  if (process.argv[2] === 'remove') {
    const f = JSON.parse(fs.readFileSync('test-results/usage-ui-fixtures.json', 'utf8'));
    await a.login('scope_owner');
    await a.call('/communities/' + f.roomA._id + '/members/' + f.users.member.id, 'DELETE');
    console.log('Removed test member from test community A');
    return;
  }
  if (process.argv[2] === 'conflict') {
    const f = JSON.parse(fs.readFileSync('test-results/usage-ui-fixtures.json', 'utf8'));
    await a.login('scope_owner');
    const q = await a.call('/questions/' + f.matrix.question._id);
    await a.call('/questions/' + q.question._id, 'PUT', {
      revision: q.question.revision,
      content: { ...q.version.content, title: '服务器并发保存的矩阵版本' },
    });
    return;
  }
  await a.login('scope_owner', true);
  await b.login('scope_member', true);
  const roomA = await a.call('/communities', 'POST', { name: '空间 A 编辑部' });
  const roomB = await a.call('/communities', 'POST', { name: '空间 B 编辑部' });
  for (const room of [roomA, roomB]) {
    const inv = await a.call('/communities/' + room._id + '/invitations', 'POST', {
      recipientId: b.user.id,
    });
    await b.call('/community-invitations/' + inv._id + '/accept', 'POST', {
      revision: inv.revision,
    });
  }
  const question = await a.call('/questions', 'POST', {
    content: content('text', '同一私人来源的空间隔离题'),
  });
  const surveys = {};
  for (const [key, n, room] of [
    ['personal', 21, null],
    ['A', 22, roomA],
    ['B', 23, roomB],
  ]) {
    let s = await a.call('/surveys', 'POST', {
      title: key + ' 空间专属引用',
      ...(room ? { communityId: room._id } : {}),
    });
    for (let i = 0; i < n; i++)
      s = (
        await a.call('/surveys/' + s._id + '/library-instances', 'POST', {
          revision: s.revision,
          questionId: question.question._id,
          versionId: question.version._id,
        })
      ).survey;
    s = await a.call('/surveys/' + s._id + '/publish', 'POST', {
      revision: s.revision,
      deadlineAt: null,
    });
    let attempt = await a.call('/public/surveys/' + s.publicId + '/attempts', 'POST', {
      anonymous: false,
    });
    while (!attempt.state.ready)
      attempt = await a.call('/attempts/' + attempt.id + '/advance', 'POST', {
        revision: attempt.state.revision,
        answer: key + ' 固定版本回答',
      });
    await a.call('/attempts/' + attempt.id + '/submit', 'POST', {
      revision: attempt.state.revision,
    });
    surveys[key] = s;
  }
  const empty = await a.call('/questions/' + question.question._id, 'PUT', {
    revision: question.question.revision,
    content: { ...question.version.content, title: 'v2 暂无引用' },
  });
  const m = content('matrix', '窄屏长矩阵');
  m.options = Array.from({ length: 9 }, (_, i) => ({ id: 'c' + i, label: '评价维度 ' + (i + 1) }));
  m.rows = Array.from({ length: 7 }, (_, i) => ({ id: 'r' + i, label: '服务场景 ' + (i + 1) }));
  const matrix = await a.call('/questions', 'POST', { content: m });
  let editor = await a.call('/surveys', 'POST', { title: '窄屏升级差异验收' });
  editor = (
    await a.call('/surveys/' + editor._id + '/library-instances', 'POST', {
      revision: editor.revision,
      questionId: matrix.question._id,
      versionId: matrix.version._id,
    })
  ).survey;
  const matrixNew = await a.call('/questions/' + matrix.question._id, 'PUT', {
    revision: 1,
    content: {
      ...m,
      title: '窄屏长矩阵新版',
      options: m.options.map((o) => ({ ...o, label: o.label + ' 新版描述' })),
    },
  });
  fs.writeFileSync(
    'test-results/usage-ui-fixtures.json',
    JSON.stringify(
      {
        database: 'survey_studio_usage_ui_20261029',
        users: { owner: a.user, member: b.user },
        roomA,
        roomB,
        question,
        empty,
        surveys,
        matrix,
        matrixNew,
        editor,
      },
      null,
      2,
    ),
  );
  console.log(
    'Dedicated UI fixtures ready: personal21/A22/B23; fixed v1 and empty v2; matrix upgrade.',
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
