<template>
    <div class="donut-chart-card">
        <h4 class="card-title">{{ title }}</h4>
        <div class="donut-chart-body">
            <!-- 环形 SVG 容器 -->
            <div class="donut-svg-wrapper">
                <svg class="donut-svg" viewBox="0 0 100 100">
                    <!-- 背景底环 -->
                    <circle cx="50" cy="50" :r="radius" fill="none" stroke="var(--background-modifier-border, rgba(128, 128, 128, 0.15))"
                        :stroke-width="strokeWidth" />

                    <!-- 扇区切片 -->
                    <circle v-for="(slice, idx) in slices" :key="`slice-${idx}`" cx="50" cy="50" :r="radius" fill="none"
                        :stroke="slice.color" :stroke-width="hoverIndex === idx ? strokeWidth + 3 : strokeWidth"
                        :stroke-dasharray="`${slice.dashLength} ${circumference - slice.dashLength}`"
                        :stroke-dashoffset="slice.dashOffset"
                        class="donut-segment"
                        :class="{ active: hoverIndex === idx }"
                        @mouseenter="hoverIndex = idx"
                        @mouseleave="hoverIndex = null" />
                </svg>

                <!-- 中心文本信息 -->
                <div class="donut-center-info">
                    <span class="center-val">{{ displayValue }}</span>
                    <span class="center-label">{{ displayLabel }}</span>
                </div>
            </div>

            <!-- 图例列表 -->
            <div class="donut-legend-list">
                <div v-for="(item, idx) in itemsWithRatio" :key="`legend-${idx}`" class="legend-item"
                    :class="{ active: hoverIndex === idx }" @mouseenter="hoverIndex = idx" @mouseleave="hoverIndex = null">
                    <span class="legend-dot" :style="{ backgroundColor: item.color }"></span>
                    <span class="legend-name">{{ item.name }}</span>
                    <span class="legend-val">{{ item.value }}</span>
                    <span class="legend-pct">{{ item.percentageText }}%</span>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";

export interface DonutItem {
    name: string;
    value: number;
    color: string;
}

const props = defineProps<{
    title: string;
    items: DonutItem[];
    centerLabel?: string;
}>();

const radius = 38;
const strokeWidth = 10;
const circumference = 2 * Math.PI * radius; // ~238.76

const hoverIndex = ref<number | null>(null);

// 计算总值
const totalValue = computed(() => {
    return props.items.reduce((sum, item) => sum + item.value, 0);
});

// 各项计算百分比
const itemsWithRatio = computed(() => {
    const total = totalValue.value;
    return props.items.map((item) => {
        const percentageText = total > 0 ? ((item.value / total) * 100).toFixed(1) : "0.0";
        return {
            ...item,
            percentageText,
        };
    });
});

// 计算每个扇区的 stroke-dasharray 和 dashoffset
const slices = computed(() => {
    const total = totalValue.value;
    if (total === 0) return [];

    let accumulatedRatio = 0;
    return props.items.map((item) => {
        const ratio = item.value / total;
        const dashLength = ratio * circumference;
        // 起始偏移 (-90度置顶开端)
        const dashOffset = -(accumulatedRatio * circumference);
        accumulatedRatio += ratio;

        return {
            color: item.color,
            dashLength,
            dashOffset,
        };
    });
});

// 中心展示文本
const displayValue = computed(() => {
    if (hoverIndex.value !== null && itemsWithRatio.value[hoverIndex.value]) {
        return `${itemsWithRatio.value[hoverIndex.value].percentageText}%`;
    }
    return totalValue.value.toLocaleString();
});

const displayLabel = computed(() => {
    if (hoverIndex.value !== null && itemsWithRatio.value[hoverIndex.value]) {
        return itemsWithRatio.value[hoverIndex.value].name;
    }
    return props.centerLabel ?? "Total";
});
</script>

<style lang="scss">
.donut-chart-card {
    background-color: var(--background-secondary, #ffffff);
    border: 1px solid var(--background-modifier-border, rgba(128, 128, 128, 0.18));
    border-radius: var(--radius-m, 8px);
    padding: 8px 10px;
    width: 100%;
    box-sizing: border-box;

    .card-title {
        margin: 0 0 6px 0;
        font-size: 0.88em;
        font-weight: 600;
        color: var(--text-normal);
    }

    .donut-chart-body {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;

        @media (max-width: 220px) {
            flex-direction: column;
        }
    }

    .donut-svg-wrapper {
        position: relative;
        width: 75px;
        height: 75px;
        flex-shrink: 0;

        .donut-svg {
            width: 100%;
            height: 100%;
            transform: rotate(-90deg);
        }

        .donut-segment {
            transition: stroke-width 0.2s ease, opacity 0.2s ease;

            &.active {
                opacity: 1;
                filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
            }
        }

        .donut-center-info {
            position: absolute;
            inset: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            pointer-events: none;
            text-align: center;

            .center-val {
                font-size: 0.9em;
                font-weight: 700;
                color: var(--text-normal);
                line-height: 1.1;
            }

            .center-label {
                font-size: 0.7em;
                color: var(--text-muted);
                margin-top: 1px;
            }
        }
    }

    .donut-legend-list {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
        font-size: 0.8em;

        .legend-item {
            display: flex;
            align-items: center;
            padding: 2px 4px;
            border-radius: 4px;
            cursor: pointer;
            transition: background-color 0.15s ease;
            width: 100%;
            box-sizing: border-box;

            &:hover,
            &.active {
                background-color: var(--background-modifier-hover);
            }

            .legend-dot {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                margin-right: 6px;
                flex-shrink: 0;
            }

            .legend-name {
                flex: 1;
                min-width: 0;
                color: var(--text-muted);
                margin-right: 6px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .legend-val {
                font-weight: 600;
                color: var(--text-normal);
                width: 48px;
                text-align: right;
                margin-right: 8px;
                flex-shrink: 0;
            }

            .legend-pct {
                font-size: 0.85em;
                color: var(--text-muted);
                width: 48px;
                text-align: right;
                flex-shrink: 0;
            }
        }
    }
}
</style>
