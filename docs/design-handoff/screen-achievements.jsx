/* global React, StatusBar, BreedTile, IconChevL, IconStar, IconLock */

const ACHIEVEMENTS = [
  // common
  { name: "中华田园猫", rarity: "common", cond: "首次完成专注", unlocked: true, progress: 1 },
  { name: "狸花猫",     rarity: "common", cond: "累计专注 ≥ 10 小时", unlocked: true, progress: 1 },
  { name: "三花猫",     rarity: "common", cond: "完成 7 天打卡", unlocked: true, progress: 1 },
  { name: "橘猫",       rarity: "common", cond: "单日 ≥ 3 小时", unlocked: false, progress: 0.7 },
  // rare
  { name: "暹罗猫",     rarity: "rare", cond: "连签 14 天", unlocked: true, progress: 1 },
  { name: "英短",       rarity: "rare", cond: "六科都打卡过", unlocked: true, progress: 1 },
  { name: "美短",       rarity: "rare", cond: "累计 ≥ 100 小时", unlocked: false, progress: 0.86 },
  // epic
  { name: "布偶猫",     rarity: "epic", cond: "≥ 45 分钟 × 连签 7 天", unlocked: true, progress: 1 },
  { name: "缅因猫",     rarity: "epic", cond: "单日 ≥ 6 小时", unlocked: false, progress: 0.55 },
  // legendary
  { name: "无毛猫",     rarity: "legendary", cond: "连签 100 天", unlocked: false, progress: 0.14 },
  { name: "金渐层",     rarity: "legendary", cond: "通过 CPA 综合", unlocked: false, progress: 0 },
];

const RARITY_LABEL = { common: "普通", rare: "稀有", epic: "史诗", legendary: "传说" };
const RARITY_COLOR = {
  common: "var(--c-rarity-common)",
  rare: "var(--c-rarity-rare)",
  epic: "var(--c-rarity-epic)",
  legendary: "var(--c-rarity-legendary)",
};

function AchievementTile({ a }) {
  const color = RARITY_COLOR[a.rarity];
  return (
    <div className="card" style={{
      padding: 14, position: "relative",
      filter: a.unlocked ? "none" : "grayscale(0.85)",
      opacity: a.unlocked ? 1 : 0.62,
    }}>
      {/* rarity corner badge */}
      {a.unlocked && (a.rarity === "epic" || a.rarity === "legendary") && (
        <span style={{
          position: "absolute", top: 8, right: 8,
          width: 18, height: 18, borderRadius: 9,
          background: color, color: "#fff",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>
          <IconStar size={10}/>
        </span>
      )}
      {!a.unlocked && (
        <span style={{
          position: "absolute", top: 8, right: 8,
          color: "var(--c-text-3)",
        }}>
          <IconLock size={12}/>
        </span>
      )}

      <BreedTile name={a.name} rarity={a.rarity} locked={!a.unlocked} size={88}/>
      <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700 }}>{a.name}</div>
      <div className="caption" style={{ marginTop: 2, lineHeight: 1.4 }}>{a.cond}</div>
      {!a.unlocked && (
        <div className="bar" style={{ marginTop: 8 }}>
          <i style={{ width: `${a.progress * 100}%`, background: color }}/>
        </div>
      )}
    </div>
  );
}

function Achievements() {
  const unlocked = ACHIEVEMENTS.filter(a => a.unlocked).length;
  const groups = ["common", "rare", "epic", "legendary"];

  return (
    <div className="app" data-screen-label="07 Achievement wall">
      <StatusBar />
      <header style={{ height: 44, padding: "0 8px", display: "flex", alignItems: "center" }}>
        <button style={{
          width: 36, height: 36, border: 0, background: "transparent",
          color: "var(--c-text-1)", cursor: "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>
          <IconChevL size={20}/>
        </button>
        <span style={{ fontSize: 14, fontWeight: 600 }}>成就</span>
      </header>

      <main style={{ height: "calc(100% - 44px - 44px)", overflowY: "auto", paddingBottom: 32 }}>
        {/* Hero */}
        <section className="page-pad fade-up" style={{ padding: "8px 16px 28px" }}>
          <div className="micro" style={{ marginBottom: 6 }}>已解锁</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span className="num" style={{ fontSize: 48, fontWeight: 800, color: "var(--c-primary)", letterSpacing: -1.5, lineHeight: 1 }}>
              {unlocked}
            </span>
            <span className="num" style={{ fontSize: 18, color: "var(--c-text-3)", fontWeight: 800 }}>
              / {ACHIEVEMENTS.length}
            </span>
          </div>
          <div className="caption" style={{ marginTop: 4 }}>
            最近解锁 · <span style={{ color: "var(--c-rarity-epic)", fontWeight: 700 }}>布偶猫</span>
          </div>
        </section>

        {/* Groups */}
        {groups.map(g => {
          const items = ACHIEVEMENTS.filter(a => a.rarity === g);
          if (items.length === 0) return null;
          const gotten = items.filter(a => a.unlocked).length;
          return (
            <section key={g} className="page-pad" style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: 4,
                    background: RARITY_COLOR[g],
                  }}/>
                  {RARITY_LABEL[g]}
                </span>
                <span className="num caption" style={{ fontWeight: 600 }}>
                  {gotten} / {items.length}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {items.map(a => <AchievementTile key={a.name} a={a}/>)}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}

Object.assign(window, { Achievements });
