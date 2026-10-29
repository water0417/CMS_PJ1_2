<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { labels } from '../api';
import { usePage, query, allCommunities, date } from '../phase2';
import PagePager from '../components/PagePager.vue';
import QuestionActions from '../components/QuestionActions.vue';
const route = useRoute(),
  router = useRouter();
const scope = ref(String(route.query.communityId || '')),
  search = ref(String(route.query.search || '')),
  type = ref(String(route.query.type || '')),
  page = ref(Math.max(1, Number(route.query.page) || 1)),
  communities = ref<any[]>([]);
allCommunities()
  .then((r) => (communities.value = r))
  .catch(() => {});
watch([scope, search, type], () => (page.value = 1));
const state = computed(() => ({
  communityId: scope.value,
  search: search.value,
  type: type.value,
  page: page.value,
}));
watch(state, (s) => router.replace('/library' + query(s)));
const back = computed(() => '/library' + query(state.value));
const edit = (id: string) =>
  '/questions/' + id + query({ communityId: scope.value, returnTo: back.value });
const { data, loading, error, load } = usePage(() => '/questions' + query(state.value));
</script>
<template>
  <div class="phase-page">
    <header class="phase-heading">
      <div>
        <span class="eyebrow">THE QUESTION COLLECTION</span>
        <h1>{{ scope ? '社区题库' : '我的题库' }}</h1>
        <p>把好问题整理在这里，留给下一次提问。</p>
      </div>
      <el-button type="primary" @click="router.push(edit('new'))">新建题目 ＋</el-button>
    </header>
    <div class="phase-filters">
      <label>
        空间
        <el-select v-model="scope" :empty-values="[null, undefined]">
          <el-option label="个人题库" value="" />
          <el-option v-for="c in communities" :key="c._id" :label="c.name" :value="c._id" />
        </el-select>
      </label>
      <label>
        搜索标题
        <el-input v-model="search" maxlength="120" clearable placeholder="搜索整个题库" />
      </label>
      <label>
        题型
        <el-select v-model="type" :empty-values="[null, undefined]">
          <el-option label="全部题型" value="" />
          <el-option v-for="(label, key) in labels" :key="key" :label="label" :value="key" />
        </el-select>
      </label>
      <el-button @click="load">刷新</el-button>
    </div>
    <p v-if="error" class="phase-error">
      {{ error }}
      <el-button @click="load">重试</el-button>
    </p>
    <div v-loading="loading" class="question-card-list">
      <article v-for="q in data.rows" :key="q._id" class="question-library-card">
        <div class="question-card-content">
          <router-link :to="edit(q._id)">
            <h2>{{ q.title }}</h2>
          </router-link>
          <small>{{ labels[q.type] }} · 更新于 {{ date(q.updatedAt) }}</small>
          <p v-if="q.provenance">从分享或题库保存的副本</p>
        </div>
        <div class="question-card-controls">
          <el-button @click="router.push(edit(q._id))">编辑</el-button>
          <QuestionActions :question-id="q._id" @changed="load" />
        </div>
      </article>
      <p v-if="!loading && !error && !data.total" class="phase-empty">
        暂无题目。新建一道题，或从题目广场保存。
      </p>
    </div>
    <PagePager :total="data.total" :page="page" @change="(p) => (page = p)" />
  </div>
</template>
