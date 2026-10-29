import { ref, watch, onBeforeUnmount, type Ref } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, uid } from './api';
import type { Question, Definition, QuestionType } from '../../api/src/domain';
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const communityMembershipChange = ref(0);
export const query = (values: Record<string, any>) => {
  const q = new URLSearchParams();
  Object.entries(values).forEach(([k, v]) => {
    if (v !== '' && v !== undefined && v !== null) q.set(k, String(v));
  });
  return '?' + q.toString();
};
export const contentOf = (q: Question) =>
  Object.fromEntries(
    ['type', 'title', 'description', 'required', 'options', 'rows', 'validation'].map((k) => [
      k,
      clone((q as any)[k]),
    ]),
  );
export function blankQuestion(type: QuestionType = 'text'): Question {
  const options = ['single_choice', 'multiple_choice', 'matrix', 'ranking'].includes(type);
  return {
    id: uid(),
    type,
    title: '',
    description: '',
    required: true,
    options: options ? Array.from({ length: 3 }, () => ({ id: uid(), label: '' })) : [],
    rows: type === 'matrix' ? Array.from({ length: 2 }, () => ({ id: uid(), label: '' })) : [],
    validation:
      type === 'slider' ? { min: 0, max: 10, step: 1 } : type === 'time' ? { mode: 'date' } : {},
    jumpRules: [],
  };
}
export const asQuestion = (content: any): Question => ({
  ...clone(content),
  id: 'library-preview',
  jumpRules: [],
});
export const singleDefinition = (q: Question): Definition => ({
  title: '题库',
  description: '',
  allowAnonymous: false,
  allowRepeatSubmissions: false,
  schemaVersion: 1,
  questions: [q],
});
export const date = (value: any) => (value ? new Date(value).toLocaleString('zh-CN') : '—');
export const statuses: Record<string, string> = {
  pending: '待接收',
  accepted: '已接受',
  rejected: '已拒绝',
  active: '有效',
  revoked: '已撤回',
};
export const kinds: Record<string, string> = {
  delivery: '用户投递',
  link: '链接共享',
  public: '公开广场',
};
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('已复制');
  } catch {
    ElMessageBox.alert(text, '请复制以下内容');
  }
}
export async function confirm(text: string, title = '请确认') {
  try {
    await ElMessageBox.confirm(text, title, {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
    });
    return true;
  } catch {
    return false;
  }
}
// Every fetch has a generation; late responses can never repopulate a new scope.
export function usePage(url: () => string) {
  const data = ref<any>({ rows: [], total: 0, page: 1, pageSize: 20 }),
    loading = ref(false),
    error = ref('');
  let generation = 0;
  async function load() {
    const request = ++generation;
    loading.value = true;
    error.value = '';
    data.value = { rows: [], total: data.value.total ?? 0, page: 1, pageSize: 20 };
    try {
      const result = await api(url());
      if (request === generation) data.value = result;
    } catch (e: any) {
      if (request === generation) {
        error.value = e.message;
        data.value = { rows: [], total: 0, page: 1, pageSize: 20 };
      }
    } finally {
      if (request === generation) loading.value = false;
    }
  }
  watch(url, load, { immediate: true });
  onBeforeUnmount(() => generation++);
  return { data, loading, error, load };
}
export async function allCommunities() {
  const rows: any[] = [];
  let page = 1,
    result;
  do {
    result = await api('/communities?page=' + page++);
    rows.push(...result.rows);
  } while (rows.length < result.total && result.rows.length);
  return rows;
}
export function protectDraft(dirty: Ref<boolean>) {
  onBeforeRouteLeave(
    async () => !dirty.value || (await confirm('有未保存的输入，确认放弃并离开？', '未保存的内容')),
  );
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (dirty.value) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', beforeUnload);
  onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload));
}
