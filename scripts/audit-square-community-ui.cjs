// Assert observations from real browser requests; never invent business responses.
const fs = require('node:fs'),
  assert = require('node:assert/strict');
const trace = JSON.parse(
  fs.readFileSync('test-results/square-community-browser-requests.json', 'utf8'),
);
const fixtures = JSON.parse(
  fs.readFileSync('test-results/square-community-ui-fixtures.json', 'utf8'),
);
const pause = JSON.parse(
  fs.readFileSync('test-results/square-community-browser-checks.json', 'utf8'),
).failurePause;
const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push({ name, result: 'PASS' });
  } catch (e) {
    results.push({ name, result: 'FAIL', error: e.message });
    throw e;
  }
};
const square = trace.filter((r) => r.url.startsWith('/api/square') && r.status === 200);
const params = (r) => new URL(r.url, 'http://test').searchParams;
check('关键词全库分页20+4及组合mine回第一页3条', () => {
  assert.ok(
    square.some(
      (r) =>
        params(r).get('search') === '分页' &&
        params(r).get('page') === '2' &&
        r.response.total === 24 &&
        r.response.rows.length === 4,
    ),
  );
  assert.ok(
    square.some(
      (r) =>
        params(r).get('mine') === 'true' &&
        params(r).get('type') === 'single_choice' &&
        params(r).get('page') === '1' &&
        r.response.total === 3,
    ),
  );
});
check('九题型页面分别发出真实筛选查询且各返回1条', () => {
  for (const type of [
    'single_choice',
    'multiple_choice',
    'text',
    'number',
    'matrix',
    'ranking',
    'time',
    'slider',
    'color',
  ])
    assert.ok(
      square.some(
        (r) =>
          params(r).get('type') === type &&
          params(r).get('search') === '广场九题型' &&
          r.response.total === 1 &&
          r.response.rows[0].version[0].content.type === type,
      ),
    );
});
check('重置全部条件以及搜索无结果', () => {
  assert.ok(
    square.some(
      (r) =>
        !params(r).has('search') &&
        !params(r).has('type') &&
        !params(r).has('mine') &&
        r.response.total === 34,
    ),
  );
  assert.ok(
    square.some(
      (r) =>
        params(r).get('search') === '乱序之后无匹配' &&
        r.response.total === 0 &&
        r.response.rows.length === 0,
    ),
  );
});
check('人为延迟旧搜索使其晚于新搜索完成，页面另有DOM验收', () => {
  const fast = square.find((r) => params(r).get('search') === '乱序之后无匹配');
  assert.ok(fast);
  assert.ok(
    square.some(
      (r) =>
        params(r).get('search') === '分页' &&
        r.started < fast.started &&
        r.finished > fast.finished,
    ),
  );
});
check('真实邀请数2→1→0，列表记录接受与拒绝', () => {
  const counts = trace
    .filter((r) => r.url.includes('pending-count') && r.status === 200)
    .map((r) => r.response.pendingCount);
  for (const n of [2, 1, 0]) assert.ok(counts.includes(n));
  const rows = trace
    .filter((r) => r.url.startsWith('/api/community-invitations?') && r.status === 200)
    .flatMap((r) => r.response.rows);
  assert.ok(rows.some((r) => r.community?.name === '接受邀请复验 D' && r.status === 'accepted'));
  assert.ok(rows.some((r) => r.community?.name === '邀请拒绝演示 C' && r.status === 'rejected'));
});
check('持续404后超过60秒无自动重复，观察区间内请求为零', () => {
  assert.ok(pause.elapsedSeconds >= 60);
  assert.equal(
    trace.filter(
      (r) =>
        r.url.includes('pending-count') &&
        r.started > pause.lastFailureAt &&
        r.started <= pause.observedAt,
    ).length,
    0,
  );
});
check('故障卡片503不妨碍其他社区200，移除后真实权限404', () => {
  assert.ok(
    trace.some((r) => r.url.includes(fixtures.rooms[1]._id + '/overview') && r.status === 503),
  );
  assert.ok(
    trace.some((r) => r.url.includes(fixtures.rooms[0]._id + '/overview') && r.status === 200),
  );
  assert.ok(
    trace.some(
      (r) =>
        r.url.includes(fixtures.rooms[1]._id + '/overview') &&
        r.status === 404 &&
        r.response.code === 'NOT_FOUND',
    ),
  );
});
const output = {
  time: new Date().toISOString(),
  database: fixtures.database,
  results,
  failurePause: pause,
};
fs.writeFileSync(
  'test-results/square-community-browser-audit.json',
  JSON.stringify(output, null, 2),
);
console.log(JSON.stringify(output, null, 2));
