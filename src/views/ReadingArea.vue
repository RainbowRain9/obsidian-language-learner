<template>
    <div id="langr-reading" ref="reading" style="height: 100%">
        <NConfigProvider :theme="theme" :theme-overrides="themeConfig"
            style="height: 100%; display: flex; flex-direction: column">
            <!-- 功能区 -->
            <div class="function-area">
                <!-- 视频播放器（使用 Media Extended 渲染，可调整高度） -->
                <div v-if="isVideoSource" class="resizable-video-wrapper" :style="{ height: videoHeight + 'px' }">
                    <div ref="videoContainer" class="video-container"></div>
                    <!-- Media Extended 工具栏 -->
                    <div class="mx-toolbar">
                        <button class="mx-toolbar-btn" @click="showAddResourcesMenu" title="Add text track">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        </button>
                    </div>
                    <div class="resize-handle-bottom" @mousedown="startResize">
                        <div class="resize-icon">⋯</div>
                    </div>
                </div>
                <!-- 音频播放器（标准 HTML5 播放器） -->
                <audio ref="mainAudioRef" v-if="audioSource" :src="audioSource" controls 
                    @error="onAudioError" @loadstart="onAudioLoadStart" @canplay="onAudioCanPlay"
                    style="width: 100%; height: 40px; margin: 8px 0;" />
                <div style="display: flex">
                    <button @click="activeNotes = true">做笔记</button>
                    <div style="
                            flex: 1;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                        ">
                        <CountBar v-if="plugin.settings.word_count" :unknown="unknown" :learn="learn"
                            :ignore="ignore" />
                    </div>
                    <button v-if="page * pageSize < totalLines" class="finish-reading" @click="addIgnores">
                        结束阅读并转入下一页
                    </button>
                    <button v-else class="finish-reading" @click="addIgnores">
                        结束阅读
                    </button>
                </div>
            </div>
            <!-- 阅读区 -->
            <div ref="textAreaRef" class="text-area" style="
                    flex: 1;
                    overflow: auto;
                    padding-left: 5%;
                    padding-right: 5%;
                " :style="{
                    fontSize: store.fontSize,
                    fontFamily: store.fontFamily,
                    lineHeight: store.lineHeight,
                }" v-html="renderedText" />
            <!-- 底栏 -->
            <div class="pagination" style="
                    padding-top: 10px;
                    border-top: 2px solid gray;
                    display: flex;
                    flex-direction: column;
                ">
                <NPagination style="justify-content: center" v-model:page="page" v-model:page-size="pageSize"
                    :item-count="totalLines" show-size-picker :page-sizes="pageSizes" :page-slot="pageSlot" />
            </div>
            <NDrawer v-model:show="activeNotes" :placement="'bottom'" :close-on-esc="true" :auto-focus="true"
                :on-after-enter="afterNoteEnter" :on-after-leave="afterNoteLeave" to="#langr-reading"
                :default-height="250" resizable>
                <NDrawerContent title="Notes">
                    <div class="note-area">
                        <NInput class="note-input" v-model:value="notes" type="textarea" :autosize="{ minRows: 5 }" />
                        <div class="note-rendered" @mouseover="onMouseOver" ref="renderedNote"></div>
                    </div>
                </NDrawerContent>
            </NDrawer>
        </NConfigProvider>
    </div>
</template>

<script setup lang="ts">
import {
    ref,
    Ref,
    getCurrentInstance,
    computed,
    watch,
    onMounted,
    onUnmounted,
    watchEffect,
    nextTick,
} from "vue";
import {
    NPagination,
    NConfigProvider,
    darkTheme,
    NDrawer,
    NDrawerContent,
    NInput,
    GlobalThemeOverrides,
} from "naive-ui";
import { MarkdownRenderer, Platform, Notice } from "obsidian";
import Plugin from "@/plugin";
import { t } from "@/lang/helper";
import { useEvent } from "@/utils/use";
import store from "@/store";
import { ReadingView } from "./ReadingView";
import CountBar from "./CountBar.vue";
import { search as googleTranslate } from "@/dictionary/google/engine";

let vueThis = getCurrentInstance();
var view = vueThis.appContext.config.globalProperties.view as ReadingView;
let plugin = view.plugin as Plugin;
let contentEl = view.contentEl as HTMLElement;
const textAreaRef = ref<HTMLElement>();

// 切换明亮/黑暗模式
const theme = computed(() => {
    return store.dark ? darkTheme : null;
});

const themeConfig: GlobalThemeOverrides = {
    Drawer: {
        bodyPadding: "8px 12px",
        headerPadding: "4px 6px",
        titleFontWeight: "700",
    },
};

let frontMatter = plugin.app.metadataCache.getFileCache(view.file).frontmatter;

console.log('[Language Learner] Frontmatter:', frontMatter);

// 检查是否有视频字段
const videoSource = (frontMatter["langr-video"] || "") as string;
const isVideoSource = ref(false);
const videoContainer = ref<HTMLElement>();
const videoHeight = ref(400); // 默认高度

console.log('[Language Learner] Video source from frontmatter:', videoSource);

if (videoSource) {
    isVideoSource.value = true;
    console.log('[Language Learner] Detected video source:', videoSource);
} else {
    console.log('[Language Learner] No video source found');
}

// 拖动调整高度
let isResizing = false;
let startY = 0;
let startHeight = 0;

function startResize(e: MouseEvent) {
    console.log('[Language Learner] Start resizing');
    isResizing = true;
    startY = e.clientY;
    startHeight = videoHeight.value;
    
    document.addEventListener('mousemove', onResize);
    document.addEventListener('mouseup', stopResize);
    e.preventDefault();
}

function onResize(e: MouseEvent) {
    if (!isResizing) return;
    
    const deltaY = e.clientY - startY;
    const newHeight = Math.max(150, Math.min(800, startHeight + deltaY));
    console.log('[Language Learner] Resizing to:', newHeight);
    videoHeight.value = newHeight;
}

function stopResize() {
    isResizing = false;
    document.removeEventListener('mousemove', onResize);
    document.removeEventListener('mouseup', stopResize);
}

// 获取 Media Extended 的服务
function getMediaExtendedServices() {
    const mediaExtended = (plugin.app as any).plugins?.plugins?.['media-extended'];
    if (!mediaExtended) {
        return null;
    }
    
    // 尝试从 container.cradle 获取服务
    const cradle = mediaExtended.container?.cradle;
    if (cradle) {
        return {
            transcriptSaver: cradle.transcriptSaver,
            workspaceOpen: cradle.workspaceOpen,
            mediaNote: cradle.mediaNote
        };
    }
    
    return null;
}

// 构建媒体信息对象
function buildMediaInfo() {
    try {
        const url = new URL(videoSource);
        // 检测视频类型
        if (videoSource.includes('youtube.com') || videoSource.includes('youtu.be')) {
            // 提取 YouTube 视频 ID
            let vid = '';
            if (videoSource.includes('youtu.be')) {
                vid = url.pathname.slice(1);
            } else {
                vid = url.searchParams.get('v') || '';
            }
            return {
                type: 'youtube',
                vid: { type: 'youtube', vid },
                url
            };
        }
        // 其他托管视频
        return {
            type: 'url:hosted',
            url
        };
    } catch (err) {
        console.error('[Language Learner] Failed to build media info:', err);
        return null;
    }
}

// 调用 Media Extended 的添加资源菜单
function showAddResourcesMenu(e: MouseEvent) {
    const { Menu, Notice } = require('obsidian');
    const menu = new Menu();
    
    // 获取 Media Extended 插件实例
    const mediaExtended = (plugin.app as any).plugins?.plugins?.['media-extended'];
    
    if (!mediaExtended) {
        new Notice('Media Extended plugin is not installed or enabled');
        return;
    }
    
    const services = getMediaExtendedServices();
    const mediaInfo = buildMediaInfo();
    
    if (!mediaInfo) {
        new Notice('Invalid video URL');
        return;
    }
    
    console.log('[Language Learner] Media Extended services:', services);
    console.log('[Language Learner] Media info:', mediaInfo);
    
    menu.addItem((item: any) => {
        item.setTitle('Add text track')
            .setIsLabel(true);
    });
    
    menu.addItem((item: any) => {
        item.setIcon('file-plus')
            .setTitle('from local file')
            .onClick(async () => {
                try {
                    if (services?.transcriptSaver) {
                        await services.transcriptSaver.importTranscriptFile(mediaInfo);
                        new Notice('Transcript imported successfully');
                    } else {
                        new Notice('Media Extended transcriptSaver not available');
                    }
                } catch (err) {
                    console.error('[Language Learner] Failed to import transcript:', err);
                    new Notice('Failed to import transcript file: ' + (err as Error).message);
                }
            });
    });
    
    menu.addItem((item: any) => {
        item.setIcon('link')
            .setTitle('from remote URL')
            .onClick(async () => {
                try {
                    if (services?.transcriptSaver) {
                        await services.transcriptSaver.importTranscriptUrl(mediaInfo);
                        new Notice('Transcript linked successfully');
                    } else {
                        new Notice('Media Extended transcriptSaver not available');
                    }
                } catch (err) {
                    console.error('[Language Learner] Failed to import transcript URL:', err);
                    new Notice('Failed to import transcript from URL: ' + (err as Error).message);
                }
            });
    });
    
    // 如果是 YouTube 视频，添加从 YouTube 获取字幕的选项
    if (videoSource.includes('youtube.com') || videoSource.includes('youtu.be')) {
        menu.addItem((item: any) => {
            item.setIcon('captions')
                .setTitle('from YouTube')
                .onClick(async () => {
                    try {
                        if (services?.transcriptSaver && mediaInfo.type === 'youtube') {
                            await services.transcriptSaver.importYouTubeSubtitles(
                                mediaInfo,
                                {
                                    onNotFound: () => new Notice('YouTube subtitles not found'),
                                    loadingText: 'Fetching YouTube subtitles...',
                                    errorText: 'Failed to load YouTube subtitles'
                                }
                            );
                        } else {
                            new Notice('Media Extended transcriptSaver not available or not a YouTube video');
                        }
                    } catch (err) {
                        console.error('[Language Learner] Failed to import YouTube subtitles:', err);
                        new Notice('Failed to import YouTube subtitles: ' + (err as Error).message);
                    }
                });
        });
    }
    
    menu.addSeparator();
    
    menu.addItem((item: any) => {
        item.setIcon('external-link')
            .setTitle('Open in Media Extended')
            .onClick(async () => {
                try {
                    if (services?.workspaceOpen) {
                        await services.workspaceOpen.openMedia(
                            { info: { url: mediaInfo.url, type: 'url:hosted' } },
                            { newLeaf: 'tab' }
                        );
                    } else {
                        // 备用方案：使用命令
                        (plugin.app as any).commands.executeCommandById('media-extended:open-media-switcher');
                    }
                } catch (err) {
                    console.error('[Language Learner] Failed to open in Media Extended:', err);
                    new Notice('Failed to open video in Media Extended');
                }
            });
    });
    
    menu.showAtMouseEvent(e);
}

// 使用 Media Extended 渲染视频
watchEffect(async (clean) => {
    console.log('[Language Learner] watchEffect triggered');
    console.log('[Language Learner] videoContainer.value:', videoContainer.value);
    console.log('[Language Learner] videoSource:', videoSource);
    
    if (!videoContainer.value || !videoSource) {
        console.log('[Language Learner] Skipping render - missing container or source');
        return;
    }
    
    console.log('[Language Learner] Starting video render...');
    
    // 使用 Obsidian 的 MarkdownRenderer 渲染 Media Extended 语法
    // 格式：![](视频URL)
    // 尝试添加参数以隐藏 YouTube 顶部信息
    let processedSource = videoSource;
    if (videoSource.includes('youtube.com') || videoSource.includes('youtu.be')) {
        const separator = videoSource.includes('?') ? '&' : '?';
        if (!videoSource.includes('modestbranding')) {
            processedSource += `${separator}modestbranding=1&rel=0`;
        }
    }
    
    const markdown = `![](${processedSource})`;
    
    await MarkdownRenderer.renderMarkdown(
        markdown,
        videoContainer.value,
        view.file.path,
        plugin
    );
    
    console.log('[Language Learner] Video rendered with Media Extended');
    
    // 优化：使用 MutationObserver 替代固定延迟，更快响应
    const fixMediaExtendedLayout = () => {
        if (!videoContainer.value) return;
        
        console.log('[Language Learner] Fixing Media Extended layout...');
        
        // 1. 处理外部容器 (.media-embed)
        const mediaEmbed = videoContainer.value.querySelector('.media-embed');
        if (mediaEmbed) {
            (mediaEmbed as HTMLElement).style.setProperty('height', '100%', 'important');
            (mediaEmbed as HTMLElement).style.setProperty('width', '100%', 'important');
            (mediaEmbed as HTMLElement).style.setProperty('padding-bottom', '0', 'important');
            (mediaEmbed as HTMLElement).style.setProperty('position', 'absolute', 'important');
        }

        // 2. 处理 Shadow DOM 内部
        const shadowHosts = videoContainer.value.querySelectorAll('.mx-player-shadow-root, .media-embed');
        
        shadowHosts.forEach(host => {
            const shadowRoot = (host as any).shadowRoot;
            if (shadowRoot && !shadowRoot.querySelector('.langr-injected-style')) {
                console.log('[Language Learner] Injecting styles into Shadow DOM');
                
                const style = document.createElement('style');
                style.className = 'langr-injected-style';
                style.textContent = `
                    video, iframe, .mx-video-player, .plyr {
                        width: 100% !important;
                        height: 100% !important;
                        max-height: none !important;
                        object-fit: contain !important;
                    }
                    .plyr__video-wrapper {
                        height: 100% !important;
                    }
                    .plyr__controls, .mx-controls, .mx-toolbar {
                        z-index: 10000 !important;
                        opacity: 1 !important;
                        visibility: visible !important;
                    }
                    .ytp-chrome-top, .ytp-title, .ytp-share-button {
                        display: none !important;
                        opacity: 0 !important;
                    }
                `;
                shadowRoot.appendChild(style);
            }
        });

        // 3. 确保菜单可见
        const toolbar = videoContainer.value.querySelector('.media-embed-toolbar');
        if (toolbar) {
             (toolbar as HTMLElement).style.setProperty('z-index', '10000', 'important');
             (toolbar as HTMLElement).style.setProperty('display', 'flex', 'important');
             (toolbar as HTMLElement).style.setProperty('visibility', 'visible', 'important');
        }
    };

    // 使用 MutationObserver 监听 DOM 变化，一旦 media-embed 出现就立即处理
    const observer = new MutationObserver((mutations, obs) => {
        const mediaEmbed = videoContainer.value?.querySelector('.media-embed');
        if (mediaEmbed) {
            fixMediaExtendedLayout();
            // 继续观察 Shadow DOM 的创建
            const checkShadow = setInterval(() => {
                const shadowHost = videoContainer.value?.querySelector('.mx-player-shadow-root');
                if (shadowHost && (shadowHost as any).shadowRoot) {
                    fixMediaExtendedLayout();
                    clearInterval(checkShadow);
                }
            }, 100);
            // 5秒后停止检查
            setTimeout(() => clearInterval(checkShadow), 5000);
        }
    });

    observer.observe(videoContainer.value, { childList: true, subtree: true });
    
    // 3秒超时兜底
    setTimeout(() => {
        observer.disconnect();
        fixMediaExtendedLayout();
    }, 3000);
    
    clean(() => {
        videoContainer.value?.empty();
    });
});

// 监听高度变化，确保 Media Extended 容器同步调整
watch(videoHeight, () => {
    if (!videoContainer.value) return;
    
    console.log('[Language Learner] Video height changed to:', videoHeight.value);
    
    // 确保 Media Extended 容器填充父容器
    const mediaEmbed = videoContainer.value.querySelector('.media-embed');
    if (mediaEmbed) {
        (mediaEmbed as HTMLElement).style.height = '100%';
        (mediaEmbed as HTMLElement).style.width = '100%';
    }
});

// 处理音频字段
let audioSource = (frontMatter["langr-audio"] || "") as string;

// 调试日志
if (audioSource) {
    console.log("[Language Learner] Raw audio source from frontmatter:", audioSource);
}

// 处理本地文件路径
if (audioSource) {
    // 检查是否是本地文件路径（以 ~/ 开头或包含 vault 相对路径）
    if (audioSource.startsWith("~/")) {
        // 标准的 ~/ 路径格式
        const relativePath = audioSource.slice(2); // 移除 "~/"
        const prefix = Platform.isDesktopApp ? "app://local/" : "http://localhost/_capacitor_file_";
        audioSource = prefix + plugin.constants.basePath + "/" + relativePath;
        console.log("[Language Learner] Converted ~/ path to:", audioSource);
    } else if (!audioSource.startsWith("http://") && !audioSource.startsWith("https://") && !audioSource.startsWith("app://")) {
        // 相对路径（如 "03-Resources/aloud/audio.mp3"）
        try {
            // 使用 Obsidian 的 API 获取资源路径
            const resourcePath = plugin.app.vault.adapter.getResourcePath(audioSource);
            console.log("[Language Learner] Converted relative path to resource path:", resourcePath);
            audioSource = resourcePath;
        } catch (error) {
            console.error("[Language Learner] Failed to resolve resource path:", error);
            // 如果失败，尝试使用旧方法
            const prefix = Platform.isDesktopApp ? "app://local/" : "http://localhost/_capacitor_file_";
            audioSource = prefix + plugin.constants.basePath + "/" + audioSource;
            console.log("[Language Learner] Fallback to manual path:", audioSource);
        }
    }
}

// 验证音频 URL 是否有效
if (audioSource) {
    const audioExtensions = ['.mp3', '.wav', '.m4a', '.ogg', '.webm', '.flac'];
    const hasValidExtension = audioExtensions.some(ext => 
        audioSource.toLowerCase().includes(ext)
    );
    
    if (!hasValidExtension) {
        console.warn("[Language Learner] Invalid audio URL - not an audio file:", audioSource);
        console.warn("[Language Learner] langr-audio should point to an audio file (.mp3, .wav, etc.), not a web page");
        // 清空无效的音频源，避免显示无法播放的播放器
        audioSource = "";
    }
}

// 记笔记
let activeNotes = ref(false);
let notes = ref("");
async function afterNoteEnter() {
    notes.value = await view.readContent("notes", true);
}
async function afterNoteLeave() {
    view.writeContent("notes", notes.value);
}

let renderedNote = ref<HTMLElement>();
watchEffect(async (clean) => {
    if (!renderedNote.value) return;
    await MarkdownRenderer.renderMarkdown(
        notes.value,
        renderedNote.value,
        view.file.path,
        null
    );
    clean(() => {
        renderedNote.value?.empty();
    });
});

function onMouseOver(e: MouseEvent) {
    let target = e.target as HTMLElement;
    if (target.hasClass("internal-link")) {
        app.workspace.trigger("hover-link", {
            event: e,
            source: "preview",
            hoverParent: { hoverPopover: null },
            targetEl: target,
            linktext: target.getAttr("href"),
            soursePath: view.file.path,
        });
    }
}

// 拆分文本
let lines = view.text.split("\n");
let segments = view.divide(lines);

let article = lines.slice(segments["article"].start, segments["article"].end);
let totalLines = article.length;

// 计数
let unknown = ref(0);
let learn = ref(0);
let ignore = ref(0);
let countChange = ref(true);
let refreshCount = () => {
    countChange.value = !countChange.value;
};

if (plugin.settings.word_count) {
    watch(
        [countChange],
        async () => {
            [unknown.value, learn.value, ignore.value] =
                await plugin.parser.countWords(article.join("\n"));
        },
        { immediate: true }
    );

    // 数据库就绪后重新统计
    plugin.db.waitForReady().then(() => {
        if (unknown.value === 0 && learn.value === 0 && ignore.value === 0) {
            refreshCount();
        }
    });

    onMounted(() => {
        addEventListener("obsidian-langr-refresh", refreshCount);
        // 添加音频点击事件监听
        if (contentEl) {
            contentEl.addEventListener("click", handleAudioClick);
        }
    });
    onUnmounted(() => {
        removeEventListener("obsidian-langr-refresh", refreshCount);
        if (contentEl) {
            contentEl.removeEventListener("click", handleAudioClick);
        }
    });
}

// 追踪当前播放的音频
let currentAudio: HTMLAudioElement | null = null;
let currentAudioMarker: HTMLElement | null = null;

// Main audio controls
const mainAudioRef = ref<HTMLAudioElement | null>(null);
const isMainAudioPlaying = ref(false);

function toggleMainAudio() {
    if (!mainAudioRef.value) return;
    
    // If inline audio is playing, stop it
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    if (currentAudioMarker) {
        currentAudioMarker.classList.remove("playing");
        currentAudioMarker = null;
    }

    if (mainAudioRef.value.paused) {
        mainAudioRef.value.play().catch(err => {
            console.error("Failed to play main audio:", err);
        });
    } else {
        mainAudioRef.value.pause();
    }
}

function onMainAudioPlay() {
    isMainAudioPlaying.value = true;
}

function onMainAudioPause() {
    isMainAudioPlaying.value = false;
}

function onMainAudioEnded() {
    isMainAudioPlaying.value = false;
}

function onAudioLoadStart() {
    console.log("[Language Learner] Audio loading started...");
}

function onAudioCanPlay() {
    console.log("[Language Learner] Audio can play now");
}

function onAudioError(event: Event) {
    const audio = event.target as HTMLAudioElement;
    let errorMessage = "Unknown error";
    
    if (audio.error) {
        switch (audio.error.code) {
            case MediaError.MEDIA_ERR_ABORTED:
                errorMessage = "Audio loading aborted";
                break;
            case MediaError.MEDIA_ERR_NETWORK:
                errorMessage = "Network error while loading audio";
                break;
            case MediaError.MEDIA_ERR_DECODE:
                errorMessage = "Audio decoding failed - unsupported format";
                break;
            case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                errorMessage = "Audio source not supported or not found";
                break;
        }
    }
    
    console.error("[Language Learner] Audio error:", errorMessage);
    console.error("[Language Learner] Audio source:", audioSource);
    console.error("[Language Learner] Error details:", audio.error);
    
    new Notice(`Audio playback error: ${errorMessage}`);
}

// 处理音频点击
function handleAudioClick(e: MouseEvent) {
    const target = (e.target as HTMLElement).closest(".langr-audio-inline-marker");
    if (target) {
        e.preventDefault();
        e.stopPropagation();
        const marker = target as HTMLElement;
        const src = marker.dataset.src;
        if (src) {
            // 如果点击的是当前正在播放的音频，则暂停
            if (currentAudio && currentAudioMarker === marker) {
                if (currentAudio.paused) {
                    // Stop main audio if playing
                    if (mainAudioRef.value && !mainAudioRef.value.paused) {
                        mainAudioRef.value.pause();
                    }
                    
                    currentAudio.play().catch(err => {
                        console.error("Failed to play audio:", err);
                    });
                    marker.classList.add("playing");
                } else {
                    currentAudio.pause();
                    marker.classList.remove("playing");
                }
            } else {
                // 停止之前的音频并移除样式
                if (currentAudio) {
                    currentAudio.pause();
                    currentAudio = null;
                }
                
                // Stop main audio if playing
                if (mainAudioRef.value && !mainAudioRef.value.paused) {
                    mainAudioRef.value.pause();
                }

                if (currentAudioMarker) {
                    currentAudioMarker.classList.remove("playing");
                    currentAudioMarker = null;
                }
                
                // 播放新音频
                const audio = new Audio(src);
                currentAudio = audio;
                currentAudioMarker = marker;
                
                audio.play().catch(err => {
                    console.error("Failed to play audio:", err);
                    currentAudio = null;
                    currentAudioMarker = null;
                });
                
                marker.classList.add("playing");
                
                // 音频结束时清除状态
                audio.addEventListener("ended", () => {
                    marker.classList.remove("playing");
                    if (currentAudio === audio) {
                        currentAudio = null;
                        currentAudioMarker = null;
                    }
                });
            }
        }
    }
}

// 分页渲染文本

const pageSizes = [
    { label: `1 ${t("paragraph")} / ${t("page")}`, value: 2 },
    { label: `2 ${t("paragraph")} / ${t("page")}`, value: 4 },
    { label: `4 ${t("paragraph")} / ${t("page")}`, value: 8 },
    { label: `8 ${t("paragraph")} / ${t("page")}`, value: 16 },
    { label: `16 ${t("paragraph")} / ${t("page")}`, value: 32 },
    { label: `${t("All")}`, value: Number.MAX_VALUE },
];

const pageSlot = Platform.isMobileApp ? 5 : null;

let dp = plugin.settings.default_paragraphs;
let pageSize = dp === "all" ? ref(Number.MAX_VALUE) : ref(parseInt(dp));
let page = view.lastPos
    ? ref(Math.ceil(view.lastPos / pageSize.value))
    : ref(1);

let renderedText = ref("");
let psChange = ref(true); // 标志pageSize的改变
let refreshHandle = ref(true);
let lastProcessedHtml = "";
let renderToken = 0;
const hoverDelay = 180;
const hoverCache = new Map<string, { value: string; ts: number }>();
const hoverCacheTTL = 5 * 60 * 1000;
let hoverTimer: number | null = null;
let hoverTarget: HTMLElement | null = null;
let hoverTooltipEl: HTMLDivElement | null = null;
let hoverRequestId = 0;

function waitForIdle(): Promise<void> {
    return new Promise((resolve) => {
        if ("requestIdleCallback" in window) {
            (window as any).requestIdleCallback(() => resolve(), { timeout: 200 });
        } else {
            setTimeout(() => resolve(), 0);
        }
    });
}

// pageSize变化应该使page同时进行调整以尽量保持原阅读位置
// 同时page和pageSize的改变都应该引起langr-pos的改变，但应只修改一次
// 因此引入psChange这个变量
watch([pageSize], async ([ps], [prev_ps]) => {
    let oldPage = page.value;
    page.value = Math.ceil(((page.value - 1) * prev_ps + 1) / ps);
    if (oldPage === page.value) {
        psChange.value = !psChange.value;
    }
});

//监视 page、psChange 和 refreshHandle 的变化，并在变化时执行分页计算、解析文章片段、更新渲染的文本以及更新前置元数据。
watch(
    [page, psChange, refreshHandle],
    async ([p, pc], [prev_p, prev_pc]) => {
        const token = ++renderToken;
        let start = (p - 1) * pageSize.value;
        let end =
            start + pageSize.value > totalLines
                ? totalLines
                : start + pageSize.value;

        await waitForIdle();
        if (token !== renderToken) {
            return;
        }

        const html = await plugin.parser.parse(
            article.slice(start, end).join("\n")
        );
        if (token !== renderToken) {
            return;
        }
        renderedText.value = html;
        await nextTick();

        if (token !== renderToken) {
            return;
        }

        if (p !== prev_p || pc != prev_pc) {
            plugin.frontManager.setFrontMatter(
                view.file,
                "langr-pos",
                `${(p - 1) * pageSize.value + 1}`
            );
        }
        processContent();
    },
    { immediate: true }
);

watch(renderedText, () => {
    hideHoverTooltip();
});

// 设置阅读文字样式

// 添加无视单词
async function addIgnores() {
    let ignores = contentEl.querySelectorAll(
        ".word.new"
    ) as unknown as HTMLElement[];
    let ignore_words: Set<string> = new Set();
    ignores.forEach((el) => {
        ignore_words.add(el.textContent.toLowerCase());
    });
    await plugin.db.postIgnoreWords([...ignore_words]);
    // this.setViewData(this.data)
    refreshHandle.value = !refreshHandle.value;
    dispatchEvent(new CustomEvent("obsidian-langr-refresh-stat"));

    if (page.value * pageSize.value < totalLines) {
        page.value++;
    }

    refreshCount();
    processContent();
}

async function processContent(){
    let textArea = document.querySelector('.text-area');
    if (!textArea) {
        return;
    }
    let htmlContent = textArea.innerHTML;
    if (htmlContent === lastProcessedHtml) {
        return;
    }
    if (!/[!#*_~]/.test(htmlContent)) {
        lastProcessedHtml = htmlContent;
        return;
    }
    //使用正则表达式匹配同时包含特定符号的 <p> 标签元素，并去除所有标签保留文本
    htmlContent = htmlContent.replace(/<p>(?=.*!)(?=.*\[)(?=.*\])(?=.*\()(?=.*\)).*<\/p>/g, function(match) {
        var pattern = /!\[(.*?)\]\((.*?)\)/;
        var str = match.replace(/<[^>]+>/g, '');
        var tq = pattern.exec(str);
        var img = document.createElement('img');
        var imgContainer = document.createElement('div');
        imgContainer.style.textAlign = 'center';  // 设置文本居中对齐
        var imgWrapper = document.createElement('div');
        imgWrapper.style.textAlign = 'center';  // 设置为内联块元素，使其水平居中

        if (tq) {
            var altText = tq[1];
            var srcUrl = tq[2];
            
            if (/^https?:\/\//.test(srcUrl)) {
                img.alt = altText;
                img.src = srcUrl;
                imgWrapper.appendChild(img);
                imgContainer.appendChild(imgWrapper);
                return imgContainer.innerHTML; 
            }
            else{
                let imgnum = localStorage.getItem('imgnum') || '';
                img.alt = altText;
                img.src =  mergeStrings(imgnum,srcUrl);
                imgWrapper.appendChild(img);
                imgContainer.appendChild(imgWrapper);
                return imgContainer.innerHTML; 
            }
        }
        
    });
    // 渲染多级标题
    htmlContent = htmlContent.replace(/(<span class="stns">)# (.*?)(<\/span>)(?=\s*<\/p>)/g, '<h1>$1$2$3</h1>');
    htmlContent = htmlContent.replace(/(<span class="stns">)## (.*?)(<\/span>)(?=\s*<\/p>)/g, '<h2>$1$2$3</h2>');
    htmlContent = htmlContent.replace(/(<span class="stns">)### (.*?)(<\/span>)(?=\s*<\/p>)/g, '<h3>$1$2$3</h3>');
    htmlContent = htmlContent.replace(/(<span class="stns">)#### (.*?)(<\/span>)(?=\s*<\/p>)/g, '<h4>$1$2$3</h4>');
    htmlContent = htmlContent.replace(/(<span class="stns">)##### (.*?)(<\/span>)(?=\s*<\/p>)/g, '<h5>$1$2$3</h5>');
    htmlContent = htmlContent.replace(/(<span class="stns">)###### (.*?)(<\/span>)(?=\s*<\/p>)/g, '<h6>$1$2$3</h6>');
    
    //渲染粗体
    htmlContent = htmlContent.replace(/(?<!\\)\*(?<!\\)\*(<span.*?>.*?<\/span>)(?<!\\)\*(?<!\\)\*/g, '<b>$1</b>');
    htmlContent = htmlContent.replace(/(?<!\\)\_(?<!\\)\_(<span.*?>.*?<\/span>)(?<!\\)\_(?<!\\)\_/g, '<b>$1</b>');

    //渲染斜体
    htmlContent = htmlContent.replace(/(?<!\\)\*(<span.*?>.*?<\/span>)(?<!\\)\*/g, '<i>$1</i>');
    htmlContent = htmlContent.replace(/(?<!\\)\_(<span.*?>.*?<\/span>)(?<!\\)\_/g, '<i>$1</i>');


    htmlContent = htmlContent.replace(/(?<!\\)\~(?<!\\)\~(<span.*?>.*?<\/span>)(?<!\\)\~(?<!\\)\~/g, '<del>$1</del>');

    // 将修改后的HTML内容重新设置回元素
    textArea.innerHTML = htmlContent;
    lastProcessedHtml = htmlContent;
}

function mergeStrings(str1:string, str2:string) {
    // 获取 str2 的前 3 个字符
    let prefix = str2.substring(0, 3);
    // 在 str1 中查找 prefix 的位置
    let index = str1.indexOf(prefix);

    // 如果找到匹配的前缀
    if (index !== -1&& index !== 0 && str1.charAt(index - 1) === '/') {
        // 截断 str1 并与 str2 相连
        let firstPart = str1.substring(0, index);
        return firstPart + str2;
    } else {
        // 如果没有找到匹配的前缀，则返回 str1 和 str2 原样相连
        return str1 + str2;
    }
}

let reading = ref(null);
let prevEl: HTMLElement = null;
const hoverScrollHandler = () => hideHoverTooltip();

function getHoverCache(word: string) {
    const cached = hoverCache.get(word);
    if (!cached) return null;
    if (Date.now() - cached.ts > hoverCacheTTL) {
        hoverCache.delete(word);
        return null;
    }
    return cached.value;
}

function setHoverCache(word: string, value: string) {
    hoverCache.set(word, { value, ts: Date.now() });
}

function ensureHoverTooltip(): HTMLDivElement {
    if (hoverTooltipEl) return hoverTooltipEl;
    hoverTooltipEl = document.createElement("div");
    hoverTooltipEl.className = "ll-hover-tooltip";
    hoverTooltipEl.style.display = "none";
    document.body.appendChild(hoverTooltipEl);
    return hoverTooltipEl;
}

function clearHoverTimer() {
    if (hoverTimer !== null) {
        window.clearTimeout(hoverTimer);
        hoverTimer = null;
    }
}

function hideHoverTooltip() {
    clearHoverTimer();
    hoverTarget = null;
    hoverRequestId++;
    if (hoverTooltipEl) {
        hoverTooltipEl.style.display = "none";
        hoverTooltipEl.textContent = "";
    }
}

function isHoverCandidate(target: HTMLElement): HTMLElement | null {
    if (!plugin.settings.hover_definition_enabled) return null;
    const wordEl = target.closest("span.word, span.phrase") as HTMLElement | null;
    if (!wordEl) return null;
    const rawText = wordEl.textContent?.trim() || "";
    if (!rawText || !/[A-Za-z]/.test(rawText)) return null;
    return wordEl;
}

function positionHoverTooltip(targetEl: HTMLElement, tooltipEl: HTMLDivElement) {
    const rect = targetEl.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();
    const spacing = 6;
    let top = rect.top - tooltipRect.height - spacing;
    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
    if (top < 8) {
        top = rect.bottom + spacing;
        tooltipEl.classList.add("ll-hover-tooltip--below");
    } else {
        tooltipEl.classList.remove("ll-hover-tooltip--below");
    }
    left = Math.min(Math.max(left, 8), window.innerWidth - tooltipRect.width - 8);
    tooltipEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
}

async function getHoverDefinition(word: string): Promise<string | null> {
    const cached = getHoverCache(word);
    if (cached) return cached;
    const hoverLang = (plugin.settings.hover_definition_lang || "").trim() || "zh";
    const nativeLang = (plugin.settings.native || "").trim();
    const useNative = nativeLang && hoverLang.toLowerCase() === nativeLang.toLowerCase();

    try {
        await plugin.db.waitForReady();
    } catch (err) {
        console.warn("[Language Learner] DB not ready for hover definition", err);
    }

    if (useNative) {
        try {
            const expr = await plugin.db.getExpression(word);
            if (expr?.meaning?.trim()) {
                const meaning = expr.meaning.trim();
                setHoverCache(word, meaning);
                return meaning;
            }
        } catch (err) {
            console.warn("[Language Learner] Hover definition DB lookup failed", err);
        }
    }

    try {
        const result = await googleTranslate(word, { native: hoverLang });
        const translated = result?.result?.tgt?.trim();
        if (translated) {
            setHoverCache(word, translated);
            return translated;
        }
    } catch (err) {
        console.warn("[Language Learner] Hover definition translation failed", err);
    }

    return null;
}

async function showHoverTooltip(wordEl: HTMLElement) {
    if (!plugin.settings.hover_definition_enabled) return;
    const word = wordEl.textContent?.trim();
    if (!word) return;
    const wordKey = word.toLowerCase();
    const tooltipEl = ensureHoverTooltip();
    const requestId = ++hoverRequestId;

    tooltipEl.textContent = "…";
    tooltipEl.style.display = "block";
    positionHoverTooltip(wordEl, tooltipEl);

    const meaning = await getHoverDefinition(wordKey);
    if (requestId !== hoverRequestId || hoverTarget !== wordEl) {
        return;
    }
    if (!meaning) {
        hideHoverTooltip();
        return;
    }
    tooltipEl.textContent = meaning;
    positionHoverTooltip(wordEl, tooltipEl);
}

function scheduleHover(wordEl: HTMLElement) {
    if (hoverTarget !== wordEl) {
        hideHoverTooltip();
        hoverTarget = wordEl;
    }
    clearHoverTimer();
    hoverTimer = window.setTimeout(() => {
        showHoverTooltip(wordEl);
    }, hoverDelay);
}

function handleHoverPointerOver(e: PointerEvent) {
    const target = e.target as HTMLElement;
    const wordEl = isHoverCandidate(target);
    if (!wordEl) return;
    scheduleHover(wordEl);
}

function handleHoverPointerOut(e: PointerEvent) {
    if (!hoverTarget) return;
    const target = e.target as HTMLElement;
    if (target !== hoverTarget) return;
    const related = e.relatedTarget as Node | null;
    if (related && hoverTarget.contains(related)) {
        return;
    }
    hideHoverTooltip();
}
//用户选择单词的事件
if (plugin.constants.platform === "mobile") {
    useEvent(reading, "click", (e) => {
        let target = e.target as HTMLElement;
        if (target.hasClass("word") || target.hasClass("phrase")) {
            e.preventDefault();
            e.stopPropagation();
            if (prevEl) {
                let selectSpan = view.wrapSelect(prevEl, target);
                if (selectSpan) {
                    plugin.queryWord(
                        selectSpan.textContent,
                        selectSpan,
                        { x: e.pageX, y: e.pageY }
                    );
                }
                prevEl = null;
            } else {
                prevEl = target;
            }
        } else {
            view.removeSelect();
            prevEl = null;
        }

    });
} else {
    useEvent(reading, "pointerover", handleHoverPointerOver);
    useEvent(reading, "pointerout", handleHoverPointerOut);
    useEvent(reading, "pointerdown", (e) => {
        let target = e.target as HTMLElement;
        if (target.hasClass("word") || target.hasClass("phrase") || target.hasClass("select")) {
            prevEl = target;
        }
    });
    useEvent(reading, "pointerup", (e) => {
        let target = e.target as HTMLElement;
        if (target.hasClass("word") || target.hasClass("phrase") || target.hasClass("select")) {
            e.preventDefault();
            e.stopPropagation();
            if (prevEl) {
                let selectSpan = view.wrapSelect(prevEl, target);
                if (selectSpan) {
                    plugin.queryWord(
                        selectSpan.textContent,
                        selectSpan,
                        { x: e.pageX, y: e.pageY }
                    );
                }
                prevEl = null;
            }
        } else {
            view.removeSelect();
        }
    });
}

onMounted(() => {
    if (textAreaRef.value) {
        textAreaRef.value.addEventListener("scroll", hoverScrollHandler, { passive: true });
    }
});

onUnmounted(() => {
    if (textAreaRef.value) {
        textAreaRef.value.removeEventListener("scroll", hoverScrollHandler);
    }
    if (hoverTooltipEl) {
        hoverTooltipEl.remove();
        hoverTooltipEl = null;
    }
});
</script>

<style lang="scss">
#langr-reading {
    user-select: none;

    .function-area {
        padding-bottom: 10px;
        border-bottom: 2px solid gray;

        button {
            width: auto;
        }
    }

    .text-area {
        touch-action: none;

        span.word {
            user-select: contain;
            border: 1px solid transparent;
            cursor: pointer;
            border-radius: 3px;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            padding: 1px 0;

            &:hover {
                background-color: rgba(0, 150, 200, 0.08);
                border-color: rgba(0, 150, 200, 0.2);
            }
        }

        span.phrase {
            background-color: transparent;
            padding: 2px 0;
            cursor: pointer;
            border: 1px solid transparent;
            border-radius: 3px;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);

            &:hover {
                background-color: rgba(0, 150, 200, 0.08);
                border-color: rgba(0, 150, 200, 0.2);
            }
        }

        span.stns {
            border: 1px solid transparent;
        }

        span {
            /* 🔵 新词 - 轻微背景提示，需要关注 */
            &.new {
                background-color: rgba(173, 216, 230, 0.10);
            }

            /* 🟠 学习中 - 默认几乎透明，悬停时才显示 */
            &.learning {
                background-color: rgba(255, 152, 0, 0.06);
            }

            /* 🟡 熟悉 - 默认几乎透明，悬停时才显示 */
            &.familiar {
                background-color: rgba(255, 235, 60, 0.05);
            }

            /* 🟢 认识 - 完全透明，仅悬停时显示 */
            &.known {
                background-color: rgba(158, 218, 88, 0.04);
            }

            /* ✅ 已学会 - 完全透明，仅悬停时显示 */
            &.learned {
                background-color: rgba(76, 176, 81, 0.03);
            }

            /* 悬停时才显示明显标记 - 渐进式反馈 */
            &.new:hover {
                background-color: rgba(173, 216, 230, 0.18);
            }

            &.learning:hover {
                background-color: rgba(255, 152, 0, 0.12);
            }

            &.familiar:hover {
                background-color: rgba(255, 235, 60, 0.12);
            }

            &.known:hover {
                background-color: rgba(158, 218, 88, 0.10);
            }

            &.learned:hover {
                background-color: rgba(76, 176, 81, 0.08);
            }
        }
    }
}

/* 深色模式优化 - 大幅降低背景色透明度 */
.theme-dark #langr-reading {
    .text-area {
        span {
            /* 深色模式：🔵 新词 - 轻微背景 */
            &.new {
                background-color: rgba(173, 216, 230, 0.05);
                border-bottom: 1px solid rgba(173, 216, 230, 0.08);
            }

            /* 深色模式：🟠 学习中 - 完全透明 */
            &.learning {
                background-color: rgba(255, 152, 0, 0.06);
                border-bottom: 1px solid rgba(255, 152, 0, 0.04);
            }

            /* 深色模式：🟡 熟悉 - 完全透明 */
            &.familiar {
                background-color: rgba(255, 235, 60, 0.05);
                border-bottom: 1px solid rgba(255, 235, 60, 0.04);
            }

            /* 深色模式：🟢 认识 - 完全透明 */
            &.known {
                background-color: rgba(158, 218, 88, 0.04);
                border-bottom: none;
            }

            /* 深色模式：✅ 已学会 - 完全透明 */
            &.learned {
                background-color: rgba(76, 176, 81, 0.03);
                border-bottom: none;
            }

            /* 深色模式：悬停时才显示标记 */
            &.new:hover {
                background-color: rgba(173, 216, 230, 0.12);
                border-bottom-color: rgba(173, 216, 230, 0.18);
            }

            &.learning:hover {
                background-color: rgba(255, 152, 0, 0.08);
                border-bottom-color: rgba(255, 152, 0, 0.12);
            }

            &.familiar:hover {
                background-color: rgba(255, 235, 60, 0.08);
                border-bottom-color: rgba(255, 235, 60, 0.12);
            }

            &.known:hover {
                background-color: rgba(158, 218, 88, 0.06);
                border-bottom: 1px solid rgba(158, 218, 88, 0.10);
            }

            &.learned:hover {
                background-color: rgba(76, 176, 81, 0.05);
                border-bottom: 1px solid rgba(76, 176, 81, 0.08);
            }
        }

        .select {
            background-color: rgba(144, 238, 144, 0.12);
            border-color: rgba(0, 200, 0, 0.20);

            &:hover {
                background-color: rgba(144, 238, 144, 0.18);
                border-color: rgba(0, 200, 0, 0.30);
            }
        }
    }
}

#langr-reading {
    .text-area {
        span.other {
            user-select: text;
        }

        .select {
            background-color: rgba(144, 238, 144, 0.20);
            padding: 2px 0;
            cursor: pointer;
            border: 1px solid rgba(0, 200, 0, 0.3);
            border-radius: 3px;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);

            &:hover {
                background-color: rgba(144, 238, 144, 0.30);
                border-color: rgba(0, 200, 0, 0.5);
            }
        }
    }

    .note-area {
        display: flex;
        height: 100%;
        width: 100%;

        .note-input {
            flex: 1;
        }

        .note-rendered {
            border: 1px solid gray;
            border-radius: 3px;
            flex: 1;
            padding: 5px;
            margin-left: 2px;
            overflow: auto;
        }
    }
}

.is-mobile #langr-reading {
    .pagination {
        padding-bottom: 48px;
    }
}

.ll-hover-tooltip {
    position: fixed;
    top: 0;
    left: 0;
    transform: translate3d(0, 0, 0);
    z-index: 10050;
    max-width: min(320px, 70vw);
    padding: 6px 10px;
    background: var(--background-secondary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s, 6px);
    font-size: 12px;
    line-height: 1.4;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    pointer-events: none;
    white-space: pre-wrap;
}

.ll-hover-tooltip--below {
    box-shadow: 0 -6px 18px rgba(0, 0, 0, 0.15);
}

/* 视频播放器可调整高度样式 */
.resizable-video-wrapper {
    position: relative;
    width: 100%;
    margin: 0 auto 20px;
    display: flex;
    flex-direction: column;
}

.video-container {
    flex: 1;
    width: 100%;
    min-height: 0; /* 关键：允许 flex 子项收缩 */
    border: 2px solid var(--background-modifier-border);
    border-radius: 8px;
    overflow: visible; /* 必须 visible 才能显示菜单 */
    background: var(--background-primary);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    position: relative;
    z-index: 1;
}

/* Media Extended 工具栏样式 */
.mx-toolbar {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 4px;
    z-index: 100;
    opacity: 0;
    transition: opacity 0.2s ease;
}

.resizable-video-wrapper:hover .mx-toolbar {
    opacity: 1;
}

.mx-toolbar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: var(--background-primary);
    color: var(--text-normal);
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    transition: all 0.2s ease;
}

.mx-toolbar-btn:hover {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    transform: scale(1.05);
}

.mx-toolbar-btn:active {
    transform: scale(0.95);
}

.mx-toolbar-btn svg {
    width: 18px;
    height: 18px;
}

/* 拖动手柄样式 */
.resize-handle-bottom {
    height: 12px;
    background: transparent;
    cursor: ns-resize;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.3s ease;
    z-index: 10;
    flex-shrink: 0;
}

/* 移除小蓝条视觉效果，保留拖动功能 */
.resize-handle-bottom::before {
    content: none;
}

/* 强力覆盖 Media Extended 外部样式 */
.video-container .media-embed, 
.video-container .mx-video-view {
    width: 100% !important;
    height: 100% !important;
    padding-bottom: 0 !important;
    position: absolute !important;
    top: 0;
    left: 0;
    /* 确保不遮挡菜单 */
    z-index: 1 !important;
}

/* 确保菜单可见 - 针对 Shadow DOM 外部的工具栏 */
.video-container .media-embed-toolbar,
.video-container .block-language-preview .menu-icon,
.video-container .clickable-icon {
    z-index: 10000 !important; /* 极高的 z-index */
    opacity: 1 !important;
    visibility: visible !important;
    display: flex !important;
    position: absolute !important;
    top: 8px !important;
    right: 8px !important;
    background: var(--background-primary) !important; /* 使用主题背景色 */
    border: 1px solid var(--background-modifier-border) !important;
    border-radius: 6px !important;
    padding: 4px !important;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2) !important;
    pointer-events: auto !important; /* 确保可点击 */
}

/* 工具栏内的图标间距 */
.video-container .media-embed-toolbar .clickable-icon {
    margin: 0 2px !important;
    position: static !important; /* 内部图标不需要绝对定位 */
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
}

.resizable-video-wrapper:hover .resize-handle-bottom {
    opacity: 0.6;
}

.resize-handle-bottom:hover {
    opacity: 1 !important;
}

.resize-icon {
    display: none;
}

/* 自定义音频播放器样式 */

/* 内联音频播放器（文本中的音频图标） */
.langr-audio-inline-marker {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    vertical-align: middle;
    width: 1.8em;
    height: 1.8em;
    margin: 0 0.2em;
    border-radius: 50%;
    background-color: var(--interactive-accent);
    color: var(--text-on-accent);
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    position: relative;
    
    /* 默认显示播放图标，隐藏暂停图标 */
    .play-icon {
        display: block;
        width: 70%;
        height: 70%;
    }
    
    .pause-icon {
        display: none;
        width: 70%;
        height: 70%;
    }
    
    &:hover {
        transform: scale(1.1);
        filter: brightness(1.1);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }

    &:active {
        transform: scale(0.95);
    }
    
    /* 播放状态 */
    &.playing {
        animation: audio-pulse 1.5s ease-in-out infinite;
        background-color: var(--interactive-accent-hover);
        box-shadow: 0 0 0 0.3em rgba(var(--interactive-accent-rgb), 0.3);
        
        /* 播放时显示暂停图标，隐藏播放图标 */
        .play-icon {
            display: none;
        }
        
        .pause-icon {
            display: block;
        }
    }
}

/* AI 语音 - 紫色 */
.langr-audio-ai {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    
    &:hover {
        background: linear-gradient(135deg, #7c8ff0 0%, #8b5bb8 100%);
    }
    
    &.playing {
        background: linear-gradient(135deg, #7c8ff0 0%, #8b5bb8 100%);
        box-shadow: 0 0 0 0.3em rgba(102, 126, 234, 0.3);
    }
}

/* 真人录音 - 橙红色 */
.langr-audio-human {
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    
    &:hover {
        background: linear-gradient(135deg, #f5a3ff 0%, #ff6b7e 100%);
    }
    
    &.playing {
        background: linear-gradient(135deg, #f5a3ff 0%, #ff6b7e 100%);
        box-shadow: 0 0 0 0.3em rgba(245, 87, 108, 0.3);
    }
}

@keyframes audio-pulse {
    0%, 100% {
        box-shadow: 0 0 0 0 rgba(var(--interactive-accent-rgb), 0.4);
    }
    50% {
        box-shadow: 0 0 0 0.5em rgba(var(--interactive-accent-rgb), 0);
    }
}

.langr-audio-block-wrapper {
    width: 100%;
    margin: 0.5em 0;
    
    audio {
        width: 100%;
        height: 2.5em; /* 随字体大小调整高度 */
        border-radius: 8px;
        outline: none;
    }
}

</style>
