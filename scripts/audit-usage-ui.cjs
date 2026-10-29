const assert = require('node:assert/strict'),
  fs = require('node:fs');
const f = JSON.parse(fs.readFileSync('test-results/usage-ui-fixtures.json', 'utf8'));
const trace = JSON.parse(fs.readFileSync('test-results/usage-ui-requests.json', 'utf8'));
const results = [];
function check(name, fn) {
  fn();
  results.push({ name, result: 'PASS' });
  console.log('PASS ' + name);
}
const rows = trace.filter((r) => r.url.includes('/usage?'));
const expected = new Map([
  ['', 21],
  [f.roomA._id, 22],
  [f.roomB._id, 23],
]);
check('浏览器实际个人请求省略communityId，社区为实际ID，无空串/undefined', () => {
  for (const r of trace) {
    const u = new URL(r.url, 'http://localhost');
    assert.ok(
      !u.searchParams.has('communityId') ||
        (expected.has(u.searchParams.get('communityId')) &&
          u.searchParams.get('communityId') !== ''),
    );
  }
  assert.ok(rows.some((r) => !new URL(r.url, 'http://localhost').searchParams.has('communityId')));
});
check('所有实际200使用响应均由所选空间提供total和rows，无跨空间混入', () => {
  for (const r of rows.filter((r) => r.status === 200)) {
    const p = new URL(r.url, 'http://localhost').searchParams,
      scope = p.get('communityId') || '';
    const total = p.get('versionId') === f.empty.version._id ? 0 : expected.get(scope);
    assert.equal(r.response.total, total);
    assert.ok(
      r.response.rows.every((row) => (scope ? row.communityId === scope : !row.communityId)),
    );
  }
});
check('浏览器三个空间page2分别1/2/3，数据库total为21/22/23', () => {
  for (const [scope, total] of expected) {
    const r = rows.find((r) => {
      const p = new URL(r.url, 'http://localhost').searchParams;
      return (
        r.status === 200 &&
        (p.get('communityId') || '') === scope &&
        p.get('page') === '2' &&
        p.get('versionId') === f.question.version._id
      );
    });
    assert.ok(r);
    assert.equal(r.response.total, total);
    assert.equal(r.response.rows.length, total - 20);
  }
});
check('版本切换后usage/statistics以page1读取v2空内容', () => {
  for (const endpoint of ['usage', 'statistics']) {
    const matches = trace.filter(
      (r) => r.url.includes('/' + endpoint + '?') && r.url.includes(f.empty.version._id),
    );
    assert.ok(matches.length);
    assert.ok(
      matches.every((r) => new URL(r.url, 'http://localhost').searchParams.get('page') === '1'),
    );
  }
});
check('回答统计仍按固定v1所选空间统计实例21/22/23', () => {
  for (const [scope, n] of expected) {
    const r = trace.find((r) => {
      const p = new URL(r.url, 'http://localhost').searchParams;
      return (
        r.status === 200 &&
        r.url.includes('/statistics?') &&
        (p.get('communityId') || '') === scope &&
        p.get('versionId') === f.question.version._id
      );
    });
    assert.equal(r.response.answerCount, n);
  }
});
check('确有A晚于后发B返回的真实乱序，并存在两社区失权404', () => {
  assert.ok(
    rows.some(
      (a) =>
        a.status === 200 &&
        a.url.includes(f.roomA._id) &&
        rows.some(
          (b) =>
            b.status === 200 &&
            b.url.includes(f.roomB._id) &&
            b.started > a.started &&
            b.finished < a.finished,
        ),
    ),
  );
  for (const id of [f.roomA._id, f.roomB._id])
    for (const endpoint of ['usage', 'statistics'])
      assert.ok(
        trace.some(
          (r) => r.url.includes(id) && r.url.includes('/' + endpoint + '?') && r.status === 404,
        ),
      );
});
fs.writeFileSync(
  'test-results/usage-ui-request-audit.json',
  JSON.stringify({ date: new Date().toISOString(), database: f.database, results }, null, 2),
);
