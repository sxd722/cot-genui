/**
 * 内置样例 CardArtifact —— 旅行场景 demo
 *
 * 用于验证 DSL 引擎（validate + reducer + runtime）。
 * 流程：hero（目的地确认）→ config（选交通方式）→ progress（规划中）→ success（行程总览）→ confirm（行前清单）
 * 所有 binding path 和工具都来自 catalogs.ts，可通过 validateArtifact 校验。
 */

import type { CardArtifact } from "./types";
import { FLOW_VERSION, DSL_VERSION } from "./types";

export const travelSampleArtifact: CardArtifact = {
  artifactId: "beijing-trip-v1",
  flow: {
    flowVersion: FLOW_VERSION,
    skillId: "beijing-trip",
    singleForm: true,
    startCardId: "intro",
    cards: [
      {
        id: "intro",
        purpose: "确认目的地与出行人",
        template: "hero",
        transitions: [
          { event: "confirm", targetCardId: "config" },
        ],
      },
      {
        id: "config",
        purpose: "选择交通方式",
        template: "config",
        transitions: [
          { event: "next", targetCardId: "planning" },
          { event: "back", targetCardId: "intro" },
        ],
      },
      {
        id: "planning",
        purpose: "规划进度展示",
        template: "progress",
        transitions: [
          { event: "done", targetCardId: "summary" },
        ],
      },
      {
        id: "summary",
        purpose: "行程总览",
        template: "success",
        transitions: [
          { event: "view-checklist", targetCardId: "checklist" },
          { event: "restart", targetCardId: "intro" },
        ],
      },
      {
        id: "checklist",
        purpose: "行前清单",
        template: "collection",
        transitions: [
          { event: "back", targetCardId: "summary" },
        ],
      },
    ],
  },
  dsl: {
    dslVersion: DSL_VERSION,
    theme: {
      preset: "black-gold",
      accentToken: "#D7AE59",
      surfaceToken: "#0B0D10",
      dangerToken: "#E88A73",
    },
    startCardId: "intro",
    initialState: {
      strings: {
        destination: "北京",
        travelParty: "一家三口（含 3 岁女儿）",
        travelDates: "8月20日-24日 · 4天3晚",
        transportMode: "高铁",
        budget: "舒适型 ¥8000-12000",
        highlight: "亲子友好 · 寓教于乐",
        statusMessage: "方案已就绪",
        title: "北京亲子游",
        subtitle: "故宫 · 动物园 · 颐和园",
      },
      numbers: {
        progress: 0,
        days: 4,
        totalBudget: 10000,
      },
      stringLists: {
        itinerary: [
          "Day1: 抵达 + 前门大街",
          "Day2: 故宫 + 景山",
          "Day3: 动物园 + 颐和园",
          "Day4: 返程",
        ],
        tips: [
          "故宫门票提前 7 天预约",
          "携带轻便折叠推车",
          "注意防晒避暑",
          "保留弹性时间",
        ],
        restaurants: [
          "四季民福烤鸭（可观景）",
          "局气（创意京菜）",
          "方砖厂炸酱面",
        ],
      },
    },
    cards: [
      /* —— 卡片1: intro (hero) —— */
      {
        id: "intro",
        template: "hero",
        header: {
          skillName: "北京亲子游",
          stepLabel: "1 / 5 · 确认",
          iconText: "B",
        },
        blocks: [
          {
            id: "hero-intro",
            kind: "hero",
            title: "确认你的出行信息",
            text: "目的地：北京 · 出行人：一家三口 · 8月20日出发",
          },
          {
            id: "party-summary",
            kind: "entity-summary",
            title: "出行人",
            valueBinding: {
              path: "strings.travelParty",
              fallback: "未确认",
              formatter: "plain",
            },
            secondaryBinding: {
              path: "strings.travelDates",
              fallback: "日期待定",
              formatter: "plain",
            },
          },
        ],
        actions: [
          {
            id: "confirm",
            label: "确认，下一步",
            role: "primary",
            kind: "local",
            dispatch: "form",
            operation: "none",
            event: "confirm",
          },
        ],
      },

      /* —— 卡片2: config (choice 交通方式) —— */
      {
        id: "config",
        template: "config",
        header: {
          skillName: "北京亲子游",
          stepLabel: "2 / 5 · 交通",
          iconText: "B",
        },
        blocks: [
          {
            id: "transport-choice",
            kind: "choice",
            title: "选择交通方式",
            text: "上海到北京，带 3 岁宝宝推荐高铁一等座",
            valueBinding: {
              path: "strings.transportMode",
              fallback: "高铁",
              formatter: "plain",
            },
            actionId: "select-transport",
            options: [
              { label: "高铁（推荐）", value: "高铁" },
              { label: "飞机", value: "飞机" },
              { label: "自驾", value: "自驾" },
            ],
          },
        ],
        actions: [
          {
            id: "select-transport",
            label: "选择",
            role: "secondary",
            kind: "local",
            dispatch: "form",
            operation: "state.select",
            statePath: "strings.transportMode",
            event: "next",
          },
          {
            id: "back",
            label: "返回",
            role: "tertiary",
            kind: "local",
            dispatch: "form",
            operation: "none",
            event: "back",
          },
        ],
      },

      /* —— 卡片3: planning (progress) —— */
      {
        id: "planning",
        template: "progress",
        header: {
          skillName: "北京亲子游",
          stepLabel: "3 / 5 · 规划中",
          iconText: "B",
        },
        blocks: [
          {
            id: "plan-progress",
            kind: "progress",
            title: "正在生成行程方案",
            valueBinding: {
              path: "numbers.progress",
              fallback: "0",
              formatter: "percent",
            },
            secondaryBinding: {
              path: "strings.statusMessage",
              fallback: "处理中",
              formatter: "plain",
            },
          },
        ],
        actions: [
          {
            id: "done",
            label: "查看方案",
            role: "primary",
            kind: "local",
            dispatch: "form",
            operation: "state.set",
            statePath: "strings.statusMessage",
            stateValue: "方案已就绪",
            event: "done",
          },
        ],
      },

      /* —— 卡片4: summary (success) —— */
      {
        id: "summary",
        template: "success",
        header: {
          skillName: "北京亲子游",
          stepLabel: "4 / 5 · 方案",
          iconText: "B",
        },
        blocks: [
          {
            id: "trip-status",
            kind: "status",
            title: "行程方案已生成",
            text: "4天3晚北京亲子游，寓教于乐路线",
            valueBinding: {
              path: "strings.highlight",
              fallback: "亲子友好",
              formatter: "plain",
            },
          },
          {
            id: "trip-detail",
            kind: "entity-summary",
            title: "行程概要",
            valueBinding: {
              path: "strings.destination",
              fallback: "北京",
              formatter: "plain",
            },
            secondaryBinding: {
              path: "strings.budget",
              fallback: "舒适型",
              formatter: "plain",
            },
          },
        ],
        actions: [
          {
            id: "view-checklist",
            label: "行前清单",
            role: "primary",
            kind: "local",
            dispatch: "form",
            operation: "none",
            event: "view-checklist",
          },
          {
            id: "restart",
            label: "重新规划",
            role: "secondary",
            kind: "local",
            dispatch: "form",
            operation: "session.reset",
            event: "restart",
          },
        ],
      },

      /* —— 卡片5: checklist (collection) —— */
      {
        id: "checklist",
        template: "collection",
        header: {
          skillName: "北京亲子游",
          stepLabel: "5 / 5 · 清单",
          iconText: "B",
        },
        blocks: [
          {
            id: "tips-list",
            kind: "list",
            title: "出行提示",
            itemsBinding: {
              path: "stringLists.tips",
              fallback: "",
              formatter: "join",
            },
            maxItems: 5,
          },
        ],
        actions: [
          {
            id: "back",
            label: "返回方案",
            role: "primary",
            kind: "local",
            dispatch: "form",
            operation: "none",
            event: "back",
          },
        ],
      },
    ],
  },
};
