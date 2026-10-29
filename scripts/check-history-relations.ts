import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { User } from '../apps/api/src/database';
import {
  createQuestion,
  editQuestion,
  questionDetail,
  versionHistory,
  saveQuestionAs,
  attachQuestion,
} from '../apps/api/src/library';
import { createSurvey, owned } from '../apps/api/src/service';
import { historyRelation, resolveHistoryNumbers } from '../apps/web/src/version-relations';
async function main() {
  await mongoose.connect(
    'mongodb://127.0.0.1:27018/survey_studio_square_ui_followup_20261029?directConnection=true',
  );
  const owner = await User.findOne({ username: 'square_member' }).lean(),
    outside = await User.findOne({ username: 'square_outside' }).lean();
  assert.ok(owner && outside);
  const uid = String(owner._id),
    other = String(outside._id);
  const content = (title: string) => ({
    type: 'text',
    title,
    description: '独立历史关系验收',
    required: true,
    options: [],
    rows: [],
    validation: {},
  });
  const v1 = await createQuestion(uid, { content: content('年龄 · 初始内容') });
  const id = String(v1.question._id);
  const v2 = await editQuestion(id, uid, {
    revision: v1.question.revision,
    content: content('年龄 · 修改后内容'),
  });
  assert.equal(v2.version.parentVersionId, String(v1.version._id));
  const a = await createSurvey(uid, '历史验收甲'),
    b = await createSurvey(uid, '历史验收乙');
  const sa = await attachQuestion(String(a._id), uid, {
    revision: 0,
    questionId: id,
    versionId: String(v1.version._id),
  });
  const sb = await attachQuestion(String(b._id), uid, {
    revision: 0,
    questionId: id,
    versionId: String(v2.version._id),
  });
  assert.notEqual(sa.survey.draft.questions[0].title, sb.survey.draft.questions[0].title);
  assert.equal(sa.survey.draft.questions[0].source.versionId, String(v1.version._id));
  assert.equal(sb.survey.draft.questions[0].source.versionId, String(v2.version._id));
  const v3 = await editQuestion(
    id,
    uid,
    { revision: v2.question.revision, versionId: String(v1.version._id) },
    true,
  );
  assert.equal(v3.version.restoredFromVersionId, String(v1.version._id));
  assert.equal(v3.version.parentVersionId, String(v2.version._id));
  assert.equal(
    (await questionDetail(id, uid, String(v2.version._id))).version.content.title,
    '年龄 · 修改后内容',
  );
  const copy = await saveQuestionAs(id, uid, {
    versionId: String(v2.version._id),
    content: content('独立另存年龄'),
  });
  assert.notEqual(String(copy.question._id), id);
  assert.equal(copy.question.provenance.channel, 'library-save-as');
  assert.equal((await questionDetail(id, uid)).question.revision, 3);
  assert.equal(
    (await questionDetail(id, uid, copy.question.provenance.versionId)).version.number,
    2,
  );
  let latest = v3;
  for (let n = 4; n <= 23; n++)
    latest = await editQuestion(id, uid, {
      revision: latest.question.revision,
      content: content('年龄 · 第' + n + '次内容'),
    });
  const first = await versionHistory(id, uid, 1),
    second = await versionHistory(id, uid, 2);
  assert.equal(first.rows.length, 20);
  assert.equal(second.rows.length, 3);
  const numbers = await resolveHistoryNumbers(
    first.rows as any,
    async (vid) => (await questionDetail(id, uid, vid)).version as any,
  );
  assert.equal(historyRelation(first.rows[19] as any, numbers), '在第3次保存的内容上修改');
  const nums = await resolveHistoryNumbers(
    second.rows as any,
    async (vid) => (await questionDetail(id, uid, vid)).version as any,
  );
  assert.equal(historyRelation(second.rows[0] as any, nums), '恢复第1次保存的内容，形成新的记录');
  assert.equal(historyRelation(second.rows[2] as any, nums), '首次创建');
  assert.equal(
    historyRelation({ _id: 'unknown', number: 4 }, {}),
    '此记录缺少修改关系，暂无法确认来源',
  );
  await assert.rejects(
    questionDetail(id, other, String(v2.version._id)),
    (e: any) => e.status === 404,
  );
  const sharedCopy = await (
    await import('../apps/api/src/library')
  ).createShare(id, uid, { kind: 'public', versionId: String(v2.version._id) });
  const received = await (
    await import('../apps/api/src/library')
  ).receiveShare(String(sharedCopy._id), other);
  assert.ok((await questionDetail(String(received.question._id), other)).question.provenance);
  await assert.rejects(
    questionDetail(id, other, String(v2.version._id)),
    (e: any) => e.status === 404,
  );
  console.log(
    'PASS 1 v1→v2 relationship; 2 surveys independently select v1/v2; 3 restore v1→v3 preserves v2; 4 save-as independent with readable authorized origin; 5 23 versions cross-page exact relationships; 6 private source denied to outsider',
  );
  fs.writeFileSync(
    'test-results/history-relations-fixture.json',
    JSON.stringify(
      {
        questionId: id,
        copyId: String(copy.question._id),
        surveyA: String(a._id),
        surveyB: String(b._id),
      },
      null,
      2,
    ),
  );
}
main()
  .finally(() => mongoose.disconnect())
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
