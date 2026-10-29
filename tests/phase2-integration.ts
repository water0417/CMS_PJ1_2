import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import mongoose from 'mongoose';
const database = 'survey_studio_phase2_test_' + Date.now();
const uri = (
  process.env.TEST_MONGODB_URI ??
  'mongodb://127.0.0.1:27018/survey_studio?replicaSet=rs0&directConnection=true'
).replace(/\/[^/?]+(?=\?|$)/, '/' + database);
const base = 'http://127.0.0.1:3103/api';
const results: any[] = [];
let logs = '';
const server = spawn(process.execPath, ['dist/main.js'], {
  cwd: path.resolve('apps/api'),
  env: { ...process.env, PORT: '3103', MONGODB_URI: uri },
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
  await work();
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
let all: any[] = [],
  text: any,
  oldText: any,
  single: any,
  community: any,
  communityQuestion: any,
  communitySurvey: any,
  personalWithCommunity: any,
  retainedCopy: any;
async function main() {
  try {
    let ready = false;
    for (let i = 0; i < 200; i++) {
      try {
        const r = await fetch(base + '/health');
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.ok(ready, 'API未启动 ' + logs.slice(-2000));
    await mongoose.connect(uri);
    await check('认证、用户ID查找最小字段及非法ID防护', async () => {
      await a.register('owner');
      await b.register('member');
      await c.register('third');
      await outsider.register('outside');
      const u = await a.call('/users/' + b.user.id);
      assert.deepEqual(Object.keys(u).sort(), ['id', 'username']);
      await new Client().call('/questions', 'GET', undefined, 401);
      await a.call('/users/bad', 'GET', undefined, 404);
    });
    await check('九题型独立存库、检索、指定版本选题及实例ID隔离', async () => {
      let s = await createSurvey(a);
      for (const type of Object.keys(answer)) {
        const q = await createQuestion(a, content(type));
        all.push(q);
        const x = await attach(a, s, q);
        s = x.survey;
        assert.notEqual(x.instanceId, q.question._id);
        assert.notEqual(x.instanceId, q.version._id);
      }
      const second = await attach(a, await createSurvey(a), all[0]);
      assert.notEqual(second.instanceId, s.draft.questions[0].id);
      assert.equal(s.draft.questions.length, 9);
      text = all.find((q) => q.version.content.type === 'text');
      oldText = text;
      single = all[0];
      assert.equal((await a.call('/questions?search=text')).total, 1);
      assert.equal((await a.call('/questions')).total, 9);
    });
    let publishedAll: any;
    await check('固定发布快照及九题型跨问卷MongoDB聚合', async () => {
      let s = await createSurvey(a);
      for (const q of all) s = (await attach(a, s, q)).survey;
      s = await publish(a, s);
      publishedAll = s;
      await fill(b, s);
      for (const q of all) {
        const stats = await a.call(
          '/questions/' + q.question._id + '/statistics?versionId=' + q.version._id,
        );
        assert.equal(stats.answerCount, 1);
        if (q.version.content.type === 'number') assert.equal(stats.numeric.average, 20);
        if (q.version.content.type === 'slider') assert.equal(stats.numeric.average, 8);
        if (q.version.content.type === 'matrix') assert.equal(stats.matrix.length, 2);
        if (q.version.content.type === 'ranking') {
          assert.equal(stats.ranking[0]._id, 'b');
          assert.equal(stats.ranking[0].firstCount, 1);
          assert.equal(stats.rankDistribution.length, 3);
        }
        if (q.version.content.type === 'text') assert.equal(stats.rows[0].value, '测试文字');
      }
    });
    await check('不可变题目版本、父版本、旧快照不变与恢复生成新版', async () => {
      const original = await a.call('/questions/' + text.question._id);
      const v2 = await a.call('/questions/' + text.question._id, 'PUT', {
        revision: 1,
        content: content('text', { title: '新版标题' }),
      });
      assert.equal(v2.version.number, 2);
      assert.equal(v2.version.parentVersionId, original.version._id);
      await a.call(
        '/questions/' + text.question._id,
        'PUT',
        { revision: 1, content: content() },
        409,
      );
      const v3 = await a.call('/questions/' + text.question._id + '/restore', 'POST', {
        revision: 2,
        versionId: original.version._id,
      });
      assert.equal(v3.version.number, 3);
      assert.equal(v3.version.restoredFromVersionId, original.version._id);
      assert.equal(v3.version.parentVersionId, v2.version._id);
      assert.deepEqual(
        (await a.call('/questions/' + text.question._id + '?versionId=' + original.version._id))
          .version.content,
        original.version.content,
      );
      assert.equal((await a.call('/questions/' + text.question._id + '/versions')).total, 3);
      assert.equal(
        (await a.call('/surveys/' + publishedAll._id)).draft.questions.find(
          (q: any) => q.source.questionId === text.question._id,
        ).source.versionId,
        original.version._id,
      );
      text = v3;
    });
    await check('编辑并发冲突仅一个成功，修改者来自会话', async () => {
      const r = await Promise.all(
        [a, b].slice(0, 1).flatMap((client) =>
          [1, 2].map((n) =>
            client
              .call('/questions/' + single.question._id, 'PUT', {
                revision: 1,
                content: content('single_choice', { title: '并发' + n }),
              })
              .then((x) => ({ ok: true, data: x }))
              .catch((e) => ({ ok: false, error: e })),
          ),
        ),
      );
      assert.equal(r.filter((x) => x.ok).length, 1);
      assert.equal((r.find((x) => !x.ok) as any).error.status, 409);
      const q = await a.call('/questions/' + single.question._id);
      assert.equal(q.question.revision, 2);
      assert.equal(q.version.authorId, a.user.id);
      await a.call(
        '/questions/' + single.question._id,
        'PUT',
        { revision: 2, content: content('single_choice'), authorId: b.user.id },
        400,
      );
    });
    await check('从旧问卷保存题库剥离跳转、不补造旧题来源', async () => {
      let s = await createSurvey(a);
      s = await a.call('/surveys/' + s._id + '/draft', 'PUT', {
        revision: s.revision,
        definition: {
          ...s.draft,
          questions: [
            {
              ...content('single_choice'),
              id: 'local',
              jumpRules: [{ id: 'end', operator: 'eq', value: 'a', target: 'END' }],
            },
          ],
        },
      });
      const q = await a.call('/surveys/' + s._id + '/questions/local/save-to-library', 'POST', {
        revision: s.revision,
      });
      assert.equal(q.version.content.jumpRules, undefined);
      assert.equal(q.version.content.id, undefined);
      assert.equal((await a.call('/surveys/' + s._id)).draft.questions[0].source, undefined);
    });
    await check('定向投递越权、拒绝、并发重复接受与独立来源', async () => {
      const share = await a.call('/questions/' + text.question._id + '/shares', 'POST', {
        kind: 'delivery',
        versionId: oldText.version._id,
        recipientId: b.user.id,
      });
      await c.call('/shares/' + share._id, 'GET', undefined, 404);
      await c.call('/shares/' + share._id + '/accept', 'POST', {}, 404);
      assert.equal((await b.call('/deliveries')).total, 1);
      const received = await Promise.all(
        [1, 2].map(() => b.call('/shares/' + share._id + '/accept', 'POST', {})),
      );
      assert.equal(received[0].question._id, received[1].question._id);
      const copy = received[0];
      assert.notEqual(copy.question._id, text.question._id);
      assert.equal(copy.version.number, 1);
      assert.equal(copy.question.provenance.versionId, oldText.version._id);
      await b.call('/questions/' + copy.question._id, 'PUT', {
        revision: 1,
        content: content('text', { title: '独立副本修改' }),
      });
      assert.notEqual(
        (await a.call('/questions/' + text.question._id)).version.content.title,
        '独立副本修改',
      );
      const replay = await b.call('/shares/' + share._id + '/accept', 'POST', {});
      assert.equal(replay.question._id, copy.question._id);
      assert.equal(replay.version._id, copy.version._id);
      assert.equal(replay.version.number, 1);
      assert.equal((await b.call('/questions/' + copy.question._id)).version.number, 2);
      const rejected = await a.call('/questions/' + text.question._id + '/shares', 'POST', {
        kind: 'delivery',
        versionId: text.version._id,
        recipientId: b.user.id,
      });
      await b.call('/shares/' + rejected._id + '/reject', 'POST', {});
      await b.call('/shares/' + rejected._id + '/accept', 'POST', {}, 409);
    });
    await check('链接与广场固定版本、转存幂等、撤回不删副本', async () => {
      const link = await a.call('/questions/' + text.question._id + '/shares', 'POST', {
        kind: 'link',
        versionId: oldText.version._id,
      });
      assert.equal(
        (await b.call('/question-links/' + link.token)).version._id,
        oldText.version._id,
      );
      const copy = await b.call('/shares/' + link._id + '/accept', 'POST', { token: link.token });
      const again = await b.call('/shares/' + link._id + '/accept', 'POST', { token: link.token });
      assert.equal(copy.question._id, again.question._id);
      await a.call('/shares/' + link._id, 'DELETE');
      await b.call('/question-links/' + link.token, 'GET', undefined, 404);
      await b.call('/shares/' + link._id + '/accept', 'POST', {}, 404);
      assert.ok((await b.call('/questions/' + copy.question._id)).question);
      const publicShare = await a.call('/questions/' + text.question._id + '/shares', 'POST', {
        kind: 'public',
        versionId: oldText.version._id,
      });
      assert.equal(
        (await outsider.call('/square')).rows[0].version[0].content.title,
        oldText.version.content.title,
      );
      assert.equal((await a.call('/square?mine=true')).total, 1);
      const cp = await outsider.call('/shares/' + publicShare._id + '/accept', 'POST', {});
      assert.equal(cp.question.provenance.channel, 'public');
      assert.equal((await a.call('/questions/' + text.question._id)).question.revision, 3);
    });
    await check('草稿引用造假、脱离与内容不一致拦截', async () => {
      let s = await createSurvey(a);
      const x = await attach(a, s, text);
      s = x.survey;
      const malformed = structuredClone(s.draft);
      malformed.questions[0].source = null;
      await a.call(
        '/surveys/' + s._id + '/draft',
        'PUT',
        { revision: s.revision, definition: malformed },
        400,
      );
      const forged = structuredClone(s.draft);
      forged.questions[0].title = '伪造';
      await a.call(
        '/surveys/' + s._id + '/draft',
        'PUT',
        { revision: s.revision, definition: forged },
        400,
      );
      const fake = structuredClone(s.draft);
      fake.questions[0].source.versionId = single.version._id;
      await a.call(
        '/surveys/' + s._id + '/draft',
        'PUT',
        { revision: s.revision, definition: fake },
        400,
      );
      const detached = structuredClone(s.draft);
      delete detached.questions[0].source;
      await a.call(
        '/surveys/' + s._id + '/draft',
        'PUT',
        { revision: s.revision, definition: detached },
        400,
      );
      const d = await a.call(
        '/surveys/' + s._id + '/instances/' + x.instanceId + '/detach',
        'POST',
        { revision: s.revision },
      );
      d.survey.draft.questions[0].title = '本地自由修改';
      await a.call('/surveys/' + s._id + '/draft', 'PUT', {
        revision: d.survey.revision,
        definition: d.survey.draft,
      });
    });
    await check('草稿主动升级与无效规则拦截，不自动删除选项引用', async () => {
      let s = await createSurvey(a);
      const q = await createQuestion(a, content('single_choice'));
      const x = await attach(a, s, q);
      s = x.survey;
      s.draft.questions[0].jumpRules = [{ id: 'end', operator: 'eq', value: 'a', target: 'END' }];
      s = await a.call('/surveys/' + s._id + '/draft', 'PUT', {
        revision: s.revision,
        definition: s.draft,
      });
      const newer = await a.call('/questions/' + q.question._id, 'PUT', {
        revision: 1,
        content: content('single_choice', {
          options: [
            { id: 'b', label: 'B' },
            { id: 'c', label: 'C' },
          ],
        }),
      });
      const preview = await a.call('/surveys/' + s._id + '/question-upgrades');
      assert.equal(preview.rows[0].canUpgrade, false);
      assert.deepEqual(preview.rows[0].options.removed, ['a']);
      await a.call(
        '/surveys/' + s._id + '/instances/' + x.instanceId + '/upgrade',
        'POST',
        { revision: s.revision, versionId: newer.version._id },
        400,
      );
      s.draft.questions[0].jumpRules = [];
      s = await a.call('/surveys/' + s._id + '/draft', 'PUT', {
        revision: s.revision,
        definition: s.draft,
      });
      const upgraded = await a.call(
        '/surveys/' + s._id + '/instances/' + x.instanceId + '/upgrade',
        'POST',
        { revision: s.revision, versionId: newer.version._id },
      );
      assert.equal(upgraded.survey.draft.questions[0].source.versionId, newer.version._id);
      const pub = await publish(a, upgraded.survey);
      await a.call(
        '/surveys/' + pub._id + '/instances/' + x.instanceId + '/upgrade',
        'POST',
        { revision: pub.revision, versionId: q.version._id },
        400,
      );
    });
    await check('重复实例、版本隔离、副本隔离及使用权限过滤', async () => {
      let s = await createSurvey(a, '重复实例');
      s = (await attach(a, s, text, oldText.version._id)).survey;
      s = (await attach(a, s, text, oldText.version._id)).survey;
      s = await publish(a, s);
      await fill(c, s);
      const stats = await a.call(
        '/questions/' + text.question._id + '/statistics?versionId=' + oldText.version._id,
      );
      assert.equal(stats.answerCount, 3);
      assert.equal(stats.unit, 'instance-answer');
      assert.equal(
        (
          await a.call(
            '/questions/' + text.question._id + '/statistics?versionId=' + text.version._id,
          )
        ).answerCount,
        0,
      );
      const usage = await a.call(
        '/questions/' + text.question._id + '/usage?versionId=' + oldText.version._id,
      );
      assert.ok(usage.rows.some((r: any) => r.title === '重复实例'));
      await b.call(
        '/questions/' + text.question._id + '/usage?versionId=' + oldText.version._id,
        'GET',
        undefined,
        404,
      );
    });
    await check('社区创建、邀请接受拒绝、成员列表及未接受权限', async () => {
      community = await a.call('/communities', 'POST', { name: '协同题库' });
      const inv = await a.call('/communities/' + community._id + '/invitations', 'POST', {
        recipientId: b.user.id,
      });
      await b.call('/questions?communityId=' + community._id, 'GET', undefined, 404);
      await c.call(
        '/community-invitations/' + inv._id + '/accept',
        'POST',
        { revision: inv.revision },
        404,
      );
      await b.call('/community-invitations/' + inv._id + '/accept', 'POST', {
        revision: inv.revision,
      });
      const reject = await a.call('/communities/' + community._id + '/invitations', 'POST', {
        recipientId: c.user.id,
      });
      await c.call('/community-invitations/' + reject._id + '/reject', 'POST', {
        revision: reject.revision,
      });
      await c.call('/questions?communityId=' + community._id, 'GET', undefined, 404);
      const reinvite = await a.call('/communities/' + community._id + '/invitations', 'POST', {
        recipientId: c.user.id,
      });
      await c.call('/community-invitations/' + reinvite._id + '/accept', 'POST', {
        revision: reinvite.revision,
      });
      assert.equal((await a.call('/communities/' + community._id + '/members')).total, 3);
      await a.call('/communities/' + community._id + '/leave', 'POST', {}, 400);
    });
    await check('成员共同修改恢复、并发版本冲突及个人副本来源', async () => {
      communityQuestion = await createQuestion(a, content('number'), community._id);
      const qid = communityQuestion.question._id;
      const edits = await Promise.all(
        [b, c].map((client, n) =>
          client
            .call('/questions/' + qid, 'PUT', {
              revision: 1,
              content: content('number', { title: '协作' + n }),
            })
            .then((x) => ({ ok: true, data: x }))
            .catch((e) => ({ ok: false })),
        ),
      );
      assert.equal(edits.filter((x) => x.ok).length, 1);
      const restored = await b.call('/questions/' + qid + '/restore', 'POST', {
        revision: 2,
        versionId: communityQuestion.version._id,
      });
      assert.equal(restored.version.number, 3);
      assert.equal(restored.version.parentVersionId, edits.find((x) => x.ok)!.data.version._id);
      retainedCopy = await b.call('/questions/' + qid + '/copy', 'POST', {
        versionId: communityQuestion.version._id,
      });
      assert.equal(retainedCopy.question.ownerId, b.user.id);
      await outsider.call('/questions/' + qid, 'GET', undefined, 404);
    });
    await check('社区问卷管理矩阵、统计成员可见及个人问卷不变归属', async () => {
      communitySurvey = await createSurvey(b, '社区成员创建', community._id);
      communitySurvey = (await attach(b, communitySurvey, communityQuestion)).survey;
      await c.call('/surveys/' + communitySurvey._id, 'GET', undefined, 404);
      await c.call(
        '/surveys/' + communitySurvey._id + '/draft',
        'PUT',
        { revision: communitySurvey.revision, definition: communitySurvey.draft },
        404,
      );
      communitySurvey = await publish(a, communitySurvey);
      await fill(outsider, communitySurvey);
      assert.equal((await c.call('/surveys/' + communitySurvey._id + '/statistics')).total, 1);
      assert.equal(
        (
          await c.call(
            '/questions/' +
              communityQuestion.question._id +
              '/statistics?versionId=' +
              communityQuestion.version._id +
              '&communityId=' +
              community._id,
          )
        ).answerCount,
        1,
      );
      personalWithCommunity = await createSurvey(b, '私人名称不可泄露');
      personalWithCommunity = (await attach(b, personalWithCommunity, communityQuestion)).survey;
      assert.equal(personalWithCommunity.communityId, undefined);
      personalWithCommunity = await publish(b, personalWithCommunity);
      await fill(c, personalWithCommunity);
      const usage = await a.call(
        '/questions/' +
          communityQuestion.question._id +
          '/usage?versionId=' +
          communityQuestion.version._id,
      );
      assert.ok(!usage.rows.some((r: any) => r.title === '私人名称不可泄露'));
      assert.equal(
        (
          await a.call(
            '/questions/' +
              communityQuestion.question._id +
              '/statistics?versionId=' +
              communityQuestion.version._id +
              '&communityId=' +
              community._id,
          )
        ).answerCount,
        1,
      );
      assert.equal(
        (
          await a.call(
            '/questions/' +
              communityQuestion.question._id +
              '/statistics?versionId=' +
              communityQuestion.version._id,
          )
        ).answerCount,
        0,
      );
    });
    await check('社区统计允许固定个人来源实例，但不泄露未使用的私题', async () => {
      const privateQuestion = await createQuestion(a, content('slider'));
      let survey = await createSurvey(a, '个人来源的社区问卷', community._id);
      survey = (await attach(a, survey, privateQuestion)).survey;
      survey = await publish(a, survey);
      await fill(outsider, survey);
      const sharedStats = await b.call(
        '/questions/' +
          privateQuestion.question._id +
          '/statistics?versionId=' +
          privateQuestion.version._id +
          '&communityId=' +
          community._id,
      );
      assert.equal(sharedStats.answerCount, 1);
      assert.equal(sharedStats.numeric.average, 8);
      await b.call('/questions/' + privateQuestion.question._id, 'GET', undefined, 404);
      await b.call(
        '/questions/' +
          text.question._id +
          '/statistics?versionId=' +
          text.version._id +
          '&communityId=' +
          community._id,
        'GET',
        undefined,
        404,
      );
      let adminDraft = await createSurvey(c, '管理员可管理', community._id);
      adminDraft = (await attach(a, adminDraft, communityQuestion)).survey;
      adminDraft = await publish(a, adminDraft);
      await b.call('/surveys/' + adminDraft._id + '/close', 'POST', {}, 404);
      adminDraft = await a.call('/surveys/' + adminDraft._id + '/close', 'POST', {});
      await a.call('/surveys/' + adminDraft._id, 'DELETE', { revision: adminDraft.revision });
    });
    await check('退出后拒绝社区访问管理统计，原个人副本及问卷快照仍有效', async () => {
      await b.call('/communities/' + community._id + '/leave', 'POST', {});
      await b.call('/questions/' + communityQuestion.question._id, 'GET', undefined, 404);
      await b.call(
        '/questions/' + communityQuestion.question._id + '/copy',
        'POST',
        { versionId: communityQuestion.version._id },
        404,
      );
      await b.call('/surveys/' + communitySurvey._id + '/close', 'POST', {}, 404);
      await b.call('/surveys/' + communitySurvey._id + '/statistics', 'GET', undefined, 404);
      await b.call(
        '/questions/' +
          communityQuestion.question._id +
          '/statistics?versionId=' +
          communityQuestion.version._id +
          '&communityId=' +
          community._id,
        'GET',
        undefined,
        404,
      );
      assert.ok((await b.call('/questions/' + retainedCopy.question._id)).question);
      assert.equal(
        (await b.call('/surveys/' + personalWithCommunity._id + '/statistics')).total,
        1,
      );
      assert.equal((await a.call('/surveys/' + communitySurvey._id + '/statistics')).total, 1);
    });
    await check('管理员移除与成员写并发、移除后禁止再写或转存', async () => {
      const q = await c.call('/questions/' + communityQuestion.question._id);
      const writes = await Promise.allSettled([
        a.call('/communities/' + community._id + '/members/' + c.user.id, 'DELETE'),
        c.call('/questions/' + q.question._id, 'PUT', {
          revision: q.question.revision,
          content: content('number', { title: '并发退出边界' }),
        }),
      ]);
      assert.equal(writes[0].status, 'fulfilled');
      await c.call(
        '/questions/' + q.question._id,
        'PUT',
        { revision: 4, content: content('number') },
        404,
      );
      await c.call(
        '/questions/' + q.question._id + '/copy',
        'POST',
        { versionId: q.version._id },
        404,
      );
      await c.call('/questions?communityId=' + community._id, 'GET', undefined, 404);
      assert.equal((await a.call('/communities/' + community._id + '/members')).total, 1);
    });
    await check('共享更新固定版本、链接令牌及撤回收件箱保护', async () => {
      const q = await createQuestion(a, content('color'));
      const link = await a.call('/questions/' + q.question._id + '/shares', 'POST', {
        kind: 'link',
        versionId: q.version._id,
      });
      const square = await a.call('/questions/' + q.question._id + '/shares', 'POST', {
        kind: 'public',
        versionId: q.version._id,
      });
      await a.call('/questions/' + q.question._id, 'PUT', {
        revision: 1,
        content: content('color', { title: '新版本不传播' }),
      });
      assert.equal(
        (await b.call('/question-links/' + link.token)).version.content.title,
        q.version.content.title,
      );
      assert.equal((await b.call('/shares/' + square._id)).version._id, q.version._id);
      await b.call('/shares/' + link._id + '/accept', 'POST', {}, 404);
      await b.call('/shares/' + link._id, 'GET', undefined, 404);
      const delivery = await a.call('/questions/' + q.question._id + '/shares', 'POST', {
        kind: 'delivery',
        versionId: q.version._id,
        recipientId: b.user.id,
      });
      await a.call('/shares/' + delivery._id, 'DELETE');
      assert.ok(!(await b.call('/deliveries')).rows.some((r: any) => r._id === delivery._id));
      await b.call('/shares/' + delivery._id + '/accept', 'POST', {}, 404);
    });
    await check('移除与转存竞态串行化、退出后不能从问卷接口绕过转存', async () => {
      const room = await a.call('/communities', 'POST', { name: '转存竞态' });
      const invite = await a.call('/communities/' + room._id + '/invitations', 'POST', {
        recipientId: c.user.id,
      });
      await c.call('/community-invitations/' + invite._id + '/accept', 'POST', {
        revision: invite.revision,
      });
      const q = await createQuestion(a, content('text'), room._id);
      const results = await Promise.allSettled([
        a.call('/communities/' + room._id + '/members/' + c.user.id, 'DELETE'),
        c.call('/questions/' + q.question._id + '/copy', 'POST', { versionId: q.version._id }),
      ]);
      assert.equal(results[0].status, 'fulfilled');
      await c.call(
        '/questions/' + q.question._id + '/copy',
        'POST',
        { versionId: q.version._id },
        404,
      );
      await b.call(
        '/surveys/' +
          personalWithCommunity._id +
          '/questions/' +
          personalWithCommunity.draft.questions[0].id +
          '/save-to-library',
        'POST',
        { revision: personalWithCommunity.revision },
        404,
      );
      assert.equal(
        (
          await b.call(
            '/questions/' +
              communityQuestion.question._id +
              '/statistics?versionId=' +
              communityQuestion.version._id,
          )
        ).answerCount,
        1,
      );
    });
    await check('文本分页及统计不把全部内容返回应用', async () => {
      let s = await createSurvey(a, '分页统计');
      for (let i = 0; i < 21; i++) s = (await attach(a, s, text, oldText.version._id)).survey;
      s = await publish(a, s);
      await fill(outsider, s);
      const first = await a.call(
        '/questions/' + text.question._id + '/statistics?versionId=' + oldText.version._id,
      );
      const second = await a.call(
        '/questions/' +
          text.question._id +
          '/statistics?versionId=' +
          oldText.version._id +
          '&page=2',
      );
      assert.equal(first.rows.length, 20);
      assert.equal(first.answerCount, 24);
      assert.equal(second.rows.length, 4);
      await outsider.call(
        '/questions/' + text.question._id + '/statistics?versionId=' + oldText.version._id,
        'GET',
        undefined,
        404,
      );
    });
    await check('跨问卷统计排除未确认空值、未进入分支及越界残留答案', async () => {
      const q = await createQuestion(a, content('number', { required: false }));
      let survey = await createSurvey(a, '统计有效路径边界');
      const first = await attach(a, survey, q);
      survey = first.survey;
      const second = await attach(a, survey, q);
      survey = second.survey;
      survey.draft.questions[0].jumpRules = [
        { id: 'only-one', operator: 'eq', value: 1, target: second.instanceId },
      ];
      survey = await a.call('/surveys/' + survey._id + '/draft', 'PUT', {
        revision: survey.revision,
        definition: survey.draft,
      });
      survey = await publish(a, survey);
      const response = await fill(b, survey, { [first.instanceId]: 0 });
      await mongoose.connection
        .db!.collection('responses')
        .updateOne(
          { _id: new mongoose.Types.ObjectId(response.id) },
          { $set: { ['answers.' + second.instanceId]: 99 } },
        );
      let attempt = await c.call('/public/surveys/' + survey.publicId + '/attempts', 'POST', {
        anonymous: true,
      });
      attempt = await c.call('/attempts/' + attempt.id + '/advance', 'POST', {
        revision: attempt.state.revision,
      });
      assert.equal(attempt.state.ready, true);
      await c.call('/attempts/' + attempt.id + '/submit', 'POST', {
        revision: attempt.state.revision,
      });
      const stats = await a.call(
        '/questions/' + q.question._id + '/statistics?versionId=' + q.version._id,
      );
      assert.equal(stats.answerCount, 1);
      assert.equal(stats.numeric.average, 0);
    });
    await check('新增MongoDB结构约束及唯一索引真实生效', async () => {
      await assert.rejects(() =>
        mongoose.connection.db!.collection('question_versions').insertOne({ questionId: 'x' }),
      );
      const indexes = await mongoose.connection.db!.collection('question_versions').indexes();
      assert.ok(indexes.some((x) => x.unique && x.key.questionId === 1 && x.key.number === 1));
      assert.equal(
        await mongoose.connection.db!.collection('question_share_copies').countDocuments(),
        3,
      );
    });
    await check('我发出的分享：会话隔离、固定版本、全部状态及最小响应', async () => {
      const q = await createQuestion(c, content('text', { title: '发出管理固定旧版' }));
      const accepted = await c.call('/questions/' + q.question._id + '/shares', 'POST', {
        kind: 'delivery',
        versionId: q.version._id,
        recipientId: b.user.id,
      });
      const rejected = await c.call('/questions/' + q.question._id + '/shares', 'POST', {
        kind: 'delivery',
        versionId: q.version._id,
        recipientId: b.user.id,
      });
      const pending = await c.call('/questions/' + q.question._id + '/shares', 'POST', {
        kind: 'delivery',
        versionId: q.version._id,
        recipientId: b.user.id,
      });
      const revoked = await c.call('/questions/' + q.question._id + '/shares', 'POST', {
        kind: 'delivery',
        versionId: q.version._id,
        recipientId: outsider.user.id,
      });
      const link = await c.call('/questions/' + q.question._id + '/shares', 'POST', {
        kind: 'link',
        versionId: q.version._id,
      });
      const published = await c.call('/questions/' + q.question._id + '/shares', 'POST', {
        kind: 'public',
        versionId: q.version._id,
      });
      await b.call('/shares/' + accepted._id + '/accept', 'POST', {});
      await b.call('/shares/' + rejected._id + '/reject', 'POST', {});
      await c.call('/shares/' + revoked._id, 'DELETE');
      await c.call('/questions/' + q.question._id, 'PUT', {
        revision: 1,
        content: content('text', { title: '新版不影响已发出列表' }),
      });
      const sent = await c.call('/shares?direction=sent');
      assert.equal(sent.total, 6);
      assert.equal(sent.rows.length, 6);
      for (const row of sent.rows) {
        assert.equal(row.questionId, q.question._id);
        assert.equal(row.versionId, q.version._id);
        assert.equal(row.version._id, q.version._id);
        assert.equal(row.version.number, 1);
        assert.equal(row.version.content.title, '发出管理固定旧版');
        assert.equal(row.version.authorId, undefined);
        assert.equal(row.senderId, undefined);
        if (row.kind !== 'link') assert.equal(row.link, undefined);
        if (row.kind !== 'delivery') assert.equal(row.recipient, undefined);
      }
      const delivery = sent.rows.find((r: any) => r._id === pending._id);
      assert.deepEqual(delivery.recipient, { id: b.user.id, username: b.user.username });
      assert.equal(sent.rows.find((r: any) => r._id === accepted._id).status, 'accepted');
      assert.equal(sent.rows.find((r: any) => r._id === rejected._id).status, 'rejected');
      assert.equal(sent.rows.find((r: any) => r._id === revoked._id).status, 'revoked');
      assert.equal(sent.rows.find((r: any) => r._id === published._id).status, 'active');
      const linked = sent.rows.find((r: any) => r._id === link._id);
      assert.equal(linked.link.token, link.token);
      assert.equal(linked.link.path, '/api/question-links/' + link.token);
      assert.ok(!JSON.stringify(sent).includes('passwordHash'));
      assert.ok(!JSON.stringify(sent).includes('TestPass123!'));
      assert.equal((await c.call('/shares?direction=sent&kind=public')).total, 1);
      assert.equal((await c.call('/shares?direction=sent&kind=delivery&status=pending')).total, 1);
      assert.equal((await b.call('/shares?direction=sent&senderId=' + c.user.id)).total, 0);
      assert.ok(
        !(await a.call('/shares?direction=sent')).rows.some(
          (r: any) => r.questionId === q.question._id,
        ),
      );
      await new Client().call('/shares?direction=sent', 'GET', undefined, 401);
      for (const query of [
        '',
        '?direction=received',
        '?direction=sent&kind=bad',
        '?direction=sent&status=bad',
        '?direction=sent&page=0',
        '?direction=sent&page=x',
      ])
        await c.call('/shares' + query, 'GET', undefined, 400);
      await c.call('/shares/' + link._id, 'DELETE');
      const revokedLink = (await c.call('/shares?direction=sent&kind=link&status=revoked')).rows[0];
      assert.equal(revokedLink.link.token, link.token);
      await b.call('/question-links/' + link.token, 'GET', undefined, 404);
    });
    await check('我发出的分享：刷新可恢复、稳定分页且类型状态筛选不串页', async () => {
      const q = await createQuestion(c, content('number'));
      const ids = [];
      for (let i = 0; i < 21; i++)
        ids.push(
          (
            await c.call('/questions/' + q.question._id + '/shares', 'POST', {
              kind: 'link',
              versionId: q.version._id,
            })
          )._id,
        );
      const refreshed = new Client();
      refreshed.cookie = c.cookie;
      const first = await refreshed.call('/shares?direction=sent&kind=link&status=active&page=1');
      const second = await refreshed.call('/shares?direction=sent&kind=link&status=active&page=2');
      assert.equal(first.total, 21);
      assert.equal(first.pageSize, 20);
      assert.equal(first.rows.length, 20);
      assert.equal(second.total, 21);
      assert.equal(second.rows.length, 1);
      assert.equal(new Set([...first.rows, ...second.rows].map((r: any) => r._id)).size, 21);
      assert.deepEqual(
        new Set([...first.rows, ...second.rows].map((r: any) => r._id)),
        new Set(ids),
      );
      assert.deepEqual(
        (await refreshed.call('/shares?direction=sent&kind=link&status=active&page=1')).rows,
        first.rows,
      );
      assert.equal(
        (await refreshed.call('/shares?direction=sent&kind=link&status=active&page=3')).rows.length,
        0,
      );
      assert.equal((await b.call('/shares?direction=sent&kind=link')).total, 0);
    });
    console.log(
      '第二阶段集成测试 ' + results.length + '/' + results.length + ' 通过，数据库 ' + database,
    );
  } finally {
    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync(
      'test-results/phase2-integration.json',
      JSON.stringify({ time: new Date().toISOString(), database, results }, null, 2),
    );
    await mongoose.disconnect();
    server.kill();
  }
}
main().catch((e) => {
  console.error(e);
  console.error(logs.slice(-6000));
  process.exitCode = 1;
});
