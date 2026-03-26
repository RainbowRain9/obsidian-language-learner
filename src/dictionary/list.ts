import { t } from "@/lang/helper";
import Youdao from "./youdao/View.vue";
import Cambridge from "./cambridge/View.vue";
import AI from "./ai/View.vue";
import Google from "./google/View.vue";

type DictMeta = {
    nameKey: Parameters<typeof t>[0];
    descriptionKey: Parameters<typeof t>[0];
    Cp: typeof Youdao;
};

const dicts = {
    "youdao": {
        nameKey: "Youdao",
        descriptionKey: "English <=> Chinese",
        Cp: Youdao,
    },
    "cambridge": {
        nameKey: "Cambridge",
        descriptionKey: "English => Chinese",
        Cp: Cambridge,
    },
    "ai": {
        nameKey: "AI Search",
        descriptionKey: "AI Explanation",
        Cp: AI,
    },
    "google": {
        nameKey: "Google",
        descriptionKey: "Multi-language Translate",
        Cp: Google,
    },
} satisfies Record<string, DictMeta>;

export { dicts };
