<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import { allCommunities, query, confirm, contentOf } from '../phase2';
import LibraryVersionPicker from './LibraryVersionPicker.vue';
import QuestionPreview from './QuestionPreview.vue';
const props = defineProps<{
  survey: any;
  ensureReady: () => Promise<boolean>;
  applySurvey: (survey: any) => Promise<void>;
}>();
const open = ref(false),
  mode = ref('pick'),
  busy = ref(false),
  scope = ref(''),
  communities = ref<any[]>([]),
  search = ref(''),
  selected = ref<any>(null),
  version = ref<any>(null),
  updates = ref<any>(null),
  instance = ref<any>(null),
  error = ref('');
async function launch(next: string, q?: any) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    if (!(await props.ensureReady())) return;
    mode.value = next;
    if (next !== 'pick' && scope.value === 'public') scope.value = '';
    communities.value = await allCommunities();
    selected.value = null;
    version.value = null;
    instance.value = q ? props.survey.draft.questions.find((item: any) => item.id === q.id) : null;
    if (next === 'updates')
      updates.value = await api(`/surveys/${props.survey._id}/question-upgrades`);
    open.value = true;
  } catch (e: any) {
    error.value = e.message;
    ElMessage.error(e.message);
  } finally {
    busy.value = false;
  }
}
async function attach(question: any, saved: any, share?: any) {
  if (!saved || busy.value) return;
  error.value = '';
  busy.value = true;
  try {
    if (!(await props.ensureReady())) return;
    if (share) {
      const copy = await api(`/shares/${share._id}/accept`, 'POST', {});
      question = copy.question;
      saved = copy.version;
    }
    const result = await api(`/surveys/${props.survey._id}/library-instances`, 'POST', {
      revision: props.survey.revision,
      questionId: question._id,
      versionId: saved._id,
    });
    await props.applySurvey(result.survey);
    open.value = false;
    ElMessage.success('题目已加入问卷');
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function saveLibrary() {
  if (busy.value) return;
  busy.value = true;
  try {
    if (!(await props.ensureReady())) return;
    const r = await api(
      `/surveys/${props.survey._id}/questions/${instance.value.id}/save-to-library`,
      'POST',
      { revision: props.survey.revision, ...(scope.value ? { communityId: scope.value } : {}) },
    );
    ElMessage.success('已保存到题库，不会改变当前问卷内容');
    open.value = false;
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function detach(q: any) {
  if (
    busy.value ||
    !(await confirm('脱离后可在本问卷独立编辑，不再跟随题库更新；跳转设置保持不变。'))
  )
    return;
  busy.value = true;
  try {
    if (!(await props.ensureReady())) return;
    const r = await api(`/surveys/${props.survey._id}/instances/${q.id}/detach`, 'POST', {
      revision: props.survey.revision,
    });
    await props.applySurvey(r.survey);
    ElMessage.success('已脱离，可本地编辑');
  } catch (e: any) {
    ElMessage.error(e.message);
  } finally {
    busy.value = false;
  }
}
async function inspect(row: any) {
  if (busy.value) return;
  busy.value = true;
  try {
    const r = await api(
      `/questions/${row.source.questionId}` + query({ versionId: row.latestVersionId }),
    );
    instance.value = props.survey.draft.questions.find((q: any) => q.id === row.instanceId);
    selected.value = row;
    version.value = r.version;
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function upgrade() {
  const row = selected.value;
  if (
    !row?.canUpgrade ||
    busy.value ||
    !(await confirm('将替换为预览中的题目内容，保留本问卷跳转设置。已发布问卷不会改变。'))
  )
    return;
  busy.value = true;
  try {
    if (!(await props.ensureReady())) return;
    const r = await api(
      `/surveys/${props.survey._id}/instances/${row.instanceId}/upgrade`,
      'POST',
      { revision: props.survey.revision, versionId: row.latestVersionId },
    );
    await props.applySurvey(r.survey);
    updates.value = await api(`/surveys/${props.survey._id}/question-upgrades`);
    selected.value = null;
    version.value = null;
    ElMessage.success('实例已升级');
  } catch (e: any) {
    error.value = e.message + '；请修正规则并保存后重新检查更新。';
  } finally {
    busy.value = false;
  }
}
defineExpose({ launch, detach });
</script>
<template>
  <div class="survey-library-tools">
    <el-button v-if="survey.status === 'draft'" :disabled="busy" @click="launch('pick')">
      从题库选题
    </el-button>
    <el-button v-if="survey.status === 'draft'" :disabled="busy" @click="launch('updates')">
      检查题库更新
    </el-button>
    <span v-if="error && !open" role="alert">{{ error }}</span>
    <el-dialog
      v-model="open"
      :title="{ pick: '从题库选题', save: '保存问卷题目到题库', updates: '检查更新与差异' }[mode]"
      width="920px"
      :close-on-click-modal="false"
    >
      <p v-if="error" class="phase-error">{{ error }}</p>
      <template v-if="mode !== 'updates'">
        <div class="phase-filters">
          <label>
            题库空间
            <el-select :empty-values="[null, undefined]" v-model="scope">
              <el-option label="个人题库" value="" />
              <el-option v-if="mode === 'pick'" label="公开题库" value="public" />
              <el-option v-for="c in communities" :key="c._id" :value="c._id" :label="c.name" />
            </el-select>
          </label>
          <label v-if="mode === 'pick'">
            搜索题目
            <el-input v-model="search" placeholder="搜索全部题库" />
          </label>
        </div>
        <template v-if="mode === 'pick'">
          <LibraryVersionPicker
            v-if="open"
            :scope="scope"
            :search="search"
            :busy="busy"
            @choose="attach"
          />
        </template>
        <template v-else>
          <QuestionPreview v-if="instance" :content="contentOf(instance)" />
          <el-button type="primary" :loading="busy" @click="saveLibrary">保存到题库</el-button>
        </template>
      </template>
      <template v-else>
        <article v-for="row in updates?.rows || []" :key="row.instanceId" class="phase-row">
          <div>
            <strong>
              {{ survey.draft.questions.find((q: any) => q.id === row.instanceId)?.title }}
            </strong>
            <small>
              {{
                row.accessible === false
                  ? '无法访问原题库，问卷中的题目仍可使用'
                  : row.hasUpdate
                    ? '有可用更新'
                    : '内容已是最新'
              }}
            </small>
            <p v-if="row.error">
              {{ row.error.code }}：{{ row.error.message }}。请修正规则并保存后重试。
            </p>
            <small v-if="row.options">
              选项：新增{{ row.options?.added?.length || 0 }}项，移除{{
                row.options?.removed?.length || 0
              }}项，修改{{ row.options?.changed?.length || 0 }}项；矩阵行：新增{{
                row.rows?.added?.length || 0
              }}行，移除{{ row.rows?.removed?.length || 0 }}行，修改{{
                row.rows?.changed?.length || 0
              }}行
            </small>
          </div>
          <el-button v-if="row.hasUpdate" :disabled="busy" @click="inspect(row)">
            预览差异
          </el-button>
        </article>
        <p v-if="!updates?.rows.length">当前没有题库引用。</p>
        <template v-if="version && selected">
          <div class="phase-comparison">
            <QuestionPreview :content="contentOf(instance)" />
            <QuestionPreview :content="version.content" />
          </div>
          <p>左为问卷中的内容，右为新的保存内容。标题、说明和填写要求也会一起更新。</p>

          <el-button type="primary" :disabled="!selected.canUpgrade || busy" @click="upgrade">
            确认更新题目
          </el-button>
        </template>
      </template>
    </el-dialog>
  </div>
</template>
