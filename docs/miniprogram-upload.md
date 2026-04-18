# Mini Program Upload

Use the repository upload script to compile the TypeScript mini program into a temporary upload bundle and send a new dev version to WeChat.

## Command

```bash
set MINIPROGRAM_PRIVATE_KEY_PATH=your-private.<appid>.key
npm run upload:miniprogram -- 0.1.0 "Version notes"
```

## What the script does

- compiles `miniprogram/**/*.ts` into `output/mp-upload/miniprogram/**/*.js`
- copies `json`, `wxml`, `wxss`, and `project.config.json`
- prefers the WeChat DevTools bundled `Node 18`
- runs `miniprogram-ci upload`

## Optional flags

```bash
npm run upload:miniprogram -- 0.1.1 "Bug fixes"
```

Supported flags:

- `--private-key-path`
- `--appid`
- `--version`
- `--description`
- `--upload-version`
- `--upload-description`
- `--robot`
- `--devtools-dir`

When you run through `npm run`, prefer positional arguments because npm may strip custom flags:

```bash
npm run upload:miniprogram -- 0.1.2 "Release notes"
```
