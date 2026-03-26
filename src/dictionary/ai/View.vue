<template>
    <div class="ai-search-view">
        <div v-if="error" class="error">{{ error }}</div>
        <div v-else class="content" ref="contentContainer"></div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, getCurrentInstance, nextTick } from 'vue';
import { search } from './engine';
import { MarkdownRenderer, Component } from 'obsidian';
import { useLoading } from "@dict/uses";
import { t } from '@/lang/helper';

const props = defineProps<{
    word: string;
}>();

const emits = defineEmits<{
    (event: "loading", status: { id: string, loading: boolean, result: boolean }): void;
}>();

const plugin = getCurrentInstance()?.appContext.config.globalProperties.plugin;

const loading = ref(false);
const error = ref('');
const contentContainer = ref<HTMLElement | null>(null);

async function onSearch(): Promise<boolean> {
    if (!props.word) return false;

    error.value = '';
    if (contentContainer.value) {
        contentContainer.value.innerHTML = '';
    }

    try {
        const result = await search(props.word, plugin.settings);
        const rawContent = result.choices?.[0]?.message?.content || t("No response content");

        if (contentContainer.value) {
            await MarkdownRenderer.renderMarkdown(
                rawContent,
                contentContainer.value,
                '',
                new Component()
            );
        }
        return true;
    } catch (e: any) {
        error.value = e.message || t("Error fetching AI response");
        console.error(e);
        return false;
    }
}

useLoading(() => props.word, "ai", onSearch, emits);
</script>

<style scoped>
.ai-search-view {
    padding: 10px;
}
.loading {
    color: var(--text-muted);
    font-style: italic;
}
.error {
    color: var(--text-error);
}
.content {
    line-height: 1.6;
    font-size: 15px;
}
/* Markdown styles */
.content :deep(h1), .content :deep(h2), .content :deep(h3) {
    margin-top: 1em;
    margin-bottom: 0.5em;
    font-size: 1.2em;
}
.content :deep(p) {
    margin-bottom: 1em;
    font-size: 15px;
}
.content :deep(ul), .content :deep(ol) {
    padding-left: 1.5em;
    margin-bottom: 1em;
    font-size: 15px;
}
.content :deep(li) {
    font-size: 15px;
}
.content :deep(strong), .content :deep(b) {
    font-size: 15px;
}
.content :deep(code) {
    font-size: 14px;
}
</style>
