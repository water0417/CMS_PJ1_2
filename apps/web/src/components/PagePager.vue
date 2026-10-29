<script setup lang="ts">
defineProps<{ total: number; page: number; size?: number }>();
defineEmits<{ change: [page: number] }>();
</script>
<template>
  <div class="phase-pager">
    <span>共 {{ total }} 条</span>
    <el-pagination
      layout="prev,pager,next"
      :total="total"
      :page-size="size || 20"
      :current-page="page"
      @current-change="(p: number) => $emit('change', p)"
    />
  </div>
</template>
