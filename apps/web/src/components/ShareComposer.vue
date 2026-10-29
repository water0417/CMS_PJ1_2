<script setup lang="ts">
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import { copyText } from '../phase2';
import UserLookup from './UserLookup.vue';
const origin = location.origin;
const props = defineProps<{ questionId: string; versionId: string; number?: number }>();
const kind = ref('delivery'),
  recipient = ref<any>(null),
  busy = ref(false),
  created = ref<any>(null);
watch(kind, () => {
  recipient.value = null;
  created.value = null;
});
async function send() {
  if (busy.value || (kind.value === 'delivery' && !recipient.value)) return;
  busy.value = true;
  try {
    created.value = await api(`/questions/${props.questionId}/shares`, 'POST', {
      kind: kind.value,
      versionId: props.versionId,
      ...(kind.value === 'delivery' ? { recipientId: recipient.value.id } : {}),
    });
    ElMessage.success(kind.value === 'link' ? '分享链接已生成' : '题目已发送');
  } catch (e: any) {
    ElMessage.error(e.status === 404 ? '题目不可用或你已失去访问权限。' : e.message);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="share-composer">
    <p>分享当前已保存的内容，之后的修改不会改变本次分享。</p>
    <el-radio-group v-model="kind" aria-label="分享方式">
      <el-radio-button value="delivery">发送给指定用户</el-radio-button>
      <el-radio-button value="link">生成分享链接</el-radio-button>
    </el-radio-group>
    <UserLookup v-if="kind === 'delivery'" @confirmed="(u) => (recipient = u)" />
    <p v-if="kind === 'delivery' && recipient">将发送给 {{ recipient.username }}</p>
    <el-button
      type="primary"
      :loading="busy"
      :disabled="!!created || (kind === 'delivery' && !recipient)"
      @click="send"
    >
      {{ kind === 'delivery' ? '发送题目' : '生成链接' }}
    </el-button>
    <div v-if="created">
      <p>已完成，可在“共享管理”查看或撤回。</p>
      <el-button
        v-if="created.token"
        @click="copyText(origin + '/question-links/' + created.token)"
      >
        复制分享链接
      </el-button>
      <router-link to="/shares?view=sent">管理分享 ↗</router-link>
    </div>
  </section>
</template>
