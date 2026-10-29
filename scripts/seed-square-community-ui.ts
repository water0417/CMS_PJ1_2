import fs from 'node:fs';
class Client {
  cookie = '';
  user: any;
  async call(url: string, method = 'GET', body?: any, expected?: number): Promise<any> {
    const res = await fetch('http://127.0.0.1:3121/api' + url, {
      method,
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json();
    const code = expected ?? (method === 'POST' ? 201 : 200);
    if (res.status !== code)
      throw Object.assign(new Error(method + ' ' + url + ': ' + JSON.stringify(data)), {
        status: res.status,
        data,
      });
    const cookie = res.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    return data;
  }
  async register(name: string) {
    await this.call('/auth/register', 'POST', { username: name, password: 'TestPass123!' });
    this.user = await this.call('/auth/login', 'POST', {
      username: name,
      password: 'TestPass123!',
    });
  }
}
// Only this dedicated, disposable browser test service is used.
const content = (type: string, title: string) => ({
  type,
  title,
  description: '独立浏览器验证',
  required: true,
  options: ['a', 'b', 'c'].map((id) => ({ id, label: id })),
  rows: ['r1', 'r2'].map((id) => ({ id, label: id })),
  validation:
    type === 'time' ? { mode: 'date' } : type === 'slider' ? { min: 0, max: 10, step: 1 } : {},
});
async function main() {
  if (!process.env.UI_DATABASE?.startsWith('survey_studio_square_ui_'))
    throw Error('仅允许显式指定独立浏览器测试库UI_DATABASE');
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:3121/api/health')).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!ready) throw Error('Test API3121 not ready');
  const a = new Client(),
    b = new Client(),
    c = new Client();
  await a.register('square_admin');
  await b.register('square_member');
  await c.register('square_outside');
  const types = [
    'single_choice',
    'multiple_choice',
    'text',
    'number',
    'matrix',
    'ranking',
    'time',
    'slider',
    'color',
  ];
  async function pub(client: Client, type: string, title: string) {
    const q = await client.call('/questions', 'POST', { content: content(type, title) });
    await client.call('/questions/' + q.question._id + '/shares', 'POST', {
      kind: 'public',
      versionId: q.version._id,
    });
    return q;
  }
  for (const type of types) await pub(a, type, '广场九题型 · ' + type);
  for (let i = 1; i <= 21; i++)
    await pub(a, 'single_choice', '分页 · 课程反馈 ' + String(i).padStart(2, '0'));
  for (let i = 1; i <= 3; i++) await pub(b, 'single_choice', '分页 · 成员反馈 ' + i);
  const old = await pub(a, 'text', '固定旧标题 [.*]');
  await a.call('/questions/' + old.question._id, 'PUT', {
    revision: 1,
    content: content('text', '新版标题不可搜索旧分享'),
  });
  const rooms: any[] = [];
  for (const name of ['共同编辑部 A', '协作社区 B', '邀请拒绝演示 C']) {
    const room = await a.call('/communities', 'POST', { name });
    const inv = await a.call('/communities/' + room._id + '/invitations', 'POST', {
      recipientId: b.user.id,
    });
    rooms.push(room);
    if (rooms.length === 1)
      await b.call('/community-invitations/' + inv._id + '/accept', 'POST', {
        revision: inv.revision,
      });
  }
  await a.call('/questions', 'POST', {
    content: content('text', '社区题'),
    communityId: rooms[0]._id,
  });
  await a.call('/surveys', 'POST', { title: '社区草稿', communityId: rooms[0]._id });
  fs.writeFileSync(
    `test-results/${process.env.UI_EVIDENCE_PREFIX || 'square-community'}-ui-fixtures.json`,
    JSON.stringify(
      {
        database: process.env.UI_DATABASE,
        users: { admin: a.user, member: b.user, outside: c.user },
        rooms,
      },
      null,
      2,
    ),
  );
  console.log('Browser fixtures created in dedicated3121 test database');
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
