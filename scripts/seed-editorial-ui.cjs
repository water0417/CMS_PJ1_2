const fs = require('node:fs');
const base = 'http://127.0.0.1:3110/api';
class Client {
  cookie = '';
  async call(url, method = 'GET', body) {
    const r = await fetch(base + url, {
      method,
      headers: {
        Cookie: this.cookie,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const v = await r.json();
    if (!r.ok) throw Error(url + ' ' + JSON.stringify(v));
    if (r.headers.get('set-cookie')) this.cookie = r.headers.get('set-cookie').split(';')[0];
    return v;
  }
  async login(name, register = false) {
    if (register)
      await this.call('/auth/register', 'POST', { username: name, password: 'TestPass123!' });
    this.user = await this.call('/auth/login', 'POST', {
      username: name,
      password: 'TestPass123!',
    });
  }
}
(async () => {
  const a = new Client(),
    b = new Client(),
    c = new Client();
  if (process.argv[2] === 'reinvite') {
    const f = JSON.parse(fs.readFileSync('test-results/editorial-ui-fixtures.json', 'utf8'));
    await a.login('edit_admin');
    await a.call('/communities/' + f.second._id + '/invitations', 'POST', {
      recipientId: f.users.member.id,
    });
    return;
  }
  if (process.argv[2] === 'conflict') {
    const f = JSON.parse(fs.readFileSync('test-results/editorial-ui-fixtures.json', 'utf8'));
    await a.login('edit_admin');
    const q = await a.call('/questions/' + f.question.question._id);
    await a.call('/questions/' + q.question._id, 'PUT', {
      revision: q.question.revision,
      content: { ...q.version.content, title: '同事刚保存的出行问题' },
    });
    return;
  }
  await a.login('edit_admin', true);
  await b.login('edit_member', true);
  await c.login('edit_other', true);
  const content = {
    type: 'single_choice',
    title: '你的日常出行方式',
    description: '让每段旅程都更轻松。',
    required: true,
    options: [
      { id: 'walk', label: '步行' },
      { id: 'bike', label: '骑行' },
      { id: 'bus', label: '公共交通' },
    ],
    rows: [],
    validation: {},
  };
  const question = await a.call('/questions', 'POST', { content });
  let survey = await a.call('/surveys', 'POST', { title: '城市出行调查' });
  survey = (
    await a.call('/surveys/' + survey._id + '/library-instances', 'POST', {
      revision: survey.revision,
      questionId: question.question._id,
      versionId: question.version._id,
    })
  ).survey;
  survey = await a.call('/surveys/' + survey._id + '/publish', 'POST', {
    revision: survey.revision,
    deadlineAt: null,
  });
  const community = await a.call('/communities', 'POST', { name: '城市观察编辑部' }),
    second = await a.call('/communities', 'POST', { name: '校园研究小组' });
  const inv = await a.call('/communities/' + community._id + '/invitations', 'POST', {
    recipientId: c.user.id,
  });
  await c.call('/community-invitations/' + inv._id + '/accept', 'POST', { revision: inv.revision });
  for (const room of [community, second])
    await a.call('/communities/' + room._id + '/invitations', 'POST', { recipientId: b.user.id });
  const communityQuestion = await a.call('/questions', 'POST', {
    content: { ...content, title: '你最想改善的公共空间' },
    communityId: community._id,
  });
  let communitySurvey = await a.call('/surveys', 'POST', {
    title: '社区公共体验调查',
    communityId: community._id,
  });
  communitySurvey = (
    await a.call('/surveys/' + communitySurvey._id + '/library-instances', 'POST', {
      revision: communitySurvey.revision,
      questionId: communityQuestion.question._id,
      versionId: communityQuestion.version._id,
    })
  ).survey;
  communitySurvey = await a.call('/surveys/' + communitySurvey._id + '/publish', 'POST', {
    revision: communitySurvey.revision,
    deadlineAt: null,
  });
  for (let i = 0; i < 21; i++)
    await a.call('/questions', 'POST', {
      content: { ...content, title: '生活观察 ' + String(i + 1).padStart(2, '0') },
    });
  fs.writeFileSync(
    'test-results/editorial-ui-fixtures.json',
    JSON.stringify(
      {
        database: 'survey_studio_editorial_ui_20261029',
        users: { admin: a.user, member: b.user, other: c.user },
        question,
        survey,
        community,
        second,
        communityQuestion,
        communitySurvey,
      },
      null,
      2,
    ),
  );
  console.log('Editorial browser fixtures ready');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
