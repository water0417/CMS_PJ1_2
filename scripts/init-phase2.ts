import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDatabase } from '../apps/api/src/database';
async function main() {
  await connectDatabase(
    process.env.MONGODB_URI ??
      'mongodb://127.0.0.1:27018/survey_studio?replicaSet=rs0&directConnection=true',
  );
  console.log('第二阶段集合、索引及验证器已就绪；未重写题目、快照、答卷或来源。');
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
