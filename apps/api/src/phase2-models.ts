import mongoose, { Schema } from 'mongoose';
const options = { timestamps: true, versionKey: false, minimize: false } as const;
const str = { type: String, required: true };
interface RecordDocument {
  _id: mongoose.Types.ObjectId;
  [key: string]: any;
}
function model(name: string, fields: any, indexes: Array<[any, any?]>) {
  const schema = new Schema<RecordDocument>(fields, options);
  indexes.forEach(([keys, opts]) => schema.index(keys, opts));
  return mongoose.model<RecordDocument>(name, schema, name);
}
export const LibraryQuestion = model(
  'library_questions',
  {
    scopeKey: str,
    ownerId: String,
    communityId: String,
    createdBy: str,
    latestVersionId: str,
    revision: { type: Number, required: true },
    title: str,
    type: str,
    provenance: Schema.Types.Mixed,
    dataVersion: { type: Number, default: 1, required: true },
  },
  [[{ scopeKey: 1, updatedAt: -1 }], [{ scopeKey: 1, title: 1 }], [{ communityId: 1 }]],
);
export const QuestionVersion = model(
  'question_versions',
  {
    questionId: str,
    number: { type: Number, required: true },
    parentVersionId: String,
    restoredFromVersionId: String,
    authorId: str,
    content: { type: Schema.Types.Mixed, required: true },
    contentSchemaVersion: { type: Number, default: 1, required: true },
  },
  [[{ questionId: 1, number: 1 }, { unique: true }], [{ authorId: 1, createdAt: -1 }]],
);
export const Community = model(
  'communities',
  {
    name: str,
    adminId: str,
    revision: { type: Number, default: 0, required: true },
    writeSerial: { type: Number, default: 0, required: true },
  },
  [[{ adminId: 1, createdAt: -1 }]],
);
export const Membership = model(
  'community_memberships',
  {
    communityId: str,
    userId: str,
    role: { type: String, enum: ['admin', 'member'], required: true },
    active: { type: Boolean, required: true },
  },
  [[{ communityId: 1, userId: 1 }, { unique: true }], [{ userId: 1, active: 1, communityId: 1 }]],
);
export const Invitation = model(
  'community_invitations',
  {
    communityId: str,
    senderId: str,
    recipientId: str,
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], required: true },
    revision: { type: Number, required: true },
  },
  [
    [{ communityId: 1, recipientId: 1 }, { unique: true }],
    [{ recipientId: 1, status: 1, createdAt: -1 }],
  ],
);
export const QuestionShare = model(
  'question_shares',
  {
    kind: { type: String, enum: ['delivery', 'link', 'public'], required: true },
    questionId: str,
    versionId: str,
    senderId: str,
    recipientId: String,
    token: String,
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'active', 'revoked'],
      required: true,
    },
    writeSerial: { type: Number, default: 0, required: true },
  },
  [
    [{ token: 1 }, { unique: true, sparse: true }],
    [{ recipientId: 1, status: 1, createdAt: -1 }],
    [{ kind: 1, status: 1, createdAt: -1 }],
    [{ senderId: 1, kind: 1, createdAt: -1 }],
    [{ senderId: 1, createdAt: -1, _id: -1 }],
  ],
);
export const ShareCopy = model(
  'question_share_copies',
  {
    shareId: str,
    userId: str,
    questionId: str,
    versionId: str,
    initialQuestion: { type: Schema.Types.Mixed, required: true },
  },
  [[{ shareId: 1, userId: 1 }, { unique: true }]],
);

// MongoDB validators complement domain validation, including writes bypassing Mongoose.
const shapes: Record<string, any> = {
  library_questions: {
    required: [
      'scopeKey',
      'createdBy',
      'latestVersionId',
      'revision',
      'title',
      'type',
      'dataVersion',
    ],
    oneOf: [
      { required: ['ownerId'], not: { required: ['communityId'] } },
      { required: ['communityId'], not: { required: ['ownerId'] } },
    ],
    properties: {
      scopeKey: { bsonType: 'string' },
      ownerId: { bsonType: 'string' },
      communityId: { bsonType: 'string' },
      createdBy: { bsonType: 'string' },
      latestVersionId: { bsonType: 'string' },
      revision: { bsonType: 'number', minimum: 1 },
      dataVersion: { enum: [1] },
      type: {
        enum: [
          'single_choice',
          'multiple_choice',
          'text',
          'number',
          'matrix',
          'ranking',
          'time',
          'slider',
          'color',
        ],
      },
    },
  },
  question_versions: {
    required: ['questionId', 'number', 'authorId', 'content', 'contentSchemaVersion'],
    properties: {
      questionId: { bsonType: 'string' },
      number: { bsonType: 'number', minimum: 1 },
      authorId: { bsonType: 'string' },
      content: {
        bsonType: 'object',
        required: ['type', 'title', 'description', 'required', 'options', 'rows', 'validation'],
        additionalProperties: false,
        properties: {
          type: { bsonType: 'string' },
          title: { bsonType: 'string' },
          description: { bsonType: 'string' },
          required: { bsonType: 'bool' },
          options: { bsonType: 'array' },
          rows: { bsonType: 'array' },
          validation: { bsonType: 'object' },
        },
      },
      contentSchemaVersion: { enum: [1] },
    },
  },
  communities: {
    required: ['name', 'adminId', 'revision', 'writeSerial'],
    properties: {
      name: { bsonType: 'string' },
      adminId: { bsonType: 'string' },
      revision: { bsonType: 'number', minimum: 0 },
      writeSerial: { bsonType: 'number', minimum: 0 },
    },
  },
  community_memberships: {
    required: ['communityId', 'userId', 'role', 'active'],
    properties: {
      communityId: { bsonType: 'string' },
      userId: { bsonType: 'string' },
      role: { enum: ['admin', 'member'] },
      active: { bsonType: 'bool' },
    },
  },
  community_invitations: {
    required: ['communityId', 'senderId', 'recipientId', 'status', 'revision'],
    properties: {
      communityId: { bsonType: 'string' },
      senderId: { bsonType: 'string' },
      recipientId: { bsonType: 'string' },
      status: { enum: ['pending', 'accepted', 'rejected'] },
      revision: { bsonType: 'number', minimum: 0 },
    },
  },
  question_shares: {
    required: ['questionId', 'versionId', 'senderId', 'kind', 'status', 'writeSerial'],
    properties: {
      questionId: { bsonType: 'string' },
      versionId: { bsonType: 'string' },
      senderId: { bsonType: 'string' },
      kind: { enum: ['delivery', 'link', 'public'] },
      status: { enum: ['pending', 'accepted', 'rejected', 'active', 'revoked'] },
      writeSerial: { bsonType: 'number', minimum: 0 },
    },
  },
  question_share_copies: {
    required: ['shareId', 'userId', 'questionId', 'versionId', 'initialQuestion'],
    properties: {
      shareId: { bsonType: 'string' },
      userId: { bsonType: 'string' },
      questionId: { bsonType: 'string' },
      versionId: { bsonType: 'string' },
      initialQuestion: { bsonType: 'object' },
    },
  },
};
export async function initPhase2Models() {
  await Promise.all(
    [
      LibraryQuestion,
      QuestionVersion,
      Community,
      Membership,
      Invitation,
      QuestionShare,
      ShareCopy,
    ].map((m) => m.init()),
  );
  for (const [name, shape] of Object.entries(shapes))
    await mongoose.connection.db!.command({
      collMod: name,
      validator: { $jsonSchema: { bsonType: 'object', ...shape } },
      validationLevel: 'strict',
      validationAction: 'error',
    });
  await mongoose.connection
    .db!.collection('surveys')
    .createIndex({ communityId: 1, deletedAt: 1, createdAt: -1 });
  await mongoose.connection
    .db!.collection('surveys')
    .createIndex({ 'draft.questions.source.questionId': 1, 'draft.questions.source.versionId': 1 });
  await mongoose.connection.db!.collection('survey_versions').createIndex({
    'definition.questions.source.questionId': 1,
    'definition.questions.source.versionId': 1,
  });
}
