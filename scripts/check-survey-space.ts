// Run only against the named disposable browser database.
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import { createSurvey, changeSurveySpace, owned } from '../apps/api/src/service';
import { Survey } from '../apps/api/src/database';
import { Community, Membership, QuestionShare } from '../apps/api/src/phase2-models';
import { User } from '../apps/api/src/database';
import { receiveShare, attachQuestion } from '../apps/api/src/library';
async function main() {
  await mongoose.connect(
    'mongodb://127.0.0.1:27018/survey_studio_square_ui_followup_20261029?directConnection=true',
  );
  const user = await User.findOne({ username: 'square_member' }).lean();
  const outsider = await User.findOne({ username: 'square_outside' }).lean();
  const room = await Community.findOne({ name: '共同编辑部 A' }).lean();
  assert.ok(user && outsider && room);
  const uid = String(user._id),
    cid = String(room._id);
  const s = await createSurvey(uid, '归属迁移专项');
  const id = String(s._id);
  let r = await changeSurveySpace(id, uid, { revision: 0, communityId: cid });
  assert.equal(r.communityId, cid);
  assert.equal(r.revision, 1);
  assert.equal(r.ownerId, uid);
  await assert.rejects(
    changeSurveySpace(id, uid, { revision: 0, communityId: null }),
    (e: any) => e.code === 'CONFLICT',
  );
  await assert.rejects(
    changeSurveySpace(id, String(outsider._id), { revision: 1, communityId: null }),
    (e: any) => e.status === 404,
  );
  r = await changeSurveySpace(id, uid, { revision: 1, communityId: null });
  assert.equal(r.communityId, undefined);
  assert.equal(r.revision, 2);
  const missing = await Community.findOne({ name: '协作社区 B' }).lean();
  await assert.rejects(
    changeSurveySpace(id, uid, { revision: 2, communityId: String(missing!._id) }),
    (e: any) => e.status === 404,
  );
  const share = await QuestionShare.findOne({ kind: 'public', status: 'active' }).lean();
  assert.ok(share);
  const copy = await receiveShare(String(share._id), uid);
  const attached = await attachQuestion(id, uid, {
    revision: 2,
    questionId: String(copy.question._id),
    versionId: String(copy.version._id),
  });
  assert.equal(attached.survey.draft.questions.length, 1);
  r = await changeSurveySpace(id, uid, { revision: attached.survey.revision, communityId: cid });
  assert.deepEqual(r.draft, attached.survey.draft);
  await Survey.updateOne({ _id: id }, { $set: { status: 'published' } });
  await assert.rejects(
    changeSurveySpace(id, uid, { revision: r.revision, communityId: null }),
    (e: any) => e.code === 'PUBLISHED',
  );
  console.log(
    'PASS: personal→community→personal; revision conflict; outsider denied; nonmember destination denied; public copy attach; migration preserves source/content; published denied',
  );
}
main()
  .finally(() => mongoose.disconnect())
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
