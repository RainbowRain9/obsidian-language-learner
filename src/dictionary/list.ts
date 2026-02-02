import { t } from "@/lang/helper";
import Youdao from "./youdao/View.vue";
import Cambridge from "./cambridge/View.vue";
import AI from "./ai/View.vue";
import Google from "./google/View.vue";


const dicts = {
    "youdao": {
        name: t("Youdao"),
        description: `${t("English")} <=> ${t("Chinese")}`,
        Cp: Youdao
    },
    "cambridge": {
        name: t("Cambridge"),
        description: `${t("English")} => ${t("Chinese")}`,
        Cp: Cambridge
    },
    "ai": {
        name: "AI Search",
        description: "AI Explanation",
        Cp: AI
    },
    "google": {
        name: "Google",
        description: "Multi-language Translate",
        Cp: Google
    },

};

export { dicts };
