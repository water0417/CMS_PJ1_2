<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { api, labels } from '../api';
import { query, usePage, date } from '../phase2';
import PagePager from './PagePager.vue';
import QuestionPreview from './QuestionPreview.vue';
const props = defineProps<{ scope: string; search: string; busy: boolean }>();
const emit = defineEmits<{ choose: [question: any, version: any, share?: any] }>();
const page = ref(1),
  rows = ref<any[]>([]),
  loading = ref(false),
  failures = ref<any[]>([]),
  preview = ref<any>(null);
watch(
  () => [props.scope, props.search],
  () => {
    page.value = 1;
  },
);
const list = usePage(() =>
  props.scope === 'public'
    ? '/square' + query({ search: props.search, page: page.value })
    : '/questions' + query({ communityId: props.scope, search: props.search, page: page.value }),
);
let generation = 0;
async function loadVersions() {
  const request = ++generation;
  rows.value = [];
  failures.value = [];
  preview.value = null;
  if (list.loading.value || list.error.value) {
    loading.value = false;
    return;
  }
  if (props.scope === 'public') {
    rows.value = list.data.value.rows
      .map((share: any) => ({
        question: { _id: share.questionId },
        version: Array.isArray(share.version) ? share.version[0] : share.version,
        share,
      }))
      .filter((r: any) => r.version);
    loading.value = false;
    return;
  }
  loading.value = true;
  const groups = await Promise.all(
    list.data.value.rows.map(async (question: any) => {
      try {
        const versions: any[] = [];
        let p = 1,
          result;
        do {
          result = await api(`/questions/${question._id}/versions?page=${p++}`);
          if (request !== generation) return [];
          versions.push(...result.rows);
        } while (versions.length < result.total && result.rows.length);
        return versions.map((version) => ({ question, version }));
      } catch (e: any) {
        if (request === generation)
          failures.value.push({ title: question.title, message: e.message });
        return [];
      }
    }),
  );
  if (request === generation) {
    rows.value = groups.flat();
    loading.value = false;
  }
}
watch([() => list.data.value, () => list.loading.value, () => list.error.value], loadVersions, {
  immediate: true,
});
onBeforeUnmount(() => generation++);
</script>
<template>
  <div v-loading="list.loading.value || loading" class="version-picker">
    <p v-if="list.error.value" class="phase-error" role="alert">
      {{ list.error.value }}
      <el-button @click="list.load">重试</el-button>
    </p>
    <p v-for="f in failures" :key="f.title" class="phase-error" role="alert">
      {{ f.title }}：{{ f.message }}
      <el-button @click="loadVersions">重新加载保存记录</el-button>
    </p>
    <article v-for="row in rows" :key="row.version._id" class="version-pick-row">
      <div class="version-pick-content">
        <h3>{{ row.version.content.title || '未命名题目' }}</h3>
        <small>
          {{ labels[row.version.content.type] }} · 第{{ row.version.number }}次保存 ·
          {{ date(row.share?.createdAt || row.version.createdAt) }}
        </small>
        <small v-if="!row.share">
          同一题目的保存记录 ·
          {{ row.version._id === row.question.latestVersionId ? '最新内容' : '历史内容' }}
        </small>
        <p v-if="row.version.content.description">{{ row.version.content.description }}</p>
      </div>
      <div class="phase-actions">
        <el-button :disabled="busy" @click="preview = row.version">预览</el-button>
        <el-button
          type="primary"
          :disabled="busy || loading"
          @click="emit('choose', row.question, row.version, row.share)"
        >
          {{ scope === 'public' ? '保存并选用' : '选用此题' }}
        </el-button>
      </div>
    </article>
    <p
      v-if="
        !loading && !list.loading.value && !list.error.value && !failures.length && !rows.length
      "
      class="phase-empty"
    >
      暂无符合条件的题目。
    </p>
    <p class="version-pick-note">
      {{
        scope === 'public'
          ? '公开题目将先保存为个人副本，再加入问卷；不会改变问卷归属。'
          : '每条为一次保存的题目内容，可直接选用。按题目分页，每页展开这些题目的全部保存记录。'
      }}
    </p>
    <PagePager :total="list.data.value.total" :page="page" @change="(p) => (page = p)" />
    <el-dialog
      :model-value="!!preview"
      title="题目预览"
      width="700px"
      append-to-body
      @close="preview = null"
    >
      <QuestionPreview v-if="preview" :content="preview.content" />
    </el-dialog>
  </div>
</template>
<style scoped>
.version-pick-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border: 1px solid #ccc;
  padding: 20px;
  margin: 12px 0;
  background: #fafafa;
}
.version-pick-content {
  min-width: 0;
}
.version-pick-content h3 {
  font-size: 21px;
  margin: 0 0 10px;
  overflow-wrap: anywhere;
}
.version-pick-content small,
.version-pick-note {
  font-size: 12px;
  color: #777;
}
.version-pick-content p {
  font-size: 13px;
  color: #666;
  overflow-wrap: anywhere;
}
.version-pick-row .phase-actions {
  flex-shrink: 0;
}
@media (max-width: 600px) {
  .version-pick-row {
    flex-direction: column;
    align-items: stretch;
    padding: 16px;
    gap: 14px;
  }
  .version-pick-row .phase-actions {
    justify-content: flex-end;
  }
}
</style>
