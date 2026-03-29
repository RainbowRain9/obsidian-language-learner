<template>
    <div class="word-more">
        <div class="word-notes" v-if="(notes.length > 0)">
            <h2>{{ t("Notes") }}:</h2>
            <ul class="word-notes-list">
                <li
                    class="word-note-card"
                    v-for="(note, index) in notes"
                    :key="`${props.word}-note-${index}`"
                >
                    <span class="word-note-index">{{ index + 1 }}</span>
                    <p>{{ note }}</p>
                </li>
            </ul>
        </div>
        <div class="word-sens" v-if="(sentences.length > 0)">
            <h2>{{ t("Sentences") }}:</h2>
            <div class="word-sen" v-for="sen in sentences">
                <p v-html="sen.text"></p>
                <p v-html="sen.trans"></p>
                <p v-html="sen.origin"></p>
            </div>
        </div>
    </div>
</template>

<script setup lang='ts'>
import { ref, getCurrentInstance } from 'vue';
import PluginType from "@/plugin";
import { t } from "@/lang/helper";

const plugin = getCurrentInstance().appContext.config.globalProperties.plugin as PluginType;

const props = defineProps<{
    word: string;
}>();

let { sentences, notes } = await plugin.db.getExpression(props.word);

sentences.forEach((_, i) => {
    sentences[i].text = highlight(sentences[i].text, props.word);
});

function highlight(text: string, word: string) {
    const expr = word.toLowerCase();
    const Expr = word[0].toUpperCase() + word.slice(1);
    text = text.replace(expr, `<em>${expr}</em>`);
    text = text.replace(Expr, `<em>${Expr}</em>`);
    return text;
}

</script>

<style lang="scss">
.word-more {
    h2 {
        margin: 0.5em 0;
    }

    .word-notes {
        user-select: text;

        .word-notes-list {
            list-style: none;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .word-note-card {
            display: flex;
            gap: 10px;
            align-items: flex-start;
            padding: 10px 12px;
            border: 1px solid var(--background-modifier-border);
            border-radius: 10px;
            background: var(--background-secondary);
            box-shadow: var(--shadow-s);
        }

        .word-note-index {
            flex: 0 0 auto;
            min-width: 22px;
            height: 22px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 700;
            color: var(--text-on-accent);
            background: var(--interactive-accent);
        }

        p {
            white-space: pre-line;
            margin: 0;
            line-height: 1.6;
            flex: 1;
        }
    }

    .word-sens {
        user-select: text;

        .word-sen {
            margin-bottom: 5px;
            border: 1px solid gray;
            border-radius: 5px;

            p {
                &:first-child {
                    font-style: italic;

                    em {
                        font-weight: bold;
                        color: var(--interactive-accent)
                    }
                }

                margin: 0.5em 5px;
            }
        }
    }
}
</style>
