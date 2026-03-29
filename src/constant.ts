import { t } from "./lang/helper";

const dict = {
    NAME: "Language Learner"
};

type Position = {
    x: number;
    y: number;
};

type SearchContext = {
    sentenceText?: string;
    origin?: string;
    sourceFilePath?: string;
};

//继承 GlobalEventHandlersEventMap：EventMap 继承了 GlobalEventHandlersEventMap，
//这意味着 EventMap 将包含 GlobalEventHandlersEventMap 中的所有事件，同时添加自定义事件。
interface EventMap extends GlobalEventHandlersEventMap {
    "obsidian-langr-search": CustomEvent<{
        selection: string,
        target?: HTMLElement,
        evtPosition?: Position,
        sentenceText?: string,
        origin?: string,
        sourceFilePath?: string,
    }>;
    "obsidian-langr-refresh": CustomEvent<{
        expression: string,
        surface?: string,
        type: string,
        status: number,
        meaning: string,
        aliases: string[],
    }>;
    "obsidian-langr-refresh-stat": CustomEvent<{}>;
    "obsidian-langr-language-change": CustomEvent<{
        language: "en" | "zh" | "zh-TW",
    }>;
    "obsidian-langr-toast": CustomEvent<{
        message: string,
        type?: "info" | "success" | "error",
        duration?: number,
    }>;
}



export { dict };
export type { EventMap, Position, SearchContext }


