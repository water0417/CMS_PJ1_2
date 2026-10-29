import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import mongoose from 'mongoose';
const database = 'survey_studio_usage_scope_test_' + Date.now();
const uri = (
  process.env.TEST_MONGODB_URI ??
  'mongodb://127.0.0.1:27018/survey_studio?replicaSet=rs0&directConnection=true'
).replace(/\/[^/?]+(?=\?|$)/, '/' + database);
const base = 'http://127.0.0.1:3106/api';
const results: any[] = [];
let logs = '';
const server = spawn(process.execPath, ['dist/main.js'], {
  cwd: path.resolve('apps/api'),
  env: { ...process.env, PORT: '3106', MONGODB_URI: uri },
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
        if ((await fetch(base + '/health')).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.ok(ready, logs);
    await mongoose.connect(uri);
    for (const [client, name] of [
      [a, 'owner'],
      [b, 'member'],
      [c, 'pending'],
      [outsider, 'outside'],
    ] as const)
      await client.register(name);
    const roomA = await a.call('/communities', 'POST', { name: 'A' });
    const roomB = await a.call('/communities', 'POST', { name: 'B' });
    async function invite(client: Client, room: any, accept = true) {
      const inv = await a.call('/communities/' + room._id + '/invitations', 'POST', {
        recipientId: client.user.id,
      });
      if (accept)
        await client.call('/community-invitations/' + inv._id + '/accept', 'POST', {
          revision: inv.revision,
        });
    }
    await invite(b, roomA);
    await invite(c, roomA, false);
    const q = await createQuestion(a, content('number'));
    const suffix = (community?: any, page = 1) =>
      '?versionId=' +
      q.version._id +
      (community ? '&communityId=' + community._id : '') +
      '&page=' +
      page;
    const usage = (client: Client, room?: any, page = 1) =>
      client.call('/questions/' + q.question._id + '/usage' + suffix(room, page));
    const stats = (client: Client, room?: any) =>
      client.call('/questions/' + q.question._id + '/statistics' + suffix(room));
    async function survey(room?: any, n = 1, resource = q, client = a) {
      let s = await createSurvey(client, 'scope ' + (room?.name ?? 'personal'), room?._id);
      for (let i = 0; i < n; i++) s = (await attach(client, s, resource)).survey;
      return s;
    }
    let personal = await survey(undefined, 21),
      communityA = await survey(roomA, 22),
      communityB = await survey(roomB, 23);
    await check('个人空间过滤在分页前执行，21实例两页及total一致', async () => {
      const first = await usage(a),
        second = await usage(a, undefined, 2);
      assert.equal(first.total, 21);
      assert.equal(second.total, 21);
      assert.equal(first.rows.length, 20);
      assert.equal(second.rows.length, 1);
      const rows = [...first.rows, ...second.rows];
      assert.equal(new Set(rows.map((r) => r.instanceId)).size, 21);
      assert.ok(rows.every((r) => r.surveyId === personal._id && !r.communityId));
    });
    await check('社区A/B严格隔离，其他空间不占分页且不泄露名称', async () => {
      for (const [room, s, total] of [
        [roomA, communityA, 22],
        [roomB, communityB, 23],
      ] as const) {
        const one = await usage(a, room),
          two = await usage(a, room, 2);
        assert.equal(one.total, total);
        assert.equal(two.total, total);
        assert.equal(one.rows.length, 20);
        assert.equal(two.rows.length, total - 20);
        assert.ok(
          [...one.rows, ...two.rows].every(
            (r) => r.surveyId === s._id && r.communityId === room._id,
          ),
        );
      }
    });
    await check('非成员及未接受邀请者拒绝社区使用和统计查询', async () => {
      for (const client of [outsider, c])
        for (const endpoint of ['usage', 'statistics'])
          await client.call(
            '/questions/' + q.question._id + '/' + endpoint + suffix(roomA),
            'GET',
            undefined,
            404,
          );
    });
    await check('私人来源固定版本授权保留，不授予私人题库和其他版本权限', async () => {
      assert.equal((await usage(b, roomA)).total, 22);
      await b.call('/questions/' + q.question._id, 'GET', undefined, 404);
      const newer = await a.call('/questions/' + q.question._id, 'PUT', {
        revision: 1,
        content: content('number', { title: 'v2' }),
      });
      await b.call(
        '/questions/' +
          q.question._id +
          '/usage?versionId=' +
          newer.version._id +
          '&communityId=' +
          roomA._id,
        'GET',
        undefined,
        404,
      );
      await survey(undefined, 1, newer);
      assert.equal((await usage(a)).total, 21);
      await a.call(
        '/questions/' + q.question._id + '/usage?versionId=' + newer.version._id,
        'GET',
        undefined,
        200,
      );
      await a.call(
        '/questions/' + q.question._id + '/usage?versionId=' + newer.question._id,
        'GET',
        undefined,
        404,
      );
    });
    await check('副本及其他用户私人问卷不进入原题使用结果', async () => {
      const share = await a.call('/questions/' + q.question._id + '/shares', 'POST', {
        kind: 'delivery',
        versionId: q.version._id,
        recipientId: b.user.id,
      });
      const copy = await b.call('/shares/' + share._id + '/accept', 'POST', {});
      await survey(undefined, 1, copy, b);
      const common = await createQuestion(a, content('number'), roomA._id);
      const own = await survey(undefined, 1, common),
        other = await survey(undefined, 1, common, b);
      const r = await a.call(
        '/questions/' + common.question._id + '/usage?versionId=' + common.version._id,
      );
      assert.equal(r.total, 1);
      assert.equal(r.rows[0].surveyId, own._id);
      assert.ok(!JSON.stringify(r).includes(other._id));
      assert.equal((await usage(a)).total, 21);
    });
    await check('无引用题返回空列表，空和缺失communityId兼容', async () => {
      const empty = await createQuestion(a, content());
      const result = await a.call(
        '/questions/' + empty.question._id + '/usage?versionId=' + empty.version._id,
      );
      assert.equal(result.total, 0);
      assert.deepEqual(result.rows, []);
      await mongoose.connection
        .db!.collection('surveys')
        .updateOne(
          { _id: new mongoose.Types.ObjectId(personal._id) },
          { $set: { communityId: null } },
          { bypassDocumentValidation: true },
        );
      assert.equal((await usage(a)).total, 21);
      // Restore the current schema after probing a legacy null fixture.
      await mongoose.connection
        .db!.collection('surveys')
        .updateOne(
          { _id: new mongoose.Types.ObjectId(personal._id) },
          { $unset: { communityId: '' } },
        );
    });
    await check('发布及归档沿用原口径，回答统计按空间聚合不变', async () => {
      personal = await publish(a, personal);
      communityA = await publish(a, communityA);
      communityB = await publish(a, communityB);
      await fill(outsider, personal);
      await fill(outsider, communityA);
      await fill(outsider, communityB);
      for (const [room, count] of [
        [undefined, 21],
        [roomA, 22],
        [roomB, 23],
      ] as const) {
        const r = await stats(a, room);
        assert.equal(r.answerCount, count);
        assert.equal(r.numeric.average, 20);
        assert.equal((await usage(a, room)).total, count);
      }
      const db = mongoose.connection.db!;
      const old = await db.collection('survey_versions').findOne({ surveyId: personal._id });
      assert.ok(old);
      const newer = { ...old, _id: new mongoose.Types.ObjectId(), versionNumber: 99 };
      await db.collection('survey_versions').insertOne(newer);
      await db
        .collection('surveys')
        .updateOne(
          { _id: new mongoose.Types.ObjectId(personal._id) },
          { $set: { publishedVersionId: newer._id.toString() } },
        );
      const first = await usage(a),
        second = await usage(a, undefined, 2),
        third = await usage(a, undefined, 3);
      assert.equal(first.total, 42);
      const rows = [...first.rows, ...second.rows, ...third.rows];
      assert.equal(rows.filter((r) => r.kind === 'archived').length, 21);
      assert.equal(rows.filter((r) => r.kind === 'published').length, 21);
      assert.equal((await stats(a)).answerCount, 21);
    });
    await check('题目版本归属不匹配被拒绝，独立副本使用单独计数', async () => {
      const other = await createQuestion(a, content('number'));
      await a.call(
        '/questions/' + q.question._id + '/usage?versionId=' + other.version._id,
        'GET',
        undefined,
        404,
      );
      const independent = await createQuestion(a, content('number'));
      const own = await survey(undefined, 2, independent);
      const result = await a.call(
        '/questions/' + independent.question._id + '/usage?versionId=' + independent.version._id,
      );
      assert.equal(result.total, 2);
      assert.ok(result.rows.every((r: any) => r.surveyId === own._id));
      assert.equal((await usage(a)).total, 42);
    });
    await check('移除和退出撤销社区访问，个人固定实例仍可读', async () => {
      const common = await createQuestion(a, content('number'), roomA._id);
      const retained = await survey(undefined, 1, common, b);
      await a.call('/communities/' + roomA._id + '/members/' + b.user.id, 'DELETE');
      for (const endpoint of ['usage', 'statistics']) {
        await b.call(
          '/questions/' + q.question._id + '/' + endpoint + suffix(roomA),
          'GET',
          undefined,
          404,
        );
        const r = await b.call(
          '/questions/' + common.question._id + '/' + endpoint + '?versionId=' + common.version._id,
        );
        if (endpoint === 'usage') {
          assert.equal(r.total, 1);
          assert.equal(r.rows[0].surveyId, retained._id);
        }
      }
      await invite(b, roomA);
      await b.call('/communities/' + roomA._id + '/leave', 'POST', {});
      for (const endpoint of ['usage', 'statistics'])
        await b.call(
          '/questions/' + q.question._id + '/' + endpoint + suffix(roomA),
          'GET',
          undefined,
          404,
        );
    });
    console.log('Usage scope ' + results.length + '/' + results.length + ' PASS');
  } finally {
    fs.writeFileSync(
      'test-results/usage-scope-integration.json',
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
