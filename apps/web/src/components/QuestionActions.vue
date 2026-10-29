<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue';
import { historyRelation, resolveHistoryNumbers } from '../version-relations';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import { query, date, confirm } from '../phase2';
import QuestionPreview from './QuestionPreview.vue';
import ShareComposer from './ShareComposer.vue';
import PagePager from './PagePager.vue';
const props = withDefaults(
  defineProps<{ questionId: string; primary?: boolean; beforeAction?: () => Promise<boolean> }>(),
  { primary: true },
);
const emit = defineEmits<{ changed: [] }>();
const router = useRouter(),
  busy = ref(false),
  mode = ref(''),
  saved = ref<any>(null),
  chosen = ref<any>(null),
  history = ref<any>({ rows: [], total: 0 }),
  page = ref(1),
  error = ref(''),
  relations = ref<Record<string, number>>({}),
  historyLoading = ref(false);
let historyRequest = 0;
onBeforeUnmount(() => historyRequest++);
async function versions(p = 1) {
  const request = ++historyRequest;
  page.value = p;
  historyLoading.value = true;
  history.value = { rows: [], total: history.value.total };
  relations.value = {};
  try {
    const result = await api(`/questions/${props.questionId}/versions?page=${p}`);
    const numbers = await resolveHistoryNumbers(
      result.rows,
      async (id) =>
        (await api('/questions/' + props.questionId + query({ versionId: id }))).version,
    );
    if (request !== historyRequest) return;
    history.value = result;
    relations.value = numbers;
    error.value = '';
  } catch {
    if (request === historyRequest) error.value = '暂时无法读取历史记录，请重试。';
  } finally {
    if (request === historyRequest) historyLoading.value = false;
  }
}
async function open(action: string) {
  if (busy.value) return;
  if (props.beforeAction && !(await props.beforeAction())) return;
  busy.value = true;
  error.value = '';
  try {
    saved.value = await api('/questions/' + props.questionId);
    chosen.value = saved.value.version;
    if (action === 'history') {
      await versions();
      mode.value = 'history';
    } else if (action === 'preview') mode.value = 'preview';
    else if (action === 'insights')
      await router.push(
        '/question-insights/' +
          props.questionId +
          query({
            versionId: saved.value.version._id,
            communityId: saved.value.question.communityId,
          }),
      );
    else if (action === 'copy') {
      await api(`/questions/${props.questionId}/copy`, 'POST', {
        versionId: saved.value.version._id,
      });
      ElMessage.success('已保存到个人题库');
      emit('changed');
    } else {
      if (saved.value.question.communityId) {
        if (!(await confirm('社区题需先保存到个人题库，再分享或公开。现在保存个人副本并继续？')))
          return;
        saved.value = await api(`/questions/${props.questionId}/copy`, 'POST', {
          versionId: saved.value.version._id,
        });
      }
      if (action === 'public') {
        if (
          !(await confirm(
            '将此题发布到题目广场，其他用户可以查看并保存到自己的题库。之后的修改不会自动更新此公开内容；再次公开将创建新的公开项。',
            '公开题目',
          ))
        )
          return;
        await api(`/questions/${saved.value.question._id}/shares`, 'POST', {
          kind: 'public',
          versionId: saved.value.version._id,
        });
        ElMessage.success('已公开到题目广场');
      } else mode.value = 'share';
    }
  } catch (e: any) {
    ElMessage.error(e.status === 404 ? '题目不存在或已失去访问权限。' : '操作失败，请稍后重试。');
  } finally {
    busy.value = false;
  }
}
async function restore(v: any) {
  if (
    busy.value ||
    !(await confirm(
      '将恢复为这次保存的内容，并留下一条新的历史记录。已有问卷和之前分享的内容不会改变。',
      '恢复题目',
    ))
  )
    return;
  busy.value = true;
  try {
    saved.value = await api(`/questions/${props.questionId}/restore`, 'POST', {
      revision: saved.value.question.revision,
      versionId: v._id,
    });
    chosen.value = saved.value.version;
    await versions();
    emit('changed');
    ElMessage.success('已恢复题目');
  } catch (e: any) {
    error.value =
      e.status === 409
        ? '这道题已被更新，请关闭历史记录后重新打开，再比较内容。'
        : '恢复失败，请稍后重试。';
  } finally {
    busy.value = false;
  }
}
defineExpose({ open });
</script>
<template>
  <div class="question-card-actions">
    <template v-if="primary">
      <el-button :disabled="busy" @click="open('share')">分享</el-button>
      <el-button :disabled="busy" @click="open('public')">公开</el-button>
    </template>
    <el-dropdown trigger="click" @command="open">
      <el-button :disabled="busy">更多 ▾</el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="preview">题目预览</el-dropdown-item>
          <el-dropdown-item command="history">历史记录</el-dropdown-item>
          <el-dropdown-item command="insights">使用情况与统计</el-dropdown-item>
          <el-dropdown-item command="copy">保存个人副本</el-dropdown-item>
          <template v-if="!primary">
            <el-dropdown-item command="share">分享题目</el-dropdown-item>
            <el-dropdown-item command="public">公开题目</el-dropdown-item>
          </template>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
  <el-dialog
    :model-value="!!mode"
    :title="mode === 'history' ? '历史记录' : mode === 'share' ? '分享题目' : '题目预览'"
    width="760px"
    class="question-action-dialog"
    @close="mode = ''"
  >
    <p v-if="error" role="alert" class="phase-error">
      {{ error }}
      <el-button @click="versions(page)">重试</el-button>
    </p>
    <template v-if="mode === 'history'">
      <p>每次保存都留有记录。恢复不会改变已有问卷或之前分享的内容。</p>
      <p v-if="historyLoading">正在读取历史关系…</p>
      <article v-for="v in history.rows" :key="v._id" class="phase-row">
        <div>
          <strong>{{ v.content.title }}</strong>
          <small>{{ date(v.createdAt) }} · 第{{ v.number }}次保存</small>
          <small>{{ historyRelation(v, relations) }}</small>
          <small v-if="v._id === saved?.question.latestVersionId">当前最新内容</small>
          <small v-if="v._id === chosen?._id">正在查看这次内容</small>
          <small>{{ v.content.description || '查看这次保存的题目内容' }}</small>
        </div>
        <div class="phase-actions">
          <el-button @click="chosen = v">查看</el-button>
          <el-button :disabled="busy" @click="restore(v)">恢复</el-button>
        </div>
      </article>
      <PagePager :total="history.total" :page="page" @change="versions" />
      <p v-if="chosen">
        所选历史内容 · 第{{ chosen.number }}次保存
        <span v-if="chosen._id === saved?.question.latestVersionId">· 当前最新</span>
      </p>
      <QuestionPreview v-if="chosen" :content="chosen.content" />
      <router-link
        v-if="chosen && saved"
        :to="
          '/question-insights/' +
          props.questionId +
          query({ versionId: chosen._id, communityId: saved.question.communityId })
        "
      >
        这次保存内容的使用情况与统计 ↗
      </router-link>
    </template>
    <QuestionPreview v-else-if="mode === 'preview' && chosen" :content="chosen.content" />
    <ShareComposer
      v-else-if="mode === 'share' && saved"
      :key="saved.version._id"
      :question-id="saved.question._id"
      :version-id="saved.version._id"
    />
  </el-dialog>
</template>
