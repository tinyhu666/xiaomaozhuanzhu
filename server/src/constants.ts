export const SUBJECTS = ["会计", "审计", "税法", "财管", "经济法", "战略"] as const;
export const TAGS = ["顺利", "卡住", "高效", "复习", "刷题", "新课"] as const;

export type Subject = (typeof SUBJECTS)[number];
export type SessionTag = (typeof TAGS)[number];

export const SHANGHAI_OFFSET_MINUTES = 8 * 60;

// CPA 推荐学时（分钟），基于六科官方建议总学时分布
export const SUBJECT_TARGET_MINUTES: Record<Subject, number> = {
  "会计": 280 * 60,
  "审计": 220 * 60,
  "税法": 200 * 60,
  "财管": 220 * 60,
  "经济法": 160 * 60,
  "战略": 140 * 60
};

