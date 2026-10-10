import { watch } from "vue";

type Emit = (event: "loading", status: { id: string, loading: boolean, result: boolean }) => void;

/** 单次查询会话：isStale() 为 true 表示期间已发起更新的查询，本次结果已过期 */
type SearchSession = {
    isStale: () => boolean;
};

function useLoading(
    watchee: () => any,
    id: string,
    search: (session: SearchSession) => Promise<boolean>,
    emit: Emit
) {
    // 查询代际号：每次发起查询自增，慢的旧请求完成后据此判定过期，不再回写状态
    let generation = 0;

    async function run() {
        const current = ++generation;
        const session: SearchSession = { isStale: () => current !== generation };
        emit("loading", { id, loading: true, result: false });
        try {
            const result = await search(session);
            if (!session.isStale()) {
                emit("loading", { id, loading: false, result });
            }
        } catch (e) {
            console.warn(`[Language Learner] dictionary "${id}" search failed:`, e);
            if (!session.isStale()) {
                emit("loading", { id, loading: false, result: false });
            }
        }
    }

    // immediate：组件以非空 word 全新挂载时（如设置中新启用词典）立即查询一次
    watch(watchee, run, { immediate: true });
}

export { useLoading };
export type { SearchSession };
