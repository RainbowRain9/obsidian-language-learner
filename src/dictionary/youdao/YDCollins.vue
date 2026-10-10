<template>
    <div class="wrapper">
        <select v-if="props.mydata.length > 1" v-model="mode">
            <option v-for="(item, i) in props.mydata" :key="i" :value="i">
                {{ i === 0 ? t("Word") : i === 1 ? t("Phrase") : (item.title || "#" + (i + 1)) }}
            </option>
        </select>
        <div class="content" v-html="showedHTML"></div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { t } from "@/lang/helper";

interface Collins {
    [index: number]: {
        title: string,
        content: string,
    };
}

const props = defineProps({
    mydata: {
        type: Object,
        default: () => {
            return [] as Collins[];
        }
    }
});

// 当前展示的 Collins 条目下标：0=Word、1=Phrase，超过 2 条时下拉依次列出
let mode = ref(0);

let showedHTML = computed(() => {
    if (!props.mydata || props.mydata.length === 0)
        return "";
    // 下标越界（新查询条目变少）时回退到第 1 条
    const item = props.mydata[mode.value] || props.mydata[0];
    return item.content;
})

</script>
