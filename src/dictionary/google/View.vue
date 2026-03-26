<template>
    <div class="google-dict">
        <div class="google-header">
            <span class="google-icon">G</span>
            <span class="google-title">{{ t("Google Translate") }}</span>
        </div>
        <div class="google-content">
            <div class="google-result">
                <div class="google-src">{{ result.src }}</div>
                <div class="google-arrow">↓</div>
                <div class="google-tgt">{{ result.tgt }}</div>
            </div>
            <div class="google-meta">
                <span class="google-lang">{{ result.srcLang }} -> {{ result.tgtLang }}</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { search, GoogleResult } from "./engine";
import { useLoading } from "@dict/uses";

const props = defineProps<{
    word: string;
}>();

const emits = defineEmits<{
    (event: "loading", status: { id: string, loading: boolean, result: boolean }): void
}>();

const result = ref<GoogleResult>({ src: "", tgt: "", srcLang: "", tgtLang: "" });

// Access plugin settings from global property or inject if available
// Assuming we can access settings somehow, or pass them. 
// However, the `search` function in engine needs settings.
// The `useLoading` hook likely handles calling the search function.
// But `useLoading` in `src/dictionary/uses.ts` might pass arguments?
// Let's check `src/dictionary/uses.ts` later. For now, we assume `search` needs settings.
// In `youdao/View.vue`, it calls `search(props.word)`. It doesn't pass settings?
// Ah, `youdao/engine.ts` imports `profile`? No, it imported helpers.
// Let's check how `youdao` gets settings.
// In `youdao/engine.ts`: `const options = { ... }`. It doesn't seem to use global settings for query params.
// But for Google, we need `settings.native`.
// We can get the plugin instance from the global context or store.

import store from "@/store";
import LanguageLearner from "@/plugin";
import { getCurrentInstance } from "vue";
import { t } from "@/lang/helper";

const plugin = getCurrentInstance()?.appContext.config.globalProperties.plugin as LanguageLearner;

async function onSearch() {
    if (!plugin) return false;
    const res = await search(props.word, plugin.settings);
    if (res && res.result) {
        result.value = res.result;
        return true;
    }
    return false;
}

useLoading(() => props.word, "google", onSearch, emits);

</script>

<style scoped>
.google-dict {
    padding: 10px;
    background-color: var(--background-secondary);
    border-radius: 8px;
}

.google-header {
    display: flex;
    align-items: center;
    margin-bottom: 8px;
    font-weight: bold;
    color: var(--text-accent);
}

.google-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    background: #4285f4;
    color: white;
    border-radius: 50%;
    margin-right: 8px;
    font-size: 14px;
    font-weight: bold;
}

.google-result {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.google-src {
    color: var(--text-muted);
    font-size: 0.9em;
}

.google-arrow {
    color: var(--text-faint);
    font-size: 0.8em;
    text-align: center;
}

.google-tgt {
    color: var(--text-normal);
    font-size: 1.1em;
    font-weight: 500;
}

.google-meta {
    margin-top: 8px;
    font-size: 0.8em;
    color: var(--text-faint);
    text-align: right;
}
</style>
