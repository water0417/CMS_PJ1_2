<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { createInvitationPolling } from '../invitation-polling';
import { ElMessage } from 'element-plus';
import { api, auth } from '../api';
import { date, statuses, communityMembershipChange } from '../phase2';
import PagePager from './PagePager.vue';
const route = useRoute(),
  open = ref(false),
  pending = ref(0),
  known = ref(false),
  error = ref(''),
  countError = ref(''),
  list = ref<any>({ rows: [], total: 0 }),
  page = ref(1),
  history = ref(false),
  busy = ref(false),
  loading = ref(false);
let countSequence = 0,
  listSequence = 0;
const rows = computed(() =>
  list.value.rows.filter((r: any) =>
    history.value ? r.status !== 'pending' : r.status === 'pending',
  ),
);
async function count() {
  const request = ++countSequence;
  if (!auth.user || document.hidden) return false;
  try {
    const r = await api('/community-invitations/pending-count');
    if (request === countSequence) {
      pending.value = r.pendingCount;
      known.value = true;
      countError.value = '';
      return true;
    }
  } catch (e: any) {
    if (request === countSequence) {
      known.value = false;
      countError.value =
        e.code === 'REQUEST' && e.status === 404
          ? '邀请数量接口尚未由当前服务提供，自动刷新已暂停。请确认服务版本后重试。'
          : '无法确认待处理邀请数量，自动刷新已暂停。请重试。';
    }
  }
  return false;
}
async function load() {
  const request = ++listSequence;
  if (!auth.user || document.hidden) return false;
  loading.value = true;
  error.value = '';
  list.value = { rows: [], total: list.value.total };
  try {
    const r = await api('/community-invitations?page=' + page.value);
    if (request === listSequence) {
      list.value = r;
      pending.value = r.pendingCount;
      if (!countError.value) known.value = true;
      return true;
    }
  } catch (e: any) {
    if (request === listSequence) {
      error.value = '暂时无法读取邀请，自动刷新已暂停，请重试。';
      polling.pause();
    }
  } finally {
    if (request === listSequence) loading.value = false;
  }
  return false;
}
const polling = createInvitationPolling(
  async () => {
    if (!(await count())) return false;
    return open.value ? await load() : true;
  },
  () => !!auth.user && !document.hidden,
);
async function retry() {
  await polling.refresh();
}
async function action(i: any, accept: boolean) {
  if (busy.value) return;
  busy.value = true;
  try {
    await api(`/community-invitations/${i._id}/${accept ? 'accept' : 'reject'}`, 'POST', {
      revision: i.revision,
    });
    ElMessage.success(accept ? '已加入社区' : '已拒绝邀请');
    if (accept) communityMembershipChange.value++;
    await retry();
  } catch (e: any) {
    const notice =
      e.status === 409
        ? '邀请状态已变化，请确认最新记录后再操作。'
        : e.status === 404
          ? '邀请已失效或无权处理。'
          : '处理失败，请重试。';
    await retry();
    polling.pause();
    error.value = notice;
  } finally {
    busy.value = false;
  }
}
watch(
  () => auth.user?.id,
  () => {
    polling.pause();
    countSequence++;
    listSequence++;
    countError.value = '';
    error.value = '';
    loading.value = false;
    pending.value = 0;
    known.value = false;
    open.value = false;
    if (auth.user) void retry();
  },
  { immediate: true },
);
watch(
  () => route.fullPath,
  () => {
    if (!countError.value && !error.value) void retry();
  },
);
watch(open, (v) => {
  if (v) {
    page.value = 1;
    history.value = false;
    void retry();
  }
});
watch(page, () => {
  if (open.value) void load();
});
function visible() {
  polling.pause();
  if (document.hidden) {
    countSequence++;
    listSequence++;
    loading.value = false;
  } else void retry();
}
onMounted(() => document.addEventListener('visibilitychange', visible));
onBeforeUnmount(() => {
  countSequence++;
  listSequence++;
  polling.pause();
  document.removeEventListener('visibilitychange', visible);
});
</script>
<template>
  <button
    class="invitation-envelope"
    :aria-label="
      known
        ? pending
          ? `社区邀请，${pending}条待处理`
          : '社区邀请，暂无待处理'
        : countError
          ? '社区邀请，状态获取失败，点击重试'
          : '社区邀请，点击检查'
    "
    :title="known ? (pending ? '有待处理的社区邀请' : '社区邀请') : '邀请状态暂不可用，点击重试'"
    @click="open = true"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="m3 6 9 7 9-7" />
    </svg>
    <span v-if="countError" class="invitation-unavailable" aria-hidden="true">?</span>
    <span v-else-if="known && pending > 0" class="invitation-alert" aria-hidden="true">!</span>
  </button>
  <el-drawer v-model="open" title="社区邀请" size="460px" class="invitation-panel" append-to-body>
    <p v-if="countError" class="phase-error" role="alert">{{ countError }}</p>
    <p>{{ known ? `待处理邀请：${pending}` : '邀请状态暂不可用' }}</p>
    <p>打开消息不会清除提醒，接受或拒绝后才会更新。</p>
    <div class="phase-actions">
      <el-radio-group v-model="history" aria-label="邀请记录">
        <el-radio-button :value="false">待处理</el-radio-button>
        <el-radio-button :value="true">历史</el-radio-button>
      </el-radio-group>
      <el-button @click="retry()">刷新邀请</el-button>
    </div>
    <p v-if="error" class="phase-error" role="alert">{{ error }}</p>
    <div v-loading="loading">
      <article v-for="i in rows" :key="i._id" class="invitation-card">
        <h3>{{ i.community?.name || '社区不可用' }}</h3>
        <p>{{ i.inviter?.username || '用户不可用' }} 邀请你加入</p>
        <small>{{ date(i.updatedAt || i.createdAt) }} · {{ statuses[i.status] }}</small>
        <div v-if="i.status === 'pending'" class="phase-actions">
          <el-button type="primary" :disabled="busy" @click="action(i, true)">接受邀请</el-button>
          <el-button :disabled="busy" @click="action(i, false)">拒绝邀请</el-button>
        </div>
        <router-link
          v-else-if="i.status === 'accepted'"
          :to="'/communities/' + i.communityId"
          @click="open = false"
        >
          查看社区 ↗
        </router-link>
      </article>
    </div>
    <p v-if="!loading && !error && !countError && !rows.length">
      本页没有{{ history ? '已处理记录' : '待处理邀请' }}。
    </p>
    <p class="invitation-paging-note">按全部邀请分页，可翻页查看其他记录。</p>
    <PagePager :total="list.total" :page="page" @change="(p) => (page = p)" />
  </el-drawer>
</template>
