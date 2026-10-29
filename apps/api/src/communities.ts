import mongoose from 'mongoose';
import { User, Survey } from './database';
import { Community, Membership, Invitation, LibraryQuestion } from './phase2-models';
import { id, member, transaction, revision, conflict, notFound, pageNumber } from './access';
import { fail } from './domain';
export async function lookupUser(userId: string) {
  const u = await User.findById(id(userId)).select({ username: 1 }).lean();
  if (!u) return notFound();
  return { id: String(u._id), username: u.username };
}
/** Match the same lowercase key used by register/login; never enumerate users. */
export async function lookupUsername(username: any) {
  if (typeof username !== 'string' || !/^[\p{L}\p{N}_-]{3,24}$/u.test(username))
    fail('USERNAME', '用户名需 3～24 位中文、字母、数字、下划线或短横线');
  const u = await User.findOne({ usernameNormalized: username.toLowerCase() })
    .select({ username: 1 })
    .lean();
  if (!u) return notFound();
  return { id: String(u._id), username: u.username };
}
export async function communityOverview(communityId: string, userId: string) {
  const { community, membership } = await member(communityId, userId);
  communityId = String(community._id);
  const [memberCount, questionCount, surveyCount] = await Promise.all([
    Membership.countDocuments({ communityId, active: true }),
    LibraryQuestion.countDocuments({ communityId }),
    Survey.countDocuments({ communityId, deletedAt: null }),
  ]);
  await member(communityId, userId);
  return {
    id: communityId,
    name: community.name,
    role: membership.role,
    memberCount,
    questionCount,
    surveyCount,
    permissions: {
      viewLibrary: true,
      viewSurveys: true,
      viewMembers: true,
      manageMembers: membership.role === 'admin',
    },
    endpoints: {
      library: '/api/questions?communityId=' + communityId,
      surveys: '/api/surveys?communityId=' + communityId,
      members: '/api/communities/' + communityId + '/members',
    },
  };
}
export async function pendingInvitations(userId: string) {
  return {
    pendingCount: await Invitation.countDocuments({ recipientId: userId, status: 'pending' }),
  };
}
export async function createCommunity(userId: string, name: any) {
  if (typeof name !== 'string' || !name.trim() || name.length > 120)
    fail('NAME', '社区名须1～120字');
  return transaction(async (session) => {
    const [c] = await Community.create([{ name: name.trim(), adminId: userId }], { session });
    await Membership.create([{ communityId: String(c._id), userId, role: 'admin', active: true }], {
      session,
    });
    return c;
  });
}
export async function listCommunities(userId: string, page: any) {
  const p = pageNumber(page);
  const memberships = await Membership.find({ userId, active: true })
    .sort({ createdAt: -1, _id: -1 })
    .skip((p - 1) * 20)
    .limit(20)
    .lean();
  const communities = await Community.find({
    _id: { $in: memberships.map((m) => m.communityId) },
  }).lean();
  return {
    page: p,
    pageSize: 20,
    total: await Membership.countDocuments({ userId, active: true }),
    rows: communities,
  };
}
export async function members(communityId: string, userId: string, page: any) {
  await member(communityId, userId);
  const p = pageNumber(page);
  const match = { communityId: id(communityId), active: true };
  const rows = await Membership.aggregate([
    { $match: match },
    { $sort: { createdAt: 1, _id: 1 } },
    { $skip: (p - 1) * 20 },
    { $limit: 20 },
    {
      $lookup: {
        from: 'users',
        let: { uid: '$userId' },
        pipeline: [
          { $match: { $expr: { $eq: [{ $toString: '$_id' }, '$$uid'] } } },
          { $project: { username: 1 } },
        ],
        as: 'user',
      },
    },
    { $project: { userId: 1, role: 1, username: { $arrayElemAt: ['$user.username', 0] } } },
  ]);
  return { page: p, pageSize: 20, total: await Membership.countDocuments(match), rows };
}
export async function invite(communityId: string, userId: string, recipientId: any) {
  await lookupUser(recipientId);
  recipientId = id(recipientId);
  return transaction(async (session) => {
    const { community } = await member(communityId, userId, session, true);
    if (community.adminId !== userId) return notFound();
    if (
      await Membership.exists({ communityId, userId: recipientId, active: true }).session(session)
    )
      fail('MEMBER_EXISTS', '对方已是成员');
    const old = await Invitation.findOne({ communityId, recipientId }).session(session).lean();
    if (old?.status === 'pending') return old;
    return Invitation.findOneAndUpdate(
      { communityId, recipientId },
      {
        $set: { senderId: userId, status: 'pending' },
        $inc: { revision: 1 },
        $setOnInsert: { communityId, recipientId },
      },
      { upsert: true, new: true, session },
    ).lean();
  });
}
export async function invitationList(userId: string, page: any) {
  const p = pageNumber(page),
    match = { recipientId: userId };
  const rows = await Invitation.find(match)
    .sort({ createdAt: -1, _id: -1 })
    .skip((p - 1) * 20)
    .limit(20)
    .lean();
  const [communities, inviters, total, pending] = await Promise.all([
    Community.find({ _id: { $in: rows.map((r) => r.communityId) } })
      .select({ name: 1 })
      .lean(),
    User.find({ _id: { $in: rows.map((r) => r.senderId) } })
      .select({ username: 1 })
      .lean(),
    Invitation.countDocuments(match),
    pendingInvitations(userId),
  ]);
  const communityMap = new Map(
    communities.map((c) => [String(c._id), { id: String(c._id), name: c.name }]),
  );
  const inviterMap = new Map(
    inviters.map((u) => [String(u._id), { id: String(u._id), username: u.username }]),
  );
  return {
    page: p,
    pageSize: 20,
    total,
    pendingCount: pending.pendingCount,
    rows: rows.map((row) => ({
      ...row,
      community: communityMap.get(row.communityId) ?? null,
      inviter: inviterMap.get(row.senderId) ?? null,
    })),
  };
}
export async function respondInvitation(
  invitationId: string,
  userId: string,
  action: 'accept' | 'reject',
  expected: any,
) {
  revision(expected);
  return transaction(async (session) => {
    const invitation = await Invitation.findOne({ _id: id(invitationId), recipientId: userId })
      .session(session)
      .lean();
    if (!invitation) return notFound();
    if (invitation.revision !== expected) return conflict();
    const target = action === 'accept' ? 'accepted' : 'rejected';
    if (invitation.status === target) return invitation;
    if (invitation.status !== 'pending') return conflict();
    // Serialize acceptance with removal, invite, exit, and all community writes.
    const community = await Community.findOneAndUpdate(
      { _id: invitation.communityId },
      { $inc: { writeSerial: 1 } },
      { session, new: true },
    ).lean();
    if (!community) return notFound();
    if (
      !(await Membership.exists({
        communityId: invitation.communityId,
        userId: community.adminId,
        active: true,
      }).session(session))
    )
      return notFound();
    if (action === 'accept')
      await Membership.findOneAndUpdate(
        { communityId: invitation.communityId, userId },
        { $set: { active: true, role: 'member' } },
        { upsert: true, session },
      );
    return Invitation.findOneAndUpdate(
      { _id: invitation._id, status: 'pending', revision: expected },
      { $set: { status: target } },
      { new: true, session },
    ).lean();
  });
}
export async function leave(communityId: string, userId: string, targetId?: string) {
  return transaction(async (session) => {
    const { community } = await member(communityId, userId, session, true);
    const target = targetId ? id(targetId) : userId;
    if (targetId && community.adminId !== userId) return notFound();
    if (target === community.adminId)
      fail('ADMIN_REQUIRED', '创建者不能退出或移除自己，当前版本不支持管理员转让');
    const result = await Membership.updateOne(
      { communityId, userId: target, active: true },
      { $set: { active: false } },
      { session },
    );
    if (!result.matchedCount) return notFound();
    // A pending invite must not allow an immediately removed member to rejoin.
    await Invitation.updateOne(
      { communityId, recipientId: target, status: 'pending' },
      { $set: { status: 'rejected' }, $inc: { revision: 1 } },
      { session },
    );
    return { ok: true };
  });
}
