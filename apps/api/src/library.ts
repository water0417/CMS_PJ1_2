import mongoose, { ClientSession } from 'mongoose';
import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Survey, Version } from './database';
import { LibraryQuestion, QuestionVersion, QuestionShare, ShareCopy } from './phase2-models';
import { Definition, Question, BRANCH_ROUTING, TYPES, fail, validateDefinition } from './domain';
import {
  id,
  member,
  transaction,
  revision,
  conflict,
  notFound,
  pageNumber,
  surveyAccess,
} from './access';
import { lookupUser } from './communities';

export type QuestionContent = Omit<Question, 'id' | 'jumpRules' | 'source'>;
const keys = ['type', 'title', 'description', 'required', 'options', 'rows', 'validation'] as const;
export function contentOf(input: any): QuestionContent {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail('QUESTION', '题目内容不合法');
  const result: any = {};
  for (const key of keys) result[key] = input[key];
  validateDefinition({
    title: '题库内容校验',
    description: '',
    allowAnonymous: false,
    allowRepeatSubmissions: false,
    schemaVersion: 1,
    routingMode: BRANCH_ROUTING,
    questions: [{ ...result, id: 'library_item', jumpRules: [] }],
  });
  return JSON.parse(JSON.stringify(result));
}
export async function questionAccess(
  questionId: string,
  userId: string,
  session?: ClientSession,
  write = false,
) {
  const q = await LibraryQuestion.findById(id(questionId))
    .session(session ?? null)
    .lean();
  if (!q) return notFound();
  if (q.communityId) await member(q.communityId, userId, session, write);
  else if (q.ownerId !== userId) return notFound();
  return q;
}
export async function versionFor(questionId: string, versionId: string, session?: ClientSession) {
  const v = await QuestionVersion.findOne({ _id: id(versionId), questionId: id(questionId) })
    .session(session ?? null)
    .lean();
  if (!v) return notFound();
  return v;
}
export async function insertQuestion(
  userId: string,
  content: QuestionContent,
  communityId: string | undefined,
  provenance: any,
  session: ClientSession,
) {
  if (communityId) {
    communityId = id(communityId);
    await member(communityId, userId, session, true);
  }
  const questionId = new mongoose.Types.ObjectId(),
    versionId = new mongoose.Types.ObjectId();
  const [q] = await LibraryQuestion.create(
    [
      {
        _id: questionId,
        scopeKey: communityId ? 'community:' + communityId : 'personal:' + userId,
        ownerId: communityId ? undefined : userId,
        communityId,
        createdBy: userId,
        revision: 1,
        latestVersionId: String(versionId),
        title: content.title,
        type: content.type,
        provenance,
      },
    ],
    { session },
  );
  const [v] = await QuestionVersion.create(
    [{ _id: versionId, questionId: String(questionId), number: 1, authorId: userId, content }],
    { session },
  );
  return { question: q.toObject(), version: v.toObject() };
}
export async function createQuestion(userId: string, body: any) {
  const content = contentOf(body.content);
  if (body.communityId !== undefined) id(body.communityId);
  if (body.provenance || body.ownerId || body.createdBy || body.source)
    fail('IDENTITY', '身份及来源由服务端设置');
  return transaction((s) => insertQuestion(userId, content, body.communityId, undefined, s));
}
export async function listQuestions(userId: string, query: any) {
  const p = pageNumber(query.page),
    match: any = { scopeKey: 'personal:' + userId };
  if (query.communityId) {
    await member(id(query.communityId), userId);
    match.scopeKey = 'community:' + id(query.communityId);
  }
  if (query.search !== undefined) {
    if (typeof query.search !== 'string' || query.search.length > 120)
      fail('SEARCH', '搜索词最多120字');
    match.title = { $regex: query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  }
  if (query.type) match.type = String(query.type);
  return {
    page: p,
    pageSize: 20,
    total: await LibraryQuestion.countDocuments(match),
    rows: await LibraryQuestion.find(match)
      .sort({ updatedAt: -1, _id: -1 })
      .skip((p - 1) * 20)
      .limit(20)
      .lean(),
  };
}
export async function questionDetail(questionId: string, userId: string, versionId?: string) {
  const q = await questionAccess(questionId, userId);
  return { question: q, version: await versionFor(questionId, versionId ?? q.latestVersionId) };
}
export async function versionHistory(questionId: string, userId: string, page: any) {
  await questionAccess(questionId, userId);
  const p = pageNumber(page);
  return {
    page: p,
    pageSize: 20,
    total: await QuestionVersion.countDocuments({ questionId }),
    rows: await QuestionVersion.find({ questionId })
      .sort({ number: -1 })
      .skip((p - 1) * 20)
      .limit(20)
      .lean(),
  };
}
export async function editQuestion(questionId: string, userId: string, body: any, restore = false) {
  revision(body.revision);
  if (body.authorId || body.ownerId || body.provenance)
    fail('IDENTITY', '不能指定修改者或改写来源');
  return transaction(async (session) => {
    const q = await questionAccess(questionId, userId, session, true);
    if (q.revision !== body.revision) return conflict();
    const from = restore ? await versionFor(questionId, body.versionId, session) : null;
    const content = from ? from.content : contentOf(body.content);
    const versionId = new mongoose.Types.ObjectId();
    const updated = await LibraryQuestion.findOneAndUpdate(
      { _id: q._id, revision: body.revision },
      {
        $set: { latestVersionId: String(versionId), title: content.title, type: content.type },
        $inc: { revision: 1 },
      },
      { session, new: true },
    ).lean();
    if (!updated) return conflict();
    const [v] = await QuestionVersion.create(
      [
        {
          _id: versionId,
          questionId,
          number: q.revision + 1,
          parentVersionId: q.latestVersionId,
          restoredFromVersionId: from ? String(from._id) : undefined,
          authorId: userId,
          content,
        },
      ],
      { session },
    );
    return { question: updated, version: v.toObject() };
  });
}
export async function copyQuestion(questionId: string, userId: string, body: any) {
  return transaction(async (session) => {
    await questionAccess(questionId, userId, session, true);
    const v = await versionFor(questionId, body.versionId, session);
    return insertQuestion(
      userId,
      v.content,
      undefined,
      { questionId, versionId: String(v._id), channel: 'library-copy' },
      session,
    );
  });
}
/** Edited independent copy: immutable origin, no update of the source resource. */
export async function saveQuestionAs(questionId: string, userId: string, body: any) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('QUESTION', '请求体须为对象');
  if (Object.keys(body).some((key) => !['versionId', 'content', 'communityId'].includes(key)))
    fail('IDENTITY', '仅允许指定来源版本、编辑内容和目标社区，身份及来源由服务端设置');
  const content = contentOf(body.content);
  if (body.communityId !== undefined) id(body.communityId);
  return transaction(async (session) => {
    const q = await questionAccess(questionId, userId, session, true);
    const v = await versionFor(String(q._id), body.versionId, session);
    return insertQuestion(
      userId,
      content,
      body.communityId,
      { questionId: String(q._id), versionId: String(v._id), channel: 'library-save-as' },
      session,
    );
  });
}
export async function saveSurveyQuestion(
  surveyId: string,
  instanceId: string,
  userId: string,
  body: any,
) {
  return transaction(async (session) => {
    const s = await surveyAccess(surveyId, userId, 'manage', session, true);
    if (revision(body.revision) !== s.revision) return conflict();
    const definition = s.publishedVersionId
      ? (await Version.findById(s.publishedVersionId).session(session).lean())?.definition
      : s.draft;
    const q = definition?.questions.find((q: Question) => q.id === instanceId);
    if (!q) return notFound();
    if (q.source) {
      const original = await LibraryQuestion.findById(id(q.source.questionId))
        .session(session)
        .lean();
      if (!original) return notFound();
      if (original.communityId) await member(original.communityId, userId, session, true);
    }
    const provenance = q.source ? { ...q.source, channel: 'survey-save' } : undefined;
    // Cross-question jumps are deliberately excluded from the independent content.
    return insertQuestion(userId, contentOf(q), body.communityId, provenance, session);
  });
}
/** Existing snapshots remain usable after losing access to the source library. New binding needs API authorization. */
export async function validateSources(
  definition: Definition,
  previous: Definition,
  userId: string,
  session: ClientSession,
) {
  for (const q of definition.questions) {
    const old = previous.questions.find((x) => x.id === q.id);
    if (!q.source) {
      if (old?.source) fail('SOURCE_DETACH_REQUIRED', '请先显式脱离题库，再保存本地修改');
      continue;
    }
    if (!old?.source || !isDeepStrictEqual(old.source, q.source))
      fail('SOURCE_ATTACH_REQUIRED', '请通过选题或实例升级接口设置引用');
    const source = q.source;
    if (Object.keys(source).sort().join(',') !== 'questionId,versionId')
      fail('SOURCE', '来源字段不合法');
    const v = await versionFor(source.questionId, source.versionId, session);
    if (!isDeepStrictEqual(contentOf(q), v.content))
      fail('SOURCE_CONTENT_MISMATCH', '题目内容与固定版本不一致，请保存新版本或显式脱离');
  }
}
async function writeDraft(s: any, definition: Definition, session: ClientSession) {
  if (s.status !== 'draft') fail('PUBLISHED', '已发布问卷不能调整题目内容');
  validateDefinition(definition);
  const updated = await Survey.findOneAndUpdate(
    { _id: s._id, status: 'draft', deletedAt: null, revision: s.revision },
    { $set: { draft: definition }, $inc: { revision: 1 } },
    { session, new: true },
  ).lean();
  if (!updated) return conflict();
  return updated;
}
export async function attachQuestion(surveyId: string, userId: string, body: any) {
  return transaction(async (session) => {
    const s = await surveyAccess(surveyId, userId, 'manage', session, true);
    if (revision(body.revision) !== s.revision) return conflict();
    await questionAccess(body.questionId, userId, session, true);
    const v = await versionFor(body.questionId, body.versionId, session);
    const instanceId = randomBytes(16).toString('hex');
    const definition: Definition = structuredClone(s.draft);
    const index = body.index ?? definition.questions.length;
    if (!Number.isInteger(index) || index < 0 || index > definition.questions.length)
      fail('INDEX', '插入位置不合法');
    definition.questions.splice(index, 0, {
      ...v.content,
      id: instanceId,
      jumpRules: [],
      source: { questionId: id(body.questionId), versionId: String(v._id) },
    });
    return { survey: await writeDraft(s, definition, session), instanceId };
  });
}
function differences(a: any[], b: any[]) {
  return {
    removed: a.filter((x) => !b.some((y) => y.id === x.id)).map((x) => x.id),
    added: b.filter((x) => !a.some((y) => y.id === x.id)).map((x) => x.id),
    changed: b.filter((x) => a.some((y) => y.id === x.id && y.label !== x.label)).map((x) => x.id),
  };
}
export async function upgradeInfo(surveyId: string, userId: string) {
  const s = await surveyAccess(surveyId, userId);
  const rows = [];
  for (const q of s.draft.questions as Question[]) {
    if (!q.source) continue;
    try {
      const resource = await questionAccess(q.source.questionId, userId);
      const latest = await versionFor(q.source.questionId, resource.latestVersionId);
      const proposed: Definition = structuredClone(s.draft);
      const i = proposed.questions.findIndex((x) => x.id === q.id);
      proposed.questions[i] = {
        ...latest.content,
        id: q.id,
        jumpRules: q.jumpRules,
        source: { questionId: q.source.questionId, versionId: String(latest._id) },
      };
      let error: any = null;
      try {
        validateDefinition(proposed);
      } catch (e: any) {
        error = { code: e.code, message: e.message };
      }
      rows.push({
        instanceId: q.id,
        source: q.source,
        latestVersionId: String(latest._id),
        hasUpdate: q.source.versionId !== String(latest._id),
        options: differences(q.options, latest.content.options),
        rows: differences(q.rows, latest.content.rows),
        canUpgrade: s.status === 'draft' && !error,
        error,
      });
    } catch (e: any) {
      rows.push({ instanceId: q.id, accessible: false, code: e.code });
    }
  }
  return { revision: s.revision, rows };
}
export async function changeInstance(
  surveyId: string,
  instanceId: string,
  userId: string,
  body: any,
  detach = false,
) {
  return transaction(async (session) => {
    const s = await surveyAccess(surveyId, userId, 'manage', session, true);
    if (revision(body.revision) !== s.revision) return conflict();
    const d: Definition = structuredClone(s.draft),
      q = d.questions.find((q) => q.id === instanceId);
    if (!q?.source) return notFound();
    if (detach) delete q.source;
    else {
      await questionAccess(q.source.questionId, userId, session, true);
      const v = await versionFor(q.source.questionId, body.versionId, session);
      Object.assign(q, v.content, {
        source: { questionId: q.source.questionId, versionId: String(v._id) },
      });
    }
    return { survey: await writeDraft(s, d, session), instanceId };
  });
}
export async function createShare(questionId: string, userId: string, body: any) {
  if (!['delivery', 'link', 'public'].includes(body.kind)) fail('SHARE_KIND', '不支持的共享方式');
  if (body.kind === 'delivery') {
    await lookupUser(body.recipientId);
    if (body.recipientId === userId) fail('RECIPIENT', '不能向自己投递');
  }
  return transaction(async (session) => {
    const q = await questionAccess(questionId, userId, session, true);
    if (q.communityId) fail('SHARE_PERSONAL_REQUIRED', '社区题目请先主动转存个人副本，再对外共享');
    const v = await versionFor(questionId, body.versionId, session);
    const [share] = await QuestionShare.create(
      [
        {
          kind: body.kind,
          questionId,
          versionId: String(v._id),
          senderId: userId,
          recipientId: body.kind === 'delivery' ? id(body.recipientId) : undefined,
          token: body.kind === 'link' ? randomBytes(24).toString('hex') : undefined,
          status: body.kind === 'delivery' ? 'pending' : 'active',
        },
      ],
      { session },
    );
    return share.toObject();
  });
}
export async function publicSquare(userId: string, query: any) {
  const page = pageNumber(query.page);
  if (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 120))
    fail('SEARCH', '搜索词最多120字');
  if (query.type !== undefined && !TYPES.includes(query.type)) fail('TYPE', '不支持的题型');
  const fixed: any = {};
  if (query.search)
    fixed['content.title'] = {
      $regex: query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      $options: 'i',
    };
  if (query.type !== undefined) fixed['content.type'] = query.type;
  const [result] = await QuestionShare.aggregate([
    {
      $match: {
        kind: 'public',
        status: 'active',
        ...(query.mine === 'true' ? { senderId: userId } : {}),
      },
    },
    {
      $lookup: {
        from: 'question_versions',
        let: { vid: '$versionId', qid: '$questionId' },
        pipeline: [
          {
            $match: {
              ...fixed,
              $expr: {
                $and: [
                  { $eq: [{ $toString: '$_id' }, '$$vid'] },
                  { $eq: ['$questionId', '$$qid'] },
                ],
              },
            },
          },
          { $project: { content: 1, number: 1 } },
        ],
        as: 'version',
      },
    },
    { $match: { 'version.0': { $exists: true } } },
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $facet: { rows: [{ $skip: (page - 1) * 20 }, { $limit: 20 }], total: [{ $count: 'value' }] },
    },
  ]);
  return { page, pageSize: 20, total: result.total[0]?.value ?? 0, rows: result.rows };
}
export async function shareList(userId: string, query: any, kind: 'delivery' | 'public') {
  if (kind === 'public') return publicSquare(userId, query);
  const p = pageNumber(query.page),
    match: any = { kind };
  if (kind === 'delivery') {
    match.recipientId = userId;
    if (query.status !== undefined && !['pending', 'accepted', 'rejected'].includes(query.status))
      fail('STATUS', '投递状态不合法');
    match.status = query.status ?? 'pending';
  } else {
    match.status = 'active';
    if (query.mine === 'true') match.senderId = userId;
  }
  // No password, session, survey, or response is joined into shared views.
  const rows = await QuestionShare.aggregate([
    { $match: match },
    { $sort: { createdAt: -1, _id: -1 } },
    { $skip: (p - 1) * 20 },
    { $limit: 20 },
    {
      $lookup: {
        from: 'question_versions',
        let: { vid: '$versionId' },
        pipeline: [
          { $match: { $expr: { $eq: [{ $toString: '$_id' }, '$$vid'] } } },
          { $project: { content: 1, number: 1 } },
        ],
        as: 'version',
      },
    },
  ]);
  return { page: p, pageSize: 20, total: await QuestionShare.countDocuments(match), rows };
}
export async function sentShares(userId: string, query: any) {
  if (query.direction !== 'sent') fail('DIRECTION', 'direction必须为sent');
  const page = pageNumber(query.page);
  const match: any = { senderId: userId };
  if (query.kind !== undefined) {
    if (!['delivery', 'link', 'public'].includes(query.kind))
      fail('SHARE_KIND', '不支持的共享方式');
    match.kind = query.kind;
  }
  if (query.status !== undefined) {
    if (!['pending', 'accepted', 'rejected', 'active', 'revoked'].includes(query.status))
      fail('STATUS', '分享状态不合法');
    match.status = query.status;
  }
  const [result] = await QuestionShare.aggregate([
    { $match: match },
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $facet: {
        total: [{ $count: 'value' }],
        rows: [
          { $skip: (page - 1) * 20 },
          { $limit: 20 },
          {
            $lookup: {
              from: 'question_versions',
              let: { vid: '$versionId', qid: '$questionId' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: [{ $toString: '$_id' }, '$$vid'] },
                        { $eq: ['$questionId', '$$qid'] },
                      ],
                    },
                  },
                },
                { $project: { _id: 1, questionId: 1, number: 1, content: 1 } },
              ],
              as: 'fixedVersion',
            },
          },
          {
            $lookup: {
              from: 'users',
              let: { recipientId: '$recipientId' },
              pipeline: [
                { $match: { $expr: { $eq: [{ $toString: '$_id' }, '$$recipientId'] } } },
                { $project: { _id: 0, id: { $toString: '$_id' }, username: 1 } },
              ],
              as: 'recipientUser',
            },
          },
          {
            $project: {
              _id: 1,
              kind: 1,
              questionId: 1,
              versionId: 1,
              status: 1,
              createdAt: 1,
              updatedAt: 1,
              version: { $ifNull: [{ $arrayElemAt: ['$fixedVersion', 0] }, null] },
              recipient: {
                $cond: [
                  { $eq: ['$kind', 'delivery'] },
                  {
                    $ifNull: [
                      { $arrayElemAt: ['$recipientUser', 0] },
                      { id: '$recipientId', username: null },
                    ],
                  },
                  '$$REMOVE',
                ],
              },
              link: {
                $cond: [
                  { $eq: ['$kind', 'link'] },
                  { token: '$token', path: { $concat: ['/api/question-links/', '$token'] } },
                  '$$REMOVE',
                ],
              },
            },
          },
        ],
      },
    },
  ]);
  return { page, pageSize: 20, total: result.total[0]?.value ?? 0, rows: result.rows };
}
async function accessShare(
  shareId: string,
  userId: string,
  session?: ClientSession,
  token?: string,
) {
  const share = await QuestionShare.findById(id(shareId))
    .session(session ?? null)
    .lean();
  if (!share || share.status === 'revoked') return notFound();
  if (share.kind === 'delivery' && share.recipientId !== userId) return notFound();
  if (share.kind === 'link' && share.token !== token) return notFound();
  if (share.kind !== 'delivery' && share.status !== 'active') return notFound();
  return share;
}
export async function shareDetail(shareId: string, userId: string, token?: string) {
  const s = await accessShare(shareId, userId, undefined, token);
  return { share: s, version: await versionFor(s.questionId, s.versionId) };
}
export async function linkDetail(token: string, userId: string) {
  if (!/^[a-f\d]{48}$/.test(token)) return notFound();
  const s = await QuestionShare.findOne({ kind: 'link', token, status: 'active' }).lean();
  if (!s) return notFound();
  return { share: s, version: await versionFor(s.questionId, s.versionId) };
}
export async function receiveShare(
  shareId: string,
  userId: string,
  reject = false,
  token?: string,
) {
  return transaction(async (session) => {
    const share = await accessShare(shareId, userId, session, token);
    if (reject) {
      if (share.kind !== 'delivery' || share.status === 'accepted') return conflict();
      await QuestionShare.updateOne(
        { _id: share._id },
        { $set: { status: 'rejected' }, $inc: { writeSerial: 1 } },
        { session },
      );
      return { status: 'rejected' };
    }
    if (share.status === 'rejected') return conflict();
    // Lock share before checking idempotency to serialize accept vs accept/revoke.
    await QuestionShare.updateOne({ _id: share._id }, { $inc: { writeSerial: 1 } }, { session });
    const old = await ShareCopy.findOne({ shareId, userId }).session(session).lean();
    if (old) {
      await questionAccess(old.questionId, userId, session);
      return {
        question: old.initialQuestion,
        version: await versionFor(old.questionId, old.versionId, session),
        alreadyAccepted: true,
      };
    }
    const v = await versionFor(share.questionId, share.versionId, session);
    const copy = await insertQuestion(
      userId,
      v.content,
      undefined,
      { questionId: share.questionId, versionId: share.versionId, channel: share.kind, shareId },
      session,
    );
    await ShareCopy.create(
      [
        {
          shareId,
          userId,
          questionId: String(copy.question._id),
          versionId: String(copy.version._id),
          initialQuestion: copy.question,
        },
      ],
      {
        session,
      },
    );
    if (share.kind === 'delivery')
      await QuestionShare.updateOne(
        { _id: share._id },
        { $set: { status: 'accepted' } },
        { session },
      );
    return { ...copy, alreadyAccepted: false };
  });
}
export async function revokeShare(shareId: string, userId: string) {
  return transaction(async (session) => {
    const s = await QuestionShare.findOneAndUpdate(
      { _id: id(shareId), senderId: userId },
      { $set: { status: 'revoked' }, $inc: { writeSerial: 1 } },
      { session, new: true },
    ).lean();
    if (!s) return notFound();
    return { ok: true };
  });
}
