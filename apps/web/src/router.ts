import { createRouter, createWebHistory } from 'vue-router';
import Dashboard from './pages/Dashboard.vue';
import Editor from './pages/Editor.vue';
import Fill from './pages/Fill.vue';
import Stats from './pages/Stats.vue';
import Login from './pages/Login.vue';
import { auth, loadAuth } from './api';
import Library from './pages/Library.vue';
import QuestionDetail from './pages/QuestionDetail.vue';
import QuestionInsights from './pages/QuestionInsights.vue';
import Shares from './pages/Shares.vue';
import ShareLink from './pages/ShareLink.vue';
import Communities from './pages/Communities.vue';
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Dashboard },
    { path: '/login', component: Login },
    { path: '/library', component: Library },
    { path: '/questions/:id', component: QuestionDetail },
    { path: '/question-insights/:id', component: QuestionInsights },
    { path: '/square', component: Shares },
    { path: '/shares', component: Shares },
    { path: '/question-links/:token', component: ShareLink },
    { path: '/communities', component: Communities },
    { path: '/communities/:id', component: Communities },
    { path: '/editor/:id', component: Editor },
    { path: '/survey/:publicId', component: Fill },
    { path: '/statistics/:id', component: Stats },
  ],
});

router.beforeEach(async (to) => {
  if (!auth.loaded) await loadAuth();
  if (to.path !== '/login' && !auth.user) return { path: '/login', query: { next: to.fullPath } };
});
