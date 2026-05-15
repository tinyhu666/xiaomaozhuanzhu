# 学习音景音频文件

需要在此目录放置 5 个 loop-able 的 MP3 音频文件（30–60 秒，可无缝循环）：

- `rain.mp3` — 雨声
- `cafe.mp3` — 咖啡馆环境音
- `ocean.mp3` — 海浪
- `fire.mp3` — 篝火 / 壁炉
- `library.mp3` — 图书馆翻书 + 笔尖声

文件名严格对应 `utils/audio.ts` 里 `SCENE_FILE` 的常量，不要改。

## 文件规范

- 格式：MP3 (44.1kHz, mono 即可)
- 时长：30–60 秒可无缝循环
- 码率：128 kbps 即可（每个文件 ~500 KB-1 MB）
- 头尾：音量从 0 渐入渐出，避免循环时听到接缝

## 推荐免版权来源

- Pixabay Audio (https://pixabay.com/music/) — CC0
- Mixkit (https://mixkit.co/free-sound-effects/) — Mixkit License
- FreePD (https://freepd.com/) — CC0
- BBC Sound Effects (https://sound-effects.bbcrewind.co.uk/) — CC license

下载后用 Audacity 或 ffmpeg 裁剪到 30-60 秒、加 fade-in/out、导出为 mp3。

## 缺失文件的处理

如果某个 scene 的 mp3 不在，`wx.createInnerAudioContext` 会触发 `onError`，
模块层默默吞掉，用户得到的就是静音（不会报红）。所以可以先上线
1-2 个，剩下的逐步补齐。
