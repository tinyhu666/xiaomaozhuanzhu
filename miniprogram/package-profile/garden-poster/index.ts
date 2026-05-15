// @ts-nocheck
import { getProfileDashboard, listMySessions } from "../../utils/api";
import { buildGarden, type CatCard, type GardenViewModel } from "../../utils/garden";

/**
 * 花园分享卡 — canvas-drawn poster of the user's collected cats,
 * pairs with v0.12's 学习日报 poster as the second canvas-share
 * surface. Same drawing infrastructure (375×600 display size, 3×
 * backing for retina); the layout differs because the content is
 * different (a grid of cats, not a single hero number).
 */

const CANVAS_DISPLAY_SIZE = { width: 375, height: 600 };
const SCALE = 3;
const GRID_COLS = 6;
const GRID_ROWS = 4;
const GRID_CAPACITY = GRID_COLS * GRID_ROWS; // 24

type PosterPageData = {
  loading: boolean;
  errorMessage: string;
  tempFilePath: string;
  total: number;
};

Page<{}, PosterPageData>({
  data: {
    loading: true,
    errorMessage: "",
    tempFilePath: "",
    total: 0
  },

  async onReady() {
    try {
      const [sessionsResult, dashboard] = await Promise.all([
        listMySessions(),
        getProfileDashboard().catch(() => null)
      ]);
      const vm = buildGarden(sessionsResult.items ?? []);
      if (vm.cats.length === 0) {
        this.setData({
          loading: false,
          errorMessage: "花园还空着，先去完成一次专注吧"
        });
        return;
      }
      this.setData({ total: vm.stats.total });
      const payload = this.buildPayload(vm, dashboard);
      await this.renderPoster(payload);
      this.setData({ loading: false });
    } catch (error) {
      console.error("[garden-poster] render failed", error);
      this.setData({
        loading: false,
        errorMessage: error instanceof Error ? error.message : "生成失败，请下拉重试"
      });
    }
  },

  buildPayload(vm: GardenViewModel, dashboard: any) {
    const nickname = dashboard?.profile?.nickname || "CPA 考生";
    const avatarUrl = dashboard?.profile?.avatarUrl || "";

    // Pick the visually-strongest cats first: legendary > epic > rare
    // > common, then most-recent-within-tier. So a user with 50 cats
    // sees their crown jewels on the share card, not the first 24
    // randoms.
    const rarityOrder: Record<string, number> = {
      legendary: 0, epic: 1, rare: 2, common: 3
    };
    const featuredCats = vm.cats
      .slice()
      .sort((a, b) => {
        const r = (rarityOrder[a.rarity] ?? 9) - (rarityOrder[b.rarity] ?? 9);
        if (r !== 0) return r;
        return 0; // already newest-first within tier
      })
      .slice(0, GRID_CAPACITY);

    return {
      nickname,
      avatarUrl,
      total: vm.stats.total,
      featuredCats,
      stats: vm.stats,
      timestamp: this.formatTimestamp()
    };
  },

  formatTimestamp() {
    const now = new Date();
    return `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`;
  },

  async renderPoster(payload: ReturnType<typeof this.buildPayload>) {
    const { canvas, ctx, width, height } = await this.acquireCanvas();
    drawPoster(ctx, width, height, payload);

    if (payload.avatarUrl) {
      try {
        const img = await loadImageOntoCanvas(canvas, payload.avatarUrl);
        drawAvatar(ctx, img, width);
      } catch (error) {
        console.warn("[garden-poster] avatar load failed", error);
        drawAvatarPlaceholder(ctx, width);
      }
    } else {
      drawAvatarPlaceholder(ctx, width);
    }

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
        .select("#garden-poster")
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
    if (!this.data.tempFilePath) return;
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
      const msg = String((error as { errMsg?: string }).errMsg ?? "");
      if (msg.includes("auth deny") || msg.includes("authorize")) {
        wx.showModal({
          title: "无法保存",
          content: "请到「设置」中授权「保存图片到相册」后再试。",
          confirmText: "去设置",
          success: (res) => { if (res.confirm) wx.openSetting(); }
        });
      } else if (!msg.includes("cancel")) {
        wx.showToast({ title: "保存失败", icon: "none" });
      }
    }
  },

  onShareAppMessage() {
    return {
      title: `我在小猫专注收集了 ${this.data.total} 只小猫`,
      path: "/pages/home/index",
      imageUrl: this.data.tempFilePath
    };
  }
});

/* -------------------------------------------------------------------------- */
/*  Pure drawing functions                                                     */
/* -------------------------------------------------------------------------- */

function drawPoster(ctx: any, w: number, h: number, p: any) {
  const padX = w * 0.08;
  const padTop = h * 0.06;

  // 1. Layered mint background with warm cream highlight
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#f8fdfa");
  bg.addColorStop(1, "#e2f1e9");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Top-right gentle glow
  const tr = ctx.createRadialGradient(w * 0.95, 0, 0, w * 0.95, 0, w * 0.6);
  tr.addColorStop(0, "rgba(94, 195, 157, 0.22)");
  tr.addColorStop(1, "rgba(94, 195, 157, 0)");
  ctx.fillStyle = tr;
  ctx.fillRect(0, 0, w, h);

  // Bottom-left warm cream
  const bl = ctx.createRadialGradient(0, h, 0, 0, h, w * 0.7);
  bl.addColorStop(0, "rgba(255, 207, 138, 0.2)");
  bl.addColorStop(1, "rgba(255, 207, 138, 0)");
  ctx.fillStyle = bl;
  ctx.fillRect(0, 0, w, h);

  // 2. Brand mark — top-left
  ctx.fillStyle = "#155946";
  ctx.font = `bold ${Math.floor(40 * (w / 1125))}px -apple-system, "PingFang SC", sans-serif`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText("🐾 小猫专注", padX, padTop);

  // Date stamp top-right
  ctx.fillStyle = "rgba(21, 89, 70, 0.55)";
  ctx.font = `600 ${Math.floor(28 * (w / 1125))}px -apple-system, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText(p.timestamp, w - padX, padTop + 8);

  // 3. Title row + count (the focal narrative)
  const heroY = padTop + h * 0.16;
  ctx.fillStyle = "#0f4836";
  ctx.font = `bold ${Math.floor(44 * (w / 1125))}px -apple-system, "PingFang SC", sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText("我的小猫花园", padX, heroY);

  // Big total number
  const numY = heroY + 70 * (w / 1125);
  ctx.fillStyle = "#0f4836";
  const numFont = Math.floor(140 * (w / 1125));
  ctx.font = `bold ${numFont}px -apple-system, sans-serif`;
  ctx.fillText(String(p.total), padX, numY);

  // "只小猫" suffix next to the number
  const numWidth = ctx.measureText(String(p.total)).width;
  ctx.fillStyle = "#5e7d75";
  ctx.font = `500 ${Math.floor(34 * (w / 1125))}px -apple-system, sans-serif`;
  const baseline = numY + numFont - 36 * (w / 1125);
  ctx.fillText(" 只小猫", padX + numWidth, baseline);

  // 4. Cat grid — 6 cols × 4 rows. Each cell is a soft rounded rect
  // with the cat emoji inside. Rarity borders/glow color the cell.
  const gridY = numY + numFont + 70 * (w / 1125);
  const gridW = w - padX * 2;
  const cellGap = 14 * (w / 1125);
  const cellSize = (gridW - cellGap * (GRID_COLS - 1)) / GRID_COLS;

  for (let i = 0; i < GRID_CAPACITY; i += 1) {
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    const x = padX + col * (cellSize + cellGap);
    const y = gridY + row * (cellSize + cellGap);
    const cat: CatCard | undefined = p.featuredCats[i];
    drawCatCell(ctx, x, y, cellSize, cat);
  }

  // 5. Rarity legend at bottom — a single horizontal row
  const legendY = gridY + GRID_ROWS * (cellSize + cellGap) + 24 * (w / 1125);
  const legendFont = Math.floor(24 * (w / 1125));
  ctx.font = `600 ${legendFont}px -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(21, 89, 70, 0.7)";
  const legendParts: string[] = [];
  if (p.stats.byRarity.legendary > 0) legendParts.push(`传说 ${p.stats.byRarity.legendary}`);
  if (p.stats.byRarity.epic > 0)      legendParts.push(`史诗 ${p.stats.byRarity.epic}`);
  if (p.stats.byRarity.rare > 0)      legendParts.push(`稀有 ${p.stats.byRarity.rare}`);
  if (p.stats.byRarity.common > 0)    legendParts.push(`普通 ${p.stats.byRarity.common}`);
  ctx.fillText(legendParts.join("  ·  "), w / 2, legendY);

  // 6. Footer slogan
  ctx.fillStyle = "rgba(21, 89, 70, 0.65)";
  const footFont = Math.floor(26 * (w / 1125));
  ctx.font = `600 ${footFont}px -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("微信搜索「小猫专注」· 开始 CPA 备考", w / 2, h - padTop);
  ctx.textAlign = "left";
}

function drawCatCell(ctx: any, x: number, y: number, size: number, cat?: CatCard) {
  // Card background — rarity tinted
  const tint = cat ? rarityTint(cat.rarity) : { fill: "rgba(46, 169, 133, 0.04)", stroke: "rgba(46, 169, 133, 0.08)" };
  ctx.fillStyle = tint.fill;
  roundRect(ctx, x, y, size, size, size * 0.16);
  ctx.fill();
  ctx.strokeStyle = tint.stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (!cat) {
    // Empty slot — small paw print silhouette so the cell isn't blank
    ctx.fillStyle = "rgba(46, 169, 133, 0.18)";
    ctx.font = `${Math.floor(size * 0.5)}px -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("·", x + size / 2, y + size / 2);
    return;
  }

  // Cat emoji
  ctx.fillStyle = "#155946";
  ctx.font = `${Math.floor(size * 0.6)}px -apple-system, "PingFang SC", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(cat.emoji, x + size / 2, y + size * 0.5);

  // Crown / star for legendary / epic
  if (cat.rarity === "legendary") {
    ctx.font = `${Math.floor(size * 0.28)}px -apple-system, sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("👑", x + size - size * 0.06, y + size * 0.04);
  } else if (cat.rarity === "epic") {
    ctx.font = `${Math.floor(size * 0.22)}px -apple-system, sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText("🌟", x + size - size * 0.06, y + size * 0.06);
  }
}

function rarityTint(rarity: CatCard["rarity"]) {
  switch (rarity) {
    case "legendary": return { fill: "rgba(255, 216, 107, 0.32)", stroke: "rgba(240, 169, 59, 0.55)" };
    case "epic":      return { fill: "rgba(255, 184, 107, 0.22)", stroke: "rgba(229, 123, 43, 0.4)" };
    case "rare":      return { fill: "rgba(138, 166, 240, 0.18)", stroke: "rgba(74, 110, 217, 0.3)" };
    default:          return { fill: "rgba(255, 255, 255, 0.85)", stroke: "rgba(46, 169, 133, 0.16)" };
  }
}

function drawAvatar(ctx: any, img: any, w: number) {
  const padX = w * 0.08;
  const size = 88 * (w / 1125);
  const y = w * 0.06 + 70 * (w / 1125);
  const x = w - padX - size;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, x, y, size, size);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2 + 2, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
  ctx.lineWidth = 4;
  ctx.stroke();
}

function drawAvatarPlaceholder(ctx: any, w: number) {
  const padX = w * 0.08;
  const size = 88 * (w / 1125);
  const y = w * 0.06 + 70 * (w / 1125);
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
