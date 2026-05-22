/* global React, StatusBar, TabBar, SubjectBar, IconPlay, IconPause, IconStop, IconChevR, IconFlame */

// ─────────────────────────────────────────────────────────────
// HOME · IDLE  (light mode)
// ─────────────────────────────────────────────────────────────
function HomeIdle() {
  const [target, setTarget] = React.useState("3h");
  const targets = ["1h", "2h", "3h", "4h"];
  const progressMin = 92; // 1h32m so far → 51% of 3h
  const pct = Math.round(progressMin / 180 * 100);

  return (
    <div className="app" data-screen-label="01 Home idle">
      <StatusBar />
      <main style={{ paddingBottom: 96, height: "calc(100% - 44px)", overflowY: "auto" }}>
        {/* page title row */}
        <header className="page-pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "8px 16px 24px" }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: -0.4 }}>
            小猫专注
          </h1>
          <span className="caption" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <IconFlame size={12} />
            <span className="num">连续 14 天</span>
          </span>
        </header>

        {/* Exam countdown Hero — no card, full-bleed text on bg */}
        <section className="page-pad fade-up" style={{ marginBottom: 28 }}>
          <div className="micro" style={{ marginBottom: 4 }}>CPA 综合阶段</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="num" style={{ fontSize: 56, fontWeight: 800, color: "var(--c-primary)", lineHeight: 1 }}>84</span>
            <span style={{ fontSize: 14, color: "var(--c-text-2)", fontWeight: 600 }}>天</span>
          </div>
          <div className="caption" style={{ marginTop: 4 }}>距 2026 年 8 月 16 日</div>
        </section>

        {/* Timer card */}
        <section className="page-pad" style={{ marginBottom: 24 }}>
          <div className="card fade-up" style={{ padding: "28px 20px 22px", textAlign: "center" }}>
            <div className="micro" style={{ marginBottom: 6 }}>今日已专注</div>
            <div className="num" style={{ fontSize: 48, fontWeight: 800, letterSpacing: -1.5, color: "var(--c-text-1)", lineHeight: 1 }}>
              01:32:18
            </div>
            <div className="caption" style={{ marginTop: 6, marginBottom: 18 }}>会计 · 审计 · 财管</div>
            <button className="btn btn-primary" style={{ width: "100%", height: 48, fontSize: 15 }}>
              <IconPlay size={16}/> 开始专注
            </button>
          </div>
        </section>

        {/* Today goal + challenge */}
        <section className="page-pad" style={{ marginBottom: 24 }}>
          <div className="card" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>今日目标</span>
              <span className="num caption" style={{ fontWeight: 600 }}>
                <span style={{ color: "var(--c-primary)", fontWeight: 800 }}>1h 32m</span>
                <span style={{ color: "var(--c-text-3)" }}> / {target}</span>
              </span>
            </div>
            <div className="bar" style={{ marginBottom: 14 }}><i style={{ width: `${pct}%` }}/></div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {targets.map(t => (
                <button key={t}
                  className={`chip ${t === target ? "active" : ""}`}
                  onClick={() => setTarget(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Six-subject mini bars */}
        <section className="page-pad" style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>六科进度</span>
            <button style={{ background: "none", border: 0, padding: 0, display: "inline-flex", alignItems: "center", color: "var(--c-text-2)", fontSize: 11, cursor: "pointer", gap: 2 }}>
              查看 <IconChevR size={11}/>
            </button>
          </div>
          <div className="card" style={{ padding: 18, display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 14, columnGap: 20 }}>
            <SubjectBar name="会计"   pct={62} hours={48} />
            <SubjectBar name="审计"   pct={41} hours={32} />
            <SubjectBar name="财管"   pct={55} hours={43} />
            <SubjectBar name="经济法" pct={28} hours={22} />
            <SubjectBar name="税法"   pct={36} hours={28} />
            <SubjectBar name="战略"   pct={18} hours={14} />
          </div>
        </section>
      </main>
      <TabBar active="home" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// HOME · FOCUS MODE  (dark, breathing, interactive)
// ─────────────────────────────────────────────────────────────
function HomeFocus() {
  const [elapsed, setElapsed] = React.useState(27 * 60 + 14); // 27:14
  const [running, setRunning] = React.useState(true);
  React.useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  const fmt = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  };

  return (
    <div className="app dark" data-screen-label="02 Focus mode">
      <StatusBar dark />
      <div className="focus-halo" />

      <main style={{ position: "absolute", inset: 0, paddingTop: 44, display: "flex", flexDirection: "column" }}>
        {/* meta row (caption only) */}
        <div className="page-pad" style={{ display: "flex", justifyContent: "center", paddingTop: 16, paddingBottom: 0 }}>
          <div className="caption" style={{ color: "var(--c-text-2-dark)", display: "inline-flex", gap: 14 }}>
            <span><span className="num" style={{ fontWeight: 700, color: "var(--c-text-1-dark)" }}>92</span> 分钟 · 今日</span>
            <span style={{ opacity: 0.5 }}>|</span>
            <span><span className="num" style={{ fontWeight: 700, color: "var(--c-text-1-dark)" }}>14</span> 天连签</span>
          </div>
        </div>

        {/* central display */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingInline: 12 }}>
          <div className="micro" style={{ color: "var(--c-accent)", marginBottom: 20, letterSpacing: 0.2 }}>
            会计 · 第 3 节
          </div>
          <div className={running ? "breathe num" : "num"} style={{
            fontSize: 64, fontWeight: 800, letterSpacing: -2,
            color: "var(--c-text-1-dark)",
            lineHeight: 1, whiteSpace: "nowrap",
          }}>
            {fmt(elapsed)}
          </div>
          <div className="caption" style={{ marginTop: 18, color: "var(--c-text-2-dark)" }}>
            开始于 09:14 · 已专注 {Math.floor(elapsed / 60)} 分钟
          </div>
        </div>

        {/* bottom controls */}
        <div style={{ paddingInline: 24, paddingBottom: "calc(env(safe-area-inset-bottom) + 36px)", display: "flex", gap: 12 }}>
          <button className="btn btn-ghost" style={{ flex: 1, height: 52 }} onClick={() => setRunning(r => !r)}>
            {running ? <><IconPause size={16}/> 暂停</> : <><IconPlay size={16}/> 继续</>}
          </button>
          <button className="btn btn-primary" style={{ flex: 1, height: 52, background: "var(--c-accent)" }}>
            <IconStop size={14}/> 结束
          </button>
        </div>
      </main>
      {/* Tab bar is HIDDEN in focus mode — intentionally absent */}
    </div>
  );
}

Object.assign(window, { HomeIdle, HomeFocus });
