export const SUBJECTS = ["会计", "审计", "税法", "财管", "经济法", "战略"] as const;
export const TAGS = ["顺利", "卡住", "高效", "复习", "刷题", "新课"] as const;

export type Subject = (typeof SUBJECTS)[number];
export type SessionTag = (typeof TAGS)[number];

export const SHANGHAI_OFFSET_MINUTES = 8 * 60;
