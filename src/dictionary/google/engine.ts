import { requestUrl } from "obsidian";
import { DictSearchResult, handleNoResult, handleNetWorkError } from "../helpers";

export type GoogleResult = {
    src: string;
    tgt: string;
    srcLang: string;
    tgtLang: string;
};

export type GoogleSearchResult = DictSearchResult<GoogleResult>;

export const search = async (text: string, settings: any): Promise<GoogleSearchResult> => {
    const targetLang = settings.native || 'zh';
    // Use 'auto' for source language to let Google detect it
    const sourceLang = 'auto'; 
    
    // API URL
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

    try {
        const response = await requestUrl({ url });
        const data = response.json;

        // data format: [[["target", "source", null, null, 1]], null, "srcLang", ...]
        if (data && data[0] && data[0].length > 0) {
            const tgt = data[0].map((item: any) => item[0]).join('');
            const src = data[0].map((item: any) => item[1]).join('');
            const detectedLang = data[2];

            return {
                result: {
                    src: text,
                    tgt: tgt,
                    srcLang: detectedLang,
                    tgtLang: targetLang
                }
            };
        }
        return handleNoResult();
    } catch (e) {
        return handleNetWorkError();
    }
};
