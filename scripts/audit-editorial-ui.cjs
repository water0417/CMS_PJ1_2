const fs = require('node:fs'),
  assert = require('node:assert/strict');
const f = JSON.parse(fs.readFileSync('test-results/editorial-ui-fixtures.json', 'utf8'));
let cookie = '';
const results = [];
async function call(url, method = 'GET', body) {
  const r = await fetch('http://127.0.0.1:3110/api' + url, {
    method,
    headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const v = await r.json();
  if (!r.ok) throw Error(url + JSON.stringify(v));
  if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
  return v;
}
function check(name, fn) {
  fn();
  results.push({ name, result: 'PASS' });
  console.log('PASS ' + name);
}
(async () => {
  await call('/auth/login', 'POST', { username: 'edit_admin', password: 'TestPass123!' });
  const own = await call('/questions/' + f.question.question._id),
    copies = await call('/questions?search=' + encodeURIComponent('出行方式的独立新问题'));
  assert.equal(copies.total, 1);
  const copy = await call('/questions/' + copies.rows[0]._id);
  check('另存保存当前标题/选项、来源由服务端生成、原题未被另存覆盖', () => {
    assert.notEqual(copy.question._id, own.question._id);
    assert.equal(copy.version.content.title, '出行方式的独立新问题');
    assert.equal(copy.version.content.options[0].label, '轻松步行');
    assert.equal(copy.question.provenance.channel, 'library-save-as');
    assert.equal(own.version.content.options[0].label, '步行');
    assert.equal(own.version.content.title, '本地保留的出行修改');
  });
  const survey = await call('/surveys/' + f.survey._id);
  check('原已发布问卷仍保留原题保存内容', () => {
    assert.equal(survey.draft.questions[0].title, '你的日常出行方式');
    assert.equal(survey.draft.questions[0].options[0].label, '步行');
    assert.equal(survey.draft.questions[0].source.versionId, f.question.version._id);
  });
  const shares = await call('/shares?direction=sent'),
    sent = shares.rows.filter((r) => r.questionId === f.question.question._id),
    deliveries = sent.filter((r) => r.kind === 'delivery');
  check('用户名与ID投递正确，切换接收者没有向旧用户误发', () => {
    assert.equal(deliveries.length, 2);
    assert.deepEqual(
      deliveries.map((r) => r.recipient.id).sort(),
      [f.users.member.id, f.users.other.id].sort(),
    );
  });
  check('链接和公开仍为分享时内容，编辑/恢复不会替换或撤回旧公开项', () => {
    for (const kind of ['link', 'public']) {
      const rows = sent.filter((r) => r.kind === kind);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, 'active');
      assert.equal(rows[0].version.content.title, '更贴近生活的出行方式');
      assert.notEqual(rows[0].versionId, own.version._id);
    }
  });
  const history = await call('/questions/' + f.question.question._id + '/versions');
  check('历史恢复、并发冲突及修正后的历史均保留', () => {
    assert.equal(history.total, 5);
    assert.equal(history.rows[0].number, 5);
    assert.ok(history.rows.some((v) => v.restoredFromVersionId === f.question.version._id));
  });
  const community = await call('/communities/' + f.community._id + '/overview');
  check('社区新建题成功留在社区且概览为真实计数', () => {
    assert.equal(community.questionCount, 2);
    assert.equal(community.surveyCount, 1);
    assert.equal(community.memberCount, 3);
  });
  await call('/auth/login', 'POST', { username: 'edit_member', password: 'TestPass123!' });
  const invitations = await call('/community-invitations'),
    count = await call('/community-invitations/pending-count');
  check('邀请历史可读，处理后待处理数为0', () => {
    assert.equal(count.pendingCount, 0);
    assert.equal(invitations.pendingCount, 0);
    assert.ok(
      invitations.rows.every((r) => r.community.name && r.inviter.username === 'edit_admin'),
    );
    assert.ok(invitations.rows.every((r) => r.status !== 'pending'));
  });
  const personalCopies = await call('/questions'),
    myShares = await call('/shares?direction=sent');
  const copied = personalCopies.rows.filter(
    (r) => r.provenance?.questionId === f.communityQuestion.question._id,
  );
  check('社区分享使用个人副本，保存并继续后副本为当前编辑内容', () => {
    assert.equal(copied.length, 2);
    assert.ok(copied.every((r) => !r.communityId && r.ownerId === f.users.member.id));
    assert.ok(copied.some((r) => r.title === '与邻居共享的公共空间问题'));
    assert.ok(
      myShares.rows.some((r) => r.kind === 'link' && copied.some((c) => c._id === r.questionId)),
    );
    assert.ok(!myShares.rows.some((r) => r.questionId === f.communityQuestion.question._id));
  });
  fs.writeFileSync(
    'test-results/editorial-ui-audit.json',
    JSON.stringify({ date: new Date().toISOString(), database: f.database, results }, null, 2),
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
