import { Response, Survey, Version } from './database';
import { questionAccess, versionFor } from './library';
import { member, id, pageNumber, visibleSurveyFilter } from './access';
async function authorizeReference(
  questionId: string,
  versionId: string,
  userId: string,
  scope: any,
) {
  const version = await versionFor(questionId, versionId);
  try {
    await questionAccess(questionId, userId);
    return version;
  } catch (error: any) {
    if (error.code !== 'NOT_FOUND') throw error;
  }
  // Reading a fixed instance in one's own survey / member-visible community survey does not
  // grant access to the source library or any other version, but permits scoped statistics.
  const reference = { 'source.questionId': id(questionId), 'source.versionId': id(versionId) };
  if (await Survey.exists({ ...scope, 'draft.questions': { $elemMatch: reference } }))
    return version;
  const visible = await Version.aggregate([
    { $match: { 'definition.questions': { $elemMatch: reference } } },
    {
      $lookup: {
        from: 'surveys',
        let: { sid: '$surveyId' },
        pipeline: [{ $match: { ...scope, $expr: { $eq: [{ $toString: '$_id' }, '$$sid'] } } }],
        as: 'survey',
      },
    },
    { $match: { 'survey.0': { $exists: true } } },
    { $limit: 1 },
    { $project: { _id: 1 } },
  ]);
  if (!visible.length) {
    const { notFound } = await import('./access');
    return notFound();
  }
  return version;
}
/** The pipeline stays in MongoDB: no response bodies are materialized in application memory. */
export async function crossStatistics(
  questionId: string,
  versionId: string,
  userId: string,
  query: any,
) {
  const scope = await visibleSurveyFilter(userId, query.communityId),
    p = pageNumber(query.page);
  const v = await authorizeReference(questionId, versionId, userId, scope);
  const pipeline: any[] = [
    {
      $lookup: {
        from: 'surveys',
        let: { sid: '$surveyId' },
        pipeline: [
          { $match: { ...scope, $expr: { $eq: [{ $toString: '$_id' }, '$$sid'] } } },
          { $project: { _id: 1 } },
        ],
        as: 'authorizedSurvey',
      },
    },
    { $match: { 'authorizedSurvey.0': { $exists: true } } },
    {
      $lookup: {
        from: 'survey_versions',
        let: { vid: '$surveyVersionId', sid: '$surveyId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [{ $eq: [{ $toString: '$_id' }, '$$vid'] }, { $eq: ['$surveyId', '$$sid'] }],
              },
            },
          },
          { $project: { questions: '$definition.questions' } },
        ],
        as: 'snapshot',
      },
    },
    { $unwind: '$snapshot' },
    { $unwind: '$snapshot.questions' },
    {
      $match: {
        'snapshot.questions.source.questionId': id(questionId),
        'snapshot.questions.source.versionId': id(versionId),
        submittedAt: { $type: 'date' },
        $expr: { $in: ['$snapshot.questions.id', { $ifNull: ['$activePath', []] }] },
      },
    },
    {
      $project: {
        submittedAt: 1,
        instanceId: '$snapshot.questions.id',
        pair: {
          $arrayElemAt: [
            {
              $filter: {
                input: { $objectToArray: '$answers' },
                as: 'item',
                cond: { $eq: ['$$item.k', '$snapshot.questions.id'] },
              },
            },
            0,
          ],
        },
      },
    },
    { $match: { 'pair.v': { $exists: true, $ne: null } } },
    { $project: { answer: '$pair.v', submittedAt: 1, instanceId: 1 } },
  ];
  const facets: any = { count: [{ $count: 'value' }] };
  const type = v.content.type;
  if (['single_choice', 'multiple_choice', 'time', 'color'].includes(type)) {
    const grouped = [
      ...(type === 'multiple_choice' ? [{ $unwind: '$answer' }] : []),
      { $group: { _id: '$answer', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ];
    facets.distribution = [...grouped, { $skip: (p - 1) * 20 }, { $limit: 20 }];
    facets.distributionTotal = [...grouped, { $count: 'value' }];
  }
  if (['number', 'slider'].includes(type))
    facets.numeric = [
      {
        $group: {
          _id: null,
          answerCount: { $sum: 1 },
          average: { $avg: '$answer' },
          min: { $min: '$answer' },
          max: { $max: '$answer' },
        },
      },
    ];
  if (type === 'text')
    facets.rows = [
      { $sort: { submittedAt: -1, _id: -1, instanceId: 1 } },
      { $skip: (p - 1) * 20 },
      { $limit: 20 },
      { $project: { _id: 0, value: '$answer', submittedAt: 1 } },
    ];
  if (type === 'matrix')
    facets.matrix = [
      { $project: { pairs: { $objectToArray: '$answer' } } },
      { $unwind: '$pairs' },
      { $group: { _id: { row: '$pairs.k', option: '$pairs.v' }, count: { $sum: 1 } } },
      { $sort: { '_id.row': 1, '_id.option': 1 } },
    ];
  if (type === 'ranking') {
    const unwind = { $unwind: { path: '$answer', includeArrayIndex: 'position' } };
    facets.ranking = [
      unwind,
      {
        $group: {
          _id: '$answer',
          averageRank: { $avg: { $add: ['$position', 1] } },
          firstCount: { $sum: { $cond: [{ $eq: ['$position', 0] }, 1, 0] } },
        },
      },
      { $sort: { averageRank: 1, _id: 1 } },
    ];
    facets.rankDistribution = [
      unwind,
      {
        $group: {
          _id: { option: '$answer', rank: { $add: ['$position', 1] } },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.option': 1, '_id.rank': 1 } },
    ];
  }
  const [result] = await Response.aggregate([...pipeline, { $facet: facets }]).allowDiskUse(true);
  const output: any = {
    questionId,
    versionId,
    content: v.content,
    scope: query.communityId ? { communityId: query.communityId } : 'personal',
    unit: 'instance-answer',
    description: '同题重复实例按实例回答次数统计，不是去重人数；不同版本和独立副本不合并',
    answerCount: result.count[0]?.value ?? 0,
    page: p,
    pageSize: 20,
  };
  for (const key of ['distribution', 'rows', 'matrix', 'ranking', 'rankDistribution'])
    if (result[key]) output[key] = result[key];
  if (result.numeric)
    output.numeric = result.numeric[0] ?? { answerCount: 0, average: null, min: null, max: null };
  if (result.distributionTotal) output.distributionTotal = result.distributionTotal[0]?.value ?? 0;
  // Recheck membership before returning a long-running community aggregation.
  if (query.communityId) await member(id(query.communityId), userId);
  return output;
}
export async function questionUsage(
  questionId: string,
  versionId: string,
  userId: string,
  query: any,
) {
  const scope = await visibleSurveyFilter(userId, query.communityId);
  await authorizeReference(questionId, versionId, userId, scope);
  const p = pageNumber(query.page);
  // Apply the selected space before both pagination and counting.
  const authorized = scope;
  const source = { questionId: id(questionId), versionId: id(versionId) };
  const draft = [
    { $match: { ...authorized, status: 'draft' } },
    {
      $project: {
        title: '$draft.title',
        surveyId: { $toString: '$_id' },
        communityId: 1,
        questions: '$draft.questions',
        kind: { $literal: 'draft' },
      },
    },
  ];
  const published = [
    {
      $lookup: {
        from: 'surveys',
        let: { sid: '$surveyId' },
        pipeline: [
          { $match: { ...authorized, $expr: { $eq: [{ $toString: '$_id' }, '$$sid'] } } },
          { $project: { publishedVersionId: 1, communityId: 1 } },
        ],
        as: 'survey',
      },
    },
    { $unwind: '$survey' },
    {
      $project: {
        surveyId: 1,
        title: '$definition.title',
        questions: '$definition.questions',
        communityId: '$survey.communityId',
        surveyVersionId: { $toString: '$_id' },
        kind: {
          $cond: [
            { $eq: [{ $toString: '$_id' }, '$survey.publishedVersionId'] },
            'published',
            'archived',
          ],
        },
      },
    },
  ];
  const result = await Survey.aggregate([
    ...draft,
    { $unionWith: { coll: 'survey_versions', pipeline: published } },
    { $unwind: '$questions' },
    {
      $match: {
        'questions.source.questionId': source.questionId,
        'questions.source.versionId': source.versionId,
      },
    },
    {
      $project: {
        _id: 0,
        surveyId: 1,
        surveyVersionId: 1,
        communityId: 1,
        title: 1,
        kind: 1,
        instanceId: '$questions.id',
      },
    },
    { $sort: { surveyId: 1, kind: 1, instanceId: 1 } },
    { $facet: { rows: [{ $skip: (p - 1) * 20 }, { $limit: 20 }], total: [{ $count: 'value' }] } },
  ]);
  if (query.communityId) await member(id(query.communityId), userId);
  return {
    page: p,
    pageSize: 20,
    total: result[0].total[0]?.value ?? 0,
    rows: result[0].rows,
    visibility: '仅列有权访问的问卷，不返回隐藏引用数量或身份',
  };
}
