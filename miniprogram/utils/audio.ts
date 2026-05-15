/**
 * Ambient audio for focus sessions ("学习音景").
 *
 * Why this exists
 * ===============
 * Industry-standard focus apps (Forest / 番茄ToDo / 泡泡白噪音) all
 * ship background sounds. Users associate "real focus apps" with
 * having them. Silence during a 25-min pomodoro feels clinical.
 *
 * Lifecycle
 * =========
 *   - session start (free or pomodoro) → if user picked a scene !==
 *     "off", play it on loop at user-set volume.
 *   - pause → context.pause() (NOT stop; we resume from same offset).
 *   - resume → context.play()
 *   - complete / abandon → context.stop() + destroy.
 *   - scene swap mid-session → stop old, start new at current volume.
 *
 * Audio file source
 * =================
 * Bundled in /miniprogram/assets/audio/{scene}.mp3. The caller never
 * sees the path — they pick a Scene from the enum and we resolve it.
 *
 * The MP3 files are loop-able 30–60 sec clips. WeChat InnerAudioContext
 * with loop=true seamlessly loops. If a file is missing the context
 * fires onError; we swallow the error so the user just gets silence
 * instead of a confusing toast.
 *
 * State is held at module scope so it survives navigation between
 * tabs — leaving the home page mid-session keeps the audio running.
 */

const STORAGE_AUDIO_SCENE_KEY = "cpa.audio.scene.v1";
const STORAGE_AUDIO_VOLUME_KEY = "cpa.audio.volume.v1";

export type AudioScene =
  | "off"
  | "rain"
  | "cafe"
  | "ocean"
  | "fire"
  | "library";

export type AudioSceneOption = {
  key: AudioScene;
  label: string;
  emoji: string;
  description: string;
};

/** All scenes the picker offers, in display order. */
export const AUDIO_SCENES: AudioSceneOption[] = [
  { key: "off",     label: "关闭",       emoji: "🔇", description: "保持安静" },
  { key: "rain",    label: "雨声",       emoji: "🌧️", description: "节奏感雨滴" },
  { key: "cafe",    label: "咖啡馆",     emoji: "☕", description: "低语 + 杯碟轻响" },
  { key: "ocean",   label: "海浪",       emoji: "🌊", description: "潮起潮落" },
  { key: "fire",    label: "篝火",       emoji: "🔥", description: "壁炉柴火" },
  { key: "library", label: "图书馆",     emoji: "📚", description: "翻书 + 笔尖声" }
];

const SCENE_FILE: Record<AudioScene, string> = {
  off: "",
  rain: "/assets/audio/rain.mp3",
  cafe: "/assets/audio/cafe.mp3",
  ocean: "/assets/audio/ocean.mp3",
  fire: "/assets/audio/fire.mp3",
  library: "/assets/audio/library.mp3"
};

const DEFAULT_SCENE: AudioScene = "off";
const DEFAULT_VOLUME = 0.6;

/* -------------------------------------------------------------------------- */
/*  Settings persistence                                                       */
/* -------------------------------------------------------------------------- */

export function getAudioScene(): AudioScene {
  try {
    const raw = wx.getStorageSync(STORAGE_AUDIO_SCENE_KEY);
    if (typeof raw !== "string") return DEFAULT_SCENE;
    return AUDIO_SCENES.some((s) => s.key === raw) ? (raw as AudioScene) : DEFAULT_SCENE;
  } catch (_) {
    return DEFAULT_SCENE;
  }
}

export function setAudioScene(scene: AudioScene) {
  try {
    wx.setStorageSync(STORAGE_AUDIO_SCENE_KEY, scene);
  } catch (_) { /* storage failures are non-fatal */ }
  // If a session is currently playing audio, swap the scene live.
  if (state.context && state.targetState !== "stopped") {
    stopInternal();
    state.scene = scene;
    playInternal();
  } else {
    state.scene = scene;
  }
}

export function getAudioVolume(): number {
  try {
    const raw = Number(wx.getStorageSync(STORAGE_AUDIO_VOLUME_KEY));
    if (!Number.isFinite(raw)) return DEFAULT_VOLUME;
    return Math.max(0, Math.min(1, raw));
  } catch (_) {
    return DEFAULT_VOLUME;
  }
}

export function setAudioVolume(volume: number) {
  const clamped = Math.max(0, Math.min(1, volume));
  try {
    wx.setStorageSync(STORAGE_AUDIO_VOLUME_KEY, clamped);
  } catch (_) { /* ignore */ }
  state.volume = clamped;
  if (state.context) {
    try { state.context.volume = clamped; } catch (_) { /* ignore */ }
  }
}

/* -------------------------------------------------------------------------- */
/*  Playback state machine                                                     */
/* -------------------------------------------------------------------------- */

type TargetState = "stopped" | "playing" | "paused";

type AudioState = {
  scene: AudioScene;
  volume: number;
  /** What we WANT the audio to be doing. The actual context may lag. */
  targetState: TargetState;
  context: WechatMiniprogram.InnerAudioContext | null;
};

const state: AudioState = {
  scene: getAudioScene(),
  volume: getAudioVolume(),
  targetState: "stopped",
  context: null
};

/**
 * Start (or restart) ambient audio. Called from the timer when a
 * session begins. If the user has scene = "off" this is a no-op.
 */
export function startAmbient(scene?: AudioScene) {
  if (scene) state.scene = scene;
  else state.scene = getAudioScene(); // re-read in case the settings page changed it
  state.volume = getAudioVolume();
  state.targetState = "playing";
  playInternal();
}

export function pauseAmbient() {
  state.targetState = "paused";
  if (state.context) {
    try { state.context.pause(); } catch (_) { /* ignore */ }
  }
}

export function resumeAmbient() {
  state.targetState = "playing";
  if (state.context) {
    try { state.context.play(); } catch (_) { /* ignore */ }
  } else {
    // Context may have been destroyed during background — re-create.
    playInternal();
  }
}

export function stopAmbient() {
  state.targetState = "stopped";
  stopInternal();
}

function playInternal() {
  const file = SCENE_FILE[state.scene];
  if (!file) return; // "off" scene
  // Re-create context for safety — InnerAudioContext gets cranky
  // when reused across long-lived sessions, especially on Android.
  stopInternal();
  let ctx: WechatMiniprogram.InnerAudioContext;
  try {
    ctx = wx.createInnerAudioContext();
  } catch (_) {
    return;
  }
  ctx.src = file;
  ctx.loop = true;
  ctx.obeyMuteSwitch = false; // play even when the user has the
                              // hardware mute switch on — focus
                              // sounds are explicitly requested.
  try { ctx.volume = state.volume; } catch (_) { /* ignore */ }
  // Swallow errors silently — if the audio file is missing we just
  // give the user silence rather than a confusing error toast.
  ctx.onError((err) => {
    console.warn("[audio] playback error", err);
    stopInternal();
  });
  ctx.play();
  state.context = ctx;
}

function stopInternal() {
  if (state.context) {
    try { state.context.stop(); } catch (_) { /* ignore */ }
    try { state.context.destroy(); } catch (_) { /* ignore */ }
    state.context = null;
  }
}

/** Read-only snapshot for UI to render the current scene label. */
export function getActiveAudio() {
  return {
    scene: state.scene,
    volume: state.volume,
    label: AUDIO_SCENES.find((s) => s.key === state.scene)?.label ?? "",
    emoji: AUDIO_SCENES.find((s) => s.key === state.scene)?.emoji ?? "",
    isPlaying: state.targetState === "playing" && state.scene !== "off"
  };
}
