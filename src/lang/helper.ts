import { shallowRef } from "vue";
import zh from "./locale/zh";
import en from "./locale/en";
import zh_TW from "./locale/zh-TW";

export type UiLanguage = "en" | "zh" | "zh-TW";
export type LocaleKey = keyof typeof en;

const localeMap: Record<UiLanguage, Partial<typeof en>> = {
    en,
    zh,
    "zh-TW": zh_TW,
};

export const currentLanguageRef = shallowRef<UiLanguage>("en");

function normalizeLanguage(lang?: string | null): UiLanguage {
    if (lang === "en" || lang === "zh" || lang === "zh-TW") {
        return lang;
    }

    const normalized = lang?.toLowerCase();
    if (normalized?.startsWith("zh")) {
        return normalized.includes("tw") || normalized.includes("hk")
            ? "zh-TW"
            : "zh";
    }

    return "en";
}

export function getLanguage(): UiLanguage {
    return currentLanguageRef.value;
}

export function setLanguage(lang?: string | null, persist = true): UiLanguage {
    const nextLanguage = normalizeLanguage(lang);
    currentLanguageRef.value = nextLanguage;

    if (persist && typeof window !== "undefined") {
        window.localStorage.setItem("language", nextLanguage);
    }

    return nextLanguage;
}

export function t(text: LocaleKey): string {
    const locale = localeMap[currentLanguageRef.value] || en;
    return locale[text] || en[text] || text;
}

if (typeof window !== "undefined") {
    setLanguage(window.localStorage.getItem("language"), false);
}
