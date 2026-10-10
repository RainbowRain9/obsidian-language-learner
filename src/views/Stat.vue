<template>
	<div class="stat-analytics-dashboard">
		<!-- 顶层 KPI 计数概览小卡片 -->
		<div class="kpi-cards-row">
			<div class="kpi-card">
				<span class="kpi-label">{{ t("Total Words") }}</span>
				<span class="kpi-val">{{ totalWords.toLocaleString() }}</span>
			</div>
			<div class="kpi-card accent-learning">
				<span class="kpi-label">{{ t("Learning Words") }}</span>
				<span class="kpi-val">{{ learningWords.toLocaleString() }}</span>
			</div>
			<div class="kpi-card accent-ignore">
				<span class="kpi-label">{{ t("Ignored") }}</span>
				<span class="kpi-val">{{ ignoreWords.toLocaleString() }}</span>
			</div>
		</div>

		<!-- 中层 7 天趋势图分析 -->
		<div class="chart-section-card">
			<CustomChart :title="t('Words')" :dates="last7days" :series="chartSeries" />
		</div>

		<!-- 底层 2 个比例分布 Donut 饼图 -->
		<div class="donuts-row">
			<DonutChart :title="t('Vocabulary Ratio')" :center-label="t('Total')" :items="statusRatioItems" />
			<DonutChart :title="t('Learning Words Distribution')" :center-label="t('Total')" :items="learningStageItems" />
		</div>

		<!-- 外部复习工具的复习留存图（echarts） -->
		<div id="review-chart" v-show="hasReviewData"></div>
		<div v-if="reviewLoaded && !hasReviewData" id="review-empty">{{ t("No review records yet") }}</div>
	</div>
</template>

<script setup lang="ts">
import { moment } from "obsidian";
import { onMounted, onUnmounted, getCurrentInstance, ref, watch } from "vue";
import { currentLanguageRef, t } from "@/lang/helper";
import LanguageLearner from "@/plugin";
import { aggregateReviewStats } from "@/utils/word-file";
import CustomChart from "./CustomChart.vue";
import DonutChart, { DonutItem } from "./DonutChart.vue";

import * as echarts from "echarts/core";

import {
	GridComponent,
	GridComponentOption,
	TooltipComponent,
	TooltipComponentOption,
	TitleComponent,
	TitleComponentOption,
	LegendComponent,
	LegendComponentOption,
} from "echarts/components";
import { LineChart, LineSeriesOption, BarChart, BarSeriesOption } from "echarts/charts";
import { UniversalTransition } from "echarts/features";
import { CanvasRenderer } from "echarts/renderers";



echarts.use([
	GridComponent,
	LineChart,
	BarChart,
	TooltipComponent,
	TitleComponent,
	LegendComponent,
	CanvasRenderer,
	UniversalTransition,
]);

type EChartsOption = echarts.ComposeOption<
	| GridComponentOption
	| LineSeriesOption
	| BarSeriesOption
	| TooltipComponentOption
	| TitleComponentOption
	| LegendComponentOption
>;

const plugin: LanguageLearner = getCurrentInstance().appContext.config.globalProperties.plugin;
const container: HTMLElement =
	getCurrentInstance().appContext.config.globalProperties.container;

let reviewDom: HTMLElement;
let reviewChart: echarts.EChartsType;
let reviewOption: EChartsOption;
// 外部复习工具写入「复习记录」前保持空态提示，不渲染空图
let hasReviewData = ref(false);
let reviewLoaded = ref(false);

// 语言切换时重建 dashboard 标签所需的原始计数（0=ignore / 1=learning / 2=familiar / 3=known / 4=learned）
let rawWordCounts = [0, 0, 0, 0, 0];

const last7days = [6, 5, 4, 3, 2, 1, 0].map((i) =>
	moment().subtract(i, "days").format("M-D")
);

// 7 天趋势图数据（零依赖 SVG CustomChart）
const chartSeries = ref([
	{ name: t("Day Ignore"), color: "#4c6ef5", data: [0, 0, 0, 0, 0, 0, 0], type: "area" as const },
	{ name: t("Day Non-Ignore"), color: "#51cf66", data: [0, 0, 0, 0, 0, 0, 0], type: "area" as const },
]);

// KPI 统计数据
const totalWords = ref(0);
const learningWords = ref(0);
const ignoreWords = ref(0);

// Donut 饼图数据
const statusRatioItems = ref<DonutItem[]>([]);
const learningStageItems = ref<DonutItem[]>([]);

reviewOption = {
	title: {
		text: t("Review Retention"),
	},
	tooltip: {
		trigger: "axis",
	},
	legend: {
		data: [t("Daily Reviews"), t("Cumulative Retention")],
	},
	xAxis: {
		type: "category",
		boundaryGap: true,
		data: [],
	},
	yAxis: [
		{
			type: "value",
			minInterval: 1,
		},
		{
			type: "value",
			min: 0,
			max: 100,
			axisLabel: {
				formatter: "{value}%",
			},
		},
	],
	series: [
		{
			name: t("Daily Reviews"),
			data: [],
			type: "bar",
			yAxisIndex: 0,
			barMaxWidth: 24,
		},
		{
			name: t("Cumulative Retention"),
			data: [],
			type: "line",
			yAxisIndex: 1,
			smooth: true,
			emphasis: {
				focus: "series",
			},
		},
	],
};

onMounted(async () => {
	reviewDom = container.querySelector("#review-chart");
	reviewChart = echarts.init(reviewDom, null, {
		width: 400,
		height: 350,
	});
	reviewOption && reviewChart.setOption(reviewOption);
	applyChartLabels();
	updateChart();
	updateReviewChart();
});

function applyChartLabels() {
	reviewChart?.setOption({
		title: {
			text: t("Review Retention"),
		},
		legend: {
			data: [t("Daily Reviews"), t("Cumulative Retention")],
		},
		series: [
			{ name: t("Daily Reviews") },
			{ name: t("Cumulative Retention") },
		],
	});
}

async function updateChart() {
	// 获取 7 天趋势数据
	let data = await plugin.db.countSeven();
	let dayIgnoreWords = data.map((d) => d.today[0]);
	let dayNoIgnoreWords = data.map((d) =>
		d.today.slice(1).reduce((a, b) => a + b)
	);

	// 更新原生 SVG 曲线图数据（暂时隐藏累计）
	chartSeries.value = [
		{ name: t("Day Ignore"), color: "#4c6ef5", data: dayIgnoreWords, type: "area" },
		{ name: t("Day Non-Ignore"), color: "#51cf66", data: dayNoIgnoreWords, type: "area" },
	];

	// 获取单词全局状态统计数据
	try {
		let countInfo = await plugin.db.getCount();
		let wordCounts = countInfo.word_count || [0, 0, 0, 0, 0];

		rawWordCounts = wordCounts;
		applyCountLabels(wordCounts);
	} catch (e) {
		console.warn("Failed to load word count info", e);
	}
}

function applyCountLabels(wordCounts: number[]) {
	let ignoreCount = wordCounts[0] || 0;
	let learningCount = wordCounts[1] || 0;
	let familiarCount = wordCounts[2] || 0;
	let knownCount = wordCounts[3] || 0;
	let learnedCount = wordCounts[4] || 0;

	let totalLearningCount = learningCount + familiarCount + knownCount + learnedCount;
	let totalAllCount = ignoreCount + totalLearningCount;

	totalWords.value = totalAllCount;
	learningWords.value = totalLearningCount;
	ignoreWords.value = ignoreCount;

	// 图一：词汇比例 (无视 vs 在学)
	statusRatioItems.value = [
		{ name: t("Ignore"), value: ignoreCount, color: "#748096" },
		{ name: t("Learning Words"), value: totalLearningCount, color: "#4c6ef5" },
	];

	// 图二：在学词汇分布
	learningStageItems.value = [
		{ name: t("Learning"), value: learningCount, color: "#ff922b" },
		{ name: t("Familiar"), value: familiarCount, color: "#fcc419" },
		{ name: t("Known"), value: knownCount, color: "#51cf66" },
		{ name: t("Learned"), value: learnedCount, color: "#20c997" },
	];
}

async function updateReviewChart() {
	if (!reviewChart) {
		return;
	}
	const logs = await plugin.collectReviewLogs();
	const stats = aggregateReviewStats(logs);
	reviewLoaded.value = true;
	hasReviewData.value = stats.dates.length > 0;
	if (!hasReviewData.value) {
		return;
	}
	reviewChart.setOption({
		xAxis: {
			data: stats.dates,
		},
		series: [
			{ data: stats.dailyCounts },
			{ data: stats.cumulativeRetention },
		],
	});
}

// 语言切换时重建 dashboard 各图表的 t() 标签
function applyDashboardLabels() {
	const seriesNames = [t("Day Ignore"), t("Day Non-Ignore")];
	chartSeries.value = chartSeries.value.map((seriesItem, idx) => {
		if (idx < seriesNames.length) {
			return { ...seriesItem, name: seriesNames[idx] };
		}
		return seriesItem;
	});
	applyCountLabels(rawWordCounts);
}

function refreshCharts() {
	updateChart();
	updateReviewChart();
}

onMounted(() => {
	addEventListener("obsidian-langr-refresh-stat", refreshCharts);
});

watch(() => currentLanguageRef.value, () => {
	applyDashboardLabels();
	applyChartLabels();
});

onUnmounted(() => {
	removeEventListener("obsidian-langr-refresh-stat", refreshCharts);
	// 释放 echarts 实例，避免反复开关统计视图造成实例与已分离 DOM 引用累积泄漏
	reviewChart?.dispose();
});

</script>

<style lang="scss">
.stat-analytics-dashboard {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 8px 6px;
	width: 100%;
	box-sizing: border-box;

	.kpi-cards-row {
		display: flex;
		gap: 6px;
		width: 100%;
		box-sizing: border-box;

		.kpi-card {
			flex: 1;
			min-width: 0;
			background-color: var(--background-secondary, #ffffff);
			border: 1px solid var(--background-modifier-border, rgba(128, 128, 128, 0.18));
			border-radius: var(--radius-m, 6px);
			padding: 6px 8px;
			display: flex;
			flex-direction: column;
			box-sizing: border-box;

			.kpi-label {
				font-size: 0.75em;
				color: var(--text-muted);
				margin-bottom: 2px;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.kpi-val {
				font-size: 1.1em;
				font-weight: 700;
				color: var(--text-normal);
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			&.accent-learning .kpi-val {
				color: var(--text-accent, #4c6ef5);
			}

			&.accent-ignore .kpi-val {
				color: var(--text-muted, #748096);
			}
		}
	}

	.chart-section-card {
		background-color: var(--background-secondary, #ffffff);
		border: 1px solid var(--background-modifier-border, rgba(128, 128, 128, 0.18));
		border-radius: var(--radius-m, 8px);
		padding: 8px 6px 4px 6px;
		box-sizing: border-box;
		width: 100%;
	}

	.donuts-row {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 100%;
		box-sizing: border-box;
	}
}

#review-empty {
	width: 400px;
	padding: 24px 0;
	text-align: center;
	color: var(--text-muted);
	font-size: var(--font-ui-small);
	border: 1px dashed var(--background-modifier-border);
	border-radius: 6px;
}
</style>
