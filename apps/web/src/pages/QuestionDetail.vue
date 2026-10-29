<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, labels } from '../api';
import {
  asQuestion,
  blankQuestion,
  contentOf,
  confirm,
  query,
  protectDraft,
  singleDefinition,
} from '../phase2';
import QuestionOrigin from '../components/QuestionOrigin.vue';
import QuestionEditor from '../components/QuestionEditor.vue';
import QuestionPreview from '../components/QuestionPreview.vue';
import QuestionActions from '../components/QuestionActions.vue';
const route = useRoute(),
  router = useRouter(),
  fresh = computed(() => route.params.id === 'new');
const detail = ref<any>(null),
  q = ref(blankQuestion()),
  base = ref(''),
  busy = ref(false),
  uncertain = ref(false),
  loading = ref(false),
  error = ref(''),
  server = ref<any>(null);
const dirty = computed(() => JSON.stringify(contentOf(q.value)) !== base.value);
protectDraft(dirty);
const back = computed(() => {
  const supplied = String(route.query.returnTo || '');
  return supplied.split('?')[0] === '/library' || /^\/communities\/[^/?]+$/.test(supplied)
    ? supplied
    : '/library' +
        query({ communityId: detail.value?.question.communityId || route.query.communityId });
});
const scope = () => detail.value?.question.communityId || String(route.query.communityId || '');
function apply(r: any) {
  detail.value = r;
  q.value = asQuestion(r.version.content);
  base.value = JSON.stringify(contentOf(q.value));
  server.value = null;
}
function message(e: any) {
  if (!e.status)
    return '连接中断，暂时无法确认保存结果。请先回题库检查，避免重复创建。当前输入已保留。';
  return e.status === 404
    ? '题目不存在或你已失去访问权限。'
    : e.status === 409
      ? '这道题已被更新，请比较后再保存。'
      : /revision|ObjectId|INTERNAL|schema/i.test(e.message || '')
        ? '操作未完成，请检查内容或稍后重试。'
        : e.message || '操作失败，请重试。';
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    if (fresh.value) base.value = JSON.stringify(contentOf(q.value));
    else apply(await api('/questions/' + route.params.id));
  } catch (e: any) {
    error.value = message(e);
    detail.value = null;
  } finally {
    loading.value = false;
  }
}
async function save(stay = false, saveAs = false) {
  if (busy.value || (uncertain.value && (fresh.value || saveAs)) || (!fresh.value && !detail.value))
    return false;
  busy.value = true;
  error.value = '';
  try {
    const content = contentOf(q.value),
      communityId = scope();
    const result = await api(
      fresh.value ? '/questions' : `/questions/${route.params.id}${saveAs ? '/save-as' : ''}`,
      fresh.value || saveAs ? 'POST' : 'PUT',
      fresh.value
        ? { content, ...(communityId ? { communityId } : {}) }
        : saveAs
          ? {
              versionId: detail.value.version._id,
              content,
              ...(communityId ? { communityId } : {}),
            }
          : { revision: detail.value.question.revision, content },
    );
    if (!saveAs) apply(result);
    else base.value = JSON.stringify(contentOf(q.value));
    ElMessage.success(saveAs ? '已另存为新题目' : fresh.value ? '题目已保存' : '修改已保存');
    if (!stay) await router.push(back.value);
    return true;
  } catch (e: any) {
    error.value = message(e);
    if (!e.status && (fresh.value || saveAs)) uncertain.value = true;
    if (e.status === 409 && !saveAs) {
      try {
        server.value = await api('/questions/' + route.params.id);
      } catch {
        error.value = '这道题已被更新，但暂时无法读取最新内容。你的输入已保留。';
      }
    }
    return false;
  } finally {
    busy.value = false;
  }
}
async function ready() {
  if (!dirty.value) return true;
  try {
    await ElMessageBox.confirm('你有未保存的修改。先保存后再继续，或取消本次操作。', '先保存修改', {
      confirmButtonText: '保存并继续',
      cancelButtonText: '取消',
    });
    return await save(true);
  } catch {
    return false;
  }
}
async function changeType(type: any) {
  const current = contentOf(q.value);
  const empty = contentOf(blankQuestion(q.value.type));
  // Generated row/option IDs are not user input.
  const normalize = (value: any) =>
    JSON.stringify({
      ...value,
      options: value.options.map((o: any) => o.label),
      rows: value.rows.map((r: any) => r.label),
    });
  const hasInput = normalize(current) !== normalize(empty);
  if (!hasInput || (await confirm('更换题型会重置当前未保存的内容，是否继续？')))
    q.value = blankQuestion(type);
}
onMounted(load);
</script>
<template>
  <div class="phase-page" v-loading="loading">
    <header class="phase-heading">
      <div>
        <router-link :to="back">← 返回题库</router-link>
        <h1>{{ fresh ? '新建题目' : '编辑题目' }}</h1>
        <p>保存修改会为原题新增历史记录；另存会创建独立题目并保留来源。已有问卷和历史均不改变。</p>
      </div>
      <div class="phase-actions">
        <el-button
          v-if="!fresh"
          :disabled="busy || !detail || uncertain"
          @click="save(false, true)"
        >
          另存为新题目
        </el-button>
        <el-button
          type="primary"
          :loading="busy"
          :disabled="(!fresh && !detail) || (fresh && uncertain)"
          @click="save(false)"
        >
          {{ fresh ? '保存题目' : '保存修改' }}
        </el-button>
        <QuestionActions
          v-if="detail"
          :question-id="detail.question._id"
          :primary="false"
          :before-action="ready"
          @changed="load"
        />
      </div>
    </header>
    <p v-if="error" class="phase-error" role="alert">
      {{ error }}
      <el-button v-if="!detail && !fresh" @click="load">重新读取</el-button>
    </p>
    <template v-if="fresh || detail">
      <div class="phase-filters">
        <label>
          题型
          <el-select :model-value="q.type" @change="changeType">
            <el-option v-for="(label, key) in labels" :key="key" :label="label" :value="key" />
          </el-select>
        </label>
        <span v-if="dirty">有未保存的修改</span>
        <QuestionOrigin
          v-if="detail?.question.provenance"
          :provenance="detail.question.provenance"
        />
      </div>
      <div class="continuous-editor phase-question-form">
        <QuestionEditor
          :key="q.id"
          :question="q"
          :index="0"
          :definition="singleDefinition(q)"
          :locked="busy"
          content-only
        />
      </div>
      <section v-if="server" class="panel phase-box">
        <h2>这道题已被更新，请比较后再保存</h2>
        <p>你的输入已保留。左侧为当前输入，右侧为最近保存的内容。</p>
        <div class="phase-comparison">
          <QuestionPreview :content="contentOf(q)" />
          <QuestionPreview :content="server.version.content" />
        </div>
        <el-button
          :disabled="busy"
          @click="
            detail = server;
            server = null;
            error = '';
          "
        >
          保留我的输入，继续编辑
        </el-button>
      </section>
    </template>
  </div>
</template>
