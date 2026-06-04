// @ts-nocheck
import { manualSession } from "../../utils/api";

/**
 * v0.34 — A1 补录. Records study time done without the timer (forgot to
 * start / studied on paper) for a past or today date. Minimal form:
 * date + duration quick-pick + subject + tags + optional one-liner.
 * No photos — 补录 is about recovering lost minutes, kept low-friction.
 */
const SUBJECTS = ["会计", "审计", "税法", "财管", "经济法", "战略"];
const TAGS = ["顺利", "卡住", "高效", "复习", "刷题", "新课"];
const DURATIONS = [15, 25, 30, 45, 60, 90, 120];

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

Page({
  data: {
    dateValue: todayStr(),
    maxDate: todayStr(),
    durations: DURATIONS,
    durationMinutes: 30,
    subjectChips: SUBJECTS.map((value) => ({ value, selected: false })),
    tagChips: TAGS.map((value) => ({ value, selected: false })),
    summary: "",
    submitting: false
  },

  onDateChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ dateValue: String(event.detail.value) });
  },

  selectDuration(event: WechatMiniprogram.BaseEvent) {
    const min = Number(event.currentTarget.dataset.min);
    if (Number.isFinite(min) && min > 0) this.setData({ durationMinutes: min });
  },

  toggleSubject(event: WechatMiniprogram.BaseEvent) {
    const value = event.currentTarget.dataset.value as string;
    // Single-select: tapping the active chip clears it.
    this.setData({
      subjectChips: this.data.subjectChips.map((chip) => ({
        value: chip.value,
        selected: chip.value === value ? !chip.selected : false
      }))
    });
  },

  toggleTag(event: WechatMiniprogram.BaseEvent) {
    const value = event.currentTarget.dataset.value as string;
    this.setData({
      tagChips: this.data.tagChips.map((chip) =>
        chip.value === value ? { value: chip.value, selected: !chip.selected } : chip
      )
    });
  },

  onSummaryInput(event: WechatMiniprogram.Input) {
    this.setData({ summary: event.detail.value });
  },

  async submit() {
    if (this.data.submitting) return;
    const durationMinutes = Number(this.data.durationMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      wx.showToast({ title: "先选一个时长", icon: "none" });
      return;
    }
    const subject = this.data.subjectChips.find((chip) => chip.selected)?.value ?? null;
    const tags = this.data.tagChips.filter((chip) => chip.selected).map((chip) => chip.value);

    this.setData({ submitting: true });
    try {
      const res = await manualSession({
        date: this.data.dateValue,
        durationMinutes,
        subject,
        tags,
        summary: this.data.summary
      });
      const unlocked = (res as { newlyUnlockedBadge?: unknown }).newlyUnlockedBadge;
      wx.showToast({ title: unlocked ? "已补录 · 解锁新成就" : "已补录", icon: "success", duration: 1200 });
      // The page that opened 补录 (calendar / profile) reloads on its
      // onShow, so navigating back is enough to reflect the new record.
      setTimeout(() => wx.navigateBack(), 800);
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "补录失败",
        icon: "none"
      });
      this.setData({ submitting: false });
    }
  }
});
