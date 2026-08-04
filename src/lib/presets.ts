/**
 * 预设的设备上下文场景 (Mock Device Context)
 *
 * 这些数据模拟"设备使用记录等本地上下文"，是消歧管线的关键输入。
 * 每个场景包含一个刻意埋的冲突信号，用来验证 conflict_detection 步骤。
 */

export interface DeviceContext {
  /** 场景标识 */
  id: string;
  /** 展示名 */
  label: string;
  /** 描述 */
  description: string;
  /** 模拟的设备使用记录 */
  records: Record<string, unknown>;
}

/** 默认测试 query */
export const DEFAULT_QUERY = "帮我规划去北京旅游";

/* ------------------------------------------------------------------ */
/*  场景 0：完整个人画像                                                */
/*  一个具体、立体的虚拟人物，覆盖身份/家庭/日程/应用/购物/健康/财务/    */
/*  位置/社交等多维度。其中故意埋了几处信号冲突，用来检验冲突检测步骤。  */
/* ------------------------------------------------------------------ */

const fullProfile: DeviceContext = {
  id: "full-profile",
  label: "完整画像 · 林晓",
  description:
    "30岁上海程序员林晓：已婚、3岁女儿。含身份/家庭/日程/应用/购物/健康/财务/位置等。埋了「独自旅行搜索 vs 家庭标记」「买婴儿用品 vs 女儿已3岁」两处冲突。",
  records: {
    /* —— 身份与基本画像 —— */
    identity: {
      name: "林晓",
      gender: "female",
      age: 30,
      occupation: "前端工程师",
      company: "某互联网公司",
      work_years: 7,
      languages: ["中文", "英语(CET-6)"],
      persona_tags: ["tech_savvy", "budget_conscious", "family_oriented"],
    },

    /* —— 家庭成员 —— */
    family: {
      marital_status: "married",
      spouse: { name: "陈宇", age: 32, occupation: "产品经理" },
      children: [
        { name: "陈乐宝", age: 3, gender: "female", relation: "daughter" },
      ],
      parents: [
        { name: "林建国", age: 62, relation: "father", health: "高血压" },
        { name: "王秀兰", age: 60, relation: "mother", health: "良好" },
      ],
      pets: [{ type: "猫", name: "团子", age: 2 }],
    },

    /* —— 日程 —— */
    calendar: [
      { date: "2026-08-12", time: "09:00", title: "项目评审会", type: "work" },
      { date: "2026-08-15", time: "19:00", title: "结婚纪念日", type: "personal" },
      { date: "2026-08-20", title: "休年假", type: "personal", note: "已审批" },
      { date: "2026-08-24", title: "休年假", type: "personal" },
      { date: "2026-08-16", time: "10:00", title: "乐乐幼儿园报名", type: "family" },
    ],

    /* —— 应用使用情况（近30天）—— */
    app_usage: {
      top_apps: [
        { name: "微信", category: "社交", daily_minutes: 95 },
        { name: "小红书", category: "内容", daily_minutes: 48 },
        { name: "抖音", category: "内容", daily_minutes: 40 },
        { name: "淘宝", category: "购物", daily_minutes: 22 },
        { name: "美团", category: "生活", daily_minutes: 15 },
        { name: "Notion", category: "效率", daily_minutes: 30 },
      ],
      recent_searches_global: ["颈椎操", "护眼台灯", "亲子餐厅"],
      installed_categories: ["社交", "购物", "母婴", "效率", "健康"],
    },

    /* —— 浏览器历史 —— */
    browser_history: {
      recent_searches: [
        "北京旅游攻略",
        "故宫门票预约",
        "北京独自旅行", // ⚠ 冲突1：与 family.children 标记矛盾
        "北京亲子酒店",
        "上海到北京高铁",
        "颈椎病的最好锻炼方法",
      ],
      visited_sites: [
        "trip.com (旅游)",
        "ctrip.com (旅游)",
        "xiaohongshu.com (种草)",
      ],
    },

    /* —— 购物记录（近60天）—— */
    shopping: {
      recent_orders: [
        { item: "乐高得宝积木", category: "玩具", price: 299, date: "2026-07-20", for: "daughter" },
        { item: "婴儿连体衣 73码", category: "母婴", price: 89, date: "2026-07-28", for: "gift" }, // ⚠ 冲突2：女儿已3岁(需100+码)，疑送礼/二胎
        { item: "护颈枕", category: "家居", price: 159, date: "2026-07-15", for: "self" },
        { item: "机械键盘", category: "数码", price: 599, date: "2026-06-30", for: "self" },
        { item: "幼儿园书包", category: "母婴", price: 129, date: "2026-08-02", for: "daughter" },
      ],
      preferred_brands: ["全棉时代", "乐高", "罗技"],
      avg_monthly_spend: 4200,
    },

    /* —— 外卖/餐饮 —— */
    food_delivery: {
      cuisine_preference: ["川菜", "日料", "轻食"],
      recent_orders: [
        { dish: "麻辣香锅", price: 38, date: "2026-08-03" },
        { dish: "三文鱼丼", price: 55, date: "2026-08-01" },
      ],
      dietary_tags: ["微辣", "少油"],
      avg_order: 45,
    },

    /* —— 健康 —— */
    health_app: {
      avg_daily_steps: 6200,
      sleep_avg_hours: 6.8,
      mobility_restricted: false,
      chronic: ["轻度颈椎病"],
      last_checkup: "2026-05-10",
      checkup_alerts: ["颈椎曲度变直", "用眼过度"],
    },

    /* —— 财务 —— */
    payment: {
      monthly_income: 28000,
      avg_monthly_spend: 18000, // 含房贷育儿
      savings: 150000,
      balance: 32000,
      budget_style: "comfortable", // 经济/舒适/高端
      has_mortgage: true,
    },

    /* —— 位置 —— */
    location_history: {
      home_city: "上海",
      home_district: "浦东新区",
      frequent_locations: ["张江高科技园区(公司)", "浦东嘉里城(商场)"],
      recent_trips: [{ dest: "杭州", date: "2026-05", purpose: "周末游" }],
    },

    /* —— 相册 —— */
    photo_album: {
      recent_themes: ["亲子", "美食", "猫", "风景"],
      nightlife_ratio: 0.03,
      travel_ratio: 0.15,
    },

    /* —— 通讯录/社交关系 —— */
    contacts: {
      total: 320,
      has_family_label: true,
      has_kid_label: true,
      close_friends: 8,
      groups: ["大学同学", "公司同事", "妈妈群"],
    },

    /* —— 笔记/备忘 —— */
    notes: {
      recent_memos: [
        "8/15 纪念日订餐厅",
        "乐乐幼儿园体检单",
        "国庆带爸妈去北京", // 暗示出行人含老人
      ],
    },
  },
};

/** 场景一：杭州上班族（埋了"亲子游搜索"冲突） */
const hangzhouWorker: DeviceContext = {
  id: "hangzhou-worker",
  label: "杭州上班族",
  description: "常驻杭州的白领，年假已定，搜过亲子游（与通讯录无亲子标签冲突）",
  records: {
    location_history: {
      home_city: "杭州",
      frequent_locations: ["西湖区", "未来科技城"],
    },
    calendar: [
      { date: "2026-08-12", title: "休年假", type: "personal" },
      { date: "2026-08-15", title: "休年假", type: "personal" },
      { date: "2026-08-15", time: "18:30", title: "航班提醒 HGH→PEK" },
    ],
    photo_album: {
      recent_themes: ["博物馆", "古建筑", "胡同"],
      nightlife_ratio: 0.05,
    },
    food_delivery: {
      cuisine_preference: ["京菜", "涮羊肉", "本帮菜"],
      avg_order: 45,
    },
    payment: {
      avg_monthly_spend: 6500,
      balance: 28000,
    },
    health_app: {
      avg_daily_steps: 8500,
      mobility_restricted: false,
    },
    contacts: {
      has_family_label: false,
      has_kid_label: false,
    },
    browser_history: {
      recent_searches: [
        "北京旅游攻略",
        "故宫门票预约",
        "北京亲子游攻略", // ⚠ 与 contacts 无亲子标签冲突
        "高铁杭州到北京多久",
      ],
    },
  },
};

/** 场景二：带娃家庭 */
const familyWithKid: DeviceContext = {
  id: "family-with-kid",
  label: "带娃家庭",
  description: "三口之家，孩子 6 岁，通讯录明确标记亲子关系",
  records: {
    location_history: { home_city: "上海" },
    calendar: [
      { date: "2026-08-10", title: "暑假带娃出游" },
      { date: "2026-08-16", title: "暑假带娃出游" },
    ],
    photo_album: {
      recent_themes: ["亲子", "乐园", "动物园"],
    },
    contacts: {
      has_family_label: true,
      has_kid_label: true,
      kid_age: 6,
    },
    browser_history: {
      recent_searches: ["北京亲子游", "北京儿童友好景点", "北京环球影城"],
    },
    health_app: { avg_daily_steps: 5000, mobility_restricted: false },
    payment: { avg_monthly_spend: 12000, balance: 50000 },
  },
};

/** 场景三：极简上下文（信息严重不足，验证提问步骤） */
const minimal: DeviceContext = {
  id: "minimal",
  label: "极简上下文",
  description: "几乎没有可用记录，用来验证消歧提问是否被正确触发",
  records: {
    location_history: {},
    calendar: [],
    browser_history: { recent_searches: ["北京"] },
  },
};

export const presets: DeviceContext[] = [fullProfile, hangzhouWorker, familyWithKid, minimal];

export function getPreset(id: string): DeviceContext | undefined {
  return presets.find((p) => p.id === id);
}
