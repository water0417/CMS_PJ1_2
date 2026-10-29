<script setup lang="ts">
defineProps<{ data: any; content: any }>();
const number = (v: any) =>
  v == null ? '暂无数据' : Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const label = (q: any, id: any) => q.options.find((o: any) => o.id === id)?.label ?? String(id);
</script>
<template>
  <section class="panel phase-box">
    <h2>{{ content.title }}</h2>
    <p>
      <strong>{{ data.answerCount }}</strong>
      次实例回答 · 非去重人数
    </p>
    <p v-if="!data.answerCount">暂无有效数据。</p>
    <div v-if="data.numeric" class="numeric-summary">
      <div>
        <span>回答数</span>
        <strong>{{ data.numeric.answerCount }}</strong>
      </div>
      <div
        v-for="[key, name] in [
          ['average', '平均值'],
          ['min', '最小值'],
          ['max', '最大值'],
        ]"
        :key="key"
      >
        <span>{{ name }}</span>
        <strong>{{ number(data.numeric[key]) }}</strong>
      </div>
    </div>
    <div v-for="d in data.distribution || []" :key="String(d._id)" class="distribution-row">
      <div>
        <span>
          <i
            v-if="content.type === 'color'"
            class="color-swatch"
            :style="{ background: d._id }"
          ></i>
          {{
            ['single_choice', 'multiple_choice'].includes(content.type)
              ? label(content, d._id)
              : d._id
          }}
        </span>
        <strong>
          {{ d.count }} 次 ·
          {{ data.answerCount ? ((d.count / data.answerCount) * 100).toFixed(1) : 0 }}%
        </strong>
      </div>
      <el-progress
        :percentage="data.answerCount ? Math.min(100, (d.count / data.answerCount) * 100) : 0"
        :show-text="false"
      />
    </div>
    <p v-if="content.type === 'multiple_choice'">比例以实例回答次数为分母，合计可超过 100%。</p>
    <div v-for="(r, i) in data.rows || []" :key="i" class="phase-row">
      <span>{{ r.value }}</span>
      <small>{{ new Date(r.submittedAt).toLocaleString('zh-CN') }}</small>
    </div>
    <div v-if="data.matrix" class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>评价项目</th>
            <th v-for="o in content.options" :key="o.id">{{ o.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in content.rows" :key="r.id">
            <th>{{ r.label }}</th>
            <td v-for="o in content.options" :key="o.id">
              {{
                data.matrix.find((m: any) => m._id.row === r.id && m._id.option === o.id)?.count ||
                0
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="data.ranking" class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>选项</th>
            <th>平均名次</th>
            <th>首选次数</th>
            <th>名次分布</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in data.ranking" :key="r._id">
            <th>{{ label(content, r._id) }}</th>
            <td>{{ number(r.averageRank) }}</td>
            <td>{{ r.firstCount }}</td>
            <td>
              {{
                data.rankDistribution
                  .filter((d: any) => d._id.option === r._id)
                  .map((d: any) => `${d._id.rank}名：${d.count}次`)
                  .join(' / ')
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
