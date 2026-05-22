/* global React, StatusBar, TabBar, IconChevR, IconTrophy, IconBook, IconBell, IconChart */

function StatTile({ label, value, unit }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="caption" style={{ marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
        <span className="num" style={{ fontSize: 24, fontWeight: 800, color: "var(--c-primary)", letterSpacing: -0.5, lineHeight: 1 }}>
          {value}
        </span>
        {unit && <span className="caption" style={{ fontWeight: 600 }}>{unit}</span>}
      </div>
    </div>
  );
}

function MenuRow({ Icon, label, hint, last }) {
  return (
    <button style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "14px 16px", border: 0, background: "transparent",
      width: "100%", textAlign: "left", cursor: "pointer",
      borderBottom: last ? "0" : "1px solid var(--c-stroke)",
      transition: "background 100ms var(--ease-std)",
    }}
    onMouseDown={(e) => e.currentTarget.style.background = "rgba(20,60,50,0.03)"}
    onMouseUp={(e) => e.currentTarget.style.background = "transparent"}
    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
    >
      <span style={{
        width: 32, height: 32, borderRadius: 8,
        background: "var(--c-soft-mint)", color: "var(--c-primary)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        flex: "0 0 32px",
      }}>
        <Icon size={16}/>
      </span>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{label}</span>
      {hint && <span className="caption" style={{ fontWeight: 600 }}>{hint}</span>}
      <IconChevR size={14} style={{ color: "var(--c-text-3)" }}/>
    </button>
  );
}

function Profile() {
  return (
    <div className="app" data-screen-label="04 Profile">
      <StatusBar />
      <main style={{ paddingBottom: 96, height: "calc(100% - 44px)", overflowY: "auto" }}>
        {/* User card */}
        <section className="page-pad fade-up" style={{ padding: "16px 16px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div className="avatar">阿七</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 2 }}>阿七</div>
              <div className="caption">
                <span className="num">2025-11-04</span> 加入 · 第 <span className="num" style={{ fontWeight: 700, color: "var(--c-primary)" }}>2</span> 次报考
              </div>
            </div>
            <button className="chip" style={{ height: 30 }}>主页</button>
          </div>
        </section>

        {/* 2×2 stat grid */}
        <section className="page-pad" style={{ marginBottom: 24 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <StatTile label="累计学习" value="186" unit="小时"/>
            <StatTile label="完成打卡" value="83" unit="次"/>
            <StatTile label="最长连签" value="22" unit="天"/>
            <StatTile label="单日最长" value="4:32" unit="时长"/>
          </div>
        </section>

        {/* Menu */}
        <section className="page-pad" style={{ marginBottom: 24 }}>
          <div className="card" style={{ padding: "4px 0" }}>
            <MenuRow Icon={IconTrophy} label="成就" hint="6 / 11" />
            <MenuRow Icon={IconBook} label="六科进度" hint="48% 平均" />
            <MenuRow Icon={IconBell} label="学习设置" />
            <MenuRow Icon={IconChart} label="学习日报" last />
          </div>
        </section>

        {/* Footer version */}
        <div className="micro" style={{ textAlign: "center", marginTop: 16, color: "var(--c-text-3)" }}>
          小猫专注 · v0.25.2
        </div>
      </main>
      <TabBar active="profile"/>
    </div>
  );
}

Object.assign(window, { Profile });
