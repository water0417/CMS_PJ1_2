<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, auth } from '../api';
import { usePage, query, confirm, communityMembershipChange } from '../phase2';
import PagePager from '../components/PagePager.vue';
import UserLookup from '../components/UserLookup.vue';
import CommunityResources from '../components/CommunityResources.vue';
import { workspace } from '../workspace';
const route = useRoute(),
  router = useRouter(),
  selected = computed(() => String(route.params.id || ''));
const page = ref(1),
  memberPage = ref(1),
  busy = ref(false),
  community = ref<any>(null),
  recipient = ref<any>(null),
  error = ref(''),
  inviteOpen = ref(false),
  showMembers = ref(false),
  overviews = ref<Record<string, any>>({}),
  overviewErrors = ref<Record<string, { message: string; forbidden: boolean }>>({}),
  overviewLoading = ref<Record<string, boolean>>({});
const admin = computed(() => community.value?.role === 'admin');
const list = usePage(() => '/communities?page=' + page.value);
const members = usePage(() =>
  selected.value
    ? `/communities/${selected.value}/members?page=${memberPage.value}`
    : '/communities?page=1',
);
let sequence = 0;
const overviewRequests = new Map<string, number>();
watch(
  () => list.data.value.rows,
  async (rows) => {
    const request = ++sequence;
    overviews.value = {};
    overviewErrors.value = {};
    overviewLoading.value = {};
    await Promise.all(
      rows.map(async (c: any) => {
        await loadOverview(c._id, request);
      }),
    );
  },
);
function overviewFailure(e: any) {
  const forbidden = e.status === 404 && e.code === 'NOT_FOUND';
  return {
    forbidden,
    message: forbidden
      ? '社区不存在或成员权限已失效。'
      : e.status === 404 && e.code === 'REQUEST'
        ? '当前服务未提供社区概览接口，请确认服务版本后重试。'
        : '社区概览暂不可用，请重试。',
  };
}
async function loadOverview(id: string, request = sequence) {
  const attempt = (overviewRequests.get(id) || 0) + 1;
  overviewRequests.set(id, attempt);
  overviewLoading.value[id] = true;
  delete overviews.value[id];
  try {
    const value = await api('/communities/' + id + '/overview');
    if (request === sequence && overviewRequests.get(id) === attempt) {
      overviews.value[id] = value;
      delete overviewErrors.value[id];
    }
  } catch (e: any) {
    if (request === sequence && overviewRequests.get(id) === attempt) {
      delete overviews.value[id];
      overviewErrors.value[id] = overviewFailure(e);
    }
  } finally {
    if (request === sequence && overviewRequests.get(id) === attempt)
      overviewLoading.value[id] = false;
  }
}
onBeforeUnmount(() => {
  sequence++;
  currentSequence++;
});
function clearScope() {
  if (workspace.communityId === selected.value) {
    workspace.communityId = '';
    workspace.communityAdminId = '';
    workspace.surveys = [];
  }
}
let currentSequence = 0;
async function current() {
  const request = ++currentSequence;
  const communityId = selected.value;
  if (!communityId) return;
  error.value = '';
  community.value = null;
  try {
    const value = await api(`/communities/${communityId}/overview`);
    if (request === currentSequence) community.value = value;
  } catch (e: any) {
    if (request !== currentSequence) return;
    const failure = overviewFailure(e);
    error.value = failure.message;
    if (failure.forbidden) clearScope();
  }
}
watch(
  selected,
  () => {
    memberPage.value = 1;
    showMembers.value = false;
    void current();
  },
  { immediate: true },
);
watch(communityMembershipChange, () => {
  void list.load();
  void current();
});
async function create() {
  if (busy.value) return;
  try {
    const { value } = await ElMessageBox.prompt('请输入社区名称', '创建社区', {
      inputValidator: (v) => (!!v?.trim() && v.length <= 120) || '请输入1～120字',
      confirmButtonText: '创建',
      cancelButtonText: '取消',
    });
    busy.value = true;
    const c = await api('/communities', 'POST', { name: value.trim() });
    await router.push('/communities/' + c._id);
  } catch (e: any) {
    if (e?.message) ElMessage.error(e.message);
  } finally {
    busy.value = false;
  }
}
async function action(url: string, method: string, body?: any) {
  if (busy.value) return;
  busy.value = true;
  try {
    await api(url, method, body);
    ElMessage.success('操作成功');
    recipient.value = null;
    inviteOpen.value = false;
    await Promise.all([list.load(), members.load(), current()]);
  } catch (e: any) {
    ElMessage.error(
      e.status === 404
        ? '社区不可用或你已失去访问权限。'
        : e.status === 409
          ? '资料已变化，请刷新后重试。'
          : e.message,
    );
    if (e.status === 404) {
      community.value = null;
      clearScope();
      await list.load();
    }
  } finally {
    busy.value = false;
  }
}
async function leave() {
  if (await confirm('退出后不能访问社区题库、问卷及统计；离开前主动转存的个人副本仍可使用。')) {
    await action(`/communities/${selected.value}/leave`, 'POST', {});
    if (!community.value) await router.push('/communities');
  }
}
async function remove(id: string) {
  if (await confirm('移除此成员后，其社区访问权限立即失效；个人副本不受影响。'))
    await action(`/communities/${selected.value}/members/${id}`, 'DELETE');
}
</script>
<template>
  <div class="phase-page">
    <header class="phase-heading">
      <div>
        <span class="eyebrow">A COLLECTIVE OF CURIOSITY</span>
        <h1>{{ selected ? community?.name || '协同社区' : '协同社区' }}</h1>
        <p>在这里共同整理题目、制作问卷。</p>
      </div>
      <div class="phase-actions">
        <template v-if="!selected">
          <el-button @click="list.load">刷新</el-button>
          <el-button type="primary" :loading="busy" @click="create">创建社区 ＋</el-button>
        </template>
        <router-link v-else to="/communities">← 社区列表</router-link>
      </div>
    </header>
    <template v-if="!selected">
      <p v-if="list.error.value" class="phase-error">
        {{ list.error.value }}
        <el-button @click="list.load">重试</el-button>
      </p>
      <div v-loading="list.loading.value" class="community-card-grid">
        <article v-for="c in list.data.value.rows" :key="c._id" class="community-card">
          <div class="community-glyph" aria-hidden="true">{{ c.name.slice(0, 1) }}</div>
          <div>
            <h2>{{ c.name }}</h2>
            <span>{{ c.adminId === auth.user?.id ? '管理员' : '成员' }}</span>
            <p v-if="overviews[c._id]">
              {{ overviews[c._id].memberCount }} 位成员 · {{ overviews[c._id].questionCount }} 道题
              · {{ overviews[c._id].surveyCount }} 份问卷
            </p>
            <p v-else-if="overviewErrors[c._id]" class="phase-error" role="alert">
              {{ overviewErrors[c._id].message }}
              <el-button :loading="overviewLoading[c._id]" @click="loadOverview(c._id)">
                重试概览
              </el-button>
            </p>
            <p v-else>概览加载中…</p>
          </div>
          <el-button
            v-if="overviews[c._id] && !overviewErrors[c._id]"
            @click="router.push('/communities/' + c._id)"
          >
            进入社区 ↗
          </el-button>
        </article>
      </div>
      <p
        v-if="!list.loading.value && !list.error.value && !list.data.value.total"
        class="phase-empty"
      >
        还没有加入社区。可以创建社区，或通过顶部信封接受邀请。
      </p>
      <PagePager :total="list.data.value.total" :page="page" @change="(p) => (page = p)" />
    </template>
    <template v-else>
      <p v-if="error || members.error.value" class="phase-error">
        {{ error || members.error.value }}
        <el-button
          @click="
            current();
            members.load();
          "
        >
          重试
        </el-button>
      </p>
      <template v-if="community && !members.error.value">
        <div class="community-summary">
          <span>{{ community.memberCount }} 位成员</span>
          <span>{{ community.questionCount }} 道题</span>
          <span>{{ community.surveyCount }} 份问卷</span>
          <span>{{ admin ? '管理员' : '成员' }}</span>
          <div class="phase-actions community-member-actions">
            <el-button @click="showMembers = !showMembers">成员</el-button>
            <el-button
              v-if="admin"
              @click="
                recipient = null;
                inviteOpen = true;
              "
            >
              邀请成员
            </el-button>
            <el-button v-else :disabled="busy" @click="leave">退出社区</el-button>
            <small v-if="admin">管理员不能直接退出社区。</small>
          </div>
        </div>
        <CommunityResources :key="selected" :community-id="selected" :is-admin="admin" />
        <section v-if="showMembers">
          <h2>社区成员</h2>
          <article v-for="m in members.data.value.rows" :key="m.userId" class="phase-row">
            <div>
              <strong>{{ m.username }}</strong>
              <small>{{ m.role === 'admin' ? '管理员' : '成员' }}</small>
            </div>
            <el-button
              v-if="admin && m.role !== 'admin'"
              :disabled="busy"
              @click="remove(m.userId)"
            >
              移除成员
            </el-button>
          </article>
          <PagePager
            :total="members.data.value.total"
            :page="memberPage"
            @change="(p) => (memberPage = p)"
          />
        </section>
      </template>
    </template>
    <el-dialog v-model="inviteOpen" title="邀请成员" width="560px" destroy-on-close>
      <UserLookup @confirmed="(u) => (recipient = u)" />
      <p v-if="recipient">邀请 {{ recipient.username }} 一起整理题目</p>
      <el-button
        type="primary"
        :loading="busy"
        :disabled="!recipient"
        @click="
          action(`/communities/${selected}/invitations`, 'POST', { recipientId: recipient.id })
        "
      >
        发送邀请
      </el-button>
    </el-dialog>
  </div>
</template>

<style scoped>
.community-summary {
  gap: 20px;
  margin: 16px 0;
}
.community-member-actions {
  margin-left: auto;
}
.phase-heading {
  margin-bottom: 20px;
  padding-bottom: 24px;
}
</style>
