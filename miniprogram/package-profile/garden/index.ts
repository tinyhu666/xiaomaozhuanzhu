// @ts-nocheck
import { listMySessions } from "../../utils/api";
import {
  buildGarden,
  rarityLabel,
  type CatCard,
  type CatRarity,
  type CatSubject,
  type GardenViewModel
} from "../../utils/garden";

/**
 * 小猫花园 — visual grid of collected cats. Each cat is one
 * completed focus session, deterministically themed by subject
 * and tiered by length/effort. See utils/garden.ts for the
 * derivation rules.
 *
 * The page is read-only: no server writes, no edits. Pull-to-
 * refresh re-fetches the session list.
 *
 * Filters: tapping a rarity chip in the stats header narrows
 * the visible cats. A second tap clears the filter.
 */

type RarityChip = {
  key: CatRarity | "all";
  label: string;
  count: number;
  active: boolean;
};

type GardenPageData = {
  loading: boolean;
  errorMessage: string;
  total: number;
  rarityChips: RarityChip[];
  visibleCats: CatCard[];
  emptyMessage: string;
  /** Detail modal — visible when the user taps a cat. */
  detail: CatCard | null;
};

Page<{}, GardenPageData>({
  data: {
    loading: true,
    errorMessage: "",
    total: 0,
    rarityChips: [],
    visibleCats: [],
    emptyMessage: "完成一次专注，就能收获第一只小猫。",
    detail: null
  },

  /** Cache of the full unfiltered view-model so filter toggles
   *  don't have to re-fetch from the server. */
  _vm: null as GardenViewModel | null,
  /** Currently active rarity filter; "all" = no filter. */
  _activeFilter: "all" as CatRarity | "all",

  async onLoad() {
    await this.refresh();
  },

  async onPullDownRefresh() {
    try {
      await this.refresh();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async refresh() {
    this.setData({ loading: true, errorMessage: "" });
    try {
      const { items } = await listMySessions();
      const vm = buildGarden(items);
      this._vm = vm;
      this._activeFilter = "all";
      this.applyVm();
    } catch (error) {
      this.setData({
        loading: false,
        errorMessage: error instanceof Error ? error.message : "加载失败"
      });
    }
  },

  /**
   * Rebuild the page-data from this._vm and this._activeFilter.
   * Called whenever filter or data changes.
   */
  applyVm() {
    const vm = this._vm;
    if (!vm) return;
    const filter = this._activeFilter;
    const visible = filter === "all" ? vm.cats : vm.cats.filter((c) => c.rarity === filter);
    const chips: RarityChip[] = [
      { key: "all",       label: "全部",  count: vm.stats.total,                 active: filter === "all" },
      { key: "legendary", label: "传说",  count: vm.stats.byRarity.legendary,    active: filter === "legendary" },
      { key: "epic",      label: "史诗",  count: vm.stats.byRarity.epic,         active: filter === "epic" },
      { key: "rare",      label: "稀有",  count: vm.stats.byRarity.rare,         active: filter === "rare" },
      { key: "common",    label: "普通",  count: vm.stats.byRarity.common,       active: filter === "common" }
    ];
    this.setData({
      loading: false,
      total: vm.stats.total,
      rarityChips: chips,
      visibleCats: visible
    });
  },

  onTapRarityChip(event: WechatMiniprogram.BaseEvent) {
    const key = event.currentTarget.dataset.key as CatRarity | "all";
    if (!key) return;
    // Tap-again-to-clear: tapping the active chip resets to "all"
    // so the user doesn't have to find the All chip after filtering.
    this._activeFilter = this._activeFilter === key ? "all" : key;
    this.applyVm();
  },

  onTapCat(event: WechatMiniprogram.BaseEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const cat = this._vm?.cats.find((c) => c.id === id);
    if (!cat) return;
    this.setData({ detail: cat });
  },

  onTapDetailClose() {
    this.setData({ detail: null });
  },

  onTapDetailContent(event: WechatMiniprogram.BaseEvent) {
    // Stop tap propagation so tapping the card itself doesn't
    // dismiss the modal (only the backdrop closes it).
    event.stopPropagation?.();
  }
});
