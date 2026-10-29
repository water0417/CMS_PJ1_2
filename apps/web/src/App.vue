<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { auth, loadAuth, api } from './api';
import { workspace, templates, refreshSurveys, templateDefinition } from './workspace';
import { allCommunities, copyText } from './phase2';
import InvitationInbox from './components/InvitationInbox.vue';
const route = useRoute(),
  router = useRouter();
const creating = ref(false),
  createOpen = ref(false),
  createTitle = ref(''),
  createSpace = ref(''),
  createCommunities = ref<any[]>([]),
  pendingTemplate = ref<number | undefined>();
const home = computed(() => route.path === '/');
const login = computed(() => route.path === '/login');
const filling = computed(() => route.path.startsWith('/survey/'));
const areaTitle = computed(
  () =>
    Object.entries({
      '/library': '我的题库',
      '/questions/': '编辑题目',
      '/question-insights/': '跨问卷统计',
      '/square': '题目广场',
      '/shares': '共享管理',
      '/communities': '协同社区',
      '/question-links/': '分享链接',
    }).find(([prefix]) => route.path.startsWith(prefix))?.[1],
);
const crumb = computed(
  () =>
    areaTitle.value ||
    (login.value
      ? '账号访问'
      : filling.value
        ? '问卷填写'
        : route.path.startsWith('/editor/')
          ? '问卷编辑'
          : route.path.startsWith('/statistics/')
            ? '统计分析'
            : workspace.filter === 'draft'
              ? '草稿箱'
              : '我的问卷'),
);
onMounted(async () => {
  if (!auth.loaded) await loadAuth();
  if (auth.user && !home.value && !filling.value) {
    try {
      await refreshSurveys();
    } catch (e: any) {
      ElMessage.error(e.message);
    }
  }
  if (!auth.user && !login.value)
    await router.replace('/login?next=' + encodeURIComponent(route.fullPath));
});
async function navigate(filter = 'all') {
  workspace.filter = filter;
  workspace.search = '';
  if (!auth.user) {
    await router.push('/login');
    return;
  }
  await router.push('/');
}
async function logout() {
  try {
    await api('/auth/logout', 'POST');
    auth.user = null;
    workspace.surveys = [];
    workspace.communityId = '';
    workspace.communityAdminId = '';
    workspace.filter = 'all';
    workspace.search = '';
    await router.push('/login');
  } catch (e: any) {
    ElMessage.error(e.message);
  }
}
async function create(templateIndex?: number) {
  if (!auth.user) {
    await router.push('/login');
    return;
  }
  if (creating.value) return;
  try {
    createCommunities.value = await allCommunities();
  } catch (e: any) {
    ElMessage.error(e.message);
    return;
  }
  pendingTemplate.value = templateIndex;
  createTitle.value = templateIndex === undefined ? '' : templates[templateIndex].title;
  createSpace.value = createCommunities.value.some((c) => c._id === workspace.communityId)
    ? workspace.communityId
    : '';
  createOpen.value = true;
}
async function confirmCreate() {
  if (creating.value || !createTitle.value.trim() || createTitle.value.length > 120) return;
  const title = createTitle.value.trim(),
    templateIndex = pendingTemplate.value;
  creating.value = true;
  let created: any;
  try {
    created = await api('/surveys', 'POST', {
      title,
      ...(createSpace.value ? { communityId: createSpace.value } : {}),
    });
    createOpen.value = false;
    if (templateIndex !== undefined) {
      try {
        await api(`/surveys/${created._id}/draft`, 'PUT', {
          revision: created.revision,
          definition: templateDefinition(templateIndex),
        });
      } catch (e: any) {
        ElMessage.warning('草稿已创建，但模板保存失败：' + e.message + '。可在编辑器中继续。');
      }
    }
    workspace.templatesOpen = false;
    await refreshSurveys();
    await router.push('/editor/' + created._id);
  } catch (e: any) {
    ElMessage.error(e.message);
    if (created) await router.push('/editor/' + created._id);
  } finally {
    creating.value = false;
  }
}
function showTemplates() {
  if (!auth.user) {
    router.push('/login');
    return;
  }
  workspace.templatesOpen = true;
}
</script>
<template>
  <div class="desktop studio-desktop">
    <div class="window studio-window">
      <div class="chrome" aria-hidden="true">
        <i></i>
        <i></i>
        <i></i>
        <span class="chrome-title">ASKWELL — A SPACE FOR QUESTIONS</span>
        <span class="chrome-right">− &nbsp; □ &nbsp; ×</span>
      </div>
      <div class="workspace">
        <aside v-if="!filling" class="sidebar">
          <router-link class="brand" to="/" aria-label="问达 ASKWELL 工作台">
            <div class="brand-symbol" aria-hidden="true">
              <svg width="21" height="21" viewBox="0 0 24 24">
                <path
                  d="M5 7V4H17V7H20V13H17V16H11V19H8V13H14V10H17V7H8V10H5ZM8 21H11V24H8Z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <div>
              <strong>问达</strong>
              <small>ASKWELL</small>
            </div>
          </router-link>
          <button class="sidebar-new" :disabled="creating" @click="create()">
            新建问卷
            <span>＋</span>
          </button>
          <div class="nav-label">WORKSPACE</div>
          <nav class="nav" aria-label="工作空间">
            <button
              :class="{ active: home && workspace.filter !== 'draft' }"
              :aria-current="home && workspace.filter !== 'draft' ? 'page' : undefined"
              aria-label="我的问卷"
              @click="navigate()"
            >
              <svg viewBox="0 0 20 20" fill="none">
                <path
                  d="M3 3H8V8H3ZM12 3H17V8H12ZM3 12H8V17H3ZM12 12H17V17H12Z"
                  stroke="currentColor"
                />
              </svg>
              <span>我的问卷</span>
              <small>{{ String(workspace.surveys.length).padStart(2, '0') }}</small>
            </button>
            <button
              :class="{ active: home && workspace.filter === 'draft' }"
              :aria-current="home && workspace.filter === 'draft' ? 'page' : undefined"
              aria-label="草稿箱"
              @click="navigate('draft')"
            >
              <svg viewBox="0 0 20 20" fill="none">
                <path d="M5 2H12L16 6V18H5ZM12 2V6H16M8 10H13M8 13H13" stroke="currentColor" />
              </svg>
              <span>草稿箱</span>
              <small>
                {{
                  String(workspace.surveys.filter((s) => s.status === 'draft').length).padStart(
                    2,
                    '0',
                  )
                }}
              </small>
            </button>
            <button aria-label="模板中心" @click="showTemplates">
              <svg viewBox="0 0 20 20" fill="none">
                <path d="M3 3V17H18M7 13V9M11 13V5M15 13V7" stroke="currentColor" />
              </svg>
              <span>模板中心</span>
              <small>↗</small>
            </button>
            <button
              v-for="[path, title] in [
                ['/library', '我的题库'],
                ['/square', '题目广场'],
                ['/shares', '共享管理'],
                ['/communities', '协同社区'],
              ]"
              :key="path"
              :class="{ active: route.path.startsWith(path) }"
              @click="router.push(path)"
            >
              <span>{{ title }}</span>
              <small>↗</small>
            </button>
          </nav>
          <div class="sidebar-bottom">
            <div class="sidebar-note">
              <div class="tiny-squares" aria-hidden="true">
                <i></i>
                <i></i>
                <i></i>
              </div>
              <strong>小小提问，大大发现。</strong>
              <br />
              给每一份好奇，一个开始。
            </div>
          </div>
        </aside>
        <main
          class="content studio-content"
          :class="{
            'is-home': home,
            'is-login': login,
            'is-fill': filling,
            'is-editor': route.path.startsWith('/editor/'),
          }"
        >
          <header class="topbar">
            <div class="breadcrumb">
              <router-link to="/">{{ filling ? '问达 ASKWELL' : '工作空间' }}</router-link>
              <span>/</span>
              <strong>{{ crumb }}</strong>
            </div>
            <div class="top-actions">
              <el-dropdown
                v-if="auth.user && !filling"
                class="mobile-phase-nav"
                trigger="click"
                @command="(path: string) => router.push(path)"
              >
                <button class="account-logout">导航 ▾</button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item
                      v-for="[path, title] in [
                        ['/', '我的问卷'],
                        ['/library', '我的题库'],
                        ['/square', '题目广场'],
                        ['/shares', '共享管理'],
                        ['/communities', '协同社区'],
                      ]"
                      :key="path"
                      :command="path"
                    >
                      {{ title }}
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <button
                v-if="auth.user && !filling"
                class="mobile-create"
                aria-label="新建问卷"
                :disabled="creating"
                @click="create()"
              >
                ＋
              </button>
              <span class="prototype-label">ASKWELL STUDIO</span>
              <template v-if="auth.user">
                <InvitationInbox v-if="!filling" />
                <el-popover trigger="click" width="300">
                  <template #reference>
                    <button class="account-logout">{{ auth.user.username }}</button>
                  </template>
                  <strong>{{ auth.user.username }}</strong>
                  <p>用户 ID</p>
                  <code class="user-id">{{ auth.user.id }}</code>
                  <el-button text @click="copyText(auth.user.id)">复制用户 ID</el-button>
                </el-popover>
                <span class="avatar" aria-hidden="true">
                  {{ auth.user.username.slice(0, 1).toUpperCase() }}
                </span>
                <button class="account-logout" @click="logout">退出</button>
              </template>
              <router-link v-else-if="!login" to="/login" class="account-logout">登录</router-link>
            </div>
          </header>
          <div v-if="!auth.loaded" class="route-loading">正在连接工作空间…</div>
          <router-view v-else :key="route.path" v-slot="{ Component }">
            <component
              :is="Component"
              @create="create()"
              :class="['route-view', home ? 'home-view' : 'scroll-view']"
            />
          </router-view>
          <footer class="statusbar">
            <span>
              <i class="dot"></i>
              问达 ASKWELL · 认真提问，真诚作答
            </span>
            <span>STAY CURIOUS. &nbsp; ↗</span>
          </footer>
        </main>
      </div>
    </div>
  </div>
  <el-dialog v-model="createOpen" title="新建问卷" width="500px" :close-on-click-modal="false">
    <el-form label-position="top">
      <el-form-item label="问卷标题">
        <el-input v-model="createTitle" maxlength="120" placeholder="为问卷起一个名字" />
      </el-form-item>
      <el-form-item label="问卷归属">
        <el-select v-model="createSpace" :empty-values="[null, undefined]">
          <el-option label="个人空间" value="" />
          <el-option v-for="c in createCommunities" :key="c._id" :label="c.name" :value="c._id" />
        </el-select>
      </el-form-item>
    </el-form>
    <p>问卷归属创建后固定；使用社区题不会改变归属。</p>
    <template #footer>
      <el-button :disabled="creating" @click="createOpen = false">取消</el-button>
      <el-button
        type="primary"
        :loading="creating"
        :disabled="!createTitle.trim()"
        @click="confirmCreate"
      >
        创建草稿
      </el-button>
    </template>
  </el-dialog>
  <el-dialog
    v-model="workspace.templatesOpen"
    title="从一个好起点开始。"
    class="studio-template-dialog"
    width="760px"
    align-center
  >
    <p class="muted">选择模板，创建一份可以自由修改的真实问卷草稿。</p>
    <div class="template-grid">
      <button
        v-for="(t, i) in templates"
        :key="t.title"
        :class="['template-tile', 'issue-' + i]"
        :disabled="creating"
        @click="create(i)"
      >
        <div class="issue-cover" aria-hidden="true">
          <div class="issue-top">
            <span>QUESTIONNAIRE / {{ String(i + 1).padStart(2, '0') }}</span>
            <span>TEMPLATE</span>
          </div>
          <div class="cover-art"></div>
          <div class="cover-heading">
            <span v-for="line in t.cover" :key="line">{{ line }}</span>
          </div>
        </div>
        <h3>{{ t.title }}</h3>
        <p>{{ t.description }}</p>
        <span>使用模板 ↗</span>
      </button>
    </div>
  </el-dialog>
</template>
