<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { api } from '../api';
import { query } from '../phase2';
const props = defineProps<{ provenance: any }>();
const text = ref('');
let sequence = 0;
watch(
  () => props.provenance,
  async (p) => {
    const request = ++sequence;
    text.value = '';
    if (!p) return;
    const channel: Record<string, string> = {
      'library-copy': '复制',
      'library-save-as': '另存',
      delivery: '收到分享后保存',
      link: '通过分享链接保存',
      public: '从公开题库保存',
      'survey-save': '从问卷保存',
    };
    const action = channel[p.channel] || '保存副本';
    text.value = `${action}的独立题目，正在读取来源…`;
    if (!p.questionId || !p.versionId) {
      text.value = `${action}的独立题目，来源信息不完整。`;
      return;
    }
    try {
      const r = await api('/questions/' + p.questionId + query({ versionId: p.versionId }));
      if (request === sequence)
        text.value = `由《${r.version.content.title || '未命名题目'}》的第${r.version.number}次保存内容${action}。`;
    } catch (e: any) {
      if (request === sequence)
        text.value = `${action}的独立题目；${e.status === 404 ? '来源不存在或你无权查看，无法显示来源标题和保存次数。' : '来源暂时无法读取。'}`;
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => sequence++);
</script>
<template>
  <p v-if="text" class="question-origin">{{ text }}</p>
</template>
<style scoped>
.question-origin {
  font-size: 13px;
  color: #777;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
</style>
