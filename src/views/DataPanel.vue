<template>
    <div id="langr-data">
        <NConfigProvider :theme="theme" :theme-overrides="themeConfig">
            <div style="display:flex; align-items:center;">
                <span
                    style="display: inline-block; width: 70px; font-size: 1.2em; font-weight: bold; margin-right: 15px;">{{ t("Search") }}:</span>
                <NInput size="small" v-model:value="searchText" />
            </div>
            <NSpace style="margin: 10px 0;" align="center">
                <span
                    style="display: inline-block; width: 70px; font-size: 1.2em; font-weight: bold; margin-right: 5px;">
                    {{ t("Tags") }}:
                </span>
                <select v-model="mode">
                    <option value="and">{{ t("And") }}</option>
                    <option value="or">{{ t("Or") }}</option>
                </select>
                <NTag v-for="(tag, i) in tags" size="small" checkable v-model:checked="checkedTags[i]">
                    {{ "#" + tag }}
                </NTag>
            </NSpace>
            <NDataTable ref="table" size="small" :loading="loading" :data="data" :columns="columns"
                :row-key="makeRowKey" @update:checked-row-keys="handleCheck" :pagination="{ pageSize: 10 }" />
        </NConfigProvider>
    </div>
</template>

<script setup lang="ts">
import { moment } from "obsidian";
import {
    h,
    ref,
    computed,
    watch,
    watchEffect,
    getCurrentInstance,
    Suspense,
    defineAsyncComponent,
    onMounted,
} from "vue";
import {
    NConfigProvider,
    NDataTable,
    NTag,
    GlobalThemeOverrides,
    darkTheme,
    NSpace,
    NInput,
} from "naive-ui";
import { t } from "@/lang/helper";

import type { DataTableColumns, DataTableRowKey } from "naive-ui";
import type PluginType from "@/plugin";

const WordMore = defineAsyncComponent(() => import("@comp/WordMore.vue"));

const plugin = getCurrentInstance().appContext.config.globalProperties
    .plugin as PluginType;

const themeConfig: GlobalThemeOverrides = {
    DataTable: {
        fontSizeSmall: plugin.constants.platform === "mobile" ? "10px" : "14px",
        tdPaddingSmall: "8px",
    },
};

// 切换明亮/黑暗模式
const theme = computed(() => {
    return plugin.store.dark ? darkTheme : null;
});


interface Row {
    expr: string;
    exprLower: string;
    status: number;
    meaning: string;
    tags: string[];
    tagSet: Set<string>;
    date: string;
    senNum: number;
    noteNum: number;
}

const statusLabels = computed(() => [
    t("Ignore"),
    t("Learning"),
    t("Familiar"),
    t("Known"),
    t("Learned"),
]);


let loading = ref(true);
const loadData = async () => {
    loading.value = true;
    let rawData = await plugin.db.getAllExpressionSimple(false);
    data.value = [];
    const tagSet = new Set<string>();
    const chunkSize = 200;
    for (let i = 0; i < rawData.length; i += chunkSize) {
        const slice = rawData.slice(i, i + chunkSize);
        const rows = slice.map((entry): Row => {
            entry.tags?.forEach((tag) => tagSet.add(tag));
            return {
                expr: entry.expression,
                exprLower: entry.expression.toLowerCase(),
                status: entry.status,
                meaning: entry.meaning,
                tags: entry.tags,
                tagSet: new Set(entry.tags),
                noteNum: entry.note_num,
                senNum: entry.sen_num,
                date: moment.unix(entry.date).format("YYYY-MM-DD"),
            };
        });
        data.value.push(...rows);
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    tags.value = [...tagSet.values()];
    checkedTags.value = Array(tags.value.length).fill(false);
    loading.value = false;
};
onMounted(() => {
    loadData();
});

let data = ref<Row[]>([]);

let table = ref<InstanceType<typeof NDataTable>>(null);
let mode = ref("and");
let tags = ref<string[]>([]);
let checkedTags = ref<boolean[]>([]);
let selectedTags = ref<string[]>([]);
watchEffect(() => {
    let selected = tags.value.filter((tag, i) => checkedTags.value[i]);
    table.value?.filter({
        tags: selected,
    });
    selectedTags.value = selected;
});

// 搜索框
let searchText = ref("");
const searchLower = computed(() => searchText.value.trim().toLowerCase());
watch(searchText, (text) => {
    table.value?.filter({
        expr: text
    });
});

// 选中行
let rowKeysRef = ref<DataTableRowKey[]>([]);
let makeRowKey = (row: Row) => row.expr;
function handleCheck(rowKeys: DataTableRowKey[]) {
    rowKeysRef.value = rowKeys;
}

let columns = computed<DataTableColumns<Row>>(() => [
    {
        type: "expand",
        expandable: (row: Row) => row.noteNum + row.senNum > 0,
        renderExpand: (row: Row) => {
            return h(Suspense, [
                h(WordMore, { word: row.expr })
            ]);
        },
    },
    {
        title: t("Expression"),
        key: "expr",
        sorter: (row1: Row, row2: Row) => row1.expr.localeCompare(row2.expr),
        filter(_value: unknown, row: Row) {
            if (!searchLower.value) return true;

            return row.exprLower.includes(searchLower.value);
        }
    },
    {
        title: t("Status"),
        key: "status",
        width: "90",
        defaultFilterOptionValues: [1, 2, 3, 4],
        filterOptions: statusLabels.value.map((label, value) => ({ label, value })),
        render(row: Row) {
            return statusLabels.value[row.status];
        },
        filter(value: number, row: Row) {
            return row.status === value;
        },
    },
    {
        title: t("Meaning"),
        key: "meaning",
    },
    {
        title: t("Tags"),
        key: "tags",
        render(row: Row) {
            return row.tags.map((tag: string) =>
                h(
                    NTag,
                    {
                        style: { marginRight: "6px" },
                        type: "info",
                        size: "tiny",
                    },
                    { default: () => tag }
                )
            );
        },
        filter(_value: unknown, row: Row) {
            if (selectedTags.value.length === 0) {
                return true;
            }
            return mode.value === "and"
                ? selectedTags.value.every((tag) => row.tagSet.has(tag))
                : selectedTags.value.some((tag) => row.tagSet.has(tag));
        },
    },
    {
        title: t("Date"),
        key: "date",
        sorter(row1: Row, row2: Row) {
            return moment.utc(row1.date).unix() - moment.utc(row2.date).unix();
        },
    },
]);


</script>

<style lang="scss">
#langr-data {
    #data-tags {
        display: flex;
    }

    .n-data-table-filter {
        width: 19px;
    }

    .n-data-table-th--filterable {
        width: 19px;

    }

    .n-data-table__pagination {
        justify-content: center;
    }

    .word-more {
        padding: 6px 2px;

        .word-notes .word-note-card {
            background: var(--background-primary);
        }

        .word-sens .word-sen {
            background: var(--background-primary);
            border-color: var(--background-modifier-border);
        }
    }
}
</style>
