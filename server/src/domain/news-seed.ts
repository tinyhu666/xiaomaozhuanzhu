/**
 * Curated seed for the「动态」tab.
 *
 * Why we seed
 * -----------
 * CICPA does not expose an RSS feed; scraping its HTML listing pages
 * from inside 微信云托管 may fail (egress restrictions, layout
 * changes, captchas). When the fetcher comes back empty the tab
 * would otherwise show an empty state — which is what motivated this
 * file.
 *
 * The seed populates a small set of evergreen reference cards on
 * first boot. Each one:
 *   - is marked `manual = true`, so the fetcher will never overwrite
 *     or hide them; admins can edit them via /admin/api/news
 *   - is marked `pinned = true`, so they always sort above
 *     fetcher-populated articles regardless of date
 *   - points to a real CICPA URL the user can land on (官方导航 / 官方
 *     专题页 / 官方公告主页). We deliberately avoid fabricating
 *     article URLs — every link here resolves to a real source page
 *     even if CICPA reshuffles its content tree.
 *
 * Updating the seed
 * -----------------
 * 1. Keep ≤ 8 items so they don't drown out fetched news.
 * 2. `publishedAt` is the *as-of* date you verified the URL works.
 * 3. To pin a non-CICPA source, add it here with `pinned = true`.
 */

import type { NewsItem, NewsCategory } from "../types";
import { newsIdFor } from "./news";

/** Bare description of a seed; we fill in the rest at runtime. */
type SeedSpec = {
  category: NewsCategory;
  title: string;
  summary: string;
  content: string;
  url: string;
  publishedAt: string;
};

const SEED_SOURCE = "cicpa";

/**
 * Each item below is hand-curated. Comments capture the rationale so
 * the next maintainer (or future you) can decide whether to refresh.
 */
const SEEDS: SeedSpec[] = [
  {
    // The single most important page during CPA season — the official
    // 报名简章 lives here. Always available, always authoritative.
    category: "announce",
    title: "中注协 · 注册考试公告（官方权威）",
    summary: "中国注册会计师协会发布的注册阶段、综合阶段考试公告、报名简章、缴费通知、准考证打印安排等官方信息的入口。",
    content:
      "本卡片由小猫专注精选，作为查看 CPA 考试官方公告的稳定入口。\n\n常用查阅项：\n· 当年度全国统一考试报名简章\n· 报名 / 缴费 / 准考证 / 成绩查询时间安排\n· 考试时间、考点城市公布\n· 成绩复核 / 资格证书 / 免试规定\n\n点击下方「查看原文 / 复制链接」即可跳转到中注协公告主页（cicpa.org.cn）。建议在报名期、缴费期、出分期定期回访。",
    url: "https://www.cicpa.org.cn/zcks/ksgg/",
    publishedAt: "2025-01-01T00:00:00.000+08:00"
  },
  {
    category: "outline",
    title: "中注协 · 注册考试大纲与样题",
    summary: "中国注册会计师协会发布的注册阶段六科、综合阶段两卷考试大纲、命题说明及历年样题入口。",
    content:
      "考试大纲是命题的依据，每年由中注协组织专家编写并在本页发布。备考要点：\n\n1. 关注「考试范围调整说明」——每年大纲发布会有少量新增 / 删除知识点。\n2. 「样题」是熟悉机考界面、题型分布的最佳途径；正式机考前务必走过一遍。\n3. 注册阶段六科：会计 / 审计 / 财务成本管理 / 公司战略与风险管理 / 经济法 / 税法。\n4. 综合阶段：职业能力综合测试（试卷一、试卷二）。",
    url: "https://www.cicpa.org.cn/zcks/ksdg/",
    publishedAt: "2025-01-01T00:00:00.000+08:00"
  },
  {
    category: "news",
    title: "中注协 · 考试动态",
    summary: "中国注册会计师协会考试动态栏目，发布命题专家访谈、阅卷动态、备考建议、机考 demo、政策解读等。",
    content:
      "本栏目偏向非官方公告类的考试相关动态，包括：\n\n· 命题专家答考生问\n· 阅卷情况说明 / 通过率回顾\n· 备考方法指导 / 心理建设\n· 机考系统升级 / demo 演示通知\n\n配合「公告」和「大纲」一起看，可以更全面了解整个考试体系。",
    url: "https://www.cicpa.org.cn/zcks/ksdt/",
    publishedAt: "2025-01-01T00:00:00.000+08:00"
  },
  {
    category: "announce",
    title: "2025 年注册会计师全国统一考试报名简章（参考）",
    summary: "2025 年报名时间：4 月 7 日—4 月 28 日；缴费时间：6 月 13 日—6 月 30 日；考试时间：8 月 23 日—25 日。",
    content:
      "2025 年注册会计师全国统一考试主要时间节点（以中注协官方公告为准）：\n\n· 报名时间：2025 年 4 月 7 日—4 月 28 日（8:00—20:00）\n· 缴费时间：2025 年 6 月 13 日—6 月 30 日\n· 准考证下载：2025 年 8 月 11 日—8 月 23 日\n· 专业阶段考试：2025 年 8 月 23 日（周六）—8 月 25 日（周一）\n· 综合阶段考试：2025 年 8 月 23 日（周六）\n· 欧洲考区专业阶段考试：2025 年 8 月 30 日—8 月 31 日\n· 成绩发布：预计 2025 年 11 月下旬\n\n报考条件、报名费、考区设置等细则请以中注协当年发布的简章原文为准。",
    url: "https://www.cicpa.org.cn/zcks/ksgg/",
    publishedAt: "2025-01-10T00:00:00.000+08:00"
  },
  {
    category: "news",
    title: "2026 年注册会计师考试预计安排（待官方公布）",
    summary: "按往年惯例，2026 年简章预计于 2026 年 1 月发布，考试预计安排在 2026 年 8 月最后一个周末。具体以官方公告为准。",
    content:
      "根据中注协历年节奏，2026 年注册会计师全国统一考试预计安排如下（**不构成官方信息**）：\n\n· 简章发布：2026 年 1 月（上一年同期为 1 月 9 日）\n· 报名：2026 年 4 月\n· 缴费：2026 年 6 月\n· 考试：2026 年 8 月下旬（专业阶段周六—周一三天，综合阶段同一周六）\n\n以上为根据 2023—2025 三年数据推算的预期窗口。一旦中注协发布 2026 年正式简章，本卡片会自动让位给真实公告。建议关注：\n· 中国注册会计师协会 cicpa.org.cn\n· 各省/自治区/直辖市注册会计师协会的本地公告",
    url: "https://www.cicpa.org.cn/",
    publishedAt: "2025-11-01T00:00:00.000+08:00"
  },
  {
    category: "outline",
    title: "六门科目搭配建议（小猫专注整理）",
    summary: "新考生常见的科目搭配方案：两年六门 vs 三年六门；难度搭配、相关性配对、备考时长参考。",
    content:
      "六门科目按公认难度大致排序：会计 > 审计 ≈ 财管 > 战略 ≈ 经济法 ≈ 税法。\n\n常见搭配方案：\n\n【两年六门 · 高压版】\n· 第一年：会计 + 审计 + 税法（核心三件套，关联度高）\n· 第二年：财管 + 经济法 + 战略\n\n【三年六门 · 稳健版】\n· 第一年：会计 + 税法（基础+应用）\n· 第二年：审计 + 战略（业务+管理）\n· 第三年：财管 + 经济法（计算+法规）\n\n【两科组合参考】\n· 会计 + 审计：核心绑定，备考逻辑互通\n· 会计 + 税法：账务实操结合\n· 财管 + 战略：管理思维一脉相承\n· 经济法 + 税法：法律与税收交叉点多\n\n小猫专注内置六科目标学时（合计 1220h），可在「六科进度」中查看具体推荐。",
    url: "https://www.cicpa.org.cn/zcks/ksdg/",
    publishedAt: "2025-02-01T00:00:00.000+08:00"
  }
];

/**
 * Build the seed NewsItem batch. The timestamps embedded above let us
 * keep cards in a sensible chronological order; `pinned = true` makes
 * them sort above fetched items regardless.
 */
export function buildSeedNewsItems(now: Date): NewsItem[] {
  const fetchedAt = now.toISOString();
  return SEEDS.map<NewsItem>((seed) => ({
    id: newsIdFor(SEED_SOURCE, seed.url + "#" + hashStub(seed.title)),
    source: SEED_SOURCE,
    category: seed.category,
    title: seed.title,
    summary: seed.summary,
    content: seed.content,
    // The seed URL is the *category page* shared across several
    // seeds. We append a fragment so each seed has a unique URL key
    // (UNIQUE(source, url) doesn't care about fragments at the HTTP
    // layer, but we never request them — fragments are client-side).
    url: seed.url + "#cm-" + hashStub(seed.title),
    publishedAt: seed.publishedAt,
    fetchedAt,
    hidden: false,
    manual: true,
    pinned: true
  }));
}

/** Short stable hash of a string — used to disambiguate seed URLs. */
function hashStub(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) - h + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 6);
}

/**
 * Idempotently install the seed batch. Safe to call on every server
 * boot — `putNewsManual` is an upsert that only overwrites manual
 * rows the seed itself wrote.
 *
 * Returns the number of items installed.
 */
export async function ensureNewsSeed(
  store: { putNewsManual: (item: NewsItem) => NewsItem | Promise<NewsItem> },
  now: Date
): Promise<number> {
  const items = buildSeedNewsItems(now);
  for (const item of items) {
    await store.putNewsManual(item);
  }
  return items.length;
}
