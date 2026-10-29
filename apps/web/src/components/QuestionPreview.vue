<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import AnswerInput from './AnswerInput.vue';
import { labels } from '../api';
import { asQuestion } from '../phase2';
const props = defineProps<{ content: any }>();
const answer = ref<any>();
const q = computed(() => asQuestion(props.content));
watch(
  () => props.content,
  () => (answer.value = undefined),
);
</script>
<template>
  <section class="panel phase-preview">
    <small>{{ labels[content.type] }} · {{ content.required ? '必答' : '选填' }} · 内容预览</small>
    <h2>{{ content.title }}</h2>
    <p v-if="content.description">{{ content.description }}</p>
    <AnswerInput :question="q" v-model="answer" />
    <small>试填仅用于预览，不会提交答案。</small>
  </section>
</template>
