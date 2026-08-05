/**
 * 购房场景的完整推理上下文（固化为文件）
 *
 * 来源：8步消歧管线的 0-6 步产出 + 用户对3个关键提问的回答。
 * 用于 generate 步（第7步）的 priorSteps 输入。
 */

/** 设备上下文（林晓画像的购房相关子集） */
export const housingDeviceContext = {
  identity: { name: "林晓", age: 30, occupation: "前端工程师", work_years: 7, persona_tags: ["tech_savvy", "budget_conscious", "family_oriented"] },
  family: {
    marital_status: "married",
    spouse: { name: "陈宇", age: 32, occupation: "产品经理" },
    children: [{ name: "陈乐宝", age: 3 }],
  },
  location_history: { home_city: "上海", home_district: "浦东新区", frequent_locations: ["张江高科技园区", "浦东嘉里城"] },
  payment: {
    monthly_income: 28000,
    avg_monthly_spend: 18000,
    savings: 150000,
    has_mortgage: true,
    budget_style: "comfortable",
  },
  calendar: [{ date: "2026-08-16", title: "乐乐幼儿园报名", type: "family" }],
  notes: { recent_memos: ["8/15 纪念日订餐厅", "乐乐幼儿园体检单", "国庆带爸妈去北京"] },
};

/** 0-6 步的产出（priorSteps） */
export const housingPriorSteps = {
  slot_definition: {
    reasoning:
      "用户请求购房规划。判断为 housing_loan_planning 任务。定义14个槽位覆盖城市/房价/首付/收入/贷款/信用等。",
    outputs: {
      task_type: "housing_loan_planning",
      slot_schema: [
        { name: "target_city", label: "目标城市", weight: 5, blocking: true },
        { name: "property_price_range", label: "房价区间", weight: 5, blocking: true },
        { name: "available_down_payment", label: "可用首付", weight: 5, blocking: true },
        { name: "household_monthly_income", label: "家庭月收入", weight: 4, blocking: false },
        { name: "current_mortgage_status", label: "现有房贷", weight: 4, blocking: true },
        { name: "family_monthly_expenses", label: "家庭月支出", weight: 3, blocking: false },
        { name: "housing_purpose", label: "购房用途", weight: 4, blocking: true },
        { name: "housing_fund_status", label: "公积金状态", weight: 3, blocking: false },
        { name: "loan_type_preference", label: "贷款类型偏好", weight: 3, blocking: false },
        { name: "loan_term_preference", label: "贷款期限偏好", weight: 3, blocking: false },
        { name: "credit_profile", label: "信用状况", weight: 3, blocking: false },
        { name: "purchase_timeline", label: "购房时间线", weight: 2, blocking: false },
        { name: "future_family_plan", label: "未来家庭规划", weight: 2, blocking: false },
        { name: "existing_property", label: "现有房产", weight: 4, blocking: true },
      ],
    },
  },

  surface_parse: {
    reasoning: "表层动作=购房贷款规划。query中无显式槽位值，全部需从上下文挖掘或提问。",
    outputs: { verb: "规划购房贷款", explicit: [], missing: "全部14个槽位" },
  },

  sufficiency_check: {
    reasoning: "房价/首付/现有房产处置等blocking槽位缺失，严重影响方案可用性，必须挖掘+提问。",
    outputs: { need_context_mining: true },
  },

  context_mining: {
    reasoning:
      "逐个挖掘14个槽位。target_city高置信(上海)；property_price_range完全无法推断(无房产APP/搜索记录)；available_down_payment仅知个人储蓄15万下限；household_monthly_income估算5.8万；current_mortgage_status确认有房贷；housing_purpose推断改善型但置换vs再购未知。",
    outputs: {},
    slots: [
      { name: "target_city", value: "上海", evidence: "home_city=上海+浦东+张江工作+嘉里城消费，北京搜索全部为旅游意图", source_record: "location_history", confidence: 0.85, status: "high" },
      { name: "property_price_range", value: "", evidence: "无贝壳/链家APP、无房贷计算器搜索、无房价浏览，完全无法推断", source_record: "—", confidence: 0.15, status: "low" },
      { name: "available_down_payment", value: "≥15万（个人储蓄下限）", evidence: "savings=150000为林晓个人储蓄确定下限，配偶/理财/卖房款未知", source_record: "payment.savings", confidence: 0.5, status: "medium" },
      { name: "household_monthly_income", value: "约58,000元/月", evidence: "林晓28k+陈宇估算30k(上海互联网产品经理中位)", source_record: "payment.monthly_income, family.spouse", confidence: 0.55, status: "medium" },
      { name: "current_mortgage_status", value: "有未结清房贷（上海本地房产）", evidence: "has_mortgage=true直接布尔字段", source_record: "payment.has_mortgage", confidence: 0.9, status: "high" },
      { name: "family_monthly_expenses", value: "约18,000元/月", evidence: "avg_monthly_spend=18000直接记录", source_record: "payment.avg_monthly_spend", confidence: 0.8, status: "high" },
      { name: "housing_purpose", value: "改善型自住（可能兼学区）", evidence: "has_mortgage+已婚+3岁女儿+幼儿园报名+family_oriented", source_record: "payment,family,calendar", confidence: 0.55, status: "medium" },
      { name: "housing_fund_status", value: "确认有公积金缴纳（正式雇佣7年）", evidence: "前端工程师+互联网公司7年，依法缴纳概率>95%", source_record: "identity.occupation,work_years", confidence: 0.4, status: "low" },
      { name: "loan_type_preference", value: "", evidence: "budget_conscious vs comfortable冲突，无法单方推断", source_record: "identity.persona_tags, payment.budget_style", confidence: 0.15, status: "conflict" },
      { name: "loan_term_preference", value: "", evidence: "同上冲突影响", source_record: "identity.persona_tags, payment.budget_style", confidence: 0.15, status: "conflict" },
      { name: "credit_profile", value: "信用良好（推断）", evidence: "稳定工作7年+月收入28k+已有获批房贷", source_record: "identity,payment", confidence: 0.45, status: "medium" },
      { name: "purchase_timeline", value: "", evidence: "无购房相关时间线记录", source_record: "—", confidence: 0.1, status: "low" },
      { name: "future_family_plan", value: "可能有父母养老同住需求", evidence: "父亲62岁高血压+母亲60岁+family_oriented+国庆带爸妈旅游", source_record: "family.parents,notes", confidence: 0.45, status: "medium" },
      { name: "existing_property", value: "浦东房产一套，正在还贷", evidence: "has_mortgage+浦东稳定居住轨迹", source_record: "payment.has_mortgage,location_history", confidence: 0.75, status: "high" },
    ],
  },

  conflict_detection: {
    reasoning:
      "检测到C1冲突：identity.persona_tags含budget_conscious（→成本最小化：长贷+公积金优先）与payment.budget_style=comfortable（→灵活从容：可能接受较高月供换总利息节省）方向相反。影响loan_type_preference和loan_term_preference，置信度降至0.15。不擅自裁决，留待提问。",
    outputs: {},
    conflicts: [
      {
        slot: "loan_type_preference + loan_term_preference",
        evidence_a: "persona_tags=budget_conscious → 成本最小化策略（长贷+公积金优先）",
        evidence_b: "budget_style=comfortable → 灵活从容策略（可能接受较高月供换总利息节省）",
        note: "UNRESOLVED——将在Step6以非阻塞提问征询，最终方案提供两种策略对比",
      },
    ],
  },

  triage: {
    reasoning: "按置信度分流。高置信直接采纳(target_city/current_mortgage/family_expenses/existing_property)；中置信采纳并标注(household_income/down_payment/housing_purpose/credit/future_plan/housing_fund)；低置信+冲突进入提问(property_price/down_payment细节/loan_preferences/timeline)。",
    outputs: {},
    slots: [
      { name: "target_city", value: "上海", confidence: 0.85, status: "high" },
      { name: "property_price_range", value: "", confidence: 0.15, status: "low" },
      { name: "available_down_payment", value: "≥15万", confidence: 0.5, status: "medium" },
      { name: "household_monthly_income", value: "约58,000元/月", confidence: 0.55, status: "medium" },
      { name: "current_mortgage_status", value: "有未结清房贷", confidence: 0.9, status: "high" },
      { name: "family_monthly_expenses", value: "约18,000元/月", confidence: 0.8, status: "high" },
      { name: "housing_purpose", value: "改善型自住", confidence: 0.55, status: "medium" },
      { name: "housing_fund_status", value: "有公积金", confidence: 0.4, status: "low" },
      { name: "loan_type_preference", value: "", confidence: 0.15, status: "conflict" },
      { name: "loan_term_preference", value: "", confidence: 0.15, status: "conflict" },
      { name: "credit_profile", value: "信用良好", confidence: 0.45, status: "medium" },
      { name: "existing_property", value: "浦东房产在还贷", confidence: 0.75, status: "high" },
    ],
  },

  clarifying_questions: {
    reasoning:
      "3个blocking问题：①房价区间（完全无法推断）②现有房产处置+首付规模（决定首套/二套认定）③贷款取向（解决C1冲突）。用户已全部回答。",
    outputs: {},
    questions: [
      {
        question: "你计划在上海购买的房屋，总价大概在哪个区间？",
        reason: "房价区间是贷款策略所有计算的起点，device_context中无任何房价锚点",
        blocking: true,
        options: ["300万以内", "300-500万（刚需改善）", "500-800万（品质改善）", "800万以上"],
      },
      {
        question: "现有的那套房产打算怎么处理？家庭目前能凑齐的首付资金大约是多少？",
        reason: "首付资金是blocking槽位，是否置换直接决定首套/二套认定和首付比例",
        blocking: true,
        options: ["卖掉旧房置换，首付≥150万", "卖掉旧房置换，首付80-150万", "保留旧房再购，首付50-100万", "保留旧房再购，首付≤50万"],
      },
      {
        question: "在贷款方案的整体取向上，你更看重哪个方面？",
        reason: "loan_type_preference和loan_term_preference因人格标签冲突无法可靠推断",
        blocking: true,
        options: ["总利息越少越好", "月供最低（长贷）", "灵活平衡"],
      },
    ],
  },
};

/** 用户对3个提问的回答（generate步会注入） */
export const housingUserAnswers = {
  0: "300-500万（刚需改善，两房至小三房）",
  1: "卖掉旧房置换，首付预计能凑150万以上",
  2: "月供最低（30年长贷）",
};

/** 推理上下文中的方案数据（供参考，GLM会基于slots+answers重新组织） */
export const housingPlanData = {
  strategy_name: "上海改善置换·30年组合贷方案",
  core_logic: "卖旧房→还清贷款→按首套认定→组合贷款（公积金120万+商贷140万）→30年等额本息→月供最小化",
  target_property: { price_range: "300-500万（取中位400万测算）", type: "两房至小三房", city: "上海" },
  down_payment: { first_buy: { ratio: "35%", amount: "约140万", feasibility: "✓可覆盖" }, second_buy: { ratio: "70%", amount: "约280万", feasibility: "⚠可能超出" } },
  recommended_plan: {
    plan_name: "组合贷30年（公积金120万+商贷140万）",
    total_loan: "260万",
    housing_fund: "120万@2.85%",
    commercial: "140万@~3.3%",
    term: 30,
    monthly_payment: "约11,079元",
    total_interest: "约138.8万",
    ratio: "19.1%",
  },
  comparison: [
    { plan_name: "组合贷25年", monthly_payment: "约12,471元", total_interest: "约114.1万", ratio: "21.5%", tag: "总利息省24.7万，月供多1,392元" },
    { plan_name: "纯商贷30年", monthly_payment: "约11,373元", total_interest: "约149.4万", ratio: "19.6%", tag: "手续简单但总利息多10.6万" },
  ],
  cashflow: { income: "~58,000", payment: "~11,079", expenses: "~18,000", surplus: "~28,921", safety: "月供后结余占收入50%" },
  actions: [
    "评估旧房市场价值与预期到手金额",
    "查询夫妻双方公积金余额与连续缴存月数",
    "打印双方征信报告确认无逾期",
    "关注上海LPR利率政策窗口期",
    "旧房挂牌出售，同步看新房",
    "签约前对比3家银行组合贷方案",
  ],
};
