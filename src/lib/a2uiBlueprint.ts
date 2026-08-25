import type { CardPlan } from "@/dsl/modules";

const COMPONENT_ALIASES: Record<string, string> = {
  card: "Card",
  column: "Column",
  row: "Row",
  list: "List",
  text: "Text",
  button: "Button",
  image: "Image",
  divider: "Divider",
  icon: "Icon",
  checkbox: "CheckBox",
  check_box: "CheckBox",
  slider: "Slider",
  choicepicker: "ChoicePicker",
  choice_picker: "ChoicePicker",
  hero: "Hero",
  highlight: "Hero",
  metric: "Metric",
  kpi: "Metric",
  chart: "Metric",
  table: "List",
  tabs: "Column",
  switch: "CheckBox",
  progress: "Progress",
  badge: "Badge",
  chip: "Badge",
  timeline: "Timeline",
};

const CONTAINERS = new Set(["Column", "Row", "List"]);
const SINGLE_CHILD = new Set(["Card", "Button"]);

interface BlueprintNode {
  component?: unknown;
  type?: unknown;
  id?: unknown;
  props?: unknown;
  children?: unknown;
  child?: unknown;
  [key: string]: unknown;
}

interface BlueprintSurface {
  id?: unknown;
  surfaceId?: unknown;
  root?: unknown;
  component?: unknown;
  sourceCardId?: unknown;
  visualDirection?: unknown;
  coveredBlockIndexes?: unknown;
  coveredActionIds?: unknown;
  [key: string]: unknown;
}

export interface A2UICompileResult {
  messages: unknown[];
  warnings: string[];
  coverage?: {
    cards: number;
    blocks: number;
    actions: number;
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeId(value: unknown, fallback: string): string {
  const id = String(value ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return id || fallback;
}

function componentName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return COMPONENT_ALIASES[value.replace(/[-\s]/g, "_").toLowerCase()] ?? null;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text) return value;
  try {
    return JSON.parse(text);
  } catch {
    const rows = text.split(/\r?\n/).filter(Boolean);
    if (rows.length > 1) {
      try {
        return rows.map((row) => JSON.parse(row));
      } catch {
        return value;
      }
    }
    return value;
  }
}

function isDirectMessages(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  return value.some((item) => !!record(item)?.createSurface) &&
    value.some((item) => !!record(item)?.updateComponents);
}

function directMessagesFrom(value: unknown): unknown[] | null {
  const parsed = parseMaybeJson(value);
  if (isDirectMessages(parsed)) return parsed;
  const obj = record(parsed);
  if (!obj) return null;
  for (const key of ["a2uiJsonl", "a2ui", "messages", "jsonl"]) {
    const candidate = parseMaybeJson(obj[key]);
    if (isDirectMessages(candidate)) return candidate;
  }
  return null;
}

function blueprintSurfaces(value: unknown): BlueprintSurface[] | null {
  const parsed = parseMaybeJson(value);
  const obj = record(parsed);
  if (!obj) return null;
  const nested = record(obj.a2uiBlueprint) ?? record(obj.blueprint) ?? obj;
  const surfaces = nested.surfaces;
  if (Array.isArray(surfaces)) return surfaces.filter((item): item is BlueprintSurface => !!record(item));
  if (nested.root || nested.component || nested.type) return [{ id: nested.id ?? "card", root: nested.root ?? nested }];
  return null;
}

function collectOpenUrls(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectOpenUrls(item, found));
    return found;
  }
  const obj = record(value);
  if (!obj) return found;
  const functionCall = record(obj.functionCall);
  if (functionCall?.call === "openUrl") {
    const args = record(functionCall.args);
    if (typeof args?.url === "string") found.add(args.url);
  }
  Object.values(obj).forEach((item) => collectOpenUrls(item, found));
  return found;
}

const CONTENT_FIELDS = new Set(["text", "title", "label", "value", "detail"]);

function normalizeContent(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function collectVisibleText(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => collectVisibleText(item, found));
    return found;
  }
  const obj = record(value);
  if (!obj) return found;
  for (const [key, item] of Object.entries(obj)) {
    if (CONTENT_FIELDS.has(key) && (typeof item === "string" || typeof item === "number")) {
      found.push(String(item));
    }
    if (item && typeof item === "object") collectVisibleText(item, found);
  }
  return found;
}

/**
 * 接受模型较容易稳定生成的嵌套 Blueprint，确定性编译为 A2UI v0.9 扁平邻接表。
 * 同时兼容旧版模型直接返回的 A2UI 消息数组。
 */
export function compileA2UIResponse(value: unknown, cardPlan?: CardPlan): A2UICompileResult {
  const direct = directMessagesFrom(value);
  if (direct) {
    if (cardPlan) throw new Error("返回了旧式 A2UI 消息，无法验证 CardPlan block/action 覆盖率");
    return { messages: direct, warnings: [] };
  }

  const surfaces = blueprintSurfaces(value);
  if (!surfaces?.length) throw new Error("找不到 a2uiBlueprint.surfaces 或有效 A2UI 消息数组");

  const messages: unknown[] = [];
  const warnings: string[] = [];
  let coveredBlocks = 0;
  let coveredActions = 0;

  if (cardPlan) {
    const coverageErrors: string[] = [];
    for (const card of cardPlan.cards) {
      const surface = surfaces.find((candidate) =>
        candidate.sourceCardId === card.id || candidate.id === card.id || candidate.surfaceId === card.id,
      );
      if (!surface) {
        coverageErrors.push(`${card.id}: 缺少对应 surface`);
        continue;
      }
      const blockIndexes = new Set(
        Array.isArray(surface.coveredBlockIndexes)
          ? surface.coveredBlockIndexes.filter((index): index is number => Number.isInteger(index))
          : [],
      );
      const actionIds = new Set(
        Array.isArray(surface.coveredActionIds)
          ? surface.coveredActionIds.filter((id): id is string => typeof id === "string")
          : [],
      );
      const missingBlocks = card.blocks.map((_, index) => index).filter((index) => !blockIndexes.has(index));
      const expectedActions = (card.actions ?? []).map((action) => action.id).filter((id): id is string => typeof id === "string" && !!id);
      const missingActions = expectedActions.filter((id) => !actionIds.has(id));
      const openUrls = collectOpenUrls(surface.root ?? surface);
      const missingExternalLinks = (card.actions ?? [])
        .filter((action) => action.type === "external-link")
        .filter((action) => typeof action.link !== "string" || !openUrls.has(action.link))
        .map((action) => `${action.id}=${String(action.link ?? "<missing URL>")}`);
      const surfaceText = JSON.stringify(surface.root ?? surface);
      const normalizedSurfaceText = normalizeContent(collectVisibleText(surface.root ?? surface).join(" "));
      const missingListItems = card.blocks.flatMap((block, blockIndex) => block.kind === "list"
        ? (block.items ?? []).filter((item) => item.label && !surfaceText.includes(item.label)).map((item) => `${blockIndex}:${item.label}`)
        : []);
      const missingContentBlocks = card.blocks.flatMap((block, blockIndex) => {
        if (!["hero", "summary", "status", "metric"].includes(block.kind)) return [];
        const title = String(block.title ?? "").trim();
        if (title.length < 4) return [];
        return normalizedSurfaceText.includes(normalizeContent(title)) ? [] : [blockIndex];
      });
      if (missingBlocks.length) coverageErrors.push(`${card.id}: 缺少 block[${missingBlocks.join(",")}]`);
      if (missingActions.length) coverageErrors.push(`${card.id}: 缺少 action[${missingActions.join(",")}]`);
      if (missingExternalLinks.length) coverageErrors.push(`${card.id}: 外链未映射为精确 openUrl[${missingExternalLinks.join(",")}]`);
      if (missingListItems.length) coverageErrors.push(`${card.id}: 列表内容未进入组件树[${missingListItems.join(",")}]`);
      if (missingContentBlocks.length) coverageErrors.push(`${card.id}: block[${missingContentBlocks.join(",")}] 内容未出现在组件树`);
      coveredBlocks += card.blocks.length;
      coveredActions += expectedActions.length;
    }
    if (coverageErrors.length) throw new Error(`CardPlan 覆盖不完整：${coverageErrors.join("；")}`);
  }

  surfaces.forEach((surface, surfaceIndex) => {
    const surfaceId = safeId(surface.sourceCardId ?? surface.id ?? surface.surfaceId, `card_${surfaceIndex + 1}`);
    const components: Record<string, unknown>[] = [];
    const usedIds = new Set<string>();
    let sequence = 0;

    const nextId = (requested?: unknown, hint = "node") => {
      const base = `${surfaceId}_${safeId(requested, `${hint}_${++sequence}`)}`;
      let id = base;
      let suffix = 2;
      while (usedIds.has(id)) id = `${base}_${suffix++}`;
      usedIds.add(id);
      return id;
    };

    const flatten = (rawNode: unknown, hint = "node"): string | null => {
      if (typeof rawNode === "string") {
        const id = nextId(undefined, "text");
        components.push({ id, component: "Text", text: rawNode, variant: "body" });
        return id;
      }
      const node = record(rawNode) as BlueprintNode | null;
      if (!node) return null;
      const component = componentName(node.component ?? node.type);
      if (!component) {
        warnings.push(`${surfaceId}: 忽略未知组件 ${String(node.component ?? node.type ?? "undefined")}`);
        return null;
      }

      const id = nextId(node.id, `${hint}_${component.toLowerCase()}`);
      const props = record(node.props) ?? {};
      const output: Record<string, unknown> = { id, component };
      const reserved = new Set(["id", "component", "type", "props", "children", "child"]);
      for (const [key, propValue] of Object.entries({ ...node, ...props })) {
        if (!reserved.has(key) && propValue !== undefined) output[key] = propValue;
      }

      let rawChildren = Array.isArray(node.children)
        ? node.children
        : node.child !== undefined
          ? [node.child]
          : [];
      if (component === "List" && rawChildren.length === 0 && Array.isArray(output.items)) {
        rawChildren = output.items.map((item) => {
          const value = record(item);
          if (!value) return { component: "Text", text: String(item), variant: "body" };
          return {
            component: "Column",
            children: [
              { component: "Text", text: String(value.label ?? value.title ?? ""), variant: "body" },
              ...(value.detail ? [{ component: "Text", text: String(value.detail), variant: "caption" }] : []),
            ],
          };
        });
        delete output.items;
      }
      const childIds = rawChildren
        .map((child, index) => flatten(child, `${component.toLowerCase()}_child_${index + 1}`))
        .filter((child): child is string => !!child);

      if (component === "Button" && childIds.length === 0) {
        const textId = nextId(undefined, "button_text");
        components.push({ id: textId, component: "Text", text: String(output.label ?? output.text ?? "查看详情"), variant: "body" });
        childIds.push(textId);
        delete output.label;
        delete output.text;
      }

      if (CONTAINERS.has(component)) output.children = childIds;
      if (SINGLE_CHILD.has(component)) {
        if (childIds.length > 1) {
          const wrapperId = nextId(undefined, "column");
          components.push({ id: wrapperId, component: "Column", children: childIds });
          output.child = wrapperId;
        } else if (childIds[0]) {
          output.child = childIds[0];
        }
      }
      components.push(output);
      return id;
    };

    const rootNode = surface.root ?? (surface.component ? surface : null);
    let rootId = flatten(rootNode, "root");
    if (!rootId) throw new Error(`surface ${surfaceId} 没有可编译的根组件`);
    const root = components.find((component) => component.id === rootId);
    if (root?.component !== "Card") {
      const wrapperId = nextId("root_card", "card");
      components.push({ id: wrapperId, component: "Card", child: rootId });
      rootId = wrapperId;
    }

    // 根节点必须最后仍能被渲染器识别；rootId 的存在本身也完成了引用校验。
    if (!components.some((component) => component.id === rootId)) throw new Error(`surface ${surfaceId} 根组件丢失`);
    messages.push(
      { version: "v0.9", createSurface: { surfaceId, catalogId: "https://a2ui.org/specification/v0_9/standard_catalog.json" } },
      { version: "v0.9", updateComponents: { surfaceId, components } },
    );
  });

  if (!messages.length) throw new Error("A2UI Blueprint 未生成任何 surface");
  return {
    messages,
    warnings,
    coverage: cardPlan
      ? { cards: cardPlan.cards.length, blocks: coveredBlocks, actions: coveredActions }
      : undefined,
  };
}

export function describeA2UIShape(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})`;
  const obj = record(value);
  if (!obj) return typeof value;
  return `object keys=[${Object.keys(obj).slice(0, 12).join(",")}]`;
}
