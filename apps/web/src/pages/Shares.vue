<script setup lang="ts">
const origin = location.origin;
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api, labels } from '../api';
import { usePage, query, statuses, kinds, date, confirm, copyText } from '../phase2';
import PagePager from '../components/PagePager.vue';
import QuestionPreview from '../components/QuestionPreview.vue';
const route = useRoute(),
  router = useRouter(),
  square = computed(() => route.path === '/square');
const view = ref(String(route.query.view || 'inbox')),
  kind = ref(''),
  status = ref(''),
  inboxStatus = ref('pending'),
  searchInput = ref(''),
  search = ref(''),
  type = ref(''),
  mine = ref(false),
  page = ref(1),
  selected = ref<any>(null),
  busy = ref(false);
watch([view, kind, status, inboxStatus, mine, type, search], () => {
  page.value = 1;
  selected.value = null;
});
const { data, error, loading, load } = usePage(() =>
  square.value
    ? '/square' +
      query({
        search: search.value,
        type: type.value,
        mine: mine.value || undefined,
        page: page.value,
      })
    : view.value === 'sent'
      ? '/shares' +
        query({ direction: 'sent', kind: kind.value, status: status.value, page: page.value })
      : '/deliveries' + query({ status: inboxStatus.value, page: page.value }),
);
function searchSquare() {
  const next = searchInput.value.trim();
  const unchanged = search.value === next && page.value === 1;
  search.value = next;
  page.value = 1;
  selected.value = null;
  if (unchanged) void load();
}
function resetSquare() {
  const unchanged = !search.value && !type.value && !mine.value && page.value === 1;
  searchInput.value = '';
  search.value = '';
  type.value = '';
  mine.value = false;
  page.value = 1;
  selected.value = null;
  if (unchanged) void load();
}
const version = (r: any) => (Array.isArray(r.version) ? r.version[0] : r.version);
async function revoke(r: any) {
  if (busy.value || !(await confirm('撤回后将阻止新的访问和转存，已转存的独立副本不受影响。')))
    return;
  busy.value = true;
  try {
    await api('/shares/' + r._id, 'DELETE');
    selected.value = null;
    await load();
    ElMessage.success('已撤回；既有副本不受影响');
  } catch (e: any) {
    ElMessage.error(e.message);
  } finally {
    busy.value = false;
  }
}
async function receive(r: any, reject = false) {
  if (busy.value) return;
  busy.value = true;
  try {
    const result = await api(
      `/shares/${r._id}/${reject ? 'reject' : 'accept'}`,
      'POST',
      r.token ? { token: r.token } : {},
    );
    selected.value = null;
    await load();
    if (reject) ElMessage.success('已拒绝');
    else {
      ElMessage.success(result.alreadyAccepted ? '此前已接收，打开已有副本' : '已转存个人副本');
      await router.push('/questions/' + result.question._id);
    }
  } catch (e: any) {
    ElMessage.error(e.message);
    if (e.status === 404 || e.status === 409) {
      selected.value = null;
      await load();
    }
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="phase-page">
    <header class="phase-heading">
      <div>
        <span class="eyebrow">SHARED IDEAS, INDEPENDENT COPIES</span>
        <h1>{{ square ? '题目广场' : '共享管理' }}</h1>
        <p>
          {{ square ? '发现别人公开的好问题，保存到自己的题库。' : '管理收到和发出的题目分享。' }}
        </p>
      </div>
      <el-button @click="load">刷新</el-button>
    </header>
    <div class="phase-filters">
      <template v-if="square">
        <label>
          搜索标题
          <el-input
            v-model="searchInput"
            maxlength="120"
            placeholder="公开时的题目标题"
            clearable
            @keyup.enter="searchSquare"
          />
        </label>
        <label>
          题型
          <el-select v-model="type" :empty-values="[null, undefined]">
            <el-option label="全部题型" value="" />
            <el-option v-for="(name, key) in labels" :key="key" :label="name" :value="key" />
          </el-select>
        </label>
        <el-checkbox v-model="mine">我公开的</el-checkbox>
        <el-button @click="searchSquare">搜索</el-button>
        <el-button @click="resetSquare">重置</el-button>
      </template>
      <template v-else>
        <el-radio-group v-model="view">
          <el-radio-button value="inbox">收件箱</el-radio-button>
          <el-radio-button value="sent">我发出的</el-radio-button>
        </el-radio-group>
        <template v-if="view === 'sent'">
          <label>
            类型
            <el-select :empty-values="[null, undefined]" v-model="kind">
              <el-option label="全部类型" value="" />
              <el-option v-for="(n, k) in kinds" :key="k" :label="n" :value="k" />
            </el-select>
          </label>
          <label>
            状态
            <el-select :empty-values="[null, undefined]" v-model="status">
              <el-option label="全部状态（含已撤回）" value="" />
              <el-option v-for="(n, k) in statuses" :key="k" :label="n" :value="k" />
            </el-select>
          </label>
        </template>
        <label v-else>
          状态
          <el-select :empty-values="[null, undefined]" v-model="inboxStatus">
            <el-option
              v-for="k in ['pending', 'accepted', 'rejected']"
              :key="k"
              :label="statuses[k]"
              :value="k"
            />
          </el-select>
        </label>
      </template>
    </div>
    <p v-if="error" class="phase-error">
      {{ error }}
      <el-button @click="load">重试</el-button>
    </p>
    <div v-loading="loading">
      <article v-for="r in data.rows" :key="r._id" class="phase-row">
        <div>
          <small>{{ kinds[r.kind] }} · {{ statuses[r.status] }} · {{ date(r.createdAt) }}</small>
          <h2>{{ version(r)?.content.title || '题目暂不可用' }}</h2>
          <p>
            分享时的内容
            <template v-if="r.recipient">
              · 接收者 {{ r.recipient.username || '账号不存在' }}
            </template>
            <template v-if="r.link">
              · {{ r.status === 'revoked' ? '链接已失效' : '分享链接' }}
            </template>
          </p>
        </div>
        <div class="phase-actions">
          <el-button @click="selected = r">题目预览</el-button>
          <template v-if="(view === 'sent' && !square) || (square && mine)">
            <el-button
              v-if="r.link && r.status === 'active'"
              @click="copyText(origin + '/question-links/' + r.link.token)"
            >
              复制链接
            </el-button>
            <el-button
              v-if="['active', 'pending'].includes(r.status)"
              :disabled="busy"
              @click="revoke(r)"
            >
              撤回
            </el-button>
          </template>
          <template v-else-if="r.status !== 'rejected'">
            <el-button :loading="busy" @click="receive(r)">
              {{ r.status === 'accepted' ? '打开已接收副本' : '转存到个人题库' }}
            </el-button>
            <el-button
              v-if="r.kind === 'delivery' && r.status === 'pending'"
              :disabled="busy"
              @click="receive(r, true)"
            >
              拒绝
            </el-button>
          </template>
        </div>
      </article>
      <p v-if="!loading && !error && !data.total" class="phase-empty">暂无符合条件的记录。</p>
    </div>
    <PagePager :total="data.total" :page="page" @change="(p) => (page = p)" />
    <el-dialog :model-value="!!selected" @close="selected = null" title="题目预览" width="720px">
      <QuestionPreview v-if="selected && version(selected)" :content="version(selected).content" />
      <p v-if="selected?.status === 'revoked'">
        此记录已撤回，不能访问原链接或再次接收；已转存副本不受影响。
      </p>
    </el-dialog>
  </div>
</template>
