// @ts-nocheck
import type { Badge, BadgeRarity, ProfileDashboardResponse } from "../../types/models";
import { getProfileDashboard } from "../../utils/api";
import { formatDuration } from "../../utils/view-models";

/**
 * v0.21 — 「成就小猫」 page.
 *
 * Each badge is a cat breed unlocked by a specific achievement.
 * The page has three blocks now:
 *   1. Hero — N/M unlocked headline
 *   2. Rarity-grouped grid of breed cards (common → rare → epic →
 *      legendary), greyscale until unlocked
 *   3. 成就说明 (achievement guide) — a compact list explaining
 *      "complete X → earn the Y cat"; users tap to expand
 */

type BadgeView = Badge & {
  /** Rarity is added in v0.21 — fall back to "common" for any rows
   *  that arrive from an unmigrated server. */
  rarity: BadgeRarity;
  progressPct: number;
  progressText: string;
  rarityLabel: string;
};

type GuideRow = {
  icon: string;
  name: string;
  description: string;
  rarity: BadgeRarity;
  rarityLabel: string;
  unlocked: boolean;
};

type BadgesPageData = {
  /** Grouped by rarity for the visual ladder. */
  groups: Array<{
    rarity: BadgeRarity;
    rarityLabel: string;
    badges: BadgeView[];
  }>;
  guide: GuideRow[];
  /** Toggleable — folded by default so the grid is the eye-catcher. */
  guideOpen: boolean;
  unlockedCount: number;
  totalCount: number;
};

const RARITY_LABEL: Record<BadgeRarity, string> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说"
};

/**
 * Visual order for both the grid and the guide. Mint-blue-amber-gold
 * matches the cat-reveal modal language from v0.18 so the two
 * surfaces feel like one collection.
 */
const RARITY_ORDER: BadgeRarity[] = ["common", "rare", "epic", "legendary"];

Page<{}, BadgesPageData>({
  data: {
    groups: [],
    guide: [],
    guideOpen: false,
    unlockedCount: 0,
    totalCount: 0
  },

  async onLoad() {
    await this.refresh();
  },

  async onPullDownRefresh() {
    await this.refresh();
    wx.stopPullDownRefresh();
  },

  async refresh() {
    wx.showNavigationBarLoading();
    try {
      const dashboard = (await getProfileDashboard()) as ProfileDashboardResponse;
      const raw = (dashboard.badges || []) as Badge[];
      const badges: BadgeView[] = raw.map((b) => {
        const rarity: BadgeRarity = (b.rarity as BadgeRarity) || "common";
        return {
          ...b,
          rarity,
          rarityLabel: RARITY_LABEL[rarity],
          progressPct: Math.round((b.progress || 0) * 100),
          progressText: formatBadgeProgress(b)
        };
      });

      // Group by rarity in the canonical display order. Hide empty
      // tiers so a future build with no `legendary` badges doesn't
      // leave a phantom section header.
      const groups = RARITY_ORDER
        .map((rarity) => ({
          rarity,
          rarityLabel: RARITY_LABEL[rarity],
          badges: badges.filter((b) => b.rarity === rarity)
        }))
        .filter((g) => g.badges.length > 0);

      // Guide list: same canonical rarity order, flattened for
      // the "do X → get Y" expandable list.
      const guide: GuideRow[] = badges
        .slice()
        .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity))
        .map((b) => ({
          icon: b.icon,
          name: b.name,
          description: b.description,
          rarity: b.rarity,
          rarityLabel: b.rarityLabel,
          unlocked: b.unlocked
        }));

      this.setData({
        groups,
        guide,
        totalCount: badges.length,
        unlockedCount: badges.filter((b) => b.unlocked).length
      });
    } catch (error) {
      console.error("[badges] dashboard failed", error);
      wx.showToast({
        title: error instanceof Error ? error.message : "加载失败",
        icon: "none"
      });
    } finally {
      wx.hideNavigationBarLoading();
    }
  },

  onTapToggleGuide() {
    this.setData({ guideOpen: !this.data.guideOpen });
  }
});

function formatBadgeProgress(b: Badge): string {
  if (b.unlocked) return "已解锁";
  if (b.unit === "min") {
    return `${formatDuration(b.current)} / ${formatDuration(b.goal)}`;
  }
  return `${b.current} / ${b.goal} ${b.unit}`;
}
