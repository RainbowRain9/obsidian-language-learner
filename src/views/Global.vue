<template>
    <div id="langr-global" ref="global">
        <PopupSearch :x="searchX" :y="searchY" ref="search" v-if="store.popupSearch" v-show="showSearch" />
        <div
            class="langr-toast"
            :class="toastType ? `langr-toast--${toastType}` : ''"
            v-show="toastVisible"
        >
            {{ toastMessage }}
        </div>
    </div>
</template>

<script setup lang='ts'>
import { onBeforeUnmount, ref, watch } from 'vue';
import { Platform } from "obsidian";
import { onClickOutside, onKeyStroke } from "@vueuse/core";
import store from "@/store";
import { getPageSize, optimizedPos } from "@/utils/style";
import { useEvent } from "@/utils/use";
import PopupSearch from "./PopupSearch.vue";

const global = ref(null);
type ToastType = "info" | "success" | "error";

let showSearch = ref(false);
// 重新再设置打开popup_search时，重置showSearch状态
watch(() => store.popupSearch, (open) => {
    if (open) {
        showSearch.value = false;
    }
});

let search = ref<InstanceType<typeof PopupSearch>>(null);
let toastVisible = ref(false);
let toastMessage = ref("");
let toastType = ref<ToastType>("info");
let toastTimer: number | null = null;

function showToast(message: string, type: ToastType = "info", duration = 2000) {
    toastMessage.value = message;
    toastType.value = type;
    toastVisible.value = true;

    if (toastTimer !== null) {
        window.clearTimeout(toastTimer);
    }

    toastTimer = window.setTimeout(() => {
        toastVisible.value = false;
        toastTimer = null;
    }, duration);
}

function closeSearch(evt: MouseEvent) {
    let target = evt.target as HTMLElement;
    if (target.hasClass("word") ||
        target.hasClass("phrase") ||
        target.matchParent("#langr-learn-panel") ||
        window.getSelection().toString() ||
        search.value.pinned
    ) {
        return;
    }
    showSearch.value = false;
}
onClickOutside(search, closeSearch);
onKeyStroke("Escape", (e) => {
    if (search.value?.pinned)
        return;

    showSearch.value = false;
})

let searchX = ref(0);
let searchY = ref(0);
useEvent(window, "obsidian-langr-search", (evt) => {
    let { pageW, pageH } = getPageSize();
    let evtPos = evt.detail.evtPosition;
    if (evtPos) {
        let h = 520, w = 450;
        if (Platform.isMobileApp) {
            h = 320;
            w = 350;
        }

        let { x, y } = optimizedPos({ h: pageH, w: pageW }, { h, w }, evtPos, 60, 30);

        searchX.value = x;
        searchY.value = y;
    }
    showSearch.value = true;
})

useEvent(window, "obsidian-langr-toast", (evt) => {
    const {
        message,
        type = "info",
        duration = 2000,
    } = evt.detail ?? {};

    if (!message) {
        return;
    }

    showToast(message, type, duration);
});

onBeforeUnmount(() => {
    if (toastTimer !== null) {
        window.clearTimeout(toastTimer);
        toastTimer = null;
    }
});


</script>

<style lang="scss">
.langr-toast {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 9999;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 14px;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
    color: var(--text-normal);
    box-shadow: 0 6px 18px #0003;
    pointer-events: none;
}

.langr-toast--success {
    background: #1f883d26;
    border-color: #1f883d80;
    color: #b7f5c4;
}

.langr-toast--error {
    background: #dc262626;
    border-color: #dc262680;
    color: #fecaca;
}

.langr-toast--info {
    background: #3b82f626;
    border-color: #3b82f666;
    color: #bfdbfe;
}
</style>
