<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { ElMessage } from 'element-plus';
import QuestionPreview from '../components/QuestionPreview.vue';
const route = useRoute(),
  router = useRouter(),
  data = ref<any>(null),
  error = ref(''),
  loading = ref(false);
async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api('/question-links/' + route.params.token);
  } catch (e: any) {
    data.value = null;
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
async function accept() {
  if (loading.value || !data.value) return;
  loading.value = true;
  try {
    const result = await api(`/shares/${data.value.share._id}/accept`, 'POST', {
      token: String(route.params.token),
    });
    ElMessage.success(result.alreadyAccepted ? '打开此前接收的副本' : '已转存个人副本');
    router.push('/questions/' + result.question._id);
  } catch (e: any) {
    error.value = e.message;
    if (e.status === 404) data.value = null;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>
<template>
  <div class="phase-page" v-loading="loading">
    <header class="phase-heading">
      <div>
        <h1>分享给你的好问题</h1>
        <p>保存到自己的题库后，可以独立编辑。原题之后的修改不会改变这次分享。</p>
      </div>
    </header>
    <p v-if="error" class="phase-error">
      {{ error }}
      <el-button @click="load">重新读取分享</el-button>
    </p>
    <template v-if="data">
      <QuestionPreview :content="data.version.content" />
      <el-button type="primary" :loading="loading" @click="accept">转存到我的题库</el-button>
    </template>
  </div>
</template>
