<template>
    <div class="custom-chart-container" ref="containerRef" @mousemove="onMouseMove" @mouseleave="onMouseLeave">
        <div class="chart-header">
            <h3 class="chart-title">{{ title ?? "Words" }}</h3>
        </div>
        <div class="chart-svg-wrapper">
            <svg class="chart-svg" :viewBox="`0 0 ${containerWidth} ${svgHeight}`" preserveAspectRatio="none">
                <defs>
                    <!-- 渐变定义 -->
                    <linearGradient v-for="(seriesItem, idx) in series" :key="`grad-${idx}`" :id="`chart-grad-${idx}`" x1="0"
                        y1="0" x2="0" y2="1">
                        <stop offset="0%" :stop-color="seriesItem.color" stop-opacity="0.35" />
                        <stop offset="100%" :stop-color="seriesItem.color" stop-opacity="0.02" />
                    </linearGradient>
                </defs>

                <!-- 网格横线与 Y 轴刻度文字 -->
                <g class="y-axis-group">
                    <g v-for="(tick, idx) in yTicks" :key="`ytick-${idx}`">
                        <line class="grid-line" :x1="margin.left" :y1="tick.y" :x2="containerWidth - margin.right"
                            :y2="tick.y" />
                        <text class="axis-text y-text" :x="margin.left - 6" :y="tick.y + 4" text-anchor="end">
                            {{ formatNumber(tick.value) }}
                        </text>
                    </g>
                </g>

                <!-- X 轴刻度文字 -->
                <g class="x-axis-group">
                    <text v-for="(dateItem, idx) in dates" :key="`xtext-${idx}`" class="axis-text x-text" :x="getX(idx)"
                        :y="svgHeight - margin.bottom + 16" text-anchor="middle">
                        {{ dateItem }}
                    </text>
                </g>

                <!-- 面积填充 Path (Area) -->
                <g class="area-group">
                    <template v-for="(seriesItem, idx) in series" :key="`area-${idx}`">
                        <path v-if="seriesItem.type === 'area' && getSeriesPoints(seriesItem.data).length > 1"
                            :d="getAreaPath(getSeriesPoints(seriesItem.data))" :fill="`url(#chart-grad-${idx})`" />
                    </template>
                </g>

                <!-- 曲线 Path (Line) -->
                <g class="line-group">
                    <path v-for="(seriesItem, idx) in series" :key="`line-${idx}`"
                        :d="getSmoothPath(getSeriesPoints(seriesItem.data))" fill="none" :stroke="seriesItem.color" stroke-width="2.5"
                        stroke-linecap="round" stroke-linejoin="round" />
                </g>

                <!-- 数据节点圆点 (Data Point Bullets) -->
                <g class="bullets-group">
                    <template v-for="(seriesItem, idx) in series" :key="`bullets-${idx}`">
                        <circle v-for="(point, pointIndex) in getSeriesPoints(seriesItem.data)" :key="`bullet-${idx}-${pointIndex}`"
                            :cx="point.x" :cy="point.y" r="3.5" :fill="bulletBackgroundColor" :stroke="seriesItem.color" stroke-width="2.2" />
                    </template>
                </g>

                <!-- 悬浮准星虚线 (Crosshair) -->
                <g v-if="activeIndex !== null" class="crosshair-group">
                    <line class="crosshair-line" :x1="getX(activeIndex)" :y1="margin.top" :x2="getX(activeIndex)"
                        :y2="svgHeight - margin.bottom" stroke-dasharray="3 3" />
                    <!-- 当前列的各系列高亮圈 -->
                    <circle v-for="(seriesItem, idx) in series" :key="`active-bullet-${idx}`"
                        :cx="getSeriesPoints(seriesItem.data)[activeIndex]?.x" :cy="getSeriesPoints(seriesItem.data)[activeIndex]?.y"
                        r="5" :fill="seriesItem.color" stroke="#ffffff" stroke-width="2" />
                </g>
            </svg>

            <!-- 悬浮 Tooltip 窗口 -->
            <div v-if="activeIndex !== null" class="chart-tooltip" :style="tooltipStyle">
                <div class="tooltip-date">{{ dates[activeIndex] }}</div>
                <div v-for="(seriesItem, idx) in series" :key="`tt-series-${idx}`" class="tooltip-row">
                    <span class="tooltip-dot" :style="{ backgroundColor: seriesItem.color }"></span>
                    <span class="tooltip-name">{{ seriesItem.name }}</span>
                    <span class="tooltip-val">{{ formatNumber(seriesItem.data[activeIndex] || 0) }}</span>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";

interface SeriesItem {
    name: string;
    color: string;
    data: number[];
    type?: "area" | "line";
}

const props = defineProps<{
    dates: string[];
    series: SeriesItem[];
    title?: string;
}>();

const containerRef = ref<HTMLElement | null>(null);

// 动态容器宽度与固定高度，确保文字和节点尺寸绝不受比例缩放影响
const containerWidth = ref<number>(380);
const svgHeight = 190;
const margin = { top: 20, right: 20, bottom: 25, left: 35 };

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
    if (containerRef.value) {
        resizeObserver = new ResizeObserver((entries) => {
            for (let entry of entries) {
                if (entry.contentRect.width > 0) {
                    containerWidth.value = entry.contentRect.width;
                }
            }
        });
        resizeObserver.observe(containerRef.value);
    }
});

onUnmounted(() => {
    if (resizeObserver) {
        resizeObserver.disconnect();
    }
});

// 当前 hover 的 X 轴索引及鼠标像素位置
const activeIndex = ref<number | null>(null);
const mousePixelX = ref<number>(0);
const mousePixelY = ref<number>(0);

// 用于 SVG 点中实心背景填色 (取原生二级背景变量)
const bulletBackgroundColor = "var(--background-secondary, #ffffff)";

// 计算最大值与 Y 轴刻度
const maxDataValue = computed(() => {
    let max = 0;
    props.series.forEach((seriesItem) => {
        seriesItem.data.forEach((val) => {
            if (val > max) max = val;
        });
    });
    return max > 0 ? max : 10;
});

const yTicks = computed(() => {
    const rawMax = maxDataValue.value;
    // 向上四舍五入适当整数
    let step = Math.ceil(rawMax / 4);
    if (step < 1) step = 1;
    // 稍微修饰 step 为整 10/50/100/300 等
    if (step > 10 && step <= 25) step = 25;
    else if (step > 25 && step <= 50) step = 50;
    else if (step > 50 && step <= 100) step = 100;
    else if (step > 100 && step <= 300) step = 300;

    const maxTick = step * 4;
    const ticks = [];
    const chartHeight = svgHeight - margin.top - margin.bottom;

    for (let i = 0; i <= 4; i++) {
        const val = i * step;
        const y = svgHeight - margin.bottom - (val / maxTick) * chartHeight;
        ticks.push({ value: val, y });
    }
    return ticks;
});

// 计算 X 轴坐标
function getX(index: number): number {
    const total = props.dates.length;
    if (total <= 1) return margin.left;
    const chartWidth = containerWidth.value - margin.left - margin.right;
    return margin.left + (index / (total - 1)) * chartWidth;
}

// 获取各系列数据点的二维像素坐标 (x, y)
function getSeriesPoints(data: number[]): { x: number; y: number }[] {
    const chartHeight = svgHeight - margin.top - margin.bottom;
    const maxTick = yTicks.value[yTicks.value.length - 1].value || 1;

    return data.map((val, idx) => {
        const x = getX(idx);
        const y = svgHeight - margin.bottom - (val / maxTick) * chartHeight;
        return { x, y };
    });
}

// 三次贝塞尔曲线平滑路径算法
function getSmoothPath(points: { x: number; y: number }[]): string {
    if (!points || points.length === 0) return "";
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i === 0 ? i : i - 1];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2 < points.length ? i + 2 : i + 1];

        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;

        path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    return path;
}

// 面积图闭合路径
function getAreaPath(points: { x: number; y: number }[]): string {
    if (!points || points.length < 2) return "";
    const smoothLine = getSmoothPath(points);
    const bottomY = svgHeight - margin.bottom;
    const firstX = points[0].x;
    const lastX = points[points.length - 1].x;

    return `${smoothLine} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;
}

// 千分位格式化
function formatNumber(num: number): string {
    return num.toLocaleString();
}

// 鼠标悬停事件
function onMouseMove(event: MouseEvent) {
    if (!containerRef.value) return;
    const rect = containerRef.value.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    mousePixelX.value = mouseX;
    mousePixelY.value = mouseY;

    const relativeX = mouseX;

    // 找到最接近的日期 index
    let closestIndex = 0;
    let minDifference = Infinity;
    props.dates.forEach((_, idx) => {
        const diff = Math.abs(getX(idx) - relativeX);
        if (diff < minDifference) {
            minDifference = diff;
            closestIndex = idx;
        }
    });
    activeIndex.value = closestIndex;
}

function onMouseLeave() {
    activeIndex.value = null;
}

// Tooltip 丝滑跟随鼠标的平滑 translate3d 样式 (全方位 X/Y 双向跟随)
const tooltipStyle = computed(() => {
    if (activeIndex.value === null || !containerRef.value) {
        return { opacity: 0, transform: "scale(0.95)" };
    }
    const rect = containerRef.value.getBoundingClientRect();
    const width = rect.width || 300;
    const height = rect.height || 250;

    // 靠右 55% 时，Tooltip 自动平滑翻转至光标左侧，防止挡出屏幕
    const isRightHalf = mousePixelX.value > width * 0.55;
    const offsetX = isRightHalf ? -12 : 12;
    const translateX = isRightHalf ? "-100%" : "0%";

    // 靠下 65% 时，Tooltip 自动平滑翻转至光标上方，防止挡出屏幕
    const isBottomHalf = mousePixelY.value > height * 0.65;
    const offsetY = isBottomHalf ? -12 : 12;
    const translateY = isBottomHalf ? "-100%" : "0%";

    return {
        opacity: 1,
        transform: `translate3d(${mousePixelX.value + offsetX}px, ${mousePixelY.value + offsetY}px, 0) translate(${translateX}, ${translateY})`,
    };
});
</script>

<style lang="scss">
.custom-chart-container {
    position: relative;
    width: 100%;
    user-select: none;
    font-size: 0.85em;

    .chart-header {
        padding: 4px 6px;

        .chart-title {
            margin: 0;
            font-size: 1.15em;
            font-weight: 700;
            color: var(--text-normal);
        }
    }

    .chart-svg-wrapper {
        position: relative;
        width: 100%;
    }

    .chart-svg {
        width: 100%;
        height: 190px;
        display: block;

        .grid-line {
            stroke: var(--background-modifier-border, rgba(128, 128, 128, 0.18));
            stroke-width: 1;
            stroke-dasharray: 2 2;
        }

        .axis-text {
            font-size: 11px;
            fill: var(--text-muted);
            font-family: inherit;
        }

        .crosshair-line {
            stroke: var(--text-muted);
            stroke-width: 1;
            opacity: 0.5;
        }
    }

    .chart-tooltip {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 200;
        background-color: var(--background-primary, #ffffff);
        color: var(--text-normal);
        border: 1px solid var(--background-modifier-border, rgba(128, 128, 128, 0.2));
        border-radius: var(--radius-m, 6px);
        padding: 8px 12px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
        pointer-events: none;
        min-width: 110px;
        transition: transform 0.12s cubic-bezier(0.1, 0.9, 0.2, 1), opacity 0.15s ease;
        will-change: transform;

        .tooltip-date {
            font-size: 0.9em;
            font-weight: 600;
            margin-bottom: 6px;
            color: var(--text-muted);
            border-bottom: 1px solid var(--background-modifier-border, rgba(128, 128, 128, 0.15));
            padding-bottom: 3px;
        }

        .tooltip-row {
            display: flex;
            align-items: center;
            font-size: 0.85em;
            margin-bottom: 4px;

            &:last-child {
                margin-bottom: 0;
            }

            .tooltip-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                margin-right: 6px;
                flex-shrink: 0;
            }

            .tooltip-name {
                flex: 1;
                margin-right: 10px;
                color: var(--text-muted);
            }

            .tooltip-val {
                font-weight: 600;
                color: var(--text-normal);
            }
        }
    }
}
</style>
