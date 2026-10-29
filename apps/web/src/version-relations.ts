export type HistoryRecord = {
  _id: string;
  number: number;
  parentVersionId?: string;
  restoredFromVersionId?: string;
};
export function historyRelation(v: HistoryRecord, numbers: Record<string, number>): string {
  if (v.restoredFromVersionId)
    return numbers[v.restoredFromVersionId]
      ? `恢复第${numbers[v.restoredFromVersionId]}次保存的内容，形成新的记录`
      : '恢复了一次历史内容，来源记录暂不可读取';
  if (v.parentVersionId)
    return numbers[v.parentVersionId]
      ? `在第${numbers[v.parentVersionId]}次保存的内容上修改`
      : '在已有保存内容上修改，关联记录暂不可读取';
  return v.number === 1 ? '首次创建' : '此记录缺少修改关系，暂无法确认来源';
}
export async function resolveHistoryNumbers(
  rows: HistoryRecord[],
  read: (id: string) => Promise<HistoryRecord>,
): Promise<Record<string, number>> {
  const numbers: Record<string, number> = Object.fromEntries(rows.map((v) => [v._id, v.number]));
  const missing = [
    ...new Set(
      rows
        .flatMap((v) => [v.parentVersionId, v.restoredFromVersionId])
        .filter((id): id is string => !!id && !numbers[id]),
    ),
  ];
  await Promise.all(
    missing.map(async (id) => {
      try {
        const v = await read(id);
        if (String(v._id) === id) numbers[id] = v.number;
      } catch {
        /* Keep unresolved relations explicit. */
      }
    }),
  );
  return numbers;
}
