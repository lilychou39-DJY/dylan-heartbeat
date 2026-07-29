// Railway/容器部署入口：把运行数据指向持久卷，然后同时拉起 gateway 和 wake-up。
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || "/data";
const PERSISTED_FILES = [
  "enhanced_messages.json",
  "message_timestamps.json",
  "presets.json",
];
const PERSISTED_DIRS = ["diary"];

// server.js 与 wake_up.js 都按应用目录读写运行数据，容器重启会清空。
// 软链到挂载的卷上，避免改动上游文件导致后续同步冲突。
function linkToVolume() {
  if (!fs.existsSync(DATA_DIR)) {
    console.log(`[start-all] 未挂载 ${DATA_DIR}，运行数据将随容器重启丢失`);
    return;
  }
  for (const name of [...PERSISTED_FILES, ...PERSISTED_DIRS]) {
    const target = path.join(DATA_DIR, name);
    const link = path.join(__dirname, name);
    if (PERSISTED_DIRS.includes(name)) fs.mkdirSync(target, { recursive: true });
    const existing = fs.lstatSync(link, { throwIfNoEntry: false });
    if (existing?.isSymbolicLink() && fs.readlinkSync(link) === target) continue;
    if (existing) {
      // 首次挂载时把容器里已有的数据搬到卷上，避免丢历史。
      if (!fs.existsSync(target)) fs.renameSync(link, target);
      else fs.rmSync(link, { recursive: true, force: true });
    }
    fs.symlinkSync(target, link);
  }
  console.log(`[start-all] 运行数据已指向 ${DATA_DIR}`);
}

linkToVolume();

const children = ["server.js", "wake_up.js"].map((file) =>
  spawn(process.execPath, [file], { stdio: "inherit", cwd: __dirname })
);

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  process.exit(code);
}

// 任一进程退出都让容器整体重启，否则会剩下一个半死的服务继续跑。
children.forEach((child, i) => {
  child.on("exit", (code, signal) => {
    console.error(`[start-all] ${["server.js", "wake_up.js"][i]} 退出 code=${code} signal=${signal}`);
    shutdown(code ?? 1);
  });
});

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
