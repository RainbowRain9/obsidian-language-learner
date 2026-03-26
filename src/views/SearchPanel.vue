<template>
    <div id="langr-search" @click="handleClick">
        <div class="search-bar">
            <div class="search-history-buttons">
                <button class="search-nav-btn" :disabled="historyIndex <= 0" @click="switchHistory('prev')">
                    <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                </button>
                <button class="search-nav-btn" :disabled="historyIndex >= lastHistory" @click="switchHistory('next')">
                    <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                </button>
            </div>
            <input 
                class="search-input" 
                type="text" 
                :placeholder="t('Enter a word')" 
                v-model="inputWord" 
                @keydown.enter="handleSearch" 
            />
            <button class="search-submit-btn" @click="handleSearch">{{ t("Search") }}</button>
        </div>
        <div class="dict-area">
            <DictItem v-for="(cp, i) in components" :loading="loadings[i]" :name="cp.name" :id="cp.id">
                <KeepAlive>
                    <Component @loading="loading" :is="cp.type" :word="word" v-show="shows[i]"></Component>
                </KeepAlive>
            </DictItem>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, getCurrentInstance } from "vue";

import DictItem from "./DictItem.vue";
import { currentLanguageRef, t } from "@/lang/helper";
import PluginType from "@/plugin";
import { dicts } from "@dict/list";
import { playAudio } from "@/utils/helpers";

const plugin = getCurrentInstance().appContext.config.globalProperties.plugin as PluginType;

let components = ref([]);
let map: { [K in string]: number } = {};
let loadings = ref<boolean[]>([]);
let shows = ref<boolean[]>([]);
watch([() => plugin.store.dictsChange, () => currentLanguageRef.value], () => {
    let collection = Object.keys(plugin.settings.dictionaries)
        .map((dict: keyof typeof dicts) => {
            // 检查字典是否存在
            if (!dicts[dict]) {
                console.warn(`Dictionary not found: ${dict}`);
                return null;
            }
            return {
                id: dict,
                priority: plugin.settings.dictionaries[dict].priority,
                name: t(dicts[dict].nameKey),
            };
        })
        .filter((dict) => dict && plugin.settings.dictionaries[dict.id].enable);
    collection.sort((a, b) => a.priority - b.priority);

    components.value = collection.map((dict) => {
        return {
            id: dict.id,
            name: dict.name,
            type: dicts[dict.id].Cp,
        };
    });
    collection.forEach((v, i) => {
        map[v.id] = i;
    });
    loadings.value = Array(collection.length).fill(false);
    shows.value = Array(collection.length).fill(false);

}, {
    immediate: true
});

function loading({ id, loading, result }: { id: string, loading: boolean, result: boolean; }) {
    loadings.value[map[id]] = loading;
    shows.value[map[id]] = result;
}

// 提供一个前进后退查询记录的功能
let history: string[] = [];
let lastHistory = ref(history.length - 1);
let historyIndex = ref(-1);
function switchHistory(direction: "prev" | "next") {
    historyIndex.value = Math.max(
        0,
        Math.min(historyIndex.value + (direction === "prev" ? -1 : 1), history.length - 1)
    );
    word.value = history[historyIndex.value];
    inputWord.value = history[historyIndex.value];
}
function appendHistory() {
    if (historyIndex.value < history.length - 1) {
        history = history.slice(0, historyIndex.value + 1);
    }
    history.push(word.value);
    lastHistory.value = history.length - 1;
    historyIndex.value++;
}

let inputWord = ref("");
let word = ref("");
const onSearch = async (evt: CustomEvent) => {
    let text = evt.detail.selection;
    word.value = text;
    appendHistory();
};

function handleSearch() {
    word.value = inputWord.value;
    appendHistory();
}

function handleClick(evt: MouseEvent) {
    const target = evt.target as HTMLElement;
    if (target.hasClass("speaker")) {
        evt.preventDefault();
        evt.stopPropagation();
        let url = (target as HTMLAnchorElement).href;
        playAudio(url);

    }
    else if (target.tagName === "A") {
        evt.preventDefault();
        evt.stopPropagation();
        word.value = target.textContent;
        inputWord.value = target.textContent;
        appendHistory();
    }
}


onMounted(() => {
    addEventListener('obsidian-langr-search', onSearch);
});

onUnmounted(() => {
    removeEventListener('obsidian-langr-search', onSearch);
});
</script>

<style lang="scss">
#langr-search {
    height: 100%;
    width: 100%;
    overflow: hidden;
    font-size: 0.8em;
    user-select: text;
    display: flex;
    flex-direction: column;

    .search-bar {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 8px;
        padding: 6px 8px;
        background: var(--background-primary);
        border-radius: 4px;
        
        .search-history-buttons {
            display: flex;
            gap: 2px;
            
            .search-nav-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 32px;
                height: 32px;
                padding: 0;
                background: var(--background-modifier-hover);
                border: 1px solid var(--background-modifier-border);
                border-radius: 3px;
                color: var(--text-muted);
                cursor: pointer;
                transition: all 0.15s;
                box-sizing: border-box; /* 确保高度包含 border */
                
                &:hover:not(:disabled) {
                    background: var(--background-modifier-active-hover);
                    color: var(--text-normal);
                }
                
                &:disabled {
                    opacity: 0.4;
                    cursor: not-allowed;
                }
                
                svg {
                    display: block;
                }
            }
        }
        
        .search-input {
            flex: 1;
            height: 32px;
            padding: 4px 8px;
            background: var(--background-primary);
            border: 1px solid var(--background-modifier-border);
            border-radius: 3px;
            color: var(--text-normal);
            font-size: 13px;
            line-height: 1.4;
            outline: none;
            box-sizing: border-box; /* 确保高度包含 border 和 padding */
            
            &::placeholder {
                color: var(--text-faint);
            }
            
            &:focus {
                border-color: var(--interactive-accent);
                box-shadow: 0 0 0 1px var(--interactive-accent);
            }
        }
        
        .search-submit-btn {
            height: 32px;
            padding: 0 12px;
            background: var(--interactive-accent);
            border: none;
            border-radius: 3px;
            color: var(--text-on-accent);
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.15s;
            box-sizing: border-box; /* 确保高度包含 padding */
            
            &:hover {
                background: var(--interactive-accent-hover);
            }
            
            &:active {
                transform: translateY(1px);
            }
        }
    }

    .dict-area {
        flex: 1;
        overflow: auto;
    }
}

.is-mobile #langr-search {
    .search-bar {
        padding: 8px;
        gap: 8px;
    }
    
    .search-history-buttons .search-nav-btn {
        width: 36px;
        height: 36px;
    }
    
    .search-input {
        height: 36px;
        font-size: 14px;
    }
    
    .search-submit-btn {
        height: 36px;
        padding: 0 14px;
        font-size: 13px;
    }
}
</style>
