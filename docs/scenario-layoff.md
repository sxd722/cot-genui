# 场景：裁员应对规划

> 来源：cot-genui 主流程真实推理（8步全部完成）
> 用户画像：林晓（完整个人画像预设）
> Query：公司业务重组，帮我规划应对方案

## 槽位推断结果（Step 3-5）

| 槽位 | 推断值 | 置信度 | 证据来源 |
|---|---|---|---|
| current_job_status | 前端工程师，7年经验，就职于某互联网公司(上海张江)，月薪约2.8万元。公司正在经历业务重组，所在部门/业务线受影响程度未知。 | 80 | identity.occupation=前端工程师 + identity.work_years=7 + identity.company=某互联网公司 + payment.monthly_income=28000 + user_query提及'公司业务重组' |
| layoff_timeline | （待确认）全设备扫描未发现任何HR面谈通知、赔偿方案讨论、内部裁员消息等痕迹 | 0 | [] |
| core_skills | 资深前端工程师(7年)，具备成熟技术栈，tech_savvy标签佐证技术热情。具体技能树、是否有团队管理经验、核心竞争力定位不明。 | 60 | identity.occupation + identity.work_years=7 + persona_tags含tech_savvy |
| financial_runway | 储蓄15万元，月均总支出约1.8万元(含房贷)，财务缓冲期(runway)约8个月。有房贷在身，断薪压力较大。 | 90 | payment.savings=150000 ÷ payment.avg_monthly_spend=18000 ≈ 8.3个月。payment.has_mortgage=true |
| family_obligations | 已婚，丈夫陈宇(32岁，产品经理)在沪工作。女儿陈乐宝3岁，正在报名上海本地幼儿园(8/16)。父亲林建国62岁患高血压，母亲60岁身体良好。家庭重心稳固锚定上海，双职工家庭依赖双收入+需承担房贷+育儿+老人健康照护。 | 90 | family.spouse.occupation=产品经理 + family.children[0].age=3 + calendar 8/16乐乐幼儿园报名 + notes'乐乐幼儿园体检单' + family.parents[0].health=高血压 + payment.has_mortgage=true |
| internal_transfer_options | （待确认）设备中无钉钉/飞书/企业微信等企业内部协作工具的使用记录，无任何公司组织架构、岗位列表、活水政策相关信息 | 0 | [] |
| external_market_landscape | 用户属于互联网行业前端工程师赛道，7年经验对应资深/高级前端定位。无具体招聘平台浏览记录，无法提取目标公司或薪资期望。 | 20 | identity.occupation + identity.company → 行业属性可做宏观行情判断；app_usage/browser_history中无BOSS直聘/拉勾/猎聘等招聘平台痕迹 |
| career_aspiration | 可能开始重视工作生活平衡(WLB)——健康数据显示轻度颈椎病+用眼过度，persona含family_oriented标签。7年经验处于'深耕技术vs转管理'的交叉路口。 | 40 | health_app.chronic=轻度颈椎病 + health_app.checkup_alerts含颈椎曲度变直/用眼过度 + persona_tags含family_oriented + work_years=7(职业分叉点) |
| risk_appetite | 信号矛盾无法裁决：budget_conscious指向保守稳健；comfortable指向财务从容。 | 0 ⚠冲突 | identity.persona_tags含budget_conscious vs payment.budget_style=comfortable |
| geographic_flexibility | 高度锚定上海本地——上海有房贷、配偶在沪做产品经理、女儿即将在上海入园、父母近邻需照护。跨城市跳槽可行性极低。 | 85 | location_history.home_city=上海 + family.spouse在沪工作 + calendar幼儿园报名(上海) + payment.has_mortgage=true(上海房产) |

## 检测到的冲突

**risk_appetite** (signal_contradiction, severity: medium, non-blocking)

- **source_a**: `identity.persona_tags = budget_conscious` → 保守稳健方向
- **source_b**: `payment.budget_style = comfortable` → 从容承受风险方向
- **impact**: 影响策略激进度微调，但不阻塞核心方案生成

## 用户回答（Step 6 最小化提问）

### Q1: 关于裁员风险的时间线，你目前了解到的情况是？（阻塞）

> 这是制定行动方案的核心分叉点：如果是1-2周内的迫在眉睫型，方案需走应急路线；如果是1-3个月的中期风险，可以更系统地准备。

**✓ 已选：中期风险：听说公司在走流程或已开始优化其他部门，预计1-3个月内可能轮到我**

### Q2: 关于公司内部的活水（转岗）机制，你目前了解多少？（阻塞）

> 你把'活水'列为备选路径之一，但我无法从设备数据中了解到公司内部的组织架构和转岗政策。

**✓ 已选：已有明确目标：知道想转哪个部门/团队，且大概了解他们的招聘需求**

### Q3: 如果跳槽时遇到短暂的空窗期，你的财务和心理承受度是？（阻塞）

> 从设备记录看到两个信号——budget_conscious vs comfortable。需要确认真实容忍度。

**✓ 已选：可以接受1-2个月短期过渡：有基本储蓄缓冲，只要整体节奏可控就行**

## 关键推理链

1. **时间线=中期(1-3个月)** → 非应急，可系统准备（不是立即裸辞，而是骑驴找马+同步活水）
2. **活水=已有明确目标** → 可操作，不需先调研政策，直接给"活水操作指南"
3. **空窗容忍=1-2个月** → 可以接受短期过渡，方案不必极端保守（骑驴找马但可选更好机会）
4. **地理锚定=上海** → 跳槽搜索范围限定上海大区（含远程办公选项）
5. **财务runway=8个月** → 有基本缓冲，但房贷+育儿开销使得断薪风险仍需管控
6. **家庭锚定** → 不可搬迁，方案必须围绕上海本地或远程办公

## 方案设计方向（供 generate 步参考）

- **双轨并行**：内部活水（已有目标团队）+ 外部跳槽（上海大区）
- **时间窗口**：1-3个月内完成两条线推进
- **财务策略**：8个月runway支撑1-2个月过渡期，但控制总风险敞口
- **行动清单**：简历更新→活水沟通→招聘平台投递→面试准备→备选方案
