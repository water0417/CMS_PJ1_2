import fs from 'node:fs';
const base = 'http://127.0.0.1:3104/api';
class Client {
  cookie = '';
  user: any;
  async call(path: string, method = 'GET', body?: any) {
    const r = await fetch(base + path, {
      method,
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(path + ' ' + JSON.stringify(data));
    if (r.headers.get('set-cookie')) this.cookie = r.headers.get('set-cookie')!.split(';')[0];
    return data;
  }
  async account(username: string) {
    await this.call('/auth/register', 'POST', { username, password: 'TestPass123!' });
    this.user = await this.call('/auth/login', 'POST', { username, password: 'TestPass123!' });
  }
}
async function main() {
  const admin = new Client(),
    member = new Client(),
    outside = new Client();
  await admin.account('ui_admin');
  await member.account('ui_member');
  await outside.account('ui_outside');
  const questions: Record<string, any> = {};
  const names: Record<string, string> = {
    single_choice: '生活满意度',
    multiple_choice: '关注的服务',
    text: '给城市的建议',
    number: '每周学习时长',
    matrix: '校园体验评价',
    ranking: '改善优先顺序',
    time: '期望活动日期',
    slider: '推荐意愿评分',
    color: '今天的心情色彩',
  };
  for (const type of Object.keys(names)) {
    const content = {
      type,
      title: names[type],
      description: '浏览器验收专用内容',
      required: true,
      options: ['a', 'b', 'c'].map((id, i) => ({ id, label: ['环境', '服务', '活动'][i] })),
      rows: [
        { id: 'r1', label: '教学空间' },
        { id: 'r2', label: '生活空间' },
      ],
      validation:
        type === 'time' ? { mode: 'date' } : type === 'slider' ? { min: 0, max: 10, step: 1 } : {},
    };
    questions[type] = await admin.call('/questions', 'POST', { content });
  }
  const community = await admin.call('/communities', 'POST', { name: '问达共创编辑部' });
  const inviteMember = await admin.call(`/communities/${community._id}/invitations`, 'POST', {
    recipientId: member.user.id,
  });
  const inviteOutside = await admin.call(`/communities/${community._id}/invitations`, 'POST', {
    recipientId: outside.user.id,
  });
  const communityQuestion = await admin.call('/questions', 'POST', {
    communityId: community._id,
    content: { ...questions.text.version.content, title: '社区生活建议' },
  });
  async function survey(title: string, communityId?: string, repeat = true) {
    let s = await admin.call('/surveys', 'POST', {
      title,
      ...(communityId ? { communityId } : {}),
    });
    s = await admin.call(`/surveys/${s._id}/draft`, 'PUT', {
      revision: s.revision,
      definition: {
        ...s.draft,
        allowRepeatSubmissions: repeat,
        questions: [
          {
            ...questions.text.version.content,
            id: 'intro',
            jumpRules: [],
            required: false,
            title: '补充说明',
          },
        ],
      },
    });
    return s;
  }
  let editor = await survey('从题库开始的调查');
  const attached = await admin.call(`/surveys/${editor._id}/library-instances`, 'POST', {
    revision: editor.revision,
    questionId: questions.single_choice.question._id,
    versionId: questions.single_choice.version._id,
  });
  editor = attached.survey;
  let published = await survey('九题型固定版本调查');
  for (const q of Object.values(questions))
    published = (
      await admin.call(`/surveys/${published._id}/library-instances`, 'POST', {
        revision: published.revision,
        questionId: q.question._id,
        versionId: q.version._id,
      })
    ).survey;
  published = (
    await admin.call(`/surveys/${published._id}/library-instances`, 'POST', {
      revision: published.revision,
      questionId: questions.text.question._id,
      versionId: questions.text.version._id,
    })
  ).survey;
  published = await admin.call(`/surveys/${published._id}/publish`, 'POST', {
    revision: published.revision,
    deadlineAt: null,
  });
  const answers: any = {
    single_choice: 'a',
    multiple_choice: ['a', 'b'],
    text: '真实接口验收的建议',
    number: 12,
    matrix: { r1: 'a', r2: 'b' },
    ranking: ['b', 'a', 'c'],
    time: '2026-10-28',
    slider: 8,
    color: '#888888',
  };
  for (let i = 0; i < 11; i++) {
    let a = await outside.call(`/public/surveys/${published.publicId}/attempts`, 'POST', {
      anonymous: true,
    });
    while (a.state.currentQuestionId !== 'END') {
      const q = a.definition.questions.find((q: any) => q.id === a.state.currentQuestionId);
      a = await outside.call(`/attempts/${a.id}/advance`, 'POST', {
        revision: a.state.revision,
        answer: answers[q.type],
      });
    }
    await outside.call(`/attempts/${a.id}/submit`, 'POST', { revision: a.state.revision });
  }
  let communitySurvey = await survey('社区公共体验调查', community._id);
  communitySurvey = (
    await admin.call(`/surveys/${communitySurvey._id}/library-instances`, 'POST', {
      revision: communitySurvey.revision,
      questionId: questions.single_choice.question._id,
      versionId: questions.single_choice.version._id,
    })
  ).survey;
  communitySurvey = await admin.call(`/surveys/${communitySurvey._id}/publish`, 'POST', {
    revision: communitySurvey.revision,
    deadlineAt: null,
  });
  const deliveries = [];
  for (let i = 0; i < 2; i++)
    deliveries.push(
      await admin.call(`/questions/${questions.text.question._id}/shares`, 'POST', {
        kind: 'delivery',
        versionId: questions.text.version._id,
        recipientId: member.user.id,
      }),
    );
  const links = [];
  for (let i = 0; i < 21; i++)
    links.push(
      await admin.call(`/questions/${questions.text.question._id}/shares`, 'POST', {
        kind: 'link',
        versionId: questions.text.version._id,
      }),
    );
  const publicShare = await admin.call(`/questions/${questions.text.question._id}/shares`, 'POST', {
    kind: 'public',
    versionId: questions.text.version._id,
  });
  const result = {
    database: 'survey_studio_phase2_ui_1793175000000',
    users: { admin: admin.user, member: member.user, outside: outside.user },
    questions,
    community,
    communityQuestion,
    editor,
    published,
    communitySurvey,
    deliveries,
    links,
    publicShare,
    inviteMember,
    inviteOutside,
  };
  fs.writeFileSync('test-results/phase2-frontend-fixtures.json', JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      users: result.users,
      questionIds: Object.fromEntries(
        Object.entries(questions).map(([t, q]) => [t, q.question._id]),
      ),
      community: community._id,
      communityQuestion: communityQuestion.question._id,
      editor: editor._id,
      published: published._id,
      communitySurvey: communitySurvey._id,
      linkToken: links[0].token,
    }),
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
