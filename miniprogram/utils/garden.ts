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
