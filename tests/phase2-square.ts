import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import mongoose from 'mongoose';
const database = 'survey_studio_square_test_' + Date.now();
const uri = (
  process.env.TEST_MONGODB_URI ??
  'mongodb://127.0.0.1:27018/survey_studio?replicaSet=rs0&directConnection=true'
).replace(/\/[^/?]+(?=\?|$)/, '/' + database);
const base = 'http://127.0.0.1:3119/api';
const results: any[] = [];
let logs = '';
const server = spawn(process.execPath, ['dist/main.js'], {
  cwd: path.resolve('apps/api'),
  env: { ...process.env, PORT: '3119', MONGODB_URI: uri },
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
        if (logs.includes('3119') && (await fetch(base + '/health')).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.ok(ready, logs);
    await mongoose.connect(uri);
    await a.register('square_owner');
    await b.register('square_other');
    async function publishQ(client: Client, type: string, title: string) {
      const q = await createQuestion(client, content(type, { title }));
      const share = await client.call('/questions/' + q.question._id + '/shares', 'POST', {
        kind: 'public',
        versionId: q.version._id,
      });
      return { q, share };
    }
    const all: any[] = [];
    for (const type of Object.keys(answer)) all.push(await publishQ(a, type, '九型 ' + type));
    await check('九种题型单独筛选和公开固定内容返回兼容', async () => {
      for (const type of Object.keys(answer)) {
        const r = await a.call('/square?type=' + type);
        assert.equal(r.total, 1);
        assert.equal(r.rows[0].version[0].content.type, type);
        assert.equal(r.rows[0].version[0].number, 1);
      }
    });
    await check('标题包含搜索、无结果、长度及非法题型', async () => {
      assert.equal((await a.call('/square?search=' + encodeURIComponent('九型'))).total, 9);
      assert.equal((await a.call('/square?search=single_choice')).total, 1);
      assert.equal((await a.call('/square?search=nonexistent')).total, 0);
      assert.deepEqual((await a.call('/square?search=nonexistent')).rows, []);
      for (const query of ['type=bad', 'type=', 'search=' + 'x'.repeat(121), 'search=x&search=y'])
        await a.call('/square?' + query, 'GET', undefined, 400);
      await new Client().call('/square', 'GET', undefined, 401);
    });
    const literal = '字面 .*+?^${}()|[]\\ 固定';
    let special: any;
    await check('搜索正则特殊字符按字面量转义', async () => {
      special = await publishQ(a, 'text', literal);
      const r = await a.call('/square?search=' + encodeURIComponent('.*+?^${}()|[]\\'));
      assert.equal(r.total, 1);
      assert.equal(r.rows[0]._id, special.share._id);
    });
    await check('原题更新不改变公开旧标题或题型检索，撤回排除', async () => {
      const { q, share } = all[0];
      await a.call('/questions/' + q.question._id, 'PUT', {
        revision: 1,
        content: content('text', { title: '最新私有标题' }),
      });
      assert.equal((await a.call('/square?search=single_choice&type=single_choice')).total, 1);
      assert.equal((await a.call('/square?search=' + encodeURIComponent('最新私有标题'))).total, 0);
      await a.call('/shares/' + special.share._id, 'DELETE');
      assert.equal((await a.call('/square?search=' + encodeURIComponent(literal))).total, 0);
    });
    const ids: string[] = [];
    for (let i = 0; i < 23; i++)
      ids.push((await publishQ(a, 'single_choice', '分页合集 ' + i)).share._id);
    for (let i = 0; i < 3; i++) await publishQ(b, 'single_choice', '分页合集 他人' + i);
    await publishQ(a, 'color', '分页合集 色彩');
    await check('关键词题型mine组合过滤在数据库计数分页前完成', async () => {
      const one = await a.call(
          '/square?search=' +
            encodeURIComponent('分页合集') +
            '&type=single_choice&mine=true&page=1',
        ),
        two = await a.call(
          '/square?search=' +
            encodeURIComponent('分页合集') +
            '&type=single_choice&mine=true&page=2',
        );
      assert.equal(one.total, 23);
      assert.equal(two.total, 23);
      assert.equal(one.rows.length, 20);
      assert.equal(two.rows.length, 3);
      assert.deepEqual(new Set([...one.rows, ...two.rows].map((r: any) => r._id)), new Set(ids));
      assert.equal(
        (await a.call('/square?search=' + encodeURIComponent('分页合集') + '&type=single_choice'))
          .total,
        26,
      );
      assert.equal(
        (
          await b.call(
            '/square?search=' + encodeURIComponent('分页合集') + '&mine=true&type=single_choice',
          )
        ).total,
        3,
      );
      assert.equal(
        (await a.call('/square?search=' + encodeURIComponent('分页合集') + '&mine=true')).total,
        24,
      );
    });
    await check('组合无结果、翻越末页、mine和撤回计数一致', async () => {
      const r = await a.call(
        '/square?search=' + encodeURIComponent('分页合集') + '&type=matrix&mine=true',
      );
      assert.equal(r.total, 0);
      assert.deepEqual(r.rows, []);
      const last = await a.call(
        '/square?search=' + encodeURIComponent('分页合集') + '&type=single_choice&mine=true&page=3',
      );
      assert.equal(last.total, 23);
      assert.deepEqual(last.rows, []);
      await a.call('/shares/' + ids[0], 'DELETE');
      assert.equal(
        (
          await a.call(
            '/square?search=' + encodeURIComponent('分页合集') + '&type=single_choice&mine=true',
          )
        ).total,
        22,
      );
    });
    await check('私人投递和发送历史不受广场条件影响', async () => {
      const q = all[1].q;
      await a.call('/questions/' + q.question._id + '/shares', 'POST', {
        kind: 'delivery',
        versionId: q.version._id,
        recipientId: b.user.id,
      });
      assert.equal((await b.call('/deliveries?search=unrelated&type=bad')).total, 1);
      const sent = await a.call('/shares?direction=sent&kind=delivery');
      assert.equal(sent.total, 1);
      assert.equal(sent.rows[0].versionId, q.version._id);
    });
    console.log('Square ' + results.length + '/' + results.length + ' PASS');
  } finally {
    fs.writeFileSync(
      'test-results/square-community-integration.json',
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
