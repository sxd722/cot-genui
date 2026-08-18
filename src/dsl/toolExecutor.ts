/**
 * 工具执行器：tool action 的真实 web 实现
 *
 * DslCardHost 在用户触发 tool action 时调用此模块。
 * 每个工具执行后返回 { outcome, stateUpdates }——outcome 决定 flow 跳转，
 * stateUpdates 写入 runtime state。
 */

"use client";

import type { Action, RuntimeState } from "./types";

export interface ToolResult {
  outcome: string;
  /** 要写入 state 的键值对（key 带命名空间，如 "strings.selectedFileName"） */
  stateUpdates: Record<string, unknown>;
  /** 给 UI 的临时提示 */
  message?: string;
}

/** 工具执行上下文 */
export interface ToolContext {
  action: Action;
  state: RuntimeState;
  /** 当前卡的所有 block（用于读取 block 内容，如要复制的文字） */
  cardId: string;
}

/**
 * 执行一个 tool action。
 * 返回 Promise 因为文件选择/LLM 调用是异步的。
 */
export async function executeTool(ctx: ToolContext): Promise<ToolResult> {
  const { action } = ctx;
  const adapter = action.toolCall?.adapterId ?? "";
  const op = action.toolCall?.operation ?? "";

  if (adapter === "system.browser.open" && op === "open") {
    return openExternalUrl(ctx);
  }

  // 文件选择
  if (adapter === "system.file.pick" && op === "document") {
    return pickFile();
  }
  // 文件保存
  if (adapter === "system.file.save" && op === "save") {
    return saveFile(ctx);
  }
  // 剪贴板写入
  if (adapter === "system.clipboard.write" && op === "write") {
    return clipboardWrite(ctx);
  }
  // 文字识别（mock）
  if (
    (adapter === "document.text.extract" && op === "extract") ||
    (adapter === "vision.ocr" && op === "recognize")
  ) {
    return mockOcr(ctx);
  }
  // LLM 调用
  if (adapter === "ai.llm" && op === "chat") {
    return llmChat(ctx);
  }

  // 未实现的工具：自动成功
  return { outcome: "success", stateUpdates: {}, message: "工具执行完成（mock）" };
}

/* ------------------------------------------------------------------ */
/*  具体实现                                                           */
/* ------------------------------------------------------------------ */

function openExternalUrl(ctx: ToolContext): ToolResult {
  try {
    const url = new URL(String(ctx.action.externalUrl ?? ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("不支持的 URL scheme");
    window.open(url.toString(), "_blank", "noopener,noreferrer");
    return {
      outcome: "success",
      stateUpdates: { "strings.statusMessage": `已打开 ${url.hostname}` },
      message: `已打开 ${url.hostname}`,
    };
  } catch {
    return {
      outcome: "error",
      stateUpdates: { "strings.errorMessage": "外部链接无效" },
      message: "外部链接无效",
    };
  }
}

/** 文件选择：打开文件选择器，返回文件名 */
async function pickFile(): Promise<ToolResult> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.png,.jpg,.jpeg,.txt,.md";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve({ outcome: "cancelled", stateUpdates: {} });
        return;
      }
      resolve({
        outcome: "success",
        stateUpdates: {
          "strings.selectedFileName": file.name,
          "strings.selectedFileMeta": `${(file.size / 1024).toFixed(0)} KB · ${file.type || "未知类型"}`,
          "strings.statusMessage": `已选择 ${file.name}`,
        },
        message: `选择了 ${file.name}`,
      });
    };
    // 用户取消（焦点返回但没选文件）
    input.onclick = null;
    input.click();
  });
}

/** 文件保存：用 Blob + <a download> 下载 */
async function saveFile(ctx: ToolContext): Promise<ToolResult> {
  try {
    const content = String(ctx.state.strings.previewText ?? ctx.state.strings.selectedFileName ?? "导出内容");
    const format = String(ctx.state.strings.outputFormat ?? "TXT");
    const ext = format.toLowerCase().includes("md") ? "md" : "txt";
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ctx.state.strings.selectedFileName?.replace(/\.[^.]+$/, "") ?? "export"}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    return {
      outcome: "success",
      stateUpdates: { "strings.statusMessage": "文件已保存" },
      message: "文件已下载",
    };
  } catch {
    return { outcome: "error", stateUpdates: { "strings.errorMessage": "保存失败" } };
  }
}

/** 剪贴板写入 */
async function clipboardWrite(ctx: ToolContext): Promise<ToolResult> {
  try {
    const text =
      ctx.action.id === "copy-note"
        ? String(ctx.state.strings.previewText ?? "")
        : ctx.state.strings.selectedFileName ?? "已复制";
    // 优先取 action 的 copyText 配置（IR 里可指定）
    const copyText = (ctx.action as unknown as Record<string, unknown>).copyText;
    const finalText = copyText ? String(copyText) : text;
    await navigator.clipboard.writeText(finalText);
    return {
      outcome: "success",
      stateUpdates: { "strings.statusMessage": "已复制到剪贴板" },
      message: "已复制",
    };
  } catch {
    return { outcome: "error", stateUpdates: { "strings.errorMessage": "复制失败" } };
  }
}

/** OCR mock：生成模拟识别结果 */
async function mockOcr(ctx: ToolContext): Promise<ToolResult> {
  // 模拟处理延迟
  await new Promise((r) => setTimeout(r, 1200));
  const fileName = ctx.state.strings.selectedFileName ?? "文档";
  const mockText = [
    `《${fileName.replace(/\.[^.]+$/, "")}》识别结果`,
    "",
    "第一章 概述",
    "本文档由 PDF 文字识别服务处理。以上内容为模拟识别结果，",
    "用于验证工具调用链路。实际部署时将接入真实 OCR 或视觉 LLM。",
    "",
    "识别统计：8 页 · 约 12,450 字符 · 置信度 96.2%",
  ].join("\n");
  return {
    outcome: "success",
    stateUpdates: {
      "strings.previewText": mockText,
      "strings.statusMessage": "识别完成",
      "numbers.progress": 100,
      "numbers.currentPage": 8,
      "numbers.totalPages": 8,
      "numbers.characterCount": 12450,
      "stringLists.resultPages": mockText.split("\n\n"),
    },
    message: "识别完成（mock）",
  };
}

/** LLM 调用：调真实 LLM API */
async function llmChat(ctx: ToolContext): Promise<ToolResult> {
  try {
    // 构造上下文：当前卡片的关键信息
    const stockName = ctx.state.strings.selectedStock ?? "该股票";
    const prompt = `作为投资顾问，针对"${stockName}"今日暴涨 7.2%的情况，给出简短的行动建议（2-3句话，包括是否止盈/加仓/观望的判断依据）。直接给建议，不要开场白。`;

    const res = await fetch("/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) throw new Error(`LLM 调用失败: ${res.status}`);
    const data = await res.json();
    const advice = data.text || "暂无建议";

    return {
      outcome: "success",
      stateUpdates: {
        "strings.aiResponse": advice,
        "strings.statusMessage": "AI 建议已生成",
      },
      message: "AI 建议已生成",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "LLM 调用失败";
    return {
      outcome: "error",
      stateUpdates: { "strings.errorMessage": msg },
    };
  }
}
