<template>
	<div id="langr-learn-panel">
		<NConfigProvider :theme="theme" :theme-overrides="themeOverrides">
			<!-- <NThemeEditor> -->
				<NForm :model="model" label-placement="top" label-width="auto" :rules="rules"
				require-mark-placement="right-hanging">
				<div class="learn-primary-grid">
					<!-- 一个单词或短语字符串 -->
					<NFormItem class="learn-primary-grid__item" :label="t('Expression')" :label-style="labelStyle" path="expression">
						<NInput size="small" v-model:value="model.expression" :placeholder="t('A word or a phrase')" />
					</NFormItem>
					<NFormItem class="learn-primary-grid__item" :label="t('Surface')" :label-style="labelStyle" path="surface">
						<NInput size="small" v-model:value="model.surface" :placeholder="t('Original selected form')" />
					</NFormItem>
					<!-- 单词或短语的含义(精简) -->
					<NFormItem class="learn-primary-grid__item" :label="t('Meaning')" :label-style="labelStyle" path="meaning">
						<NInput size="small" v-model:value="model.meaning" :placeholder="t('A short definition')"
							type="textarea" autosize />
					</NFormItem>
					<!-- 变形 -->
					<NFormItem class="learn-primary-grid__item" :label="t('aliases')" :label-style="labelStyle" path="aliases">
						<NInput size="small" v-model:value="model.aliases" :placeholder="t('The inflections with , spacing')"
							type="textarea" autosize />
					</NFormItem>
				</div>
				<!-- 类别，可以是Word或Phrase -->
				<NFormItem :label="t('Type')" :label-style="labelStyle" path="t">
					<NRadioGroup v-model:value="model.t">
						<NRadio value="WORD">{{ t("Word") }}</NRadio>
						<NRadio value="PHRASE">{{ t("Phrase") }}</NRadio>
					</NRadioGroup>
				</NFormItem>
				<!-- 当前单词的学习状态 -->
				<NFormItem :label="t('Status')" :label-style="labelStyle" path="status">
					<NRadioGroup v-model:value="model.status" size="small">
						<NRadioButton v-for="(s, i) in status" :value="i">
							{{ s.text }}
						</NRadioButton>
					</NRadioGroup>
				</NFormItem>
				<!-- 加一些tag, 可以用来搜索 -->
				<NFormItem :label="t('Tags')" :label-style="labelStyle" path="tags">
					<NSelect size="small" v-model:value="model.tags" filterable multiple tag
						:placeholder="t('Input or select some tags')" :loading="tagLoading" :options="tagOptions"
						@search="tagSearch"></NSelect>
				</NFormItem>
				<!-- 可选,可以记多条笔记 -->
				<NFormItem :label="t('Notes')" :label-style="labelStyle" path="notes">
					<div class="learn-notes-list">
						<div
							v-for="(note, index) in model.notes"
							:key="`note-${index}`"
							class="learn-notes-item"
							:data-note-index="index"
						>
							<NInput
								size="small"
								type="textarea"
								:placeholder="t('Write a new note')"
								:autosize="{ minRows: 1, maxRows: 3 }"
								v-model:value="model.notes[index]"
								@keydown="handleNoteKeydown($event, index)"
							/>
							<div class="learn-notes-actions">
								<div
									class="action-btn delete-btn"
									@click="removeNote(index)"
								>
									<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
								</div>
								<div
									class="action-btn add-btn"
									@click="insertNote(index + 1)"
								>
									<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
								</div>
							</div>
						</div>
						<NButton
							v-if="model.notes.length === 0"
							size="small"
							dashed
							style="width: 100%"
							@click="insertNote()"
						>
							{{ t("Create") }}
						</NButton>
					</div>
				</NFormItem>
				<!-- 可选,例句也可以记多条 -->
				<div style="margin-bottom: 8px">
				<label for="Sentences" :style="[labelStyle]">{{
					t("Sentences")
				}}</label>
			</div>
			<!-- 使用 v-for 替代 NDynamicInput 以获得更好的控制 -->
			<div v-for="(sentence, index) in model.sentences" :key="index" style="margin-bottom: 10px;">
				<div style="display: flex; gap: 8px; align-items: flex-start;">
					<div style="display: flex;
							flex-direction: column;
							flex: 1;
							border: 2px solid var(--background-modifier-border);
							border-radius: 6px;
							padding: 8px;
							background: var(--background-primary);
						">
						<NFormItem :show-label="false" :path="`sentences[${index}].text`" :rule="sourceRule">
							<NInput size="small" type="textarea" v-model:value="model.sentences[index].text"
								:placeholder="t('Origin sentence')" :autosize="{ minRows: 1, maxRows: 3 }" />
						</NFormItem>
						<NFormItem :show-feedback="false" :show-label="false" :path="`sentences[${index}].trans`">
							<NInput size="small" type="textarea" v-model:value="model.sentences[index].trans"
								:placeholder="t('Translation (Optional)')" :autosize="{ minRows: 1, maxRows: 3 }" />
						</NFormItem>
						<NFormItem :show-feedback="false" :show-label="false" :path="`sentences[${index}].origin`">
							<NInput size="small" type="textarea" v-model:value="
								model.sentences[index].origin
							" :placeholder="t('Origin (Optional)')" :autosize="{ minRows: 1, maxRows: 3 }" />
						</NFormItem>
					</div>
					
					<!-- 自定义按钮组 -->
					<div class="custom-btn-group">
						<!-- 翻译切换按钮 -->
						<div 
							class="action-btn translate-btn" 
							:class="{ 'ai-mode': translationTypes[index] === 'ai' }"
							@click="toggleTrans(index, model.sentences[index])"
							:title="translationTypes[index] === 'ai' ? t('AI translation mode') : t('Machine translation mode')"
						>
							{{ getTranslationModeShortLabel(translationTypes[index]) }}
						</div>
						
						<!-- 删除按钮 -->
						<div
							class="action-btn delete-btn"
							@click="() => model.sentences.splice(index, 1)"
							:title="t('Delete sentence')"
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
						</div>
						
						<!-- 添加按钮 -->
						<div
							class="action-btn add-btn"
							@click="() => model.sentences.splice(index + 1, 0, onCreateSentence())"
							:title="t('Add sentence')"
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
						</div>
					</div>
				</div>
			</div>
			
			<!-- 底部创建按钮 (当列表为空时显示，或者总是显示以便于在底部添加) -->
			<div v-if="model.sentences.length === 0" style="margin-bottom: 10px;">
				<NButton size="small" dashed style="width: 100%" @click="() => model.sentences.push(onCreateSentence())">
					{{ t("Create") }}
				</NButton>
			</div>
			</NForm>
			<!-- 提交按钮 -->
			<div class="footer-actions">
				<NButton
					size="small"
					class="footer-action-btn footer-action-btn--primary"
					attr-type="submit"
					@click="submit"
					:loading="submitLoading"
					:disabled="aiAutofillLoading"
				>
					{{ t("Submit") }}
				</NButton>
				<NButton
					v-if="showManualAIAutofillButton"
					size="small"
					class="footer-action-btn footer-action-btn--secondary"
					@click="runAIAutofill"
					:loading="aiAutofillLoading"
					:disabled="submitLoading"
					:title="manualAIAutofillHint"
				>
					{{ t("AI Autofill") }}
				</NButton>
			</div>
			<div
				v-if="showManualAIAutofillButton"
				class="footer-ai-hint"
			>
				{{ manualAIAutofillHint }}
			</div>
			<!-- </NThemeEditor> -->
		</NConfigProvider>
	</div>
</template>

<script setup lang="ts">
import { Notice } from "obsidian";
import {
	ref,
	onMounted,
	onUnmounted,
	getCurrentInstance,
	computed,
	CSSProperties,
	nextTick,
    watch,
} from "vue";
import {
	NForm,
	NFormItem,
	NInput,
	NRadio,
	NRadioButton,
	NRadioGroup,
	NButton,
	NSelect,
	SelectOption,
	NConfigProvider,
	// NThemeEditor,
	darkTheme,
	GlobalThemeOverrides,
} from "naive-ui";

import { ExpressionInfo, Sentence } from "@/db/interface";
import { t } from "@/lang/helper";
import type {
	AIAutofillFieldKey,
	AIAutofillWriteMode,
	MeaningAutofillMode,
	SentenceTranslationMode
} from "@/settings";
import { useEvent } from "@/utils/use";
import { analyzeWordSelection } from "@/utils/word-analysis";
import { LearnPanelView } from "./LearnPanelView";
import { ReadingView } from "./ReadingView";
import Plugin from "@/plugin";
import { search as cambridgeSearch } from "@dict/cambridge/engine";
import { search as youdaoSearch, YoudaoResultLex } from "@dict/youdao/engine";
import { search as googleTranslate } from "@dict/google/engine";
import {
	autofillExpression,
	formatAIDebugLog,
	getLatestAIDebugLog,
	translate as aiTranslate
} from "@dict/ai/engine";
import store from "@/store";
const tr = (key: string) => t(key as any);

const view: LearnPanelView =
	getCurrentInstance().appContext.config.globalProperties.view;
const plugin: Plugin =
	getCurrentInstance().appContext.config.globalProperties.plugin;

// 切换明亮/黑暗模式
const theme = computed(() => {
	return store.dark ? darkTheme : null;
});

// 样式设置
const themeOverrides: GlobalThemeOverrides = {
	common: {},
	Form: {
		labelFontSizeTopMedium: "15px",
		feedbackFontSizeMedium: "13px",
		blankHeightMedium: "5px",
		feedbackHeightMedium: "22px",
	},
	Radio: {
		buttonBorderRadius: "5px",
		fontSizeMedium: "13px",
		fontSizeSmall: "13px",
		buttonHeightSmall: "22px",
	},
	Input: {
		fontSizeSmall: "12px",
		paddingSmall: "0 5px",
	},
	DynamicInput: {
		actionMargin: "0 0 0 5px",
	},
};

//表单数据
let model = ref<any>({
	expression: null,
	surface: "",
	meaning: null,
	status: 0,
	t: "WORD",
	tags: [],
	notes: [""],
	sentences: [],
	aliases: "",
    date: Date.now(),
});

// 表单检查规则
const rules = computed(() => ({
	expression: {
		required: true,
		trigger: ["blur", "input"],
		message: t("Please input a word/phrase"),
	},
	meaning: {
		required: true,
		trigger: ["blur", "input"],
		message: t("A short definition is needed"),
	},
	t: {
		required: true,
		trigger: "change",
		message: t("Expression can be a word or phrase"),
	},
	status: {
		required: true,
	},
}));

const sourceRule = computed(() => ({
	required: true,
	trigger: ["blur", "input"],
	message: t("At least input a source sentence"),
}));

let labelStyle: CSSProperties = {
	// fontSize: "16px",
	fontWeight: "bold",
	// padding: "0 0 8px 2px",
};

function onCreateSentence() {
	return {
		text: "",
		trans: "",
		origin: "",
	};
}

function onCreateNote() {
	return "";
}

// 单词状态样式
const status = computed(() => [
	{ text: t("Ignore"), style: "" },
	{ text: t("Learning"), style: "background-Color: #ff980055" },
	{ text: t("Familiar"), style: "background-Color: #ffeb3c55" },
	{ text: t("Known"), style: "background-Color: #9eda5855" },
	{ text: t("Learned"), style: "background-Color: #4cb05155" },
]);


// 异步获取数据库中所有tag
let tagOptions = ref<SelectOption[]>([]);
let tagLoading = ref(false);
let tags: string[] = [];

async function tagSearch(query: string) {
	tagLoading.value = true;
	if (query.length < 2) {
		tags = await plugin.db.getTags();
	}
	tagLoading.value = false;

	if (!query.length) {
		tagOptions.value = tags.map((v) => {
			return { label: v, value: v };
		});
		return;
	}
	tagOptions.value = tags
		.filter((v) => ~v.indexOf(query))
		.map((v) => {
			return { label: v, value: v };
		});
}

// 提交信息到数据库的加载状态
let submitLoading = ref(false);
let aiAutofillLoading = ref(false);
let aiAutofillRunId = 0;
const aiAutofillSettingsVersion = ref(0);

type RunAIAutofillOptions = {
	source?: "manual" | "auto";
	silent?: boolean;
	selectionTokenSnapshot?: number;
};

const AI_AUTOFILL_FIELD_KEYS: AIAutofillFieldKey[] = ["meaning", "aliases", "tags", "notes"];

const manualAIAutofillFields = computed<AIAutofillFieldKey[]>(() => {
	aiAutofillSettingsVersion.value;
	return AI_AUTOFILL_FIELD_KEYS.filter((field) => {
		const triggerMode = plugin.settings.ai_autofill.fields[field].triggerMode;
		return triggerMode === "manual" || triggerMode === "manual-and-auto";
	});
});

const autoAIAutofillFields = computed<AIAutofillFieldKey[]>(() => {
	aiAutofillSettingsVersion.value;
	return AI_AUTOFILL_FIELD_KEYS.filter((field) => {
		const triggerMode = plugin.settings.ai_autofill.fields[field].triggerMode;
		return triggerMode === "auto" || triggerMode === "manual-and-auto";
	});
});

const showManualAIAutofillButton = computed(() => {
	return manualAIAutofillFields.value.length > 0;
});

const manualAIAutofillHint = computed(() => {
	const labels = manualAIAutofillFields.value.map((field) => {
		switch (field) {
			case "meaning":
				return t("Meaning");
			case "aliases":
				return t("aliases");
			case "tags":
				return t("Tags");
			case "notes":
				return t("Notes");
			default:
				return field;
		}
	});

	return `${t("AI Autofill fields")}: ${labels.join(" / ")}`;
});

function normalizeWordValue(value?: string | null): string {
	return (value || "").trim().toLowerCase();
}

function normalizeSurfaceValue(value?: string | null): string | undefined {
	const normalized = normalizeWordValue(value);
	return normalized || undefined;
}

const GENERIC_COMPARATIVE_ALIASES = new Set(["more", "most"]);

function shouldExcludeAlias(alias: string, expression: string, surface?: string): boolean {
	if (!alias) {
		return true;
	}

	if (alias === expression) {
		return true;
	}

	if (
		GENERIC_COMPARATIVE_ALIASES.has(alias) &&
		alias !== expression &&
		(!surface || alias !== surface)
	) {
		return true;
	}

	return false;
}

function escapeWordPattern(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countStandaloneWordOccurrences(text?: string | null, word?: string | null): number {
	const normalizedText = normalizeWordValue(text);
	const normalizedWord = normalizeWordValue(word);
	if (!normalizedText || !normalizedWord) {
		return 0;
	}

	const pattern = new RegExp(
		`(^|[^a-z'-])${escapeWordPattern(normalizedWord)}(?=$|[^a-z'-])`,
		"gi"
	);
	return Array.from(normalizedText.matchAll(pattern)).length;
}

function shouldSkipStoredExpressionMerge(
	expr: ExpressionInfo,
	currentSurface: string,
	sentenceText: string
): boolean {
	const normalizedCurrentSurface = normalizeSurfaceValue(currentSurface);
	const normalizedStoredSurface = normalizeSurfaceValue(expr.surface);

	if (
		!sentenceText ||
		!normalizedCurrentSurface ||
		!normalizedStoredSurface ||
		normalizedCurrentSurface === normalizedStoredSurface
	) {
		return false;
	}

	return (
		countStandaloneWordOccurrences(sentenceText, normalizedCurrentSurface) > 0 &&
		countStandaloneWordOccurrences(sentenceText, normalizedStoredSurface) > 0
	);
}

function normalizeAliasesValue(
	value: string[] | string | null | undefined,
	expression: string,
	surface?: string,
	extraAliases: string[] = []
): string[] {
	const source = Array.isArray(value) ? value : (value || "").split(/[,，]/);
	const merged = [...source, ...extraAliases];
	const normalized = [...new Set(merged.map((item) => normalizeWordValue(item)).filter(Boolean))].filter((alias) =>
		!shouldExcludeAlias(alias, expression, surface)
	);

	if (surface && surface !== expression && !normalized.includes(surface)) {
		normalized.unshift(surface);
	}

	return normalized;
}

function aliasesToInputValue(value: string[] | string | null | undefined): string {
	if (Array.isArray(value)) {
		return value.join(", ");
	}
	return value || "";
}

function mergeUniqueTextList(existing: string[] = [], incoming: string[] = []): string[] {
	const seen = new Set<string>();
	const merged: string[] = [];

	[...existing, ...incoming].forEach((item) => {
		if (typeof item !== "string") {
			return;
		}

		const trimmed = item.trim();
		const dedupeKey = trimmed.toLowerCase();
		if (!trimmed || seen.has(dedupeKey)) {
			return;
		}

		seen.add(dedupeKey);
		merged.push(trimmed);
	});

	return merged;
}

function normalizeNotesValue(value: string[] | string | null | undefined): string[] {
	if (Array.isArray(value)) {
		return mergeUniqueTextList(value);
	}

	if (typeof value === "string") {
		return mergeUniqueTextList(value.split(/\r?\n+/));
	}

	return [];
}

function ensureEditableNotes(value: string[] | string | null | undefined): string[] {
	const normalized = normalizeNotesValue(value);
	return normalized.length > 0 ? normalized : [onCreateNote()];
}

async function focusNoteInput(index: number) {
	await nextTick();
	const textarea = document.querySelector(
		`#langr-learn-panel .learn-notes-item[data-note-index="${index}"] textarea`
	) as HTMLTextAreaElement | null;
	textarea?.focus();
}

async function insertNote(index?: number) {
	const nextNotes = [...normalizeNotesValue(model.value.notes || [])];
	const insertAt = typeof index === "number" ? Math.max(0, Math.min(index, nextNotes.length)) : nextNotes.length;
	nextNotes.splice(insertAt, 0, onCreateNote());
	model.value.notes = nextNotes;
	await focusNoteInput(insertAt);
}

function removeNote(index: number) {
	const nextNotes = [...(model.value.notes || [])];
	nextNotes.splice(index, 1);
	model.value.notes = nextNotes.length > 0 ? nextNotes : [onCreateNote()];
}

function handleNoteKeydown(event: KeyboardEvent, index: number) {
	if (event.key !== "Enter" || event.shiftKey) {
		return;
	}

	if (event.ctrlKey || event.metaKey || (!event.altKey && !event.ctrlKey && !event.metaKey)) {
		event.preventDefault();
		void insertNote(index + 1);
	}
}

function aliasesInputToList(value: string[] | string | null | undefined): string[] {
	return normalizeAliasesValue(
		value,
		normalizeWordValue(model.value.expression),
		normalizeSurfaceValue(model.value.surface)
	);
}

function getPrimarySentenceContext(): Sentence | null {
	const sentences = dedupeSentences(model.value.sentences || []);
	return sentences.find((sentence) => sanitizeSentenceText(sentence.text)) || null;
}

useEvent(window, "obsidian-langr-ai-autofill-settings-change", () => {
	aiAutofillSettingsVersion.value += 1;
});

function isSelectionStillCurrent(selectionTokenSnapshot?: number): boolean {
	return selectionTokenSnapshot === undefined || selectionToken.value === selectionTokenSnapshot;
}

function getAIAutofillFieldsForSource(source: "manual" | "auto"): AIAutofillFieldKey[] {
	return source === "manual" ? manualAIAutofillFields.value : autoAIAutofillFields.value;
}

function fieldNeedsAutofill(field: AIAutofillFieldKey): boolean {
	const strategy = plugin.settings.ai_autofill.fields[field];
	switch (field) {
		case "meaning":
			return strategy.writeMode === "overwrite" || !cleanMeaningText(model.value.meaning);
		case "aliases":
			return strategy.writeMode !== "fill-empty" || aliasesInputToList(model.value.aliases).length === 0;
		case "tags":
			return true;
		case "notes":
			return true;
		default:
			return false;
	}
}

function shouldRunAutoAIAutofill(selectedFields: AIAutofillFieldKey[]): boolean {
	if (selectedFields.length === 0) {
		return false;
	}

	return selectedFields.some((field) => fieldNeedsAutofill(field));
}

function applyAIAutofillWriteMode(
	field: AIAutofillFieldKey,
	writeMode: AIAutofillWriteMode,
	result: Awaited<ReturnType<typeof autofillExpression>>
): string | string[] {
	switch (field) {
		case "meaning": {
			const aiMeaning = cleanMeaningText(result.meaning);
			if (!aiMeaning) {
				return model.value.meaning || "";
			}
			if (writeMode === "overwrite") {
				return aiMeaning;
			}
			return cleanMeaningText(model.value.meaning) ? (model.value.meaning || "") : aiMeaning;
		}
		case "aliases": {
			const normalizedExpression = normalizeWordValue(model.value.expression);
			const normalizedSurface = normalizeSurfaceValue(model.value.surface);
			if (writeMode === "overwrite") {
				return aliasesToInputValue(
					normalizeAliasesValue(result.aliases || [], normalizedExpression, normalizedSurface)
				);
			}
			if (writeMode === "merge") {
				return aliasesToInputValue(
					normalizeAliasesValue(
						model.value.aliases,
						normalizedExpression,
						normalizedSurface,
						result.aliases || []
					)
				);
			}
			return aliasesInputToList(model.value.aliases).length > 0
				? (model.value.aliases || "")
				: aliasesToInputValue(
					normalizeAliasesValue(result.aliases || [], normalizedExpression, normalizedSurface)
				);
		}
		case "tags":
			return writeMode === "overwrite"
				? mergeUniqueTextList(result.tags || [])
				: mergeUniqueTextList(model.value.tags || [], result.tags || []);
		case "notes":
			return writeMode === "overwrite"
				? mergeUniqueTextList(result.notes || [])
				: mergeUniqueTextList(model.value.notes || [], result.notes || []);
		default:
			return "";
	}
}

async function runAIAutofill(options: RunAIAutofillOptions = {}) {
	const source = options.source || "manual";
	const silent = options.silent ?? false;
	const selectedFields = getAIAutofillFieldsForSource(source);

	if (!model.value.expression?.trim()) {
		if (!silent) {
			new Notice(t("Expression is empty!"));
		}
		return;
	}

	if (selectedFields.length === 0) {
		if (!silent) {
			new Notice(t("Please enable at least one AI autofill field in settings"));
		}
		return;
	}

	if (source === "auto" && !shouldRunAutoAIAutofill(selectedFields)) {
		return;
	}

	if (!isSelectionStillCurrent(options.selectionTokenSnapshot)) {
		return;
	}

	const currentRunId = ++aiAutofillRunId;
	aiAutofillLoading.value = true;
	try {
		const primarySentence = getPrimarySentenceContext();
		const result = await autofillExpression({
			expression: normalizeWordValue(model.value.expression),
			surface: normalizeSurfaceValue(model.value.surface),
			type: model.value.t,
			sentenceText: primarySentence?.text || "",
			origin: primarySentence?.origin || "",
			existingMeaning: cleanMeaningText(model.value.meaning),
			existingAliases: aliasesInputToList(model.value.aliases),
			existingTags: mergeUniqueTextList(model.value.tags || []),
			existingNotes: mergeUniqueTextList(model.value.notes || []),
			nativeLanguage: plugin.settings.native,
			foreignLanguage: plugin.settings.foreign,
			requestedFields: selectedFields,
		}, plugin.settings);

		if (!isSelectionStillCurrent(options.selectionTokenSnapshot)) {
			return;
		}

		let nextMeaning = model.value.meaning || "";
		let nextAliases = model.value.aliases || "";
		let nextTags = [...(model.value.tags || [])];
		let nextNotes = [...(model.value.notes || [])];

		if (selectedFields.includes("meaning")) {
			nextMeaning = applyAIAutofillWriteMode("meaning", plugin.settings.ai_autofill.fields.meaning.writeMode, result) as string;
		}

		if (selectedFields.includes("aliases")) {
			nextAliases = applyAIAutofillWriteMode("aliases", plugin.settings.ai_autofill.fields.aliases.writeMode, result) as string;
		}

		if (selectedFields.includes("tags")) {
			nextTags = applyAIAutofillWriteMode("tags", plugin.settings.ai_autofill.fields.tags.writeMode, result) as string[];
		}

		if (selectedFields.includes("notes")) {
			nextNotes = applyAIAutofillWriteMode("notes", plugin.settings.ai_autofill.fields.notes.writeMode, result) as string[];
		}

		const changed =
			nextMeaning !== (model.value.meaning || "") ||
			nextAliases !== (model.value.aliases || "") ||
			JSON.stringify(nextTags) !== JSON.stringify(model.value.tags || []) ||
			JSON.stringify(nextNotes) !== JSON.stringify(model.value.notes || []);

		model.value.meaning = nextMeaning;
		model.value.aliases = nextAliases;
		model.value.tags = nextTags;
		model.value.notes = ensureEditableNotes(nextNotes);

		if (!silent) {
			new Notice(t(changed ? "AI autofill applied" : "AI autofill made no changes"));
		}
	} catch (e: any) {
		const latestLog = getLatestAIDebugLog();
		if (!silent) {
			new Notice(`${t("AI autofill failed")}${e?.message ? `: ${e.message}` : ""}`);
		}
		console.error("[Language Learner][AI][autofill] Autofill failed", {
			expression: model.value.expression,
			surface: model.value.surface,
			type: model.value.t,
			sentences: model.value.sentences,
			requestedFields: selectedFields,
			error: e,
			latestLog,
		});
		if (latestLog) {
			console.info("[Language Learner][AI][autofill][latest-log]\n" + formatAIDebugLog(latestLog));
		}
	} finally {
		if (currentRunId === aiAutofillRunId) {
			aiAutofillLoading.value = false;
		}
	}
}

async function submit() {
	// 表单内容检查
	if (!model.value.expression) {
		new Notice(t("Expression is empty!"));
		return;
	}
	if (!model.value.meaning) {
		new Notice(t("Meaning is empty!"));
		return;
	}
	if (
		model.value.expression.trim().split(" ").length > 1 &&
		model.value.t === "WORD"
	) {
		new Notice(t("It looks more like a PHRASE than a WORD"));
		return;
	}
	submitLoading.value = true;
	try {
			let data = JSON.parse(JSON.stringify(model.value));
			data.expression = normalizeWordValue(data.expression);
			data.surface = normalizeSurfaceValue(data.surface);
			data.aliases = normalizeAliasesValue(
				data.aliases,
				data.expression,
				data.surface
			);
			data.notes = normalizeNotesValue(data.notes);
			data.sentences = dedupeSentences(data.sentences || []);
			// 超过1条例句时，sentences中的对象会变成Proxy，尚不知原因，因此用JSON转换一下

		let statusCode = await plugin.db.postExpression(data);
		if (statusCode !== 200) {
			new Notice(t("Submit failed"));
			console.warn("Submit failed, please check server status");
			return;
		}

		dispatchEvent(
			new CustomEvent("obsidian-langr-refresh", {
				detail: {
					expression: data.expression,
					surface: data.surface,
					type: data.t,
					status: data.status,
					meaning: data.meaning,
					aliases: data.aliases,
				},
			})
		);
		dispatchEvent(new CustomEvent("obsidian-langr-refresh-stat"));

		//自动刷新数据库（延迟执行，等待元数据缓存更新）
		if (plugin.settings.auto_refresh_db) {
			plugin.scheduleRefreshTextDB(500);
		}
		clearPanel();
	} finally {
		submitLoading.value = false;
	}
};

//清空词表单
function clearPanel(){
	model.value = {
		expression: null,
		surface: "",
		meaning: null,
		status: 1,
		t: "WORD",
		tags: [],
		notes: [""],
		sentences: [],
		aliases: "",
        date: Date.now(),
	};
};

const selectionToken = ref(0);
const GOOGLE_CONTEXT_MARKER_START = "[[";
const GOOGLE_CONTEXT_MARKER_END = "]]";
const CONTEXT_DETERMINERS = new Set([
	"a", "an", "the", "this", "that", "these", "those",
	"some", "any", "each", "every", "either", "neither", "no",
	"another", "other", "such", "what", "which", "whose"
]);
const CONTEXT_POSSESSIVES = new Set([
	"my", "your", "his", "her", "its", "our", "their"
]);
const CONTEXT_NUMBER_HINTS = new Set([
	"one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
	"many", "few", "several", "much", "more", "most", "less", "least"
]);
const CONTEXT_MODAL_HINTS = new Set([
	"to", "will", "would", "can", "could", "may", "might", "must", "shall", "should",
	"do", "does", "did", "be", "am", "is", "are", "was", "were", "been", "being",
	"have", "has", "had"
]);
const CONTEXT_SUBJECT_HINTS = new Set([
	"i", "you", "he", "she", "it", "we", "they", "who"
]);
const CONTEXT_OBJECT_HINTS = new Set([
	"me", "you", "him", "her", "it", "us", "them", "this", "that", "these", "those"
]);
const CONTEXT_NOUN_FOLLOW_HINTS = new Set([
	"of", "for", "with", "about", "over", "on", "in", "at", "from",
	"that", "whether", "when", "where", "which", "who", "whom", "whose"
]);

interface YoudaoMeaningEntry {
	pos: string;
	meaning: string;
	text: string;
}

function decodeHtmlEntities(input: string): string {
	const textarea = document.createElement("textarea");
	let value = input;
	for (let i = 0; i < 3; i++) {
		textarea.innerHTML = value;
		const decoded = textarea.value;
		if (decoded === value) {
			break;
		}
		value = decoded;
	}
	return value;
}

function normalizePosMeaningLine(text: string): string {
	return cleanMeaningText(text).replace(/^([a-z]{1,6}\.)\s+/i, "$1");
}

function normalizePosKey(pos?: string | null): string {
	const normalized = cleanMeaningText(pos).toLowerCase();
	if (!normalized) return "";
	if (normalized.startsWith("vt.") || normalized.startsWith("vi.") || normalized.startsWith("v.")) {
		return "v.";
	}
	if (normalized.startsWith("n.")) return "n.";
	if (normalized.startsWith("adj.")) return "adj.";
	if (normalized.startsWith("adv.")) return "adv.";
	if (normalized.startsWith("prep.")) return "prep.";
	return normalized;
}

function extractYoudaoBasicMeaningEntries(res: any): YoudaoMeaningEntry[] {
	const basicHtml = (res?.result as YoudaoResultLex | undefined)?.basic;
	if (!basicHtml) return [];

	const container = document.createElement("div");
	container.innerHTML = basicHtml;
	const items = Array.from(container.querySelectorAll("li"))
		.map((item) => {
			const line = normalizePosMeaningLine(item.textContent || "");
			if (!line) return null;
			const matched = line.match(/^([a-z]{1,6}\.)\s*(.+)$/i);
			return {
				pos: matched?.[1] || "",
				meaning: matched?.[2] || line,
				text: line,
			} as YoudaoMeaningEntry;
		})
		.filter((item): item is YoudaoMeaningEntry => Boolean(item));

	if (items.length > 0) {
		return items;
	}

	const text = container.textContent?.replace(/\s+/g, " ").trim() || "";
	if (!text) return [];

	const line = normalizePosMeaningLine(decodeHtmlEntities(text));
	return line
		? [{
			pos: line.match(/^([a-z]{1,6}\.)/i)?.[1] || "",
			meaning: line.replace(/^([a-z]{1,6}\.)\s*/i, ""),
			text: line,
		}]
		: [];
}

function extractYoudaoBasicMeaning(res: any): string {
	return extractYoudaoBasicMeaningEntries(res)
		.map((item) => item.text)
		.join("；");
}

function extractYoudaoMeaningByPos(res: any, pos: string): string {
	const normalizedPos = normalizePosKey(pos);
	if (!normalizedPos) return "";

	return extractYoudaoBasicMeaningEntries(res)
		.filter((item) => normalizePosKey(item.pos) === normalizedPos)
		.map((item) => item.text)
		.join("；");
}

function extractYoudaoTranslationFallback(res: any): string {
	if (!res || !(res.result as any)?.translation) return "";
	const html = (res.result as any).translation as string;
	const container = document.createElement("div");
	container.innerHTML = html;
	const text = container.textContent?.replace(/\s+/g, " ").trim() || "";
	return text ? decodeHtmlEntities(text) : "";
}

function extractYoudaoMeaning(res: any): string {
	return extractYoudaoBasicMeaning(res) || extractYoudaoTranslationFallback(res);
}

function extractCambridgeHeadword(res: any): string {
	const firstEntryHtml = res?.result?.[0]?.html;
	if (!firstEntryHtml) return "";

	const container = document.createElement("div");
	container.innerHTML = firstEntryHtml;
	const text =
		container.querySelector(".headword")?.textContent ||
		container.querySelector(".di-title")?.textContent ||
		"";

	return normalizeWordValue(text);
}

function extractYoudaoBasicInflections(res: any): string[] {
	const basicHtml = (res?.result as YoudaoResultLex | undefined)?.basic;
	if (!basicHtml) return [];

	const container = document.createElement("div");
	container.innerHTML = basicHtml;

	const inflectionText = Array.from(container.querySelectorAll(".additional"))
		.map((item) => decodeHtmlEntities(item.textContent || ""))
		.join(" ");
	if (!inflectionText) return [];

	return [...new Set(
		(inflectionText.match(/[a-z]+(?:['-][a-z]+)*/gi) || [])
			.map((word) => normalizeWordValue(word))
			.filter((word) => word.length > 1)
	)];
}

function prefixMeaningWithPos(meaning: string, pos: string): string {
	const normalizedPos = normalizePosKey(pos);
	const cleanedMeaning = cleanMeaningText(meaning).replace(/^[a-z]{1,6}\.\s*/i, "");
	if (!cleanedMeaning) return "";
	if (!normalizedPos) return cleanedMeaning;
	return normalizePosMeaningLine(`${normalizedPos} ${cleanedMeaning}`);
}

function tokenizeSentenceWords(sentenceText: string): string[] {
	return normalizeWordValue(sentenceText).match(/[a-z]+(?:['-][a-z]+)*/g) || [];
}

function looksLikeAdjectiveHint(word: string): boolean {
	return /(?:al|ary|ed|ful|ic|ical|ish|ive|less|ory|ous|y)$/.test(word);
}

function looksLikeFiniteVerbHint(word: string): boolean {
	return CONTEXT_MODAL_HINTS.has(word) || /(?:ed|ing|en|es|s)$/.test(word);
}

function inferContextualPos(selection: string, expression: string, sentenceText: string): string {
	const surface = normalizeWordValue(selection);
	const lemma = normalizeWordValue(expression);
	if (!surface || surface.includes(" ")) return "";

	if (surface !== lemma) {
		if (/(ed|ing)$/.test(surface)) return "v.";
		if (/ly$/.test(surface)) return "adv.";
	}

	const tokens = tokenizeSentenceWords(sentenceText);
	if (!tokens.length) return "";

	const indexes = tokens
		.map((token, index) => token === surface ? index : -1)
		.filter((index) => index >= 0);
	let bestPos = "";
	let bestScore = 0;

	for (const index of indexes) {
		const prev2 = tokens[index - 2] || "";
		const prev = tokens[index - 1] || "";
		const next = tokens[index + 1] || "";
		const next2 = tokens[index + 2] || "";
		let nounScore = 0;
		let verbScore = 0;

		if (
			CONTEXT_DETERMINERS.has(prev) ||
			CONTEXT_POSSESSIVES.has(prev) ||
			CONTEXT_NUMBER_HINTS.has(prev)
		) {
			nounScore += 3;
		}
		if (looksLikeAdjectiveHint(prev)) {
			nounScore += 1;
		}
		if (CONTEXT_DETERMINERS.has(prev2) && prev && !CONTEXT_MODAL_HINTS.has(prev)) {
			nounScore += 1;
		}
		if (CONTEXT_NOUN_FOLLOW_HINTS.has(next)) {
			nounScore += 2;
		}
		if (
			looksLikeFiniteVerbHint(next) &&
			(
				CONTEXT_DETERMINERS.has(prev) ||
				CONTEXT_NUMBER_HINTS.has(prev) ||
				looksLikeAdjectiveHint(prev)
			)
		) {
			nounScore += 2;
		}

		if (CONTEXT_MODAL_HINTS.has(prev)) {
			verbScore += 3;
		}
		if (/ly$/.test(prev)) {
			verbScore += 1;
		}
		if (
			CONTEXT_SUBJECT_HINTS.has(prev) &&
			next &&
			!CONTEXT_NOUN_FOLLOW_HINTS.has(next)
		) {
			verbScore += 2;
		}
		if (
			(
				CONTEXT_DETERMINERS.has(next) ||
				CONTEXT_OBJECT_HINTS.has(next) ||
				CONTEXT_NUMBER_HINTS.has(next)
			) &&
			!CONTEXT_DETERMINERS.has(prev) &&
			!CONTEXT_NUMBER_HINTS.has(prev)
		) {
			verbScore += 2;
		}
		if (CONTEXT_DETERMINERS.has(next) && CONTEXT_OBJECT_HINTS.has(next2)) {
			verbScore += 1;
		}

		if (nounScore > verbScore && nounScore > bestScore) {
			bestPos = "n.";
			bestScore = nounScore;
		}
		if (verbScore > nounScore && verbScore > bestScore) {
			bestPos = "v.";
			bestScore = verbScore;
		}
	}

	return bestPos;
}

function resolveMeaningAutofill(
	mode: MeaningAutofillMode,
	input: {
		selection: string;
		expression: string;
		sentenceText: string;
		formsResult: any;
		translationResult: { sentenceTranslation: string; meaningTranslation: string } | null;
	}
): string {
	const translationMeaning = cleanMeaningText(input.translationResult?.meaningTranslation);

	switch (mode) {
		case "off":
			return "";
		case "context-translation":
			return translationMeaning || extractYoudaoTranslationFallback(input.formsResult) || extractYoudaoBasicMeaning(input.formsResult);
		case "youdao-basic":
			return extractYoudaoBasicMeaning(input.formsResult) || translationMeaning || extractYoudaoTranslationFallback(input.formsResult);
		case "context-pos": {
			const inferredPos = inferContextualPos(
				input.selection,
				input.expression,
				input.sentenceText
			);
			if (inferredPos && translationMeaning) {
				return prefixMeaningWithPos(translationMeaning, inferredPos);
			}

			const youdaoPosMeaning = extractYoudaoMeaningByPos(input.formsResult, inferredPos);
			if (youdaoPosMeaning) {
				return youdaoPosMeaning;
			}

			const entries = extractYoudaoBasicMeaningEntries(input.formsResult);
			if (!inferredPos && entries.length === 1) {
				return entries[0].text;
			}

			return translationMeaning || extractYoudaoBasicMeaning(input.formsResult) || extractYoudaoTranslationFallback(input.formsResult);
		}
		default:
			return translationMeaning || extractYoudaoMeaning(input.formsResult);
	}
}

function extractGoogleTranslation(res: any): string {
	const text = res?.result?.tgt?.trim?.() || "";
	return text ? decodeHtmlEntities(text) : "";
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanMeaningText(text?: string | null): string {
	return (text || "")
		.replace(/\s+/g, " ")
		.replace(/^[\s,，。；;:："“”"'‘’\-]+/, "")
		.replace(/[\s,，。；;:："“”"'‘’\-]+$/, "")
		.trim();
}

function wrapSelectionForContext(sentence: string, selection: string): string {
	if (!sentence || !selection) return "";
	const exactSelection = selection.trim();
	const matcher = /^[a-z][a-z'-]*$/i.test(exactSelection)
		? new RegExp(`\\b${escapeRegExp(exactSelection)}\\b`, "i")
		: new RegExp(escapeRegExp(exactSelection), "i");
	if (!matcher.test(sentence)) return "";
	return sentence.replace(
		matcher,
		`${GOOGLE_CONTEXT_MARKER_START}$&${GOOGLE_CONTEXT_MARKER_END}`
	);
}

function stripGoogleContextMarkers(text?: string | null): string {
	return (text || "")
		.split(GOOGLE_CONTEXT_MARKER_START).join("")
		.split(GOOGLE_CONTEXT_MARKER_END).join("")
		.trim();
}

function extractGoogleContextMeaning(text?: string | null): string {
	const raw = text || "";
	const matched = raw.match(/\[\[(.*?)\]\]/);
	if (!matched?.[1]) return "";
	return cleanMeaningText(decodeHtmlEntities(matched[1]));
}

async function translateMeaningWithContext(
	selection: string,
	sentenceText: string
): Promise<{ sentenceTranslation: string; meaningTranslation: string }> {
	let sentenceTranslation = "";
	let meaningTranslation = "";

	if (sentenceText) {
		const markedSentence = wrapSelectionForContext(sentenceText, selection);
		const sentenceRes = markedSentence
			? await googleTranslate(markedSentence, plugin.settings).catch((): null => null)
			: await googleTranslate(sentenceText, plugin.settings).catch((): null => null);
		const translatedSentence = extractGoogleTranslation(sentenceRes);
		sentenceTranslation = stripGoogleContextMarkers(translatedSentence);
		if (markedSentence) {
			meaningTranslation = extractGoogleContextMeaning(translatedSentence);
		}
	}

	if (!meaningTranslation) {
		const wordRes = await googleTranslate(selection, plugin.settings).catch((): null => null);
		meaningTranslation = cleanMeaningText(extractGoogleTranslation(wordRes));
	}

	return { sentenceTranslation, meaningTranslation };
}

function sanitizeSentenceText(text?: string | null): string {
	return plugin.sanitizeSentenceContext(text);
}

function sanitizeSentenceRecord(sentence: Sentence | null): Sentence | null {
	if (!sentence) return null;
	const text = sanitizeSentenceText(sentence.text);
	if (!text) return null;
	return {
		...sentence,
		text,
	};
}

function dedupeSentences(sentences: Sentence[] = []): Sentence[] {
	const merged = new Map<string, Sentence>();
	sentences.forEach((sentence) => {
		const sanitized = sanitizeSentenceRecord(sentence);
		if (!sanitized) return;

		const existing = merged.get(sanitized.text);
		if (!existing) {
			merged.set(sanitized.text, { ...sanitized });
			return;
		}

		if (!existing.trans && sanitized.trans) {
			existing.trans = sanitized.trans;
		}
		if (!existing.origin && sanitized.origin) {
			existing.origin = sanitized.origin;
		}
	});
	return [...merged.values()];
}

function normalizeCurrentModelSentences() {
	model.value.sentences = dedupeSentences(model.value.sentences || []);
}

function mergeExpressionWithContext(
	expr: ExpressionInfo,
	sentenceText: string,
	defaultOrigin: string,
	storedSen: Sentence | null
) {
	const currentModel = model.value;
	const nextSentences = dedupeSentences(expr.sentences || []);

	if (sentenceText) {
		if (!storedSen) {
			nextSentences.push({
				text: sentenceText,
				trans: "",
				origin: defaultOrigin,
			});
		} else if (!nextSentences.find((sen: Sentence) => sen.text === sentenceText)) {
			nextSentences.push(storedSen);
		}
	}

		model.value = {
			...currentModel,
			...expr,
			// Keep the current clicked form as the active surface for this context.
			surface: currentModel.surface || expr.surface || "",
			meaning: expr.meaning || currentModel.meaning || "",
			notes: ensureEditableNotes(expr.notes || currentModel.notes || []),
			sentences: dedupeSentences([...(currentModel.sentences || []), ...nextSentences]),
			aliases: expr.aliases?.length ? expr.aliases.join(",") : currentModel.aliases || "",
		};
}

// 查询词汇时自动填充新词表单
useEvent(window, "obsidian-langr-search", async (evt: CustomEvent) => {
	const selectionRaw = (evt.detail.selection as string) || "";
	const selection = selectionRaw.trim();
	if (!selection) return;
	const token = ++selectionToken.value;
	const exprType = selection.includes(" ") ? "PHRASE" : "WORD";
	const target = evt.detail.target as HTMLElement;
	let sentenceText = sanitizeSentenceText((evt.detail.sentenceText as string) || "");
	let defaultOrigin: string = (evt.detail.origin as string) || null;

	if (!sentenceText && target) {
		let sentenceEl = target.parentElement?.hasClass("stns")
			? target.parentElement
			: target.parentElement?.parentElement;
		sentenceText = sanitizeSentenceText(sentenceEl?.textContent || "");

		let reading = view.app.workspace.getActiveViewOfType(ReadingView);
		if (reading && !defaultOrigin) {
			let presetOrigin = view.app.metadataCache.getFileCache(reading.file)
				.frontmatter["langr-origin"];
			defaultOrigin = presetOrigin ? presetOrigin : reading.file.name;
		}
	}

	// Fast fill to avoid UI lag
	model.value = {
		expression: selection,
		surface: selection,
		meaning: "",
		status: 1,
		t: exprType,
		tags: [],
		notes: [""],
		aliases: "",
		date: Date.now(),
		sentences: sentenceText
			? [
				{
					text: sentenceText,
					trans: "",
					origin: defaultOrigin,
				},
			]
			: [],
	};

	initializeSentenceTranslationModes(model.value.sentences || []);

	const exprPromise = plugin.db.getExpression(selection).catch((): null => null);
	const storedSenPromise = sentenceText
		? plugin.db.tryGetSen(sentenceText).catch((): null => null)
		: Promise.resolve(null);
	const cambridgePromise = exprType === "WORD"
		? cambridgeSearch(selection).catch((): null => null)
		: Promise.resolve(null);
	const formsPromise = youdaoSearch(selection).catch((): null => null);
	const defaultSentenceTranslationMode = getDefaultSentenceTranslationMode();
	const translationPromise = plugin.settings.use_machine_trans
		? (
			defaultSentenceTranslationMode === "machine"
				? translateMeaningWithContext(selection, sentenceText).catch((): null => null)
				: sentenceText
					? aiTranslate(sentenceText, plugin.settings)
						.then((translated) => ({
							sentenceTranslation: decodeHtmlEntities(translated),
							meaningTranslation: "",
						}))
						.catch((): null => null)
					: Promise.resolve(null)
		)
		: Promise.resolve(null);
	const meaningAutofillMode = plugin.settings.meaning_autofill_mode;

	const isCurrent = () => selectionToken.value === token;
	let storedExpressionApplied = false;

	void (async () => {
		const expr = await exprPromise;
		if (!expr || !isCurrent()) return;
		const storedSen = sanitizeSentenceRecord(await storedSenPromise);
		if (!isCurrent()) return;
		if (shouldSkipStoredExpressionMerge(expr, selection, sentenceText)) return;
		storedExpressionApplied = true;
		mergeExpressionWithContext(expr, sentenceText, defaultOrigin, storedSen);
	})();

	void (async () => {
		const res = await formsPromise;
		if (!isCurrent()) return;
		const cambridgeRes = await cambridgePromise;
		if (!isCurrent()) return;
		const lex = res?.result && (res.result as any).type === "lex"
			? (res.result as YoudaoResultLex)
			: null;
		const cambridgeHeadword = extractCambridgeHeadword(cambridgeRes);
		const wordInfo = analyzeWordSelection(
			selection,
			cambridgeHeadword || lex?.title,
			lex?.pattern
		);
		const youdaoInflections = extractYoudaoBasicInflections(res);

		if (!storedExpressionApplied) {
			for (const candidate of wordInfo.lookupCandidates) {
				const expr = await plugin.db.getExpression(candidate).catch((): null => null);
				if (!expr || !isCurrent()) continue;
				const storedSen = sanitizeSentenceRecord(await storedSenPromise);
				if (!isCurrent()) return;
				if (shouldSkipStoredExpressionMerge(expr, selection, sentenceText)) continue;
				storedExpressionApplied = true;
				mergeExpressionWithContext(expr, sentenceText, defaultOrigin, storedSen);
				break;
			}
		}

		if (!storedExpressionApplied && wordInfo.resolvedBaseExpression && model.value.t === "WORD") {
			model.value.expression = wordInfo.resolvedBaseExpression;
		}

		model.value.surface = model.value.surface || wordInfo.surface || selection;
		const normalizedExpression = normalizeWordValue(model.value.expression);
		const normalizedSurface = normalizeSurfaceValue(model.value.surface);
		const mergedAliases = normalizeAliasesValue(
			model.value.aliases,
			normalizedExpression,
			normalizedSurface,
			[...wordInfo.aliases, ...youdaoInflections]
		);
		model.value.aliases = aliasesToInputValue(mergedAliases);

		if (!model.value.meaning) {
			const translationResult =
				meaningAutofillMode === "context-translation" || meaningAutofillMode === "context-pos"
					? await translationPromise
					: null;
			if (!isCurrent()) return;

			const autofilledMeaning = resolveMeaningAutofill(meaningAutofillMode, {
				selection,
				expression: normalizedExpression || wordInfo.resolvedBaseExpression || selection,
				sentenceText,
				formsResult: res,
				translationResult,
			});
			if (autofilledMeaning) {
				model.value.meaning = cleanMeaningText(autofilledMeaning);
			}
		}

		if (isCurrent()) {
			void runAIAutofill({
				source: "auto",
				silent: true,
				selectionTokenSnapshot: token,
			});
		}
	})();

	void (async () => {
		const res = await translationPromise;
		if (!isCurrent()) return;
		if (!sentenceText || !res?.sentenceTranslation) return;
		const sentences = model.value.sentences || [];
		const targetSen = sentences.find((sen: any) => sen.text === sentenceText);
		if (targetSen && !targetSen.trans) {
			targetSen.trans = res.sentenceTranslation;
			if (!translationCache.value[sentenceText]) translationCache.value[sentenceText] = {};
			translationCache.value[sentenceText][defaultSentenceTranslationMode] = res.sentenceTranslation;
		}
	})();
});

// 翻译切换逻辑
const translationTypes = ref<Record<number, 'machine' | 'ai'>>({});
const translationCache = ref<Record<string, { machine?: string; ai?: string }>>({});

function getDefaultSentenceTranslationMode(): SentenceTranslationMode {
	return plugin.settings.sentence_translation_mode || "machine";
}

function initializeSentenceTranslationModes(sentences: Sentence[] = []) {
	const defaultMode = getDefaultSentenceTranslationMode();
	translationTypes.value = {};
	sentences.forEach((_, idx) => {
		translationTypes.value[idx] = defaultMode;
	});
}

function getTranslationModeShortLabel(mode: "machine" | "ai" | undefined) {
	return mode === "ai" ? "AI" : t("Machine translation short");
}

async function translateSentenceByMode(
	mode: "machine" | "ai",
	sentence: string
): Promise<string> {
	if (mode === "ai") {
		return decodeHtmlEntities(await aiTranslate(sentence, plugin.settings));
	}

	const res = await googleTranslate(sentence, plugin.settings);
	return decodeHtmlEntities(extractGoogleTranslation(res));
}

const toggleTrans = async (index: number, element: any) => {
    const currentType = translationTypes.value[index] || 'machine';
    const newType = currentType === 'machine' ? 'ai' : 'machine';
    const sentence = element.text; // 注意这里是 text 不是 sentence

    if (!sentence) return;

    // 初始化缓存
    if (!translationCache.value[sentence]) translationCache.value[sentence] = {};

    // 1. 检查缓存
    if (translationCache.value[sentence][newType]) {
        element.trans = translationCache.value[sentence][newType];
        translationTypes.value[index] = newType;
        return;
    }

    // 2. 执行翻译
    try {
        const result = await translateSentenceByMode(newType, sentence);

        if (!result) {
            const message = newType === "ai"
                ? tr("AI translation returned empty content")
                : tr("Machine translation returned empty content");
            new Notice(message);
            const latestLog = getLatestAIDebugLog();
            console.warn("[Language Learner][translate] Empty translation result", {
                type: newType,
                sentence,
                latestLog,
            });
            if (latestLog && newType === "ai") {
                console.info("[Language Learner][AI][translate][latest-log]\n" + formatAIDebugLog(latestLog));
            }
            return;
        }

        // 3. 更新结果和缓存
        element.trans = result;
        translationCache.value[sentence][newType] = result;
        translationTypes.value[index] = newType;
    } catch (e: any) {
        const latestLog = getLatestAIDebugLog();
        new Notice(`${t("Translation failed")}${e?.message ? `: ${e.message}` : ""}`);
        console.error("[Language Learner][translate] Translation failed", {
            type: newType,
            sentence,
            error: e,
            latestLog,
        });
        if (latestLog && newType === "ai") {
            console.info("[Language Learner][AI][translate][latest-log]\n" + formatAIDebugLog(latestLog));
        }
    }
};

// 监听单词变化，重置状态
watch(() => model.value, () => {
	normalizeCurrentModelSentences();
	model.value.notes = ensureEditableNotes(model.value.notes || []);
	initializeSentenceTranslationModes(model.value.sentences || []);
}, { immediate: true });

</script>

<style lang="scss">
#langr-learn-panel {
	padding-bottom: 18px;

	.n-input {
		margin: 1px 0;
	}

	.learn-primary-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		column-gap: 12px;
		align-items: start;
	}

	.learn-primary-grid__item {
		min-width: 0;
	}

	@media (max-width: 720px) {
		.learn-primary-grid {
			grid-template-columns: minmax(0, 1fr);
			column-gap: 0;
		}
	}

	.footer-actions {
		display: flex;
		gap: 8px;
		margin-top: 10px;
	}

	.footer-action-btn {
		flex: 1;
	}

	.footer-action-btn--primary {
		font-weight: 600;
	}

	.footer-action-btn--secondary {
		border: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		color: var(--text-normal);

		&:hover:not(.n-button--disabled) {
			border-color: var(--interactive-accent);
			color: var(--interactive-accent);
			background: var(--background-modifier-hover);
		}
	}

	.footer-ai-hint {
		margin-top: 6px;
		font-size: 12px;
		line-height: 1.4;
		color: var(--text-muted);
		text-align: right;
	}

	.learn-notes-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 100%;
	}

	.learn-notes-item {
		display: flex;
		gap: 8px;
		align-items: flex-start;
	}

	.learn-notes-actions {
		display: flex;
		flex-direction: column;
		gap: 0;
		align-items: center;
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		overflow: hidden;
		background: var(--background-primary);
	}

    /* 隐藏默认的按钮组（如果还有残留） */
	.n-dynamic-input .n-button-group {
		display: none !important;
	}

    /* 自定义按钮组样式 */
    .custom-btn-group {
        display: flex;
        flex-direction: column;
        gap: 0; /* 按钮紧贴 */
        align-items: center;
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        overflow: hidden;
        background: var(--background-primary);
    }

    .action-btn {
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        transition: all 0.2s ease;
        color: var(--text-muted);
        user-select: none;
        border-bottom: 1px solid var(--background-modifier-border);

        &:last-child {
            border-bottom: none;
        }

        &:hover {
            background: var(--background-modifier-hover);
            color: var(--text-normal);
        }

        /* 翻译按钮特殊样式 */
        &.translate-btn {
            font-size: 12px;
            
            &.ai-mode {
                background: var(--interactive-accent);
                color: var(--text-on-accent);
            }
            
            &:hover:not(.ai-mode) {
                color: var(--interactive-accent);
            }
        }

        /* 删除按钮特殊样式 */
        &.delete-btn {
            &:hover {
                color: var(--text-error);
                background: var(--background-modifier-error-hover);
            }
        }
        
        /* 添加按钮特殊样式 */
        &.add-btn {
            &:hover {
                color: var(--interactive-success);
            }
        }
    }
}
</style>
