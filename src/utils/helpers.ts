export function playAudio(src: string) {
    // 音频源失败（断网、链接失效等）时 play() 返回的 Promise 会 reject，
    // 捕获避免未处理的 Promise rejection（自动发音场景频繁触发，不打断用户，仅告警）
    new Audio(src).play().catch((e) => console.warn("playAudio failed:", e));
}

// HTML 转义：& 必须最先替换，避免二次转义
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
