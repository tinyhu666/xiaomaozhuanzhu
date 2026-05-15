/**
 * 小猫花园 — turn the user's completed-session history into a grid
 * of collectible cats. Pure client-side derivation: there's no
 * server-side "cats" table; we deterministically map each session
 * to a cat variant. So a user can reload the page and see the
 * same garden, but no new schema is needed and no extra writes
 * happen during a session.
 *
 * Design choices
 * ==============
 *
 * Subject → cat persona
 *   Each of the 6 CPA subjects maps to a themed cat:
 *     会计 → 算盘猫 (abacus)
 *     审计 → 望远镜猫 (telescope)
 *     税法 → 印章猫 (chop)
 *     财管 → 账簿猫 (ledger)
 *     经济法 → 法槌猫 (gavel)
 *     战略 → 棋盘猫 (chessboard)
 *   A session with no subject gets the "通用猫" variant (just a
 *   plain 🐱 with no accessory).
 *
 * Length / mode → rarity tier (visual frame)
 *   - common  : <30 min free session, no special border
 *   - rare    : 30–120 min free session OR pomodoro with <4 cycles
 *               → soft mint glow border
 *   - epic    : >120 min free session OR pomodoro with ≥4 cycles
 *               → amber border + 🌟 corner star
 *   - legendary: pomodoro with ≥8 cycles (a full 4h+ pomodoro set)
 *               → gold border + 👑 crown corner
 *
 * Why this scheme: the rarity reflects effort honestly. A 25-min
 * cup-of-coffee session gets a common cat; a 4-cycle pomodoro set
 * gets epic; an 8-cycle "lock in for the afternoon" gets legendary.
 * The user can see at a glance what their best sessions looked
 * like without reading any numbers.
 */

import type { CompletedSession } from "./api";

export type CatRarity = "common" | "rare" | "epic" | "legendary";

export type CatSubject =
  | "会计"
  | "审计"
  | "税法"
  | "财管"
  | "经济法"
  | "战略"
  | "其它";

export type CatCard = {
  /** Stable ID = session ID; lets the garden survive re-fetches. */
  id: string;
  subject: CatSubject;
  rarity: CatRarity;
  /** The base emoji of the cat (subject-themed). */
  emoji: string;
  /** A short subject-accessory string (e.g. "算盘") to render under the cat. */
  accessory: string;
  /** Duration of the session in minutes, for the detail tooltip. */
  durationMinutes: number;
  /** Pomodoro count, 0 for free sessions. */
  pomodoroCycles: number;
  /** Shanghai-local date string for the detail tooltip. */
  dateText: string;
  /** True for pomodoro mode sessions, used to badge the card. */
  fromPomodoro: boolean;
};

export type GardenStats = {
  total: number;
  byRarity: Record<CatRarity, number>;
  bySubject: Record<CatSubject, number>;
};

export type GardenViewModel = {
  cats: CatCard[];
  stats: GardenStats;
};

const SUBJECT_THEME: Record<CatSubject, { emoji: string; accessory: string }> = {
  会计:    { emoji: "🐱", accessory: "算盘" },
  审计:    { emoji: "😼", accessory: "望远镜" },
  税法:    { emoji: "😺", accessory: "印章" },
  财管:    { emoji: "😸", accessory: "账簿" },
  经济法:  { emoji: "😻", accessory: "法槌" },
  战略:    { emoji: "🐈", accessory: "棋盘" },
  其它:    { emoji: "🐈‍⬛", accessory: "—" }
};

const RARITY_LABEL: Record<CatRarity, string> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说"
};

const KNOWN_SUBJECTS: CatSubject[] = ["会计", "审计", "税法", "财管", "经济法", "战略"];

function toCatSubject(value: string | null): CatSubject {
  if (!value) return "其它";
  return KNOWN_SUBJECTS.includes(value as CatSubject) ? (value as CatSubject) : "其它";
}

function deriveRarity(session: CompletedSession): CatRarity {
  if (session.mode === "pomodoro" && session.pomodoroCycles >= 8) return "legendary";
  if (session.mode === "pomodoro" && session.pomodoroCycles >= 4) return "epic";
  if (session.durationMinutes > 120) return "epic";
  if (session.mode === "pomodoro" && session.pomodoroCycles >= 1) return "rare";
  if (session.durationMinutes >= 30) return "rare";
  return "common";
}

function formatDateText(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const shifted = new Date(d.getTime() + 8 * 3600 * 1000);
    const y = shifted.getUTCFullYear();
    const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
    const day = String(shifted.getUTCDate()).padStart(2, "0");
    return `${y}.${m}.${day}`;
  } catch {
    return "";
  }
}

/**
 * Build a single CatCard from session-completion data, without
 * needing a full sessions list. Used by the complete-page cat
 * reveal: the moment a user finishes打卡 we already know everything
 * needed to derive what cat they just earned, so we can show it
 * immediately instead of waiting for them to navigate to the garden.
 *
 * The input shape mirrors what the complete page has on hand:
 *   - sessionId from the route query
 *   - subject from the selected chip (or null)
 *   - durationMinutes from the route query ("minutes")
 *   - pomodoroCycles from the route query ("cycles")
 * Derivation rules match buildGarden so a cat shown here will be
 * the same cat shown in the garden grid.
 */
export function previewCatForSession(input: {
  sessionId: string;
  subject: string | null;
  durationMinutes: number;
  pomodoroCycles: number;
}): CatCard {
  const synthetic: CompletedSession = {
    id: input.sessionId,
    subject: input.subject,
    mode: input.pomodoroCycles > 0 ? "pomodoro" : "free",
    durationMinutes: input.durationMinutes,
    pomodoroCycles: input.pomodoroCycles,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString()
  };
  const subject = toCatSubject(synthetic.subject);
  const theme = SUBJECT_THEME[subject];
  return {
    id: synthetic.id,
    subject,
    rarity: deriveRarity(synthetic),
    emoji: theme.emoji,
    accessory: theme.accessory,
    durationMinutes: synthetic.durationMinutes,
    pomodoroCycles: synthetic.pomodoroCycles,
    dateText: formatDateText(synthetic.endedAt),
    fromPomodoro: synthetic.mode === "pomodoro"
  };
}

export function buildGarden(sessions: CompletedSession[]): GardenViewModel {
  const cats: CatCard[] = sessions
    // Garden ordered newest-first so the latest-earned cat is what
    // the user sees first. Server already filters to completed.
    .slice()
    .sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""))
    .map((session) => {
      const subject = toCatSubject(session.subject);
      const theme = SUBJECT_THEME[subject];
      const rarity = deriveRarity(session);
      return {
        id: session.id,
        subject,
        rarity,
        emoji: theme.emoji,
        accessory: theme.accessory,
        durationMinutes: session.durationMinutes,
        pomodoroCycles: session.pomodoroCycles,
        dateText: formatDateText(session.endedAt),
        fromPomodoro: session.mode === "pomodoro"
      };
    });

  const stats: GardenStats = {
    total: cats.length,
    byRarity: { common: 0, rare: 0, epic: 0, legendary: 0 },
    bySubject: {
      会计: 0, 审计: 0, 税法: 0, 财管: 0, 经济法: 0, 战略: 0, 其它: 0
    }
  };
  for (const cat of cats) {
    stats.byRarity[cat.rarity] += 1;
    stats.bySubject[cat.subject] += 1;
  }

  return { cats, stats };
}

export function rarityLabel(rarity: CatRarity): string {
  return RARITY_LABEL[rarity];
}

/* -------------------------------------------------------------------------- */
/*  Milestones                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Counts at which we want to celebrate. Picked to feel evenly spaced
 * across realistic study volumes — daily 1-session users hit 10 in
 * ~10 days, 30 in a month, 100 in ~3 months. 200 acknowledges a
 * dedicated multi-month run.
 */
export const GARDEN_MILESTONES: readonly number[] = [10, 30, 50, 100, 200] as const;

const STORAGE_LAST_MILESTONE_KEY = "cpa.garden.lastMilestoneSeen";

export type MilestoneEvent = {
  /** The milestone count just crossed (e.g. 30). */
  milestone: number;
  /** A celebratory headline localized for that milestone. */
  title: string;
  /** Subhead text — encouraging next-step nudge. */
  subtitle: string;
};

const MILESTONE_COPY: Record<number, { title: string; subtitle: string }> = {
  10:  { title: "10 只小猫到手", subtitle: "已经迈出第一阶，节奏稳了再加把劲。" },
  30:  { title: "30 只啦", subtitle: "一个月的努力浓缩在这里，别停。" },
  50:  { title: "50 只，半百达成", subtitle: "你已经走在 CPA 大多数考生的前面。" },
  100: { title: "100 只，破百了", subtitle: "厚积薄发。下一只史诗就在路上。" },
  200: { title: "200 只，专注达人", subtitle: "你的花园已经能开个小型动物园了。" }
};

/**
 * Returns the milestone event for the current total IF the user has
 * just crossed a milestone they haven't seen before. Otherwise null.
 *
 * Side effect: writes the new total to storage so subsequent calls
 * with the same `total` return null. (We intentionally use the
 * actual total, not just the milestone number, so re-opening the
 * page at total=10 doesn't refire — only when total grows past a
 * previously-uncelebrated milestone.)
 */
export function consumeMilestoneEvent(total: number): MilestoneEvent | null {
  let lastSeen = 0;
  try {
    const raw = Number(wx.getStorageSync(STORAGE_LAST_MILESTONE_KEY));
    if (Number.isFinite(raw) && raw > 0) lastSeen = raw;
  } catch (_) { /* storage failures are non-fatal */ }

  if (total <= lastSeen) {
    // No new growth since last check — nothing to celebrate.
    return null;
  }

  // Find the largest milestone the user has crossed but hasn't seen.
  // Scanning in descending order so a user who jumps from 8 → 35
  // (e.g. backfill / multiple sessions) gets the 30 celebration,
  // not 10. They've "earned" 30 worth of grind in one go.
  let crossed: number | null = null;
  for (let i = GARDEN_MILESTONES.length - 1; i >= 0; i -= 1) {
    const m = GARDEN_MILESTONES[i];
    if (total >= m && lastSeen < m) {
      crossed = m;
      break;
    }
  }

  // Always persist the current total so future opens know what we've
  // shown — even when no celebration fired (lastSeen has now moved
  // up so we don't fire the same milestone twice).
  try {
    wx.setStorageSync(STORAGE_LAST_MILESTONE_KEY, total);
  } catch (_) { /* ignore */ }

  if (crossed === null) return null;
  const copy = MILESTONE_COPY[crossed];
  return {
    milestone: crossed,
    title: copy.title,
    subtitle: copy.subtitle
  };
}

/**
 * Test seam: reset the cached milestone counter. Vitest tests for
 * consumeMilestoneEvent use this between cases.
 */
export function __resetMilestoneStorageForTests() {
  try { wx.removeStorageSync(STORAGE_LAST_MILESTONE_KEY); } catch (_) { /* ignore */ }
}
