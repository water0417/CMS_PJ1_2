<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import { query, usePage, allCommunities } from '../phase2';
import PagePager from '../components/PagePager.vue';
import QuestionMetrics from '../components/QuestionMetrics.vue';
const route = useRoute(),
  versionId = ref(String(route.query.versionId || '')),
  scope = ref(String(route.query.communityId || '')),
  page = ref(1),
  usagePage = ref(1),
  communities = ref<any[]>([]);
const historyOpen = ref(false),
  history = ref<any>({ rows: [], total: 0 }),
  historyPage = ref(1),
  historyError = ref('');
async function versions(p = 1) {
  historyPage.value = p;
  historyError.value = '';
  try {
    history.value = await api(`/questions/${route.params.id}/versions?page=${p}`);
  } catch {
    history.value = { rows: [], total: 0 };
    historyError.value = '你可以查看当前问卷中的这次保存内容，但无法读取原题的其他历史记录。';
  }
}
allCommunities()
  .then((rows) => (communities.value = rows))
  .catch(() => {});
watch([versionId, scope], () => {
  page.value = 1;
  usagePage.value = 1;
});
const stats = usePage(
  () =>
    `/questions/${route.params.id}/statistics` +
    query({ versionId: versionId.value, communityId: scope.value, page: page.value }),
);
const usage = usePage(
  () =>
    `/questions/${route.params.id}/usage` +
    query({ versionId: versionId.value, communityId: scope.value, page: usagePage.value }),
);
</script>
<template>
  <div class="phase-page">
    <header class="phase-heading">
      <div>
        <h1>使用与跨问卷统计</h1>
        <p>按所选题目记录和空间统计，不合并其他保存记录或副本的回答。</p>
      </div>
    </header>
    <div class="phase-filters">
      <label>
        题目记录
        <el-button
          @click="
            historyOpen = true;
            versions();
          "
        >
          选择保存记录
        </el-button>
      </label>
      <label>
        统计空间
        <el-select :empty-values="[null, undefined]" v-model="scope">
          <el-option label="个人空间" value="" />
          <el-option v-for="c in communities" :key="c._id" :label="c.name" :value="c._id" />
        </el-select>
      </label>
      <el-button
        @click="
          stats.load();
          usage.load();
        "
      >
        刷新
      </el-button>
    </div>
    <p>统计单位：实例回答次数。同题在同卷出现两次，可贡献两次回答。</p>
    <p v-if="stats.error.value" class="phase-error">
      {{ stats.error.value }}
      <el-button @click="stats.load">重试统计</el-button>
    </p>
    <div v-loading="stats.loading.value">
      <QuestionMetrics
        v-if="stats.data.value.content"
        :data="stats.data.value"
        :content="stats.data.value.content"
      />
      <PagePager
        v-if="
          !stats.loading.value &&
          stats.data.value.content &&
          (stats.data.value.distributionTotal !== undefined || stats.data.value.rows)
        "
        :total="stats.data.value.distributionTotal ?? stats.data.value.answerCount"
        :page="page"
        @change="(p) => (page = p)"
      />
    </div>
    <h2>{{ scope ? '社区问卷使用情况' : '个人问卷使用情况' }}</h2>
    <p>
      仅显示所选空间中有权访问的问卷引用，包含草稿、发布及归档记录。同一题目重复选用会形成多个实例。
    </p>
    <p>{{ usage.data.value.visibility }}</p>
    <p v-if="usage.error.value" class="phase-error">
      {{ usage.error.value }}
      <el-button @click="usage.load">重试</el-button>
    </p>
    <div v-loading="usage.loading.value">
      <article
        v-for="r in usage.data.value.rows"
        :key="r.instanceId + r.surveyVersionId + r.kind"
        class="phase-row"
      >
        <div>
          <strong>{{ r.title }}</strong>
          <small>
            {{
              { draft: '草稿', published: '当前发布快照', archived: '归档快照' }[r.kind as string]
            }}
          </small>
        </div>
        <router-link
          v-if="r.kind !== 'draft'"
          :to="'/statistics/' + r.surveyId + query({ communityId: r.communityId })"
        >
          问卷统计 ↗
        </router-link>
      </article>
      <p v-if="!usage.loading.value && !usage.error.value && !usage.data.value.total">
        这次保存的题目在所选空间暂无可见引用
      </p>
      <PagePager
        v-if="!usage.loading.value && !usage.error.value"
        :total="usage.data.value.total"
        :page="usagePage"
        @change="(p) => (usagePage = p)"
      />
    </div>
    <el-dialog v-model="historyOpen" title="选择保存记录" width="600px">
      <p v-if="historyError">{{ historyError }}</p>
      <article v-for="v in history.rows" :key="v._id" class="phase-row">
        <span>{{ v.content.title }} · 第{{ v.number }}次保存</span>
        <el-button
          @click="
            versionId = v._id;
            historyOpen = false;
          "
        >
          查看统计
        </el-button>
      </article>
      <PagePager :total="history.total" :page="historyPage" @change="versions" />
    </el-dialog>
  </div>
</template>
