#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const sourceMiniprogramDir = path.join(projectRoot, "miniprogram");
const uploadRoot = path.join(projectRoot, "output", "mp-upload");
const uploadMiniprogramDir = path.join(uploadRoot, "miniprogram");
const uploadInfoPath = path.join(projectRoot, "output", "mini-upload.json");
const packageJson = readJson(path.join(projectRoot, "package.json"));
const projectConfig = readJson(path.join(projectRoot, "project.config.json"));
const isWindows = process.platform === "win32";

const cliOptions = parseCliArgs(process.argv.slice(2));
const appId = cliOptions.appid || process.env.MINIPROGRAM_APPID || projectConfig.appid;
const conventionalPrivateKeyPath = appId
  ? path.resolve(projectRoot, "..", "..", "minikey", `private.${appId}.key`)
  : "";
const privateKeyPath =
  cliOptions.privateKeyPath ||
  process.env.MINIPROGRAM_PRIVATE_KEY_PATH ||
  process.env.WECHAT_PRIVATE_KEY_PATH ||
  (conventionalPrivateKeyPath && fs.existsSync(conventionalPrivateKeyPath) ? conventionalPrivateKeyPath : "") ||
  "";
const uploadVersion = cliOptions.version || process.env.MINIPROGRAM_UPLOAD_VERSION || packageJson.version;
const uploadDescription =
  cliOptions.description ||
  process.env.MINIPROGRAM_UPLOAD_DESC ||
  `Upload ${uploadVersion}`;
const robot = cliOptions.robot || process.env.MINIPROGRAM_UPLOAD_ROBOT || "1";
const devtoolsDir = isWindows ? resolveWindowsDevtoolsDir(cliOptions.devtoolsDir || process.env.WECHAT_DEVTOOLS_DIR) : "";

if (!appId) {
  fail("Missing appid. Set MINIPROGRAM_APPID or keep appid in project.config.json.");
}
if (!privateKeyPath || !fs.existsSync(privateKeyPath)) {
  fail([
    "Missing upload private key.",
    "Set MINIPROGRAM_PRIVATE_KEY_PATH, pass --private-key-path,",
    `or place the key at ${conventionalPrivateKeyPath || "<workspace>/minikey/private.<appid>.key"}.`
  ].join(" "));
}
if (isWindows && !devtoolsDir) {
  fail("Cannot find 微信开发者工具 installation. Set WECHAT_DEVTOOLS_DIR or pass --devtools-dir.");
}

prepareUploadWorkspace();
compileTypeScript();
copyProjectAssets();
upload();

function prepareUploadWorkspace() {
  fs.rmSync(uploadRoot, { recursive: true, force: true });
  fs.mkdirSync(uploadMiniprogramDir, { recursive: true });
  fs.mkdirSync(path.dirname(uploadInfoPath), { recursive: true });
}

function compileTypeScript() {
  const tscBin = path.join(projectRoot, "node_modules", "typescript", "bin", "tsc");
  runOrThrow(process.execPath, [
    tscBin,
    "-p",
    path.join(projectRoot, "miniprogram", "tsconfig.json"),
    "--noEmit",
    "false",
    "--outDir",
    uploadMiniprogramDir,
    "--rootDir",
    sourceMiniprogramDir
  ]);

  fs.rmSync(path.join(uploadMiniprogramDir, "tests"), { recursive: true, force: true });
}

function copyProjectAssets() {
  copyDirectory(sourceMiniprogramDir, uploadMiniprogramDir, (sourcePath) => path.extname(sourcePath) !== ".ts");
  copyFile(path.join(projectRoot, "project.config.json"), path.join(uploadRoot, "project.config.json"));

  const privateProjectConfig = path.join(projectRoot, "project.private.config.json");
  if (fs.existsSync(privateProjectConfig)) {
    copyFile(privateProjectConfig, path.join(uploadRoot, "project.private.config.json"));
  }
}

function upload() {
  const env = { ...process.env };
  if (isWindows && devtoolsDir) {
    env.PATH = `${devtoolsDir}${path.delimiter}${process.env.PATH ?? ""}`;
  }

  const npxCommand = isWindows ? "npx.cmd" : "npx";
  const args = [
    "--yes",
    "miniprogram-ci",
    "upload",
    "--project-path",
    uploadRoot,
    "--private-key-path",
    privateKeyPath,
    "--appid",
    appId,
    "--robot",
    robot,
    "--upload-version",
    uploadVersion,
    "--upload-description",
    uploadDescription,
    "--project-ignores",
    "miniprogram/tests/**/*",
    "--use-project-config",
    "--info-output",
    uploadInfoPath
  ];

  const result = spawnSync(npxCommand, args, {
    cwd: projectRoot,
    stdio: ["inherit", "pipe", "pipe"],
    env,
    shell: isWindows,
    encoding: "utf8"
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    explainUploadFailure(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    process.exit(result.status ?? 1);
  }
}

function copyDirectory(sourceDir, targetDir, includeFile) {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      copyDirectory(sourcePath, targetPath, includeFile);
      continue;
    }

    if (includeFile(sourcePath)) {
      copyFile(sourcePath, targetPath);
    }
  }
}

function copyFile(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveWindowsDevtoolsDir(explicitPath) {
  const candidates = [
    explicitPath,
    "D:\\Program Files (x86)\\Tencent\\微信web开发者工具",
    "C:\\Program Files (x86)\\Tencent\\微信web开发者工具"
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(path.join(candidate, "node.exe"))) || "";
}

function runOrThrow(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function parseCliArgs(args) {
  const parsed = {};
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    const next = args[index + 1];

    const equalsIndex = current.indexOf("=");
    const option = equalsIndex > 0 ? current.slice(0, equalsIndex) : current;
    const inlineValue = equalsIndex > 0 ? current.slice(equalsIndex + 1) : undefined;
    const value = inlineValue ?? next;

    switch (option) {
      case "--private-key-path":
        parsed.privateKeyPath = value;
        if (inlineValue === undefined) index += 1;
        break;
      case "--appid":
        parsed.appid = value;
        if (inlineValue === undefined) index += 1;
        break;
      case "--version":
      case "--upload-version":
        parsed.version = value;
        if (inlineValue === undefined) index += 1;
        break;
      case "--description":
      case "--upload-description":
        parsed.description = value;
        if (inlineValue === undefined) index += 1;
        break;
      case "--robot":
        parsed.robot = value;
        if (inlineValue === undefined) index += 1;
        break;
      case "--devtools-dir":
        parsed.devtoolsDir = value;
        if (inlineValue === undefined) index += 1;
        break;
      default:
        if (!current.startsWith("--")) {
          positionals.push(current);
        }
        break;
    }
  }

  if (!parsed.privateKeyPath && positionals[0] && looksLikePrivateKeyPath(positionals[0])) {
    parsed.privateKeyPath = positionals.shift();
  }
  if (
    positionals.length === 1 &&
    !parsed.version &&
    !parsed.description &&
    !looksLikeVersion(positionals[0])
  ) {
    parsed.description = positionals.shift();
  }
  if (!parsed.version && positionals[0]) {
    parsed.version = positionals[0];
  }
  if (!parsed.description && positionals[1]) {
    parsed.description = positionals.slice(1).join(" ");
  }

  return parsed;
}

function looksLikePrivateKeyPath(value) {
  return /\.(key|pem)$/i.test(value) && fs.existsSync(path.resolve(value));
}

function looksLikeVersion(value) {
  return /^v?\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

function explainUploadFailure(output) {
  if (!/41001|access_token missing|inner get attr fail|code:\s*20003/i.test(output)) {
    return;
  }

  console.error("");
  console.error("WeChat code upload authentication failed before code submission.");
  console.error("The local package compiled successfully, but WeChat rejected the code-upload credential.");
  console.error("Check the Mini Program admin console:");
  console.error("1. Use the 小程序代码上传 key, not the AppSecret.");
  console.error("2. If the key was regenerated, replace the local private key file.");
  console.error("3. Disable the code-upload IP whitelist, or add this machine/CI public IP.");
  console.error("4. Re-run: npm run upload:miniprogram -- <version> <description>");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
