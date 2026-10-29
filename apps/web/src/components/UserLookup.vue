<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { api } from '../api';
const emit = defineEmits<{ confirmed: [user: { id: string; username: string } | null] }>();
const mode = ref('name'),
  term = ref(''),
  user = ref<any>(null),
  busy = ref(false),
  error = ref(''),
  confirmed = ref(false);
let sequence = 0;
watch(
  [mode, term],
  () => {
    sequence++;
    user.value = null;
    error.value = '';
    busy.value = false;
    confirmed.value = false;
    emit('confirmed', null);
  },
  { flush: 'sync' },
);
onBeforeUnmount(() => sequence++);
async function lookup() {
  if (busy.value || !term.value) return;
  const request = ++sequence;
  busy.value = true;
  error.value = '';
  user.value = null;
  confirmed.value = false;
  emit('confirmed', null);
  try {
    const result = await api(
      mode.value === 'name'
        ? '/users?username=' + encodeURIComponent(term.value)
        : '/users/' + encodeURIComponent(term.value),
    );
    if (request === sequence) user.value = result;
  } catch (e: any) {
    if (request === sequence)
      error.value =
        e.status === 404
          ? '没有找到这位用户，请检查后重试。'
          : e.status === 400
            ? '请输入正确的用户名或用户ID。'
            : '查询失败，请稍后重试。';
  } finally {
    if (request === sequence) busy.value = false;
  }
}
</script>
<template>
  <div class="phase-lookup">
    <el-radio-group v-model="mode" aria-label="查找方式">
      <el-radio-button value="name">用户名</el-radio-button>
      <el-radio-button value="id">用户ID</el-radio-button>
    </el-radio-group>
    <label>
      {{ mode === 'name' ? '用户名' : '用户ID' }}
      <el-input
        v-model="term"
        :placeholder="mode === 'name' ? '输入完整用户名' : '输入用户ID'"
        @keyup.enter="lookup"
      />
    </label>
    <el-button :loading="busy" :disabled="!term" @click="lookup">查询用户</el-button>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="user" class="lookup-result">
      <strong>{{ user.username }}</strong>
      <small class="user-id">ID：{{ user.id }}</small>
      <el-button
        :disabled="confirmed"
        @click="
          confirmed = true;
          emit('confirmed', user);
        "
      >
        {{ confirmed ? '已选择' : '选择此用户' }}
      </el-button>
    </div>
  </div>
</template>
