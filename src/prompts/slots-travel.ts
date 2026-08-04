/**
 * 旅游场景的槽位定义 (Slot Schema)
 *
 * 这是"意图消歧管线"泛化到其他场景的关键：换一份 slot schema，
 * 就能把同样的管线应用到"点外卖""买礼物""订会议室"等其他模糊意图。
 */

export interface SlotDefinition {
  /** 槽位键名 */
  name: string;
  /** 中文展示名 */
  label: string;
  /** 该槽位对最终输出的影响权重 (1~5)，越高越关键 */
  weight: 1 | 2 | 3 | 4 | 5;
  /** 缺失时是否阻塞核心输出 */
  blocking: boolean;
  /** 取值说明，给 LLM 的提示 */
  description: string;
}

export const travelSlots: SlotDefinition[] = [
  {
    name: "travelers",
    label: "出行人",
    weight: 5,
    blocking: true,
    description: "人数、年龄结构（是否有老人/小孩）、关系（独行/情侣/家庭/朋友）",
  },
  {
    name: "origin",
    label: "出发地",
    weight: 4,
    blocking: true,
    description: "用户从哪个城市出发，决定交通方式（高铁/飞机/自驾）",
  },
  {
    name: "dates",
    label: "出行日期与天数",
    weight: 5,
    blocking: true,
    description: "出发日期、回程日期、总天数；季节决定可选景点",
  },
  {
    name: "budget",
    label: "预算档位",
    weight: 4,
    blocking: false,
    description: "经济(<3k) / 舒适(3~8k) / 高端(>8k)，决定住宿与餐饮档次",
  },
  {
    name: "preferences",
    label: "兴趣偏好",
    weight: 3,
    blocking: false,
    description: "历史文化 / 自然风光 / 美食 / 购物 / 打卡拍照 等",
  },
  {
    name: "dietary",
    label: "饮食约束",
    weight: 2,
    blocking: false,
    description: "饮食禁忌、偏好菜系、是否素食/清真",
  },
  {
    name: "mobility",
    label: "体力与无障碍",
    weight: 3,
    blocking: false,
    description: "日均步数、是否有行动受限、是否需要无障碍设施",
  },
  {
    name: "constraints",
    label: "其他约束",
    weight: 2,
    blocking: false,
    description: "宠物随行、必须避开的时段、特殊目的（如看演唱会）",
  },
];

/** 把槽位定义格式化成给 LLM 的提示文本 */
export function formatSlotsForPrompt(slots: SlotDefinition[]): string {
  return slots
    .map(
      (s) =>
        `- ${s.name}（${s.label}）[权重${s.weight}${s.blocking ? ", 必填" : ""}]: ${s.description}`,
    )
    .join("\n");
}
