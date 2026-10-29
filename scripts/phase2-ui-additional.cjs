const fs = require('node:fs');
(async () => {
  const base = 'http://127.0.0.1:3104/api';
  let cookie = '';
  async function call(path, method = 'GET', body) {
    const r = await fetch(base + path, {
      method,
      headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const v = await r.json();
    if (!r.ok) throw Error(path + JSON.stringify(v));
    if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return v;
  }
  await call('/auth/login', 'POST', { username: 'ui_admin', password: 'TestPass123!' });
  const f = JSON.parse(fs.readFileSync('test-results/phase2-frontend-fixtures.json', 'utf8'));
  let q = await call('/questions/' + f.questions.text.question._id);
  while (q.version.number < 21)
    q = await call('/questions/' + q.question._id, 'PUT', {
      revision: q.question.revision,
      content: { ...q.version.content, title: '给城市的建议 · 历史' + (q.version.number + 1) },
    });
  for (let i = 1; i <= 12; i++)
    await call('/questions', 'POST', {
      content: {
        ...f.questions.text.version.content,
        title: '访谈补充问题 ' + String(i).padStart(2, '0'),
      },
    });
  const usage = await call(
    '/questions/' +
      f.questions.single_choice.question._id +
      '/usage?versionId=' +
      f.questions.single_choice.version._id,
  );
  fs.writeFileSync(
    'test-results/phase2-frontend-usage-gap.json',
    JSON.stringify(
      {
        request:
          '/api/questions/' +
          f.questions.single_choice.question._id +
          '/usage?versionId=' +
          f.questions.single_choice.version._id,
        actual: usage,
        expected: '个人空间使用查询不应包含communityId的行；或提供明确的个人scope参数',
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      history: q.version.number,
      library: (await call('/questions')).total,
      usageCommunities: usage.rows.filter((r) => r.communityId).length,
    }),
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
