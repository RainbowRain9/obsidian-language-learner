<template>
	<div id="chart"></div>
	<div id="review-chart" v-show="hasReviewData"></div>
	<div v-if="reviewLoaded && !hasReviewData" id="review-empty">{{ t("No review records yet") }}</div>
</template>

<script setup lang="ts">
import { moment } from "obsidian";
import { onMounted, onUnmounted, getCurrentInstance, ref, watch } from "vue";
import { currentLanguageRef, t } from "@/lang/helper";
import LanguageLearner from "@/plugin";
import { aggregateReviewStats } from "@/utils/word-file";

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

let charDom: HTMLElement;
let sevenDays: echarts.EChartsType;
let option: EChartsOption;

let reviewDom: HTMLElement;
let reviewChart: echarts.EChartsType;
let reviewOption: EChartsOption;
// 外部复习工具写入「复习记录」前保持空态提示，不渲染空图
let hasReviewData = ref(false);
let reviewLoaded = ref(false);

onMounted(async () => {
	charDom = container.querySelector("#chart");
	// setTimeout(() => {
	sevenDays = echarts.init(charDom, null, {
		width: 400,
		height: 350,
	});
	option && sevenDays.setOption(option);
	reviewDom = container.querySelector("#review-chart");
	reviewChart = echarts.init(reviewDom, null, {
		width: 400,
		height: 350,
	});
	reviewOption && reviewChart.setOption(reviewOption);
	applyChartLabels();
	// },0)
	updateChart();
	updateReviewChart();
});

const last7days = [6, 5, 4, 3, 2, 1, 0].map((i) =>
	moment().subtract(i, "days").format("M-D")
);

option = {
	title: {
		text: t("Words"),
	},
	tooltip: {
		trigger: "axis",
	},
	xAxis: {
		type: "category",
		boundaryGap: false,
		data: last7days,
	},
	yAxis: {
		type: "value",
	},
	series: [
		{
			name: t("Day Ignore"),
			data: [],
			type: "line",
			areaStyle: {},
			smooth: true,
			// encode: {
			//   tooltip: ["words"]
			// },
			emphasis: {
				focus: "series",
			},
			stack: "single",
		},
		{
			name: t("Day Non-Ignore"),
			data: [],
			type: "line",
			areaStyle: {},
			smooth: true,
			// encode: {
			//   tooltip: ["words"]
			// },
			emphasis: {
				focus: "series",
			},
			stack: "single",
		},
		{
			name: t("Accumulated"),
			data: [],
			type: "line",
			smooth: true,
			emphasis: {
				focus: "series",
			},
		},
	],
};

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

function applyChartLabels() {
	if (!sevenDays) {
		return;
	}

	sevenDays.setOption({
		title: {
			text: t("Words"),
		},
		series: [
			{ name: t("Day Ignore") },
			{ name: t("Day Non-Ignore") },
			{ name: t("Accumulated") },
		],
	});

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
	let data = await plugin.db.countSeven();
	let dayIgnoreWords = data.map((d) => d.today[0]);
	let dayNoIgnoreWords = data.map((d) =>
		d.today.slice(1).reduce((a, b) => a + b)
	);
	let accumAllWords = data.map((d) => d.accumulated.reduce((a, b) => a + b));

	sevenDays.setOption({
		series: [
			{ data: dayIgnoreWords },
			{ data: dayNoIgnoreWords },
			{ data: accumAllWords },
		],
	});
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

function refreshCharts() {
	updateChart();
	updateReviewChart();
}

onMounted(() => {
	addEventListener("obsidian-langr-refresh-stat", refreshCharts);
});

watch(() => currentLanguageRef.value, () => {
	applyChartLabels();
});

onUnmounted(() => {
	removeEventListener("obsidian-langr-refresh-stat", refreshCharts);
});

</script>

<style scoped>
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
