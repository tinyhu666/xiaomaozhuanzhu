/* global React, StatusBar, ImagePlaceholder, BreedTile, CatPhoto, IconChevL, IconCamera, IconPlus, IconClose, IconStar */

// ─────────────────────────────────────────────────────────────
// COMPLETE CHECK-IN form
// ─────────────────────────────────────────────────────────────
function CompleteCheckin() {
  const [subject, setSubject] = React.useState("会计");
  const [tags, setTags] = React.useState(new Set(["专注"]));
  const subjects = ["会计", "审计", "财管", "经济法", "税法", "战略"];
  const tagList = ["专注", "状态好", "瞌睡", "做题", "看书", "听课"];
  const toggleTag = (t) => {
    const next = new Set(tags);
    next.has(t) ? next.delete(t) : next.add(t);
    setTags(next);
  };

  return (
    <div className="app" data-screen-label="05 Complete check-in">
      <StatusBar />
      {/* nav */}
      <header style={{ height: 44, padding: "0 8px", display: "flex", alignItems: "center" }}>
        <button style={{
          width: 36, height: 36, border: 0, background: "transparent",
          color: "var(--c-text-1)", cursor: "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>
          <IconChevL size={20}/>
        </button>
        <span style={{ fontSize: 14, fontWeight: 600 }}>完成打卡</span>
      </header>

      <main style={{ height: "calc(100% - 44px - 44px - 88px)", overflowY: "auto", paddingBottom: 20 }}>
        {/* Hero — this session */}
        <section className="page-pad fade-up" style={{ padding: "12px 16px 28px" }}>
          <div className="micro" style={{ marginBottom: 6 }}>这次专注了</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span className="num" style={{ fontSize: 48, fontWeight: 800, color: "var(--c-primary)", lineHeight: 1, letterSpacing: -1.5 }}>
              52
            </span>
            <span style={{ fontSize: 16, color: "var(--c-text-2)", fontWeight: 600 }}>分钟</span>
            <span className="caption" style={{ marginLeft: 8 }}>09:14 – 10:06</span>
          </div>
        </section>

        {/* Photo */}
        <section className="page-pad" style={{ marginBottom: 24 }}>
          <div className="micro" style={{ marginBottom: 10 }}>照片 · 可选 0–3 张</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            <ImagePlaceholder h={92} label="study photo"/>
            <button style={{
              height: 92, borderRadius: 12, border: "1.5px dashed var(--c-stroke)",
              background: "transparent", color: "var(--c-text-3)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 4, fontSize: 11, cursor: "pointer",
            }}>
              <IconPlus size={18}/>
              加一张
            </button>
            <div/>
          </div>
        </section>

        {/* Summary */}
        <section className="page-pad" style={{ marginBottom: 24 }}>
          <div className="micro" style={{ marginBottom: 10 }}>一句话总结 · 可选</div>
          <div className="card" style={{ padding: "12px 14px" }}>
            <textarea
              defaultValue="把第六章金融资产分类的几个判断条件整理成了表格。"
              style={{
                width: "100%", border: 0, outline: "none",
                fontFamily: "var(--ff-cn)", fontSize: 13, color: "var(--c-text-1)",
                background: "transparent", resize: "none", lineHeight: 1.5,
                minHeight: 56,
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <span className="caption num">28 / 80</span>
            </div>
          </div>
        </section>

        {/* Subject — single-select */}
        <section className="page-pad" style={{ marginBottom: 20 }}>
          <div className="micro" style={{ marginBottom: 10 }}>科目</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {subjects.map(s => (
              <button key={s} className={`chip ${s === subject ? "active" : ""}`}
                onClick={() => setSubject(s)}
                style={{ opacity: subject && s !== subject ? 0.6 : 1 }}>
                {s}
              </button>
            ))}
          </div>
        </section>

        {/* Tags — multi-select */}
        <section className="page-pad" style={{ marginBottom: 20 }}>
          <div className="micro" style={{ marginBottom: 10 }}>标签</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {tagList.map(t => (
              <button key={t} className={`chip ${tags.has(t) ? "active" : ""}`}
                onClick={() => toggleTag(t)}>
                {t}
              </button>
            ))}
          </div>
        </section>
      </main>

      {/* Sticky submit */}
      <div style={{
        position: "absolute", left: 0, right: 0, bottom: 0,
        padding: "16px 16px calc(env(safe-area-inset-bottom) + 20px)",
        background: "linear-gradient(to top, var(--c-bg-light) 70%, rgba(243,250,246,0))",
      }}>
        <button className="btn btn-primary" style={{ width: "100%", height: 48, fontSize: 15 }}>
          完成打卡
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ACHIEVEMENT UNLOCK MODAL (full-bleed overlay; shown above complete screen)
// ─────────────────────────────────────────────────────────────
function CompleteWithUnlock() {
  return (
    <div className="app" data-screen-label="06 Achievement unlock">
      {/* dimmed background */}
      <div style={{ position: "absolute", inset: 0, opacity: 0.4, pointerEvents: "none" }}>
        <CompleteCheckin/>
      </div>
      <div style={{
        position: "absolute", inset: 0,
        background: "rgba(20,60,50,0.55)",
        backdropFilter: "blur(2px)",
      }}/>

      {/* center modal */}
      <div className="fade-up" style={{
        position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
        width: "calc(100% - 48px)", maxWidth: 320,
        background: "#fff", borderRadius: 16,
        boxShadow: "var(--sh-3)",
        padding: "28px 24px 24px", textAlign: "center",
      }}>
        <div className="micro" style={{ marginBottom: 6, color: "var(--c-rarity-epic)" }}>
          <IconStar size={10} style={{ verticalAlign: -1, marginRight: 2 }}/>
          史诗 · 解锁成就
        </div>

        <div style={{
          margin: "12px auto 18px",
          width: 156, height: 156, borderRadius: 24,
          overflow: "hidden",
          position: "relative",
        }}>
          {/* halo */}
          <div style={{
            position: "absolute", inset: -6, borderRadius: 30,
            border: "2px solid var(--c-rarity-epic)", opacity: 0.5,
            animation: "breathe 2s ease-in-out infinite",
            pointerEvents: "none", zIndex: 2,
          }}/>
          <CatPhoto breed="布偶猫" size={156}/>
        </div>

        <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 6, letterSpacing: -0.3 }}>布偶猫</div>
        <div className="caption" style={{ marginBottom: 20, lineHeight: 1.6 }}>
          单次专注 ≥ 45 分钟 · 连续 7 天<br/>
          你做到了。
        </div>

        <button className="btn btn-primary" style={{ width: "100%", height: 44, marginBottom: 8 }}>
          收藏 · 继续打卡
        </button>
        <button style={{ background: "transparent", border: 0, color: "var(--c-text-2)", fontSize: 12, cursor: "pointer", padding: 8 }}>
          查看成就墙
        </button>
      </div>
    </div>
  );
}

Object.assign(window, { CompleteCheckin, CompleteWithUnlock });
