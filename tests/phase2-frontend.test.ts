import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankQuestion, contentOf, clone, query } from '../apps/web/src/phase2';
import { TYPES, validateDefinition } from '../apps/api/src/domain';
test('空间查询省略空值，保留固定版本、实际社区和服务端页码', () => {
  const personal = new URLSearchParams(query({ versionId: 'v1', communityId: '', page: 2 }));
  assert.equal(personal.has('communityId'), false);
  for (const communityId of [undefined, null])
    assert.equal(new URLSearchParams(query({ communityId })).has('communityId'), false);
  const community = new URLSearchParams(query({ versionId: 'v2', communityId: 'room-a', page: 1 }));
  assert.deepEqual(Object.fromEntries(community), {
    versionId: 'v2',
    communityId: 'room-a',
    page: '1',
  });
});
test('题库内容只发送7个内容字段，不夹带实例/引用/跳转', () => {
  const q = {
    ...blankQuestion('single_choice'),
    source: { questionId: 'private', versionId: 'fixed' },
  };
  q.jumpRules = [{ id: 'r', operator: 'eq', value: 'a', target: 'END' }];
  assert.deepEqual(Object.keys(contentOf(q)).sort(), [
    'description',
    'options',
    'required',
    'rows',
    'title',
    'type',
    'validation',
  ]);
});
test('修改选项和矩阵文字保留ID，复制内容不会反写固定快照', () => {
  const q = blankQuestion('matrix');
  const copy = clone(q);
  copy.options[0].label = '修订列';
  copy.rows[0].label = '修订行';
  assert.equal(copy.options[0].id, q.options[0].id);
  assert.equal(copy.rows[0].id, q.rows[0].id);
  assert.equal(q.options[0].label, '');
  assert.equal(q.rows[0].label, '');
});
test('复用编辑器生成九题型合法内容，实例ID各自独立', () => {
  const ids = new Set<string>();
  for (const type of TYPES) {
    const q = blankQuestion(type);
    q.title = type;
    q.options.forEach((o, i) => (o.label = '选项' + i));
    q.rows.forEach((r, i) => (r.label = '项目' + i));
    validateDefinition({
      title: '合法内容',
      description: '',
      allowAnonymous: false,
      allowRepeatSubmissions: false,
      schemaVersion: 1,
      questions: [q],
    });
    assert.ok(!ids.has(q.id));
    ids.add(q.id);
  }
});

import { createInvitationPolling } from '../apps/web/src/invitation-polling';
function pollingClock() {
  let next = 0;
  const jobs = new Map<any, () => void>();
  return {
    jobs,
    setTimeout: ((fn: () => void) => {
      jobs.set(++next, fn);
      return next;
    }) as any,
    clearTimeout: ((id: any) => {
      jobs.delete(id);
    }) as any,
    async tick() {
      const callbacks = [...jobs.values()];
      jobs.clear();
      callbacks.forEach((fn) => fn());
      await new Promise((r) => setImmediate(r));
    },
  };
}
test('邀请轮询正常调度，接口失败暂停，手动重试恢复', async () => {
  const clock = pollingClock();
  let calls = 0,
    success = true;
  const poll = createInvitationPolling(
    async () => {
      calls++;
      return success;
    },
    () => true,
    60000,
    clock,
  );
  await poll.refresh();
  assert.equal(calls, 1);
  assert.equal(clock.jobs.size, 1);
  success = false;
  await clock.tick();
  assert.equal(calls, 2);
  assert.equal(clock.jobs.size, 0);
  await clock.tick();
  assert.equal(calls, 2);
  success = true;
  await poll.refresh();
  assert.equal(calls, 3);
  assert.equal(clock.jobs.size, 1);
  poll.pause();
  assert.equal(clock.jobs.size, 0);
});
test('邀请轮询隐藏、退出登录和卸载暂停，不由晚到响应重建定时器', async () => {
  const clock = pollingClock();
  let enabled = true,
    calls = 0,
    release!: (v: boolean) => void;
  const poll = createInvitationPolling(
    () => {
      calls++;
      return new Promise((r) => (release = r));
    },
    () => enabled,
    60000,
    clock,
  );
  const inflight = poll.refresh();
  poll.pause();
  enabled = false;
  release(true);
  await inflight;
  assert.equal(clock.jobs.size, 0);
  await poll.refresh();
  assert.equal(calls, 1);
  enabled = true;
  const restored = poll.refresh();
  release(true);
  await restored;
  assert.equal(clock.jobs.size, 1);
  enabled = false;
  poll.pause();
  await clock.tick();
  assert.equal(calls, 2);
  assert.equal(clock.jobs.size, 0);
});
test('邀请任务网络异常同样停止自动轮询，不假装成功', async () => {
  const clock = pollingClock();
  const poll = createInvitationPolling(
    async () => {
      throw Error('network');
    },
    () => true,
    60000,
    clock,
  );
  await poll.refresh();
  assert.equal(clock.jobs.size, 0);
});
