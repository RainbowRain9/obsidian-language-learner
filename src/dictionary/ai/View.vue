<template>
    <div class="ai-search-view">
        <div v-if="error" class="error">{{ error }}</div>
        <template v-else>
            <div v-if="hasContext" class="context-card">
                <div class="context-card-title">{{ t("Context") }}</div>
                <div class="context-sentence">{{ sentenceText }}</div>
                <div v-if="origin" class="context-origin">
                    <span class="context-origin-label">{{ t("Source") }}:</span>
                    <span>{{ origin }}</span>
                </div>
            </div>
            <div class="content" ref="contentContainer"></div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, getCurrentInstance } from 'vue';
import { search } from './engine';
import { MarkdownRenderer, Component } from 'obsidian';
import { useLoading } from "@dict/uses";
import { t } from '@/lang/helper';

const props = defineProps<{
    word: string;
    sentenceText?: string;
    origin?: string;
}>();

const emits = defineEmits<{
    (event: "loading", status: { id: string, loading: boolean, result: boolean }): void;
}>();

const plugin = getCurrentInstance()?.appContext.config.globalProperties.plugin;

const loading = ref(false);
const error = ref('');
const contentContainer = ref<HTMLElement | null>(null);
const hasContext = computed(() => !!props.sentenceText?.trim());

async function onSearch(): Promise<boolean> {
    if (!props.word) return false;

    error.value = '';
    if (contentContainer.value) {
        contentContainer.value.innerHTML = '';
    }

    try {
        const result = await search(props.word, plugin.settings, {
            sentenceText: props.sentenceText,
            origin: props.origin,
            nativeLanguage: plugin.settings.native,
            foreignLanguage: plugin.settings.foreign,
        });
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

useLoading(() => [props.word, props.sentenceText, props.origin], "ai", onSearch, emits);
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
.context-card {
    margin-bottom: 12px;
    padding: 10px 12px;
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    background: var(--background-secondary);
}
.context-card-title {
    margin-bottom: 6px;
    font-size: 12px;
    font-weight: 700;
    color: var(--text-accent);
    letter-spacing: 0.02em;
    text-transform: uppercase;
}
.context-sentence {
    line-height: 1.5;
    font-size: 14px;
    color: var(--text-normal);
}
.context-origin {
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-muted);
}
.context-origin-label {
    font-weight: 600;
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
