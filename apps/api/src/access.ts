import mongoose, { ClientSession } from 'mongoose';
import { Survey } from './database';
import { Community, Membership } from './phase2-models';
import { DomainError, fail } from './domain';
export const notFound = (): never => {
  throw new DomainError('NOT_FOUND', '资源不存在或无权访问', 404);
};
export const conflict = (): never => {
  throw new DomainError('CONFLICT', '版本已变化，请保留输入并重新读取比较', 409);
};
export function id(value: any): string {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/.test(value)) return notFound();
  return value.toLowerCase();
}
export function revision(value: any): number {
  if (!Number.isInteger(value) || value < 0) fail('REVISION', '必须提供非负整数revision');
  return value;
}
export function pageNumber(value: any): number {
  const n = Number(value ?? 1);
  if (!Number.isInteger(n) || n < 1 || n > 100000) fail('PAGE', 'page须为1～100000整数');
  return n;
}
export async function transaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    return (await session.withTransaction(() => work(session)))!;
  } finally {
    await session.endSession();
  }
}
export async function member(
  communityId: string,
  userId: string,
  session?: ClientSession,
  write = false,
) {
  communityId = id(communityId);
  const c = await Community.findById(communityId)
    .session(session ?? null)
    .lean();
  const m = await Membership.findOne({ communityId, userId, active: true })
    .session(session ?? null)
    .lean();
  if (!c || !m) return notFound();
  if (write) {
    if (!session) throw new Error('community writes require transaction');
    // Every membership-dependent write and every departure touches the same fence document.
    await Community.updateOne({ _id: c._id }, { $inc: { writeSerial: 1 } }, { session });
  }
  return { community: c, membership: m };
}
export async function surveyAccess(
  surveyId: string,
  userId: string,
  mode: 'manage' | 'statistics' = 'manage',
  session?: ClientSession,
  write = false,
) {
  const s = await Survey.findOne({ _id: id(surveyId), deletedAt: null })
    .session(session ?? null)
    .lean();
  if (!s) return notFound();
  if (s.communityId) {
    const access = await member(s.communityId, userId, session, write);
    if (mode === 'manage' && s.ownerId !== userId && access.community.adminId !== userId)
      return notFound();
  } else if (s.ownerId !== userId) return notFound();
  return s;
}
export async function visibleSurveyFilter(userId: string, communityId?: string) {
  if (communityId) {
    await member(communityId, userId);
    return { communityId: id(communityId), deletedAt: null };
  }
  return { ownerId: userId, communityId: null, deletedAt: null };
}
