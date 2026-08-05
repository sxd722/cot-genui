/**
 * Card Plan IR → CardArtifact 编译器
 *
 * 确定性转换：模型输出 CardPlan（语义化 IR），编译器机械地落成合法 CardArtifact。
 * 所有 DSL 语法正确性（双侧 ID 一致、transition/event 格式、binding 命名空间）由此保证。
 *
 * 处理：
 * - block 映射：IR kind → DSL block（能映射的映射，不能的降级）
 * - 数据流：IRListItem.onSelect → state.set action + transition + binding
 * - 操作：IRAction → local/tool action
 * - 双侧同步：同一组 card ID 生成 flow + dsl
 */

import type {
  CardArtifact,
  Card,
  CardTemplate,
  Block,
  Action,
  FlowCard,
  FlowTransition,
  Header,
  InitialState,
  Binding,
} from "./types";
import { FLOW_VERSION, DSL_VERSION } from "./types";
import type {
  CardPlan,
  CardNode,
  IRBlock,
  IRAction,
  IRListItem,
  CompileResult,
  CompileNotice,
} from "./modules";

/* ------------------------------------------------------------------ */
/*  主入口                                                             */
/* ------------------------------------------------------------------ */

export function compileCardPlan(plan: CardPlan): CompileResult {
  const notices: CompileNotice[] = [];

  // 收集所有卡 ID（去重校验）
  const cardIds = plan.cards.map((c) => c.id);
  const idSet = new Set(cardIds);
  if (idSet.size !== cardIds.length) {
    notices.push({ level: "info", message: "检测到重复 card ID，可能影响 transition" });
  }

  // 收集 initialState（从 IR 的 slot 引用 + 直接值）
  const initialState = collectInitialState(plan, notices);

  // 编译每张卡
  const dslCards: Card[] = [];
  const flowCards: FlowCard[] = [];

  for (let i = 0; i < plan.cards.length; i++) {
    const node = plan.cards[i];
    const { card, extraTransitions, extraActions } = compileCard(
      node,
      i,
      plan.cards.length,
      plan,
      notices,
    );
    dslCards.push(card);

    // flow card：收集 transitions（来自 IRAction + onSelect + tool outcomes）
    const transitions = collectTransitions(node, card, extraTransitions);
    flowCards.push({
      id: node.id,
      purpose: node.purpose,
      template: card.template,
      transitions,
    });
  }

  const startCardId = cardIds[0] ?? "start";

  const artifact: CardArtifact = {
    artifactId: `${plan.skillName}-generated`.replace(/\s+/g, "-").toLowerCase(),
    flow: {
      flowVersion: FLOW_VERSION,
      skillId: plan.skillName.replace(/\s+/g, "-").toLowerCase(),
      singleForm: true,
      startCardId,
      cards: flowCards,
    },
    dsl: {
      dslVersion: DSL_VERSION,
      theme: {
        preset: "black-gold",
        accentToken: "#D7AE59",
        surfaceToken: "#0B0D10",
        dangerToken: "#E88A73",
      },
      startCardId,
      initialState,
      cards: dslCards,
    },
  };

  return { artifact, notices };
}

/* ------------------------------------------------------------------ */
/*  编译单张卡                                                         */
/* ------------------------------------------------------------------ */

function compileCard(
  node: CardNode,
  index: number,
  total: number,
  plan: CardPlan,
  notices: CompileNotice[],
): { card: Card; extraTransitions: FlowTransition[]; extraActions: Action[] } {
  const header: Header = {
    skillName: plan.skillName,
    stepLabel: `${index + 1} / ${total} · ${node.purpose}`,
    iconText: plan.iconText ?? "S",
  };

  // 编译 blocks
  const blocks: Block[] = [];
  const extraActions: Action[] = [];
  const extraTransitions: FlowTransition[] = [];
  let blockSeq = 0;

  for (const irBlock of node.blocks ?? []) {
    const compiled = compileBlock(irBlock, node.id, blockSeq++, notices);
    blocks.push(compiled.block);
    // 可点击列表项产生的 action/transition 收集起来
    extraActions.push(...(compiled.extraActions ?? []));
    extraTransitions.push(...(compiled.extraTransitions ?? []));
    // spec §4.10 最多 5 block
    if (blocks.length >= 5) break;
  }

  // 编译 IRAction → DSL action（可见 action，限 3 个）
  const visibleActions: Action[] = [];
  for (const irAction of node.actions ?? []) {
    const compiled = compileAction(irAction, node.id, notices);
    if (compiled) visibleActions.push(compiled);
    if (visibleActions.length >= 3) break; // spec §4.10 最多 3 个可见 action
  }
  // block 内部 action（choice/toggle 等）不计入可见 action 上限
  const uniqueActions = dedupActions([...visibleActions, ...extraActions]);

  // template：从 IR 推断
  const template = inferTemplate(node, blocks);

  return {
    card: { id: node.id, template, header, blocks, actions: uniqueActions },
    extraTransitions,
    extraActions: extraActions,
  };
}

/* ------------------------------------------------------------------ */
/*  block 编译（IR kind → DSL block）                                   */
/* ------------------------------------------------------------------ */

function compileBlock(
  ir: IRBlock,
  cardId: string,
  seq: number,
  notices: CompileNotice[],
): { block: Block; extraActions?: Action[]; extraTransitions?: FlowTransition[] } {
  const id = `${cardId}-b${seq}`;
  const extraActions: Action[] = [];
  const extraTransitions: FlowTransition[] = [];

  switch (ir.kind) {
    /* —— 直接映射的 block —— */
    case "hero":
      return { block: { id, kind: "hero", title: ir.title, text: ir.text } };

    case "summary":
      return {
        block: {
          id,
          kind: "entity-summary",
          title: ir.title,
          valueBinding: makeBinding(ir),
          secondaryBinding: ir.detail ? { path: "", fallback: ir.detail, formatter: "plain" } : undefined,
        },
      };

    case "status":
      return {
        block: {
          id,
          kind: "status",
          title: ir.title,
          text: ir.text,
          tone: ir.tone === "danger" ? "danger" : undefined,
          valueBinding: makeBinding(ir),
        },
      };

    case "progress": {
      const numPath = ir.valueFromSlot ? `numbers.${ir.valueFromSlot}` : "numbers.progress";
      return {
        block: {
          id,
          kind: "progress",
          title: ir.title,
          valueBinding: { path: numPath, fallback: ir.value ?? "0", formatter: "percent" },
          secondaryBinding: ir.text ? { path: "strings.statusMessage", fallback: ir.text, formatter: "plain" } : undefined,
        },
      };
    }

    case "toggle":
    case "toggle": {
      const actionId = `${id}-toggle`;
      // 为 toggle block 生成对应的 toggle action（切换 booleans.{currentFromSlot}）
      if (ir.currentFromSlot) {
        extraActions.push({
          id: actionId,
          label: "切换",
          role: "secondary",
          kind: "local",
          dispatch: "form",
          operation: "state.toggle",
          statePath: `booleans.${ir.currentFromSlot}`,
          event: actionId,
        });
      }
      return {
        block: {
          id,
          kind: "toggle",
          title: ir.title,
          text: ir.text,
          valueBinding: ir.currentFromSlot
            ? { path: `booleans.${ir.currentFromSlot}`, fallback: "false", formatter: "plain" }
            : undefined,
          actionId,
        },
        extraActions,
      };
    }

    case "choice": {
      const actionId = `${id}-select`;
      // 为 choice block 生成对应的 select action（写入 strings.{currentFromSlot}）
      if (ir.currentFromSlot) {
        extraActions.push({
          id: actionId,
          label: "选择",
          role: "secondary",
          kind: "local",
          dispatch: "form",
          operation: "state.select",
          statePath: `strings.${ir.currentFromSlot}`,
          stateValue: "", // 运行时由 ChoiceBlock 传入动态值
          event: actionId,
        });
      }
      return {
        block: {
          id,
          kind: "choice",
          title: ir.title,
          text: ir.text,
          options: (ir.options ?? []).map((o) => ({ label: o, value: o })),
          valueBinding: ir.currentFromSlot
            ? { path: `strings.${ir.currentFromSlot}`, fallback: "", formatter: "plain" }
            : undefined,
          actionId,
        },
        extraActions,
      };
    }

    /* —— list（核心：处理可点击项的数据流）—— */
    case "list": {
      const items = ir.items ?? [];
      const hasClickable = items.some((it) => it.onSelect);

      if (hasClickable) {
        // 可点击列表 → 编译成 choice block（纵向变体，前端 ChoiceBlock 渲染）
        // 每个 item 一个 select action（用索引保证 ID 唯一）
        items.forEach((item, idx) => {
          if (!item.onSelect) return;
          const actionId = `${id}-pick-${idx}`;
          extraActions.push({
            id: actionId,
            label: item.label,
            role: "secondary",
            kind: "local",
            dispatch: "form",
            operation: "state.set",
            statePath: `strings.${item.onSelect.writeTo}`,
            stateValue: item.onSelect.value,
            event: actionId,
          });
          if (item.onSelect.thenGoTo) {
            extraTransitions.push({ event: actionId, targetCardId: item.onSelect.thenGoTo });
          }
        });
        return {
          block: {
            id,
            kind: "choice",
            title: ir.title,
            text: ir.text,
            options: items.map((it) => ({ label: it.label, value: it.onSelect?.value ?? it.label })),
            valueBinding: ir.currentFromSlot
              ? { path: `strings.${ir.currentFromSlot}`, fallback: "", formatter: "plain" }
              : undefined,
            // 标记纵向布局（ChoiceBlock 读取此字段）
            detail: "layout:stack",
          },
          extraActions,
          extraTransitions,
        };
      }

      // 不可点击列表 → list block（降级渲染）
      return {
        block: {
          id,
          kind: "list",
          title: ir.title,
          itemsBinding: ir.itemsFromSlot
            ? { path: `stringLists.${ir.itemsFromSlot}`, fallback: "", formatter: "join" }
            : undefined,
          maxItems: ir.items ? ir.items.length : 5,
        },
      };
    }

    /* —— metric → key-value 降级（spec 无专门 metric block）—— */
    case "metric":
      if (ir.metrics && ir.metrics.length > 0) {
        // 多指标只能取第一个降级展示，其余记 notice
        const m = ir.metrics[0];
        if (ir.metrics.length > 1) {
          notices.push({
            level: "downgraded",
            message: `metric block 有 ${ir.metrics.length} 个指标，当前只展示首个，其余降级`,
            location: cardId,
          });
        }
        return {
          block: {
            id,
            kind: "key-value",
            title: m.label,
            valueBinding: { path: "", fallback: `${m.value} ${m.unit ?? ""}`, formatter: "plain" },
          },
        };
      }
      return { block: { id, kind: "text", title: ir.title, text: ir.text } };

    /* —— 领先 spec 的 block：降级 + notice —— */
    case "image":
      notices.push({
        level: "downgraded",
        message: `image block 降级为 text（spec 暂不支持图片），imageUrl: ${ir.imageUrl}`,
        location: cardId,
      });
      return {
        block: { id, kind: "illustration", title: ir.title, text: ir.text ?? `[图片: ${ir.imageUrl ?? ""}]` },
      };

    case "chart":
    case "infographic":
      notices.push({
        level: "downgraded",
        message: `${ir.kind} block 降级为 text（spec 暂不支持图表），chartType: ${ir.chartType ?? ""}`,
        location: cardId,
      });
      return {
        block: {
          id,
          kind: "key-value",
          title: ir.title,
          text: ir.text,
          valueBinding: ir.valueFromSlot
            ? { path: `strings.${ir.valueFromSlot}`, fallback: ir.value ?? "", formatter: "plain" }
            : { path: "", fallback: ir.value ?? "", formatter: "plain" },
        },
      };

    default:
      return { block: { id, kind: "text", title: ir.title, text: ir.text } };
  }
}

/* ------------------------------------------------------------------ */
/*  action 编译（IRAction → DSL action）                               */
/* ------------------------------------------------------------------ */

function compileAction(ir: IRAction, cardId: string, notices: CompileNotice[]): Action | null {
  const role = ir.role ?? "primary";

  switch (ir.type) {
    case "navigate":
      return {
        id: ir.id,
        label: ir.label,
        role,
        kind: "local",
        dispatch: "form",
        operation: "none",
        event: ir.id,
      };

    case "select":
      return {
        id: ir.id,
        label: ir.label,
        role: role,
        kind: "local",
        dispatch: "form",
        operation: "state.set",
        statePath: ir.writeTo ? `strings.${ir.writeTo}` : undefined,
        stateValue: ir.writeValue,
        event: ir.id,
      };

    case "toggle":
      return {
        id: ir.id,
        label: ir.label,
        role,
        kind: "local",
        dispatch: "form",
        operation: "state.toggle",
        statePath: ir.writeTo ? `booleans.${ir.writeTo}` : undefined,
        event: ir.id,
      };

    case "confirm":
      return {
        id: ir.id,
        label: ir.label,
        role,
        kind: "local",
        dispatch: "form",
        operation: "none",
        event: ir.id,
      };

    case "copy":
      // spec 有 system.clipboard.write
      return {
        id: ir.id,
        label: ir.label,
        role,
        kind: "tool",
        dispatch: "host",
        toolCall: {
          adapterId: "system.clipboard.write",
          operation: "write",
          outcomes: ["success", "error"],
        },
      };

    case "save":
      // spec 有 system.file.save
      return {
        id: ir.id,
        label: ir.label,
        role,
        kind: "tool",
        dispatch: "host",
        toolCall: {
          adapterId: "system.file.save",
          operation: "save",
          outcomes: ["success", "cancelled", "error"],
        },
      };

    case "external-link":
      // spec §8.3 禁止 URL scheme，但 local.navigate 可做纯导航
      notices.push({
        level: "downgraded",
        message: `external-link 降级为 navigate（spec 禁止 URL scheme），link: ${ir.link}`,
        location: cardId,
      });
      return {
        id: ir.id,
        label: ir.label,
        role,
        kind: "local",
        dispatch: "form",
        operation: "none",
        event: ir.id,
      };

    case "pick-file":
      // 文件选择 → tool: system.file.pick
      return {
        id: ir.id,
        label: ir.label,
        role,
        kind: "tool",
        dispatch: "host",
        toolCall: {
          adapterId: "system.file.pick",
          operation: "document",
          outcomes: ["success", "cancelled", "error"],
        },
      };

    case "ocr":
      // 文字识别 → tool: document.text.extract
      return {
        id: ir.id,
        label: ir.label,
        role,
        kind: "tool",
        dispatch: "host",
        toolCall: {
          adapterId: "document.text.extract",
          operation: "extract",
          outcomes: ["success", "needsConfirmation", "error"],
        },
      };

    case "llm-call":
      // LLM 调用 → tool: ai.llm/chat（web 端真实调用）
      return {
        id: ir.id,
        label: ir.label,
        role,
        kind: "tool",
        dispatch: "host",
        toolCall: {
          adapterId: "ai.llm",
          operation: "chat",
          outcomes: ["success", "error"],
        },
      };

    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  transition 收集                                                    */
/* ------------------------------------------------------------------ */

function collectTransitions(
  node: CardNode,
  card: Card,
  extra: FlowTransition[],
): FlowTransition[] {
  const transitions: FlowTransition[] = [...extra];
  const seen = new Set<string>();

  const add = (t: FlowTransition) => {
    if (!seen.has(t.event)) {
      seen.add(t.event);
      transitions.push(t);
    }
  };

  // 1. IRAction navigate 类型 → 目标卡 transition
  for (const irAction of node.actions ?? []) {
    if (irAction.type === "navigate" && irAction.targetCardId) {
      add({ event: irAction.id, targetCardId: irAction.targetCardId });
    }
  }

  // 2. 编译后的 local action：有 event 但无对应 transition → 自环（留在当前卡）
  //    这覆盖 confirm/select/toggle/external-link(降级)/llm-call(降级) 等
  for (const action of card.actions) {
    if (action.kind !== "local") continue;
    const evt = action.event || action.id;
    if (!evt) continue;
    // onSelect 产生的 action 已在 extra 里处理；这里只补顶层 actions
    if (action.id === action.event || action.event) {
      if (!seen.has(evt)) {
        add({ event: evt, targetCardId: node.id }); // 自环
      }
    }
  }

  // 3. tool action：每个 outcome 都要 transition（spec §5.3）
  //    若 IRAction 有 targetCardId → success 跳目标卡，其余自环
  const irActionMap = new Map((node.actions ?? []).map((a) => [a.id, a]));
  for (const action of card.actions) {
    if (action.kind !== "tool" || !action.toolCall) continue;
    const irAct = irActionMap.get(action.id);
    const successTarget = irAct?.targetCardId;
    for (const outcome of action.toolCall.outcomes ?? []) {
      const evt = `${action.id}.${outcome}`;
      if (!seen.has(evt)) {
        // success 且有 targetCardId → 跳目标；否则自环
        const target = outcome === "success" && successTarget ? successTarget : node.id;
        add({ event: evt, targetCardId: target });
      }
    }
  }

  return transitions;
}

/* ------------------------------------------------------------------ */
/*  initialState 收集                                                  */
/* ------------------------------------------------------------------ */

function collectInitialState(plan: CardPlan, notices: CompileNotice[]): InitialState {
  const strings: Record<string, string> = {};
  const numbers: Record<string, number> = {};
  const booleans: Record<string, boolean> = {};
  const stringLists: Record<string, string[]> = {};

  for (const node of plan.cards) {
    for (const block of node.blocks ?? []) {
      // 直接值 → strings
      if (block.value) {
        const key = block.valueFromSlot ?? `${node.id}-${block.kind}-value`;
        strings[key] = block.value;
      }
      // metric → numbers
      if (block.metrics) {
        for (const m of block.metrics) {
          const key = sanitize(m.label);
          numbers[key] = m.value;
        }
      }
      // list 直接项 → stringLists
      if (block.items && block.items.length > 0 && !block.itemsFromSlot) {
        const key = `${node.id}-${block.kind}-items`;
        stringLists[key] = block.items.map((it) => it.label);
      }
      // progress 默认值
      if (block.kind === "progress" && block.valueFromSlot) {
        if (!numbers[block.valueFromSlot]) numbers[block.valueFromSlot] = 0;
      }
      // choice 默认值：第一个 option 作为初始选中
      if (block.kind === "choice" && block.currentFromSlot && block.options?.length) {
        if (!strings[block.currentFromSlot]) {
          strings[block.currentFromSlot] = block.options[0];
        }
      }
      // toggle 默认值：false
      if (block.kind === "toggle" && block.currentFromSlot) {
        if (booleans[block.currentFromSlot] === undefined) {
          booleans[block.currentFromSlot] = false;
        }
      }
    }
  }

  return { strings, numbers, booleans, stringLists };
}

/* ------------------------------------------------------------------ */
/*  辅助                                                               */
/* ------------------------------------------------------------------ */

/** 从 IRBlock 构造 valueBinding（优先 slot 引用，其次 fallback 直接值） */
function makeBinding(ir: IRBlock): Binding | undefined {
  if (ir.valueFromSlot) {
    return { path: `strings.${ir.valueFromSlot}`, fallback: ir.value ?? "", formatter: "plain" };
  }
  if (ir.value) {
    return { path: "", fallback: ir.value, formatter: "plain" };
  }
  return undefined;
}

/** 推断 card template */
function inferTemplate(node: CardNode, blocks: Block[]): CardTemplate {
  const kinds = blocks.map((b) => b.kind);
  if (kinds.includes("hero")) return "hero";
  if (kinds.includes("choice") || kinds.includes("toggle")) return "config";
  if (kinds.includes("progress")) return "progress";
  if (kinds.includes("status")) return "success";
  if (kinds.includes("list") || kinds.includes("entity-summary")) return "collection";
  return "summary";
}

/** sanitize：转合法 ID 片段 */
function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase().slice(0, 20);
}

/** action 去重（按 id） */
function dedupActions(actions: Action[]): Action[] {
  const seen = new Set<string>();
  const out: Action[] = [];
  for (const a of actions) {
    if (!seen.has(a.id)) {
      seen.add(a.id);
      out.push(a);
    }
  }
  return out;
}
