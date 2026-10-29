<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, auth, labels, typeMarks, uid } from '../api';
import { protectDraft, clone, allCommunities, confirm } from '../phase2';
import SurveyLibrary from '../components/SurveyLibrary.vue';
import QuestionEditor from '../components/QuestionEditor.vue';
import { previewRouting, type Routing } from '../routing';
import type { Definition, QuestionType } from '../../../api/src/domain';
const route = useRoute(),
  router = useRouter();
const survey = ref<any>(null),
  definition = ref<Definition | null>(null),
  selected = ref(0),
  busy = ref(false),
  loadError = ref(''),
  deadline = ref('');
const locked = computed(() => survey.value?.status !== 'draft');
const serverRouting = ref<Routing | null>(null);
const savedDefinition = ref('');
const dirty = computed(() => JSON.stringify(definition.value) !== savedDefinition.value);
protectDraft(dirty);
const libraryTools = ref<InstanceType<typeof SurveyLibrary> | null>(null),
  unsavedOpen = ref(false),
  serverConflict = ref<any>(null);
let settleUnsaved: ((value: boolean) => void) | null = null;
async function ensureReady() {
  if (!dirty.value) return true;
  unsavedOpen.value = true;
  return new Promise<boolean>((resolve) => (settleUnsaved = resolve));
}
async function resolveUnsaved(action: string) {
  let ready = false;
  if (action === 'save') ready = await save();
  else if (action === 'discard') {
    await load();
    ready = !loadError.value;
  }
  unsavedOpen.value = false;
  settleUnsaved?.(ready);
  settleUnsaved = null;
}
async function applySurvey(result: any) {
  survey.value = result;
  definition.value = clone(result.draft);
  savedDefinition.value = JSON.stringify(definition.value);
  serverConflict.value = null;
  await refreshRouting();
}
const routing = computed(() =>
  definition.value
    ? !dirty.value && serverRouting.value
      ? serverRouting.value
      : previewRouting(definition.value)
    : null,
);
const routingById = computed(() => new Map(routing.value?.questions.map((q) => [q.questionId, q])));
async function refreshRouting() {
  serverRouting.value = await api('/surveys/' + route.params.id + '/routing');
}
const settingsOpen = ref(false),
  canvas = ref<HTMLElement | null>(null),
  outline = ref<HTMLElement | null>(null);
const questionElements = new Map<string, HTMLElement>();
let scrollFrame = 0;
watch(selected, async () => {
  await nextTick();
  const list = outline.value;
  const item = list?.querySelector<HTMLElement>('[aria-current]');
  if (!list || !item) return;
  const root = list.getBoundingClientRect(),
    rect = item.getBoundingClientRect();
  if (rect.top < root.top) list.scrollTop += rect.top - root.top;
  else if (rect.bottom > root.bottom) list.scrollTop += rect.bottom - root.bottom;
  if (rect.left < root.left) list.scrollLeft += rect.left - root.left;
  else if (rect.right > root.right) list.scrollLeft += rect.right - root.right;
});
onMounted(load);
onBeforeUnmount(() => {
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
});
function setQuestionElement(id: string, element: unknown) {
  if (element instanceof HTMLElement) questionElements.set(id, element);
  else questionElements.delete(id);
}
async function load() {
  loadError.value = '';
  try {
    survey.value = await api('/surveys/' + route.params.id);
    definition.value = JSON.parse(JSON.stringify(survey.value.draft));
    savedDefinition.value = JSON.stringify(definition.value);
    await refreshRouting();
    deadline.value = survey.value.deadlineAt ?? '';
    settingsOpen.value = !definition.value?.questions.length;
    selected.value = 0;
    await nextTick();
    if (canvas.value) canvas.value.scrollTop = 0;
  } catch (e: any) {
    loadError.value = e.message;
    ElMessage.error(e.message);
  }
}
const spaces = ref<any[]>([]),
  targetSpace = ref(''),
  spaceBusy = ref(false);
allCommunities()
  .then((rows) => (spaces.value = rows))
  .catch(() => {});
watch(
  () => survey.value?.communityId,
  (value) => (targetSpace.value = value || ''),
  { immediate: true },
);
async function changeSpace() {
  if (spaceBusy.value || !(await ensureReady())) return;
  const name = spaces.value.find((c) => c._id === targetSpace.value)?.name || '个人空间';
  if (
    !(await confirm(
      `将问卷移至${name}？${targetSpace.value ? '目标社区成员将能查看问卷及统计；原社区成员将失去访问权限。' : '问卷将仅归你个人所有，原社区成员将失去访问权限。'}题目内容保持不变。`,
    ))
  )
    return;
  spaceBusy.value = true;
  try {
    const result = await api(`/surveys/${survey.value._id}/space`, 'PATCH', {
      revision: survey.value.revision,
      communityId: targetSpace.value || null,
    });
    await applySurvey(result);
    ElMessage.success('问卷归属已更新');
  } catch (e: any) {
    ElMessage.error(
      e.status === 409 ? '问卷已变化，请保留输入并重新读取后再修改归属。' : e.message,
    );
  } finally {
    spaceBusy.value = false;
  }
}
async function goToQuestion(index: number) {
  const question = definition.value?.questions[index];
  if (!question) return;
  selected.value = index;
  settingsOpen.value = false;
  await nextTick();
  const node = questionElements.get(question.id),
    root = canvas.value;
  if (node && root)
    root.scrollTo({
      top:
        root.scrollTop + node.getBoundingClientRect().top - root.getBoundingClientRect().top - 10,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
}
function onCanvasScroll() {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    const root = canvas.value,
      questions = definition.value?.questions;
    if (!root || !questions?.length) return;
    if (root.scrollHeight - root.scrollTop - root.clientHeight <= 2) {
      selected.value = questions.length - 1;
      return;
    }
    const target = root.getBoundingClientRect().top + Math.min(70, root.clientHeight * 0.16);
    let current = 0;
    for (let i = 0; i < questions.length; i++) {
      const node = questionElements.get(questions[i].id);
      if (node && node.getBoundingClientRect().top <= target) current = i;
    }
    selected.value = current;
  });
}
function add(type: string) {
  if (!definition.value || locked.value) return;
  if (definition.value.questions.length >= 100) {
    ElMessage.warning('每份问卷最多 100 道题');
    return;
  }
  const choices = ['single_choice', 'multiple_choice', 'matrix', 'ranking'].includes(type);
  definition.value.questions.push({
    id: uid(),
    type: type as QuestionType,
    title: '',
    description: '',
    required: true,
    options: choices ? Array.from({ length: 3 }, () => ({ id: uid(), label: '' })) : [],
    rows: type === 'matrix' ? Array.from({ length: 2 }, () => ({ id: uid(), label: '' })) : [],
    validation:
      type === 'slider' ? { min: 0, max: 10, step: 1 } : type === 'time' ? { mode: 'date' } : {},
    jumpRules: [],
  });
  goToQuestion(definition.value.questions.length - 1);
}
async function remove(index: number) {
  const question = definition.value?.questions[index];
  if (!definition.value || !question || locked.value) return;
  if (
    definition.value.questions.some(
      (x) => x.id !== question.id && x.jumpRules.some((r) => r.target === question.id),
    )
  ) {
    ElMessage.warning('有规则引用此题，请先修改相关跳转目标');
    return;
  }
  try {
    await ElMessageBox.confirm('删除后无法撤销，确定删除这道题？', '删除题目', { type: 'warning' });
    const current = definition.value.questions.findIndex((q) => q.id === question.id);
    if (current < 0) return;
    definition.value.questions.splice(current, 1);
    selected.value = Math.max(0, Math.min(current, definition.value.questions.length - 1));
    if (definition.value.questions.length) goToQuestion(selected.value);
    else settingsOpen.value = true;
  } catch {}
}
function move(index: number, delta: number) {
  const questions = definition.value?.questions;
  if (!questions || locked.value) return;
  const target = index + delta;
  if (target < 0 || target >= questions.length) return;
  [questions[index], questions[target]] = [questions[target], questions[index]];
  goToQuestion(target);
}
async function save() {
  if (!definition.value) return false;
  busy.value = true;
  try {
    survey.value = await api('/surveys/' + route.params.id + '/draft', 'PUT', {
      definition: definition.value,
      revision: survey.value.revision,
    });
    definition.value = JSON.parse(JSON.stringify(survey.value.draft));
    savedDefinition.value = JSON.stringify(definition.value);
    await refreshRouting();
    ElMessage.success('草稿已保存');
    return true;
  } catch (e: any) {
    ElMessage.error(e.message);
    if (e.status === 404) {
      definition.value = null;
      survey.value = null;
      serverRouting.value = null;
      savedDefinition.value = 'null';
      loadError.value = '问卷不存在或社区权限已失效';
    }
    if (e.status === 409) {
      try {
        serverConflict.value = await api('/surveys/' + route.params.id);
      } catch {}
    }
    return false;
  } finally {
    busy.value = false;
  }
}
async function publish() {
  if (!(await save())) return;
  try {
    await ElMessageBox.confirm(
      '发布后题目、逻辑和填写设置将锁定。' +
        (routing.value?.routingMode === 'exclusive-branches-v1'
          ? '分支题仅通过条件跳转进入，连续分支必须明确配置跳转。'
          : '当前保留旧版顺序跳转机制。') +
        '请确认已检查所有题目。',
      '发布问卷',
      { confirmButtonText: '确认发布', cancelButtonText: '再检查一下', type: 'warning' },
    );
    busy.value = true;
    survey.value = await api('/surveys/' + route.params.id + '/publish', 'POST', {
      revision: survey.value.revision,
      deadlineAt: deadline.value || null,
    });
    await refreshRouting();
    ElMessage.success('发布成功，现在可以分享填写链接');
  } catch (e: any) {
    if (e instanceof Error) ElMessage.error(e.message);
  } finally {
    busy.value = false;
  }
}
async function close() {
  try {
    await ElMessageBox.confirm('关闭后将停止接收答卷，第一阶段不支持重新开放。', '关闭问卷', {
      type: 'warning',
    });
    survey.value = await api('/surveys/' + route.params.id + '/close', 'POST');
    ElMessage.success('问卷已关闭');
  } catch (e: any) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
async function saveDeadline() {
  try {
    survey.value = await api('/surveys/' + route.params.id + '/deadline', 'PATCH', {
      deadlineAt: deadline.value || null,
    });
    ElMessage.success('截止时间已更新');
  } catch (e: any) {
    ElMessage.error(e.message);
  }
}
async function copy() {
  try {
    await navigator.clipboard.writeText(location.origin + '/survey/' + survey.value.publicId);
    ElMessage.success('链接已复制');
  } catch {
    ElMessage.info(location.origin + '/survey/' + survey.value.publicId);
  }
}
</script>
<template>
  <div v-if="definition" class="editor-page continuous-editor">
    <header class="editor-toolbar">
      <div class="editor-title-row">
        <router-link to="/" class="editor-back" aria-label="返回我的问卷">←</router-link>
        <h2 :title="definition.title">
          {{ definition.title }}
          <span class="status" :class="survey.status">
            {{ locked ? '已锁定发布内容' : '草稿' }}
          </span>
        </h2>
        <span class="editor-question-count">{{ definition.questions.length }} 道题</span>
      </div>
      <div class="toolbar-actions">
        <template v-if="!locked">
          <el-button :loading="busy" @click="save">保存草稿</el-button>
          <el-button type="primary" :loading="busy" @click="publish">发布问卷 ↗</el-button>
        </template>
        <template v-else>
          <el-button @click="router.push('/survey/' + survey.publicId)">打开填写页</el-button>
          <el-button @click="copy">复制填写链接</el-button>
          <el-button type="primary" @click="router.push('/statistics/' + survey._id)">
            查看统计
          </el-button>
          <el-button v-if="survey.status === 'published'" type="danger" plain @click="close">
            关闭
          </el-button>
        </template>
      </div>
    </header>
    <div class="editor-layout">
      <aside class="panel question-palette">
        <div class="palette-types">
          <span class="eyebrow">QUESTION LIBRARY</span>
          <h3>添加题目</h3>
          <div class="palette-grid">
            <button
              v-for="(label, type) in labels"
              :key="type"
              :disabled="locked"
              @click="add(type)"
            >
              <b>{{ typeMarks[type] }}</b>
              {{ label }}
            </button>
          </div>
        </div>
        <div class="outline-heading">
          <h3>题目目录</h3>
          <small>{{ definition.questions.length }} / 100</small>
        </div>
        <nav ref="outline" class="question-outline" aria-label="题目目录">
          <button
            v-for="(item, i) in definition.questions"
            :key="item.id"
            :class="['outline-item', { selected: selected === i }]"
            :aria-current="selected === i ? 'true' : undefined"
            @click="goToQuestion(i)"
          >
            <span>{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="outline-title">{{ item.title || '未命名题目' }}</span>
            <small class="routing-badge">
              {{ routingById.get(item.id)?.kind === 'branch' ? '分支' : '通用' }}
            </small>
          </button>
          <p v-if="!definition.questions.length" class="outline-empty">
            从上方选择题型，开始第一题。
          </p>
        </nav>
        <div class="palette-footnote">
          上下滚动可连续编辑题目
          <br />
          点击目录可直接定位
        </div>
      </aside>
      <div class="editor-main">
        <SurveyLibrary
          ref="libraryTools"
          :survey="survey"
          :ensure-ready="ensureReady"
          :apply-survey="applySurvey"
        />
        <el-alert
          v-if="serverConflict"
          title="问卷版本冲突：本地输入已保留，请比较后明确重新加载或继续编辑。"
          type="error"
          :closable="false"
        />
        <details v-if="serverConflict" class="phase-conflict">
          <summary>查看服务器当前内容（不会覆盖本地）</summary>
          <pre class="phase-json">{{ JSON.stringify(serverConflict.draft, null, 2) }}</pre>
          <el-button @click="unsavedOpen = true">保存、取消或放弃本地输入</el-button>
        </details>
        <el-alert
          v-if="routing && !routing.entryQuestionId && definition.questions.length"
          title="缺少填写入口：请至少保留一道通用题。"
          type="error"
          :closable="false"
          class="routing-entry-error"
        />
        <section :class="['editor-survey-settings', { 'is-expanded': settingsOpen }]">
          <button
            class="settings-toggle"
            :aria-expanded="settingsOpen"
            aria-controls="survey-settings-body"
            @click="settingsOpen = !settingsOpen"
          >
            <span>
              <b>问卷设置</b>
              <small>标题 · 说明 · 填写权限 · 截止时间</small>
            </span>
            <span>{{ settingsOpen ? '收起 −' : '展开 ＋' }}</span>
          </button>
          <div v-if="settingsOpen" id="survey-settings-body" class="settings-body">
            <el-form label-position="top" :disabled="locked">
              <div class="survey-definition-fields">
                <el-form-item label="问卷标题">
                  <el-input v-model="definition.title" maxlength="120" show-word-limit />
                </el-form-item>
                <el-form-item label="问卷说明">
                  <el-input
                    v-model="definition.description"
                    type="textarea"
                    :rows="1"
                    maxlength="5000"
                    placeholder="向填写者介绍本次调查的目的"
                  />
                </el-form-item>
              </div>
              <div class="setting-switches">
                <label>
                  <el-switch v-model="definition.allowAnonymous" />
                  允许选择匿名
                </label>
                <label>
                  <el-switch v-model="definition.allowRepeatSubmissions" />
                  允许重复提交
                </label>
              </div>
            </el-form>
            <div class="deadline-row">
              <label>问卷归属</label>
              <el-select
                v-model="targetSpace"
                :empty-values="[null, undefined]"
                :disabled="locked || survey.ownerId !== auth.user?.id || spaceBusy"
              >
                <el-option label="个人空间" value="" />
                <el-option v-for="c in spaces" :key="c._id" :label="c.name" :value="c._id" />
              </el-select>
              <el-button
                v-if="!locked && survey.ownerId === auth.user?.id"
                :loading="spaceBusy"
                :disabled="targetSpace === (survey.communityId || '')"
                @click="changeSpace"
              >
                修改归属
              </el-button>
              <small v-if="locked">已发布问卷不能修改归属</small>
              <small v-else-if="survey.ownerId !== auth.user?.id">仅创建者可修改归属</small>
            </div>
            <div class="deadline-row">
              <label>截止时间</label>
              <el-date-picker
                v-model="deadline"
                type="datetime"
                value-format="YYYY-MM-DDTHH:mm:ssZ"
                placeholder="不设置则长期有效"
                :disabled="survey.status === 'closed'"
              />
              <el-button v-if="locked && survey.status !== 'closed'" @click="saveDeadline">
                更新
              </el-button>
            </div>
            <p v-if="locked" class="muted">
              发布内容已锁定；截止时间仍可更新。时间按浏览器本地时区显示。
            </p>
          </div>
        </section>
        <div
          ref="canvas"
          class="question-canvas"
          tabindex="0"
          aria-label="连续题目编辑画布"
          @scroll.passive="onCanvasScroll"
        >
          <div
            v-for="(item, i) in definition.questions"
            :key="item.id"
            :ref="(el) => setQuestionElement(item.id, el)"
            :data-question-id="item.id"
            :class="['question-anchor', { 'is-selected': selected === i }]"
            @focusin="selected = i"
            @pointerdown="selected = i"
          >
            <div class="instance-source phase-actions">
              <span v-if="item.source">来自题库 · 内容只读</span>
              <span v-else>本地题</span>
              <template v-if="item.source">
                <router-link :to="'/questions/' + item.source.questionId">
                  编辑题库中的原题 ↗
                </router-link>
                <el-button v-if="!locked" text @click="libraryTools?.detach(item)">
                  脱离后本地编辑
                </el-button>
              </template>
              <el-button text @click="libraryTools?.launch('save', item)">存入题库</el-button>
            </div>
            <QuestionEditor
              :question="item"
              :index="i"
              :definition="definition"
              :locked="locked || busy"
              :content-locked="!!item.source"
              :routing-info="routingById.get(item.id)"
              @move="move"
              @remove="remove"
            />
            <div class="question-divider" aria-hidden="true">
              <span>
                {{
                  i + 1 < definition.questions.length
                    ? '下一题 / ' + String(i + 2).padStart(2, '0')
                    : '问卷题目到这里结束'
                }}
              </span>
            </div>
          </div>
          <section v-if="!definition.questions.length" class="editor-canvas-empty">
            <span>YOUR FIRST QUESTION.</span>
            <h3>从一个好问题开始。</h3>
            <p>点击左侧题型，添加你的第一道题。</p>
          </section>
          <button
            v-else-if="!locked && definition.questions.length < 100"
            class="append-question"
            @click="add('single_choice')"
          >
            ＋ 添加下一道单选题
            <span>也可从左侧选择其他题型</span>
          </button>
        </div>
      </div>
    </div>
    <el-dialog
      v-model="unsavedOpen"
      title="当前有未保存输入"
      width="560px"
      :close-on-click-modal="false"
      @close="
        settleUnsaved?.(false);
        settleUnsaved = null;
      "
    >
      <p>
        接下来的操作需要服务器最新问卷。请保存、取消，或明确放弃未保存输入。保存失败会停止后续操作。
      </p>
      <template #footer>
        <el-button :disabled="busy" @click="resolveUnsaved('cancel')">取消</el-button>
        <el-button :disabled="busy" @click="resolveUnsaved('discard')">放弃未保存输入</el-button>
        <el-button type="primary" :loading="busy" @click="resolveUnsaved('save')">先保存</el-button>
      </template>
    </el-dialog>
  </div>
  <div v-else-if="loadError" class="empty">
    <p>{{ loadError }}</p>
    <el-button @click="load">重新加载</el-button>
  </div>
  <div v-else class="empty">正在读取问卷…</div>
</template>
