<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue';
import { auth, api, labels } from '../api';
import { usePage, query, date } from '../phase2';
import { statusName, type SurveySummary } from '../workspace';
import PagePager from './PagePager.vue';
import QuestionActions from './QuestionActions.vue';
const props = defineProps<{ communityId: string; isAdmin: boolean }>();
const page = ref(1),
  surveys = ref<SurveySummary[]>([]),
  loading = ref(false),
  error = ref('');
const questions = usePage(
  () => '/questions' + query({ communityId: props.communityId, page: page.value }),
);
let generation = 0;
async function loadSurveys() {
  const request = ++generation;
  loading.value = true;
  error.value = '';
  surveys.value = [];
  try {
    const rows = await api('/surveys' + query({ communityId: props.communityId }));
    if (request === generation) surveys.value = rows;
  } catch (e: any) {
    if (request === generation) error.value = e.message;
  } finally {
    if (request === generation) loading.value = false;
  }
}
void loadSurveys();
onBeforeUnmount(() => generation++);
const returnTo = computed(() => '/communities/' + props.communityId);
const edit = (id: string) =>
  '/questions/' + id + query({ communityId: props.communityId, returnTo: returnTo.value });
const canManage = (s: SurveySummary) => s.ownerId === auth.user?.id || props.isAdmin;
</script>
<template>
  <div class="community-resources">
    <section class="community-resource-panel">
      <header>
        <div>
          <span class="eyebrow">SURVEY COLLECTION</span>
          <h2>
            社区问卷
            <small>{{ surveys.length }}</small>
          </h2>
        </div>
        <el-button :loading="loading" @click="loadSurveys">刷新</el-button>
      </header>
      <p v-if="error" class="phase-error" role="alert">
        {{ error }}
        <el-button @click="loadSurveys">重试</el-button>
      </p>
      <div v-loading="loading" class="community-survey-grid">
        <article v-for="(s, index) in surveys" :key="s._id" class="community-survey-card">
          <div class="community-survey-top">
            <span>{{ String(index + 1).padStart(2, '0') }}</span>
            <small>{{ statusName(s) }}</small>
          </div>
          <h3>{{ s.draft.title || '未命名问卷' }}</h3>
          <p v-if="s.draft.description">{{ s.draft.description }}</p>
          <small>{{ s.questionCount }} 道题 · {{ s.responseCount }} 次回答</small>
          <div class="phase-actions">
            <router-link v-if="canManage(s)" :to="'/editor/' + s._id">管理问卷 ↗</router-link>
            <router-link :to="'/statistics/' + s._id">统计 ↗</router-link>
          </div>
        </article>
      </div>
      <p v-if="!loading && !error && !surveys.length" class="phase-empty">还没有社区问卷。</p>
    </section>
    <section class="community-resource-panel">
      <header>
        <div>
          <span class="eyebrow">QUESTION COLLECTION</span>
          <h2>
            社区题库
            <small>{{ questions.data.value.total }}</small>
          </h2>
        </div>
        <router-link :to="edit('new')">新建题目 ＋</router-link>
      </header>
      <p v-if="questions.error.value" class="phase-error" role="alert">
        {{ questions.error.value }}
        <el-button @click="questions.load">重试</el-button>
      </p>
      <div v-loading="questions.loading.value" class="community-question-list">
        <article v-for="q in questions.data.value.rows" :key="q._id" class="community-question-row">
          <div>
            <router-link :to="edit(q._id)">
              <h3>{{ q.title }}</h3>
            </router-link>
            <small>{{ labels[q.type] }} · {{ date(q.updatedAt) }}</small>
          </div>
          <div class="phase-actions">
            <router-link :to="edit(q._id)">编辑</router-link>
            <QuestionActions :question-id="q._id" @changed="questions.load" />
          </div>
        </article>
      </div>
      <p
        v-if="!questions.loading.value && !questions.error.value && !questions.data.value.total"
        class="phase-empty"
      >
        还没有社区题目。
      </p>
      <PagePager :total="questions.data.value.total" :page="page" @change="(p) => (page = p)" />
    </section>
  </div>
</template>
<style scoped>
.community-resources {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 24px;
  margin-top: 26px;
  align-items: start;
}
.community-resource-panel {
  min-width: 0;
  border: 1px solid #bdbdbd;
  padding: 22px;
  background: #fafafa;
}
.community-resource-panel > header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding-bottom: 18px;
  border-bottom: 1px solid #c9c9c9;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.community-resource-panel h2 {
  margin: 8px 0 0;
  font-size: 25px;
}
.community-resource-panel h2 small {
  font-family: 'Microsoft YaHei', sans-serif;
  font-size: 13px;
  color: #777;
  margin-left: 8px;
}
.community-survey-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.community-survey-card {
  min-width: 0;
  border: 1px solid #ccc;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: #f0f0f0;
}
.community-survey-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #777;
}
.community-survey-card h3,
.community-question-row h3 {
  margin: 0;
  font-size: 20px;
  overflow-wrap: anywhere;
}
.community-survey-card p {
  font-size: 13px;
  color: #777;
  overflow-wrap: anywhere;
}
.community-survey-card > .phase-actions {
  margin-top: auto;
  font-size: 12px;
  gap: 10px;
}
.community-survey-card > small {
  font-size: 12px;
  color: #666;
}
.community-question-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 18px 0;
  border-bottom: 1px solid #d1d1d1;
}
.community-question-row > div {
  min-width: 0;
}
.community-question-row small {
  display: block;
  margin-top: 9px;
  color: #777;
  font-size: 12px;
}
.community-question-row .phase-actions {
  flex-shrink: 0;
  flex-wrap: wrap;
}
@media (max-width: 1200px) {
  .community-resources {
    grid-template-columns: 1fr;
  }
  .community-survey-card {
    min-height: 180px;
  }
}
@media (max-width: 600px) {
  .community-resource-panel {
    padding: 16px;
  }
  .community-survey-grid {
    grid-template-columns: 1fr;
  }
  .community-question-row {
    align-items: flex-start;
    flex-direction: column;
  }
  .community-question-row .phase-actions {
    width: 100%;
  }
}
</style>
