import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import mongoose from 'mongoose';
const database = 'survey_studio_backend_additions_test_' + Date.now();
const uri = (
  process.env.TEST_MONGODB_URI ??
  'mongodb://127.0.0.1:27018/survey_studio?replicaSet=rs0&directConnection=true'
).replace(/\/[^/?]+(?=\?|$)/, '/' + database);
const base = 'http://127.0.0.1:3117/api';
const results: any[] = [];
let logs = '';
const server = spawn(process.execPath, ['dist/main.js'], {
  cwd: path.resolve('apps/api'),
  env: { ...process.env, PORT: '3117', MONGODB_URI: uri },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (d) => (logs += d));
server.stderr.on('data', (d) => (logs += d));
class Client {
  cookie = '';
  user: any;
  async call(url: string, method = 'GET', body?: any, expected?: number): Promise<any> {
    const res = await fetch(base + url, {
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
const a = new Client(),
  b = new Client(),
  c = new Client(),
  outsider = new Client();
async function check(name: string, work: () => Promise<void>) {
  try {
    await work();
  } catch (error: any) {
    results.push({ name, result: 'FAIL', error: error.message });
    throw error;
  }
  results.push({ name, result: 'PASS' });
  console.log('PASS ' + name);
}
function content(type = 'text', extra: any = {}) {
  return {
    type,
    title: type + '题目',
    description: '',
    required: true,
    options: ['a', 'b', 'c'].map((id) => ({ id, label: id.toUpperCase() })),
    rows: ['r1', 'r2'].map((id) => ({ id, label: id })),
    validation:
      type === 'slider' ? { min: 0, max: 10, step: 1 } : type === 'time' ? { mode: 'date' } : {},
    ...extra,
  };
}
const answer: Record<string, any> = {
  single_choice: 'a',
  multiple_choice: ['a', 'b'],
  text: '测试文字',
  number: 20,
  matrix: { r1: 'a', r2: 'b' },
  ranking: ['b', 'a', 'c'],
  time: '2026-10-28',
  slider: 8,
  color: '#123456',
};
async function createQuestion(client: Client, value: any, communityId?: string) {
  return client.call('/questions', 'POST', {
    content: value,
    ...(communityId ? { communityId } : {}),
  });
}
async function createSurvey(client: Client, title = '测试问卷', communityId?: string) {
  return client.call('/surveys', 'POST', { title, ...(communityId ? { communityId } : {}) });
}
async function attach(client: Client, survey: any, q: any, versionId?: string) {
  return client.call('/surveys/' + survey._id + '/library-instances', 'POST', {
    revision: survey.revision,
    questionId: q.question._id,
    versionId: versionId ?? q.version._id,
  });
}
async function publish(client: Client, survey: any) {
  return client.call('/surveys/' + survey._id + '/publish', 'POST', {
    revision: survey.revision,
    deadlineAt: null,
  });
}
async function fill(client: Client, survey: any, override: any = {}) {
  let t = await client.call('/public/surveys/' + survey.publicId + '/attempts', 'POST', {
    anonymous: false,
  });
  while (!t.state.ready) {
    const q = survey.draft.questions.find((q: any) => q.id === t.state.currentQuestionId);
    t = await client.call('/attempts/' + t.id + '/advance', 'POST', {
      revision: t.state.revision,
      answer: override[q.id] ?? answer[q.type],
    });
  }
  return client.call('/attempts/' + t.id + '/submit', 'POST', { revision: t.state.revision });
}
async function main() {
  try {
    let ready = false;
    for (let i = 0; i < 200; i++) {
      try {
        if (logs.includes('3117') && (await fetch(base + '/health')).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.ok(ready, logs);
    await mongoose.connect(uri);
    await a.register('OwnerCase');
    await b.register('ReceiverCase');
    await c.register('PendingUser');
    await outsider.register('OutsideUser');
    const anonymous = new Client();
    await check('用户名精确规范化、ID兼容及最小响应', async () => {
      for (const name of ['ReceiverCase', 'receivercase', 'RECEIVERCASE'])
        assert.deepEqual(await a.call('/users?username=' + name), {
          id: b.user.id,
          username: 'ReceiverCase',
        });
      assert.deepEqual(await a.call('/users/' + b.user.id), {
        id: b.user.id,
        username: 'ReceiverCase',
      });
      await a.call('/users?username=NotFoundUser', 'GET', undefined, 404);
      for (const query of [
        '',
        '?username=',
        '?username=%20%20%20',
        '?username=Receiv',
        '?username=Receiver.*',
      ])
        await a.call('/users' + query, 'GET', undefined, query === '?username=Receiv' ? 404 : 400);
      await anonymous.call('/users?username=ReceiverCase', 'GET', undefined, 401);
      await anonymous.call('/users/' + b.user.id, 'GET', undefined, 401);
    });
    const room = await a.call('/communities', 'POST', { name: '可读社区' });
    let invitation: any;
    await check('用户名查得ID可投递及邀请，展示名称不泄露账号敏感字段', async () => {
      const recipient = await a.call('/users?username=RECEIVERCASE');
      invitation = await a.call('/communities/' + room._id + '/invitations', 'POST', {
        recipientId: recipient.id,
      });
      const list = await b.call('/community-invitations');
      assert.equal(list.total, 1);
      assert.equal(list.pendingCount, 1);
      const row = list.rows[0];
      assert.equal(row._id, invitation._id);
      assert.equal(row.status, 'pending');
      assert.equal(row.revision, invitation.revision);
      assert.deepEqual(row.community, { id: room._id, name: '可读社区' });
      assert.deepEqual(row.inviter, { id: a.user.id, username: 'OwnerCase' });
      assert.ok(!JSON.stringify(list).includes('password'));
      assert.ok(!JSON.stringify(list).includes('survey_session'));
      const q = await createQuestion(a, content());
      const share = await a.call('/questions/' + q.question._id + '/shares', 'POST', {
        kind: 'delivery',
        versionId: q.version._id,
        recipientId: recipient.id,
      });
      assert.equal(share.recipientId, b.user.id);
    });
    await check('信封读取不改状态，接受拒绝后待处理数量更新且会话隔离', async () => {
      assert.deepEqual(await b.call('/community-invitations/pending-count'), { pendingCount: 1 });
      await b.call('/community-invitations');
      assert.deepEqual(await b.call('/community-invitations/pending-count'), { pendingCount: 1 });
      assert.equal((await outsider.call('/community-invitations')).total, 0);
      assert.equal((await outsider.call('/community-invitations/pending-count')).pendingCount, 0);
      await outsider.call(
        '/community-invitations/' + invitation._id + '/accept',
        'POST',
        { revision: invitation.revision },
        404,
      );
      await b.call('/community-invitations/' + invitation._id + '/accept', 'POST', {
        revision: invitation.revision,
      });
      assert.equal((await b.call('/community-invitations/pending-count')).pendingCount, 0);
      const inv = await a.call('/communities/' + room._id + '/invitations', 'POST', {
        recipientId: c.user.id,
      });
      await c.call('/community-invitations/' + inv._id + '/reject', 'POST', {
        revision: inv.revision,
      });
      assert.equal((await c.call('/community-invitations')).pendingCount, 0);
      await anonymous.call('/community-invitations/pending-count', 'GET', undefined, 401);
      await anonymous.call('/community-invitations', 'GET', undefined, 401);
    });
    await check('超过20邀请时pendingCount不依赖当前页', async () => {
      for (let i = 0; i < 21; i++) {
        const r = await a.call('/communities', 'POST', { name: '分页社区' + i });
        await a.call('/communities/' + r._id + '/invitations', 'POST', { recipientId: c.user.id });
      }
      const first = await c.call('/community-invitations?page=1'),
        second = await c.call('/community-invitations?page=2');
      assert.equal(first.total, 22);
      assert.equal(first.rows.length, 20);
      assert.equal(second.rows.length, 2);
      await c.call(
        '/communities/' + first.rows[0].communityId + '/overview',
        'GET',
        undefined,
        404,
      );
      assert.equal(first.pendingCount, 21);
      assert.equal(second.pendingCount, 21);
      assert.equal((await c.call('/community-invitations/pending-count')).pendingCount, 21);
      assert.ok(
        [...first.rows, ...second.rows].every(
          (r: any) => r.community.name && r.inviter.username === 'OwnerCase',
        ),
      );
    });
    await check('九种题型未保存编辑另存为独立v1，来源不变且原题不变', async () => {
      for (const type of Object.keys(answer)) {
        const original = await createQuestion(a, content(type));
        const edited = content(type, { title: '未保存编辑 ' + type });
        const copy = await a.call('/questions/' + original.question._id + '/save-as', 'POST', {
          versionId: original.version._id,
          content: edited,
        });
        assert.notEqual(copy.question._id, original.question._id);
        assert.notEqual(copy.version._id, original.version._id);
        assert.equal(copy.version.number, 1);
        assert.equal(copy.question.revision, 1);
        assert.equal(copy.question.ownerId, a.user.id);
        assert.equal(copy.question.communityId, undefined);
        assert.deepEqual(copy.version.content, edited);
        assert.deepEqual(copy.question.provenance, {
          questionId: original.question._id,
          versionId: original.version._id,
          channel: 'library-save-as',
        });
        assert.equal(copy.version.authorId, a.user.id);
        const source = await a.call('/questions/' + original.question._id);
        assert.deepEqual(source, original);
        assert.equal((await a.call('/questions/' + original.question._id + '/versions')).total, 1);
      }
    });
    await check('另存为验证内容、来源归属、当前访问权和防伪造', async () => {
      const source = await createQuestion(a, content()),
        other = await createQuestion(a, content());
      const url = '/questions/' + source.question._id + '/save-as';
      const body = { versionId: source.version._id, content: content() };
      await a.call(url, 'POST', null, 400);
      await b.call(url, 'POST', body, 404);
      await anonymous.call(url, 'POST', body, 401);
      await a.call(url, 'POST', { ...body, versionId: other.version._id }, 404);
      await a.call(
        url,
        'POST',
        { ...body, content: content('number', { validation: { min: 10, max: 1 } }) },
        400,
      );
      for (const field of ['provenance', 'source', 'ownerId', 'authorId'])
        await a.call(url, 'POST', { ...body, [field]: a.user.id }, 400);
      const saved = await a.call(url, 'POST', {
        ...body,
        content: {
          ...content(),
          source: { questionId: other.question._id },
          jumpRules: [{ target: 'END' }],
        },
      });
      assert.equal(saved.version.content.source, undefined);
      assert.equal(saved.version.content.jumpRules, undefined);
      assert.equal(saved.question.provenance.questionId, source.question._id);
    });
    let communitySource: any, retained: any;
    await check('社区来源另存个人及社区需当前成员，旧保存修改仍产生新版本', async () => {
      communitySource = await createQuestion(a, content('text'), room._id);
      const edited = content('text', { title: '社区另存编辑' });
      retained = await b.call('/questions/' + communitySource.question._id + '/save-as', 'POST', {
        versionId: communitySource.version._id,
        content: edited,
      });
      const dest = await b.call('/questions/' + communitySource.question._id + '/save-as', 'POST', {
        versionId: communitySource.version._id,
        content: edited,
        communityId: room._id,
      });
      assert.equal(dest.question.communityId, room._id);
      assert.equal(dest.question.ownerId, undefined);
      const foreign = await outsider.call('/communities', 'POST', { name: '其他社区' });
      await b.call(
        '/questions/' + communitySource.question._id + '/save-as',
        'POST',
        { versionId: communitySource.version._id, content: edited, communityId: foreign._id },
        404,
      );
      const v2 = await b.call('/questions/' + communitySource.question._id, 'PUT', {
        revision: 1,
        content: content('text', { title: '保存修改新版' }),
      });
      assert.equal(v2.version.number, 2);
      assert.equal((await b.call('/questions/' + retained.question._id)).version.number, 1);
    });
    await check('社区概览真实计数、角色及入口，排除个人和已删除问卷', async () => {
      await createQuestion(a, content());
      await createSurvey(a, '个人不计');
      await createSurvey(a, '社区草稿', room._id);
      const deleted = await createSurvey(a, '社区删除', room._id);
      await a.call('/surveys/' + deleted._id, 'DELETE', { revision: deleted.revision });
      const admin = await a.call('/communities/' + room._id + '/overview'),
        member = await b.call('/communities/' + room._id + '/overview');
      assert.equal(admin.name, '可读社区');
      assert.equal(admin.role, 'admin');
      assert.equal(member.role, 'member');
      assert.equal(admin.memberCount, 2);
      assert.equal(admin.questionCount, 2);
      assert.equal(admin.surveyCount, 1);
      assert.equal(admin.permissions.manageMembers, true);
      assert.equal(member.permissions.manageMembers, false);
      assert.equal(admin.endpoints.library, '/api/questions?communityId=' + room._id);
      assert.equal(admin.endpoints.surveys, '/api/surveys?communityId=' + room._id);
      assert.equal(admin.endpoints.members, '/api/communities/' + room._id + '/members');
      for (const client of [c, outsider])
        await client.call('/communities/' + room._id + '/overview', 'GET', undefined, 404);
      await anonymous.call('/communities/' + room._id + '/overview', 'GET', undefined, 401);
      const empty = await a.call('/communities', 'POST', { name: '空社区' });
      const view = await a.call('/communities/' + empty._id + '/overview');
      assert.equal(view.memberCount, 1);
      assert.equal(view.questionCount, 0);
      assert.equal(view.surveyCount, 0);
    });
    await check('退出移除后概览与另存被拒绝，离开前个人副本仍独立可用', async () => {
      await b.call('/communities/' + room._id + '/leave', 'POST', {});
      await b.call('/communities/' + room._id + '/overview', 'GET', undefined, 404);
      await b.call(
        '/questions/' + communitySource.question._id + '/save-as',
        'POST',
        { versionId: communitySource.version._id, content: content() },
        404,
      );
      assert.ok((await b.call('/questions/' + retained.question._id)).question);
      assert.equal((await a.call('/communities/' + room._id + '/overview')).memberCount, 1);
      const inv = await a.call('/communities/' + room._id + '/invitations', 'POST', {
        recipientId: b.user.id,
      });
      await b.call('/community-invitations/' + inv._id + '/accept', 'POST', {
        revision: inv.revision,
      });
      await a.call('/communities/' + room._id + '/members/' + b.user.id, 'DELETE');
      await b.call('/communities/' + room._id + '/overview', 'GET', undefined, 404);
      await b.call(
        '/questions/' + retained.question._id + '/save-as',
        'POST',
        { versionId: retained.version._id, content: content(), communityId: room._id },
        404,
      );
    });
    console.log('Backend additions ' + results.length + '/' + results.length + ' PASS');
  } finally {
    fs.writeFileSync(
      'test-results/backend-additions-integration.json',
      JSON.stringify({ time: new Date().toISOString(), database, results }, null, 2),
    );
    await mongoose.disconnect();
    server.kill();
  }
}
main().catch((e) => {
  console.error(e);
  console.error(logs.slice(-4000));
  process.exitCode = 1;
});
