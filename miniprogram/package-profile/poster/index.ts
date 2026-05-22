// @ts-nocheck
import type { ProfileDashboardResponse } from "../../types/models";
import { getHome, getProfileDashboard } from "../../utils/api";
import { formatDuration, getDailyQuote } from "../../utils/view-models";

/**
 * Generate a square-ish poster card the user can long-press to save
 * or forward — the main user-acquisition lever the v0.12 plan is
 * built around (小红书 #学习打卡 trend etc).
 *
 * Why canvas 2D, not wxml-to-image
 * --------------------------------
 * - WeChat MP's modern `canvas type="2d"` API gives a real Canvas
 *   element with DOM-like access, drawImage, gradients, etc. — no
 *   need for a 3rd-party library.
 * - We can produce a 1080×1920 image (3× the 360×640 display size)
 *   so the saved photo is crisp on retina screens.
 * - Single dependency-free file; the layout lives in code, easy to
 *   iterate without WXSS gymnastics.
 *
 * Layout (proportions in display px, canvas backing is 3× larger)
 *   ┌─────────────────────────────────┐
 *   │  🐾 小猫专注                   │  brand
 *   │                                 │
 *   │  [avatar] 昵称                  │  user row
 *   │                                 │
 *   │  103 h 14 m                     │  hero number
 *   │  累计学习时长                  │  hero caption
 *   │                                 │
 *   │  ──── stat grid (4 cells) ────  │
 *   │                                 │
 *   │  "金句"                         │  quote block
 *   │  ─────                          │
 *   │                                 │
 *   │  搜索「小猫专注」 · 开始备考    │  footer
 *   └─────────────────────────────────┘
 */

const CANVAS_DISPLAY_SIZE = { width: 375, height: 600 };
const SCALE = 3; // backing-store DPR for crisp PNG output

type PosterPageData = {
  loading: boolean;
  errorMessage: string;
  tempFilePath: string;
  /** Display copy under the canvas. */
  hero: string;
  caption: string;
};

Page<{}, PosterPageData>({
  data: {
    loading: true,
    errorMessage: "",
    tempFilePath: "",
    hero: "",
    caption: ""
  },

  async onReady() {
    try {
      // Run all three reads in parallel — they're independent.
      const [dashboard, home] = await Promise.all([
        getProfileDashboard().catch(() => null),
        getHome().catch(() => null)
      ]);
      const payload = this.buildPayload(dashboard, home);
      this.setData({
        hero: payload.heroValue,
        caption: payload.heroCaption
      });
      await this.renderPoster(payload);
      this.setData({ loading: false });
    } catch (error) {
      console.error("[poster] render failed", error);
      this.setData({
        loading: false,
        errorMessage: error instanceof Error ? error.message : "生成失败，请下拉重试"
      });
    }
  },

  /**
   * Assemble the data shape the canvas draw code expects. Pulls
   * cumulative + today numbers from dashboard, falls back gracefully
   * when either endpoint failed (e.g. cold-start network blip).
   */
  buildPayload(dashboard: ProfileDashboardResponse | null, home: any) {
    const summary = dashboard?.summary ?? {};
    const totalMinutes = summary.totalMinutes ?? 0;
    const completedCount = summary.completedSessionCount ?? 0;
    const longestStreak = summary.longestStreakDays ?? 0;
    const currentStreak = summary.currentStreakDays ?? 0;
    const bestDay = dashboard?.records?.bestDay ?? dashboard?.bestDay ?? { totalMinutes: 0 };
    const todayMinutes = home?.today?.totalMinutes ?? 0;

    // Hero number: prefer today's minutes if user has studied today
    // (so the card celebrates the live session), otherwise show
    // cumulative time (so a returning user still has a story).
    const heroValue = todayMinutes > 0
      ? formatDuration(todayMinutes)
      : formatDuration(totalMinutes);
    const heroCaption = todayMinutes > 0 ? "今日专注" : "CPA 累计学习";

    const quote = getDailyQuote();
    return {
      nickname: dashboard?.profile?.nickname || "CPA 考生",
      avatarUrl: dashboard?.profile?.avatarUrl || "",
      heroValue,
      heroCaption,
      stats: [
        { label: "完成打卡", value: String(completedCount) },
        { label: "当前连签", value: `${currentStreak} 天` },
        { label: "最长连签", value: `${longestStreak} 天` },
        { label: "单日最长", value: bestDay.totalMinutes > 0 ? formatDuration(bestDay.totalMinutes) : "—" }
      ],
      quoteEn: quote.en,
      quoteZh: quote.zh,
      timestamp: this.formatTimestamp()
    };
  },

  formatTimestamp() {
    const now = new Date();
    return `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`;
  },

  /**
   * Resolve the WeChat canvas-2d node via SelectorQuery. WeChat's
   * native API gives us a real Canvas element; everything else is
   * standard 2D context drawing.
   */
  async renderPoster(payload: ReturnType<typeof this.buildPayload>) {
    const { canvas, ctx, width, height } = await this.acquireCanvas();
    drawPoster(ctx, canvas, width, height, payload);

    // Pre-load avatar after the synchronous draw so the bulk of the
    // card renders immediately; the avatar layers on top when ready.
    if (payload.avatarUrl) {
      try {
        const img = await loadImageOntoCanvas(canvas, payload.avatarUrl);
        drawAvatar(ctx, img, width);
      } catch (error) {
        console.warn("[poster] avatar load failed; falling back to placeholder", error);
        drawAvatarPlaceholder(ctx, width);
      }
    } else {
      drawAvatarPlaceholder(ctx, width);
    }

    // Export to a temp file so the wxml <image> can preview it and
    // wx.saveImageToPhotosAlbum can persist it.
    const tempFilePath = await new Promise<string>((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas,
        width,
        height,
        destWidth: width,
        destHeight: height,
        fileType: "png",
        success: (res) => resolve(res.tempFilePath),
        fail: reject
      });
    });
    this.setData({ tempFilePath });
  },

  acquireCanvas() {
    return new Promise<{ canvas: any; ctx: any; width: number; height: number }>((resolve, reject) => {
      wx.createSelectorQuery()
        .select("#poster")
        .fields({ node: true, size: true })
        .exec((results) => {
          const node = results?.[0]?.node;
          if (!node) {
            reject(new Error("找不到画布"));
            return;
          }
          const ctx = node.getContext("2d");
          const width = CANVAS_DISPLAY_SIZE.width * SCALE;
          const height = CANVAS_DISPLAY_SIZE.height * SCALE;
          node.width = width;
          node.height = height;
          resolve({ canvas: node, ctx, width, height });
        });
    });
  },

  async onSaveTap() {
    // v0.26.1 — guard against premature tap before canvas render
    // finishes. Was silently returning, leaving the user wondering why
    // nothing happened. Now we surface a hint so they know to wait.
    if (!this.data.tempFilePath) {
      wx.showToast({ title: "海报还在生成，请稍候", icon: "none", duration: 1500 });
      return;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        wx.saveImageToPhotosAlbum({
          filePath: this.data.tempFilePath,
          success: () => resolve(),
          fail: reject
        });
      });
      wx.showToast({ title: "已保存到相册", icon: "success" });
    } catch (error) {
      // v0.26.1 — was failing to detect auth issues on iOS because the
      // errMsg format varies ("saveImageToPhotosAlbum:fail auth deny" /
      // "saveImageToPhotosAlbum:fail:authorize no setting" /
      // "saveImageToPhotosAlbum:fail authorize fail"). Broadened the
      // matcher to catch any auth keyword. Also log the raw errMsg
      // so we can diagnose future failures in the dev tools.
      console.error("[poster] saveImageToPhotosAlbum failed", error);
      const errMsg = String((error as { errMsg?: string }).errMsg ?? "");
      const lower = errMsg.toLowerCase();
      const isAuthIssue =
        lower.includes("auth") ||
        lower.includes("scope") ||
        lower.includes("permission") ||
        lower.includes("deny");
      const isCancel = lower.includes("cancel") || lower.includes("cancelled");
      if (isAuthIssue) {
        wx.showModal({
          title: "无法保存",
          content: "请在「设置」中授权「保存图片到相册」后再试。",
          confirmText: "去设置",
          cancelText: "取消",
          success: (res) => {
            if (res.confirm) {
              wx.openSetting({
                success: (setting) => {
                  // After returning from settings, if user granted, we
                  // could auto-retry — but a fresh tap is simpler UX.
                  if (setting.authSetting?.["scope.writePhotosAlbum"]) {
                    wx.showToast({ title: "已授权，请再次点保存", icon: "none" });
                  }
                }
              });
            }
          }
        });
      } else if (!isCancel) {
        // Surface the raw errMsg tail so the user can screenshot it
        // for support, while still keeping the toast short.
        const tail = errMsg.replace(/^saveImageToPhotosAlbum:fail\s*/i, "").slice(0, 24);
        wx.showToast({
          title: tail ? `保存失败：${tail}` : "保存失败",
          icon: "none",
          duration: 2500
        });
      }
    }
  },

  onShareAppMessage() {
    // 转发: WeChat handles this natively when the page has
    // onShareAppMessage. We just provide the metadata.
    return {
      title: "我在小猫专注备考 CPA，一起？",
      path: "/pages/home/index",
      imageUrl: this.data.tempFilePath
    };
  }
});

/* -------------------------------------------------------------------------- */
/*  Pure drawing functions — no `this`, easy to reason about and tweak        */
/* -------------------------------------------------------------------------- */

function drawPoster(ctx: any, canvas: any, w: number, h: number, p: any) {
  const padX = w * 0.08;
  const padTop = h * 0.07;

  // 1. Layered mint background. Two stacked radial gradients give
  // visual depth without a bitmap dependency.
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#f8fdfa");
  bg.addColorStop(1, "#e2f1e9");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Top-right glow
  const tr = ctx.createRadialGradient(w * 0.95, 0, 0, w * 0.95, 0, w * 0.6);
  tr.addColorStop(0, "rgba(94, 195, 157, 0.25)");
  tr.addColorStop(1, "rgba(94, 195, 157, 0)");
  ctx.fillStyle = tr;
  ctx.fillRect(0, 0, w, h);

  // Bottom-left soft cream
  const bl = ctx.createRadialGradient(0, h, 0, 0, h, w * 0.7);
  bl.addColorStop(0, "rgba(255, 207, 138, 0.18)");
  bl.addColorStop(1, "rgba(255, 207, 138, 0)");
  ctx.fillStyle = bl;
  ctx.fillRect(0, 0, w, h);

  // 2. Brand mark — top-left
  ctx.fillStyle = "#155946";
  ctx.font = `bold ${Math.floor(40 * (w / 1125))}px -apple-system, "PingFang SC", sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillText("🐾 小猫专注", padX, padTop);

  // Date stamp top-right
  ctx.fillStyle = "rgba(21, 89, 70, 0.55)";
  ctx.font = `600 ${Math.floor(28 * (w / 1125))}px -apple-system, sans-serif`;
  const tsW = ctx.measureText(p.timestamp).width;
  ctx.fillText(p.timestamp, w - padX - tsW, padTop + 8);

  // 2.5 Nickname — sits between brand and the hero number. Truncate
  // anything past a sensible width so a 50-char joke nickname can't
  // crash into the avatar circle on the right.
  const nicknameY = padTop + 90 * (w / 1125);
  ctx.fillStyle = "#3a6256";
  const nickFont = Math.floor(36 * (w / 1125));
  ctx.font = `600 ${nickFont}px -apple-system, "PingFang SC", sans-serif`;
  const nicknameMaxW = w - padX * 2 - (130 * (w / 1125)); // leave room for avatar
  const nicknameText = truncateForWidth(ctx, p.nickname, nicknameMaxW);
  ctx.fillText(nicknameText, padX, nicknameY);

  // 3. Hero number — big, takes the visual weight
  const heroY = padTop + h * 0.18;
  ctx.fillStyle = "#0f4836";
  const heroFontSize = Math.floor(140 * (w / 1125));
  ctx.font = `bold ${heroFontSize}px -apple-system, "PingFang SC", sans-serif`;
  ctx.fillText(p.heroValue, padX, heroY);

  ctx.fillStyle = "#5e7d75";
  ctx.font = `500 ${Math.floor(30 * (w / 1125))}px -apple-system, sans-serif`;
  ctx.fillText(p.heroCaption, padX, heroY + heroFontSize + 14);

  // 4. Stat grid — 2×2
  const gridY = heroY + heroFontSize + 80;
  const cellW = (w - padX * 2 - 24) / 2;
  const cellH = 130 * (w / 1125);
  const gap = 24 * (w / 1125);
  for (let i = 0; i < p.stats.length; i += 1) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = padX + col * (cellW + gap);
    const y = gridY + row * (cellH + gap);
    drawStatCell(ctx, x, y, cellW, cellH, p.stats[i]);
  }

  // 5. Quote block
  const quoteY = gridY + cellH * 2 + gap + 60 * (w / 1125);
  ctx.fillStyle = "#155946";
  const enFont = Math.floor(36 * (w / 1125));
  ctx.font = `italic 600 ${enFont}px Georgia, "Times New Roman", serif`;
  drawWrappedText(ctx, p.quoteEn, padX, quoteY, w - padX * 2, enFont * 1.3, 2);

  ctx.fillStyle = "#5e7d75";
  const zhFont = Math.floor(26 * (w / 1125));
  ctx.font = `400 ${zhFont}px -apple-system, "PingFang SC", sans-serif`;
  drawWrappedText(ctx, p.quoteZh, padX, quoteY + enFont * 1.3 * 2 + 16, w - padX * 2, zhFont * 1.5, 2);

  // 6. Footer slogan
  ctx.fillStyle = "rgba(21, 89, 70, 0.65)";
  const footFont = Math.floor(26 * (w / 1125));
  ctx.font = `600 ${footFont}px -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("微信搜索「小猫专注」· 开始 CPA 备考", w / 2, h - padTop);
  ctx.textAlign = "left"; // restore
}

function drawStatCell(ctx: any, x: number, y: number, w: number, h: number, stat: any) {
  // Subtle white card with rounded corners
  const r = 24;
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.strokeStyle = "rgba(46, 169, 133, 0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#0f4836";
  ctx.textAlign = "left";
  const valueFont = Math.floor(48 * (w / 480));
  ctx.font = `bold ${valueFont}px -apple-system, sans-serif`;
  ctx.fillText(stat.value, x + 28, y + 28);

  ctx.fillStyle = "#7d9b91";
  const labelFont = Math.floor(22 * (w / 480));
  ctx.font = `500 ${labelFont}px -apple-system, sans-serif`;
  ctx.fillText(stat.label, x + 28, y + 28 + valueFont + 14);
}

function drawAvatar(ctx: any, img: any, w: number) {
  const padX = w * 0.08;
  const size = 88 * (w / 1125);
  const y = w * 0.07 + 70 * (w / 1125);
  const x = w - padX - size;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, x, y, size, size);
  ctx.restore();
  // Ring
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2 + 2, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
  ctx.lineWidth = 4;
  ctx.stroke();
}

function drawAvatarPlaceholder(ctx: any, w: number) {
  const padX = w * 0.08;
  const size = 88 * (w / 1125);
  const y = w * 0.07 + 70 * (w / 1125);
  const x = w - padX - size;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const grad = ctx.createLinearGradient(x, y, x + size, y + size);
  grad.addColorStop(0, "#c2ead2");
  grad.addColorStop(1, "#6fc99a");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `${Math.floor(size * 0.6)}px -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🐱", cx, cy + size * 0.05);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
}

/**
 * Load an arbitrary URL into the canvas-bound Image so it can be
 * drawn. Cloud:// avatars need to be normalized to https first via
 * wx.cloud.getTempFileURL — MP's canvas createImage doesn't speak
 * cloud:// natively.
 */
async function loadImageOntoCanvas(canvas: any, url: string): Promise<any> {
  let finalUrl = url;
  if (url.startsWith("cloud://")) {
    finalUrl = await new Promise<string>((resolve, reject) => {
      wx.cloud.getTempFileURL({
        fileList: [url],
        success: (res: any) => {
          const item = res.fileList?.[0];
          if (item?.tempFileURL) resolve(item.tempFileURL);
          else reject(new Error(item?.errMsg || "无法解析云端头像"));
        },
        fail: reject
      });
    });
  }
  return new Promise((resolve, reject) => {
    const img = canvas.createImage();
    img.onload = () => resolve(img);
    img.onerror = (err: unknown) => reject(err);
    img.src = finalUrl;
  });
}

/** Word-wrap helper for CJK + Latin mixed text. */
function drawWrappedText(
  ctx: any,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
) {
  if (!text) return;
  const words = Array.from(text);
  let line = "";
  let line0 = y;
  let lines = 0;
  for (const ch of words) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line.length > 0) {
      ctx.fillText(line, x, line0);
      lines += 1;
      if (lines >= maxLines) {
        // Truncate with ellipsis if there's overflow.
        const remaining = words.slice(words.indexOf(ch)).join("");
        if (remaining.length > 0) {
          // Already at the cap — append ellipsis to last drawn line.
          // Simple approach: append to next line then stop.
        }
        return;
      }
      line = ch;
      line0 += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, line0);
}

/**
 * Truncate `text` with an ellipsis so it fits in `maxWidth`. Iterates
 * one char at a time; cheap enough for short nickname strings, and
 * tolerates mixed CJK / Latin (measureText handles per-glyph widths).
 */
function truncateForWidth(ctx: any, text: string, maxWidth: number): string {
  if (!text) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  const chars = Array.from(text);
  let acc = "";
  for (const ch of chars) {
    const probe = acc + ch + "…";
    if (ctx.measureText(probe).width > maxWidth) break;
    acc += ch;
  }
  return acc + "…";
}

/** Path a rounded rectangle. Canvas API doesn't ship this by default. */
function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
