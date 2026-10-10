import { text } from "node:stream/consumers";
import { App, Modal, Notice, Setting } from "obsidian";
import { t, getLanguage } from "./lang/helper";

// 输入文字
class InputModal extends Modal {
    text: string = "";
    onSubmit: (text: string) => void;
    constructor(app: App, onSubmit: (text: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h3", {
            text: t("Input Text"),
            attr: {
                style: "margin: 10px 0;",
            }
        });

        let inputEl = contentEl.createEl("input", {
            attr: {
                type: "text",
                style: "width: 100%;"
            }
        });

        inputEl.addEventListener("input", (evt) => {
            this.text = inputEl.value;
        });

        inputEl.addEventListener("keydown", (evt) => {
            if (evt.key === "Enter") {
                evt.preventDefault();
                evt.stopPropagation();
                this.onSubmit(this.text);
                this.close();
            }
        });
    }
}

// 打开某个文件
class OpenFileModal extends Modal {
    input: HTMLInputElement;
    file: File;
    onSubmit: (file: File) => Promise<void>;
    constructor(app: App, onSubmit: (file: File) => Promise<void>) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;

        this.input = contentEl.createEl("input", {
            attr: {
                type: "file"
            }
        });

        this.input.addEventListener("change", () => {
            this.file = this.input.files[0];
        });

        new Setting(contentEl)
            .addButton(button => button
                .setButtonText(t("Yes"))
                .onClick((evt) => {
                    // 未选择文件时禁止提交：importDB 是先删库再导入，undefined 会导致词库被清空
                    if (!this.file) {
                        new Notice(getLanguage().startsWith("zh")
                            ? "请先选择一个文件"
                            : "Please select a file first");
                        return;
                    }
                    this.onSubmit(this.file);
                    this.close();
                })
            );
    }

    onClose(): void {

    }
}

// 做某些危险操作前问一句
class WarningModal extends Modal {
    onSubmit: () => Promise<void>;
    message: string;

    constructor(app: App, message: string, onSubmit: () => Promise<void>) {
        super(app);
        this.message = message;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl("h2", { text: this.message });

        new Setting(contentEl)
            .addButton((btn) => btn
                .setButtonText(t("Yes"))
                .setWarning()
                .setCta()
                .onClick(() => {
                    this.close();
                    this.onSubmit();
                })
            )
            .addButton((btn) => btn
                .setButtonText(t("No!!!"))
                .setCta() // what is this?
                .onClick(() => {
                    this.close();
                }));
    }

    onClose() {
        let { contentEl } = this;
        contentEl.empty();
    }
}

export { OpenFileModal, WarningModal, InputModal };
