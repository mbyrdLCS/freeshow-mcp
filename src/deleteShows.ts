import { execSync, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { callAction } from "./freeshow.js";

// FreeShow's API has no "delete show" action, and it re-saves shows from memory, so files can't be
// removed while it runs. Instead: ask FreeShow to save and close, remove the files, and reopen it.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Electron's userData folder for FreeShow (holds config.json and the shows index)
function appDataDir(): string {
  const home = os.homedir();
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "freeshow");
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "freeshow");
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "freeshow");
}

function dataDir(): string {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(appDataDir(), "config.json"), "utf8"));
    if (config.dataPath) return config.dataPath;
  } catch {
    // fall through to FreeShow's default
  }
  return path.join(os.homedir(), "Documents", "FreeShow");
}

async function apiUp(): Promise<boolean> {
  try {
    await callAction("get_cleared");
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(500)) {
    if (await check()) return true;
  }
  return false;
}

// Is the FreeShow app process still alive? (Its API stops answering before it finishes saving and exits.)
function freeShowRunning(): boolean {
  try {
    if (process.platform === "win32") return execSync('tasklist /FI "IMAGENAME eq FreeShow.exe" /NH', { encoding: "utf8" }).includes("FreeShow.exe");
    execSync(process.platform === "darwin" ? "pgrep -x FreeShow" : "pgrep -x freeshow", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function launchFreeShow() {
  const custom = process.env.FREESHOW_APP_PATH;
  let command: string;
  let args: string[] = [];
  if (process.platform === "darwin") {
    command = "open";
    args = custom ? [custom] : ["-a", "FreeShow"];
  } else if (process.platform === "win32") {
    command = custom ?? path.join(process.env.LOCALAPPDATA ?? "", "Programs", "freeshow", "FreeShow.exe");
  } else {
    command = custom ?? "freeshow";
  }
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {}); // reported via the API-up check instead
  child.unref();
}

// .show files are JSON arrays that start with the show ID: ["<id>",{...}]
function showIdOfFile(file: string): string | undefined {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(128);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return /^\s*\[\s*"([^"]+)"/.exec(buf.toString("utf8", 0, n))?.[1];
  } finally {
    fs.closeSync(fd);
  }
}

function removeFromIndex(file: string, ids: Set<string>) {
  if (!fs.existsSync(file)) return;
  const index = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const id of ids) delete index[id];
  fs.writeFileSync(file, JSON.stringify(index), "utf8");
}

// Drop the shows from every project so no project points at a missing show
function removeFromProjects(file: string, ids: Set<string>): number {
  if (!fs.existsSync(file)) return 0;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  let removed = 0;
  for (const project of Object.values<any>(data.projects ?? {})) {
    const before = project.shows?.length ?? 0;
    project.shows = (project.shows ?? []).filter((item: { id: string }) => !ids.has(item.id));
    removed += before - project.shows.length;
  }
  fs.writeFileSync(file, JSON.stringify(data), "utf8");
  return removed;
}

/**
 * Run fn while FreeShow is closed: FreeShow saves and quits via the API, fn edits its files,
 * then FreeShow is reopened. Refuses while presenting or when FreeShow is on another computer.
 */
export async function withFreeShowClosed<T>(what: string, fn: () => T): Promise<{ result: T; freeShowRestarted: boolean; warning?: string }> {
  const host = process.env.FREESHOW_HOST ?? "localhost";
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`${what} only works when FreeShow runs on this computer (FREESHOW_HOST is ${host})`);
  }

  const output = (await callAction("get_output")) as { data?: { slide?: unknown } } | null;
  if (output?.data?.slide) {
    throw new Error(`FreeShow is presenting a slide right now. Clear the output first — ${what} restarts FreeShow.`);
  }

  await callAction("close").catch(() => {}); // FreeShow saves, then quits; the connection may drop
  if (!(await waitFor(async () => !(await apiUp()), 30000))) {
    throw new Error(`FreeShow didn't close (it may be showing a dialog). Nothing was changed.`);
  }
  // Wait for the process itself to exit: it keeps saving after the API goes down, and anything
  // written before then would be overwritten by FreeShow's in-memory copy
  if (!(await waitFor(async () => !freeShowRunning(), 30000))) {
    throw new Error(`FreeShow is still shutting down. Nothing was changed — try again in a moment.`);
  }
  await sleep(1000);

  const result = fn();

  launchFreeShow();
  const back = await waitFor(apiUp, 60000);
  return {
    result,
    freeShowRestarted: back,
    ...(!back && { warning: "FreeShow didn't come back within a minute — open it manually (set FREESHOW_APP_PATH if it's installed somewhere unusual)." }),
  };
}

export async function deleteShows(ids: string[]) {
  const root = dataDir();
  const showsDir = path.join(root, "Shows");
  const targets = new Set(ids);

  const { result, ...restart } = await withFreeShowClosed("delete_shows", () => {
    // Move (not delete) the files so they can be recovered
    const trash = path.join(root, "MCP Deleted Shows", new Date().toISOString().replace(/[:.]/g, "-"));
    const moved: string[] = [];
    if (fs.existsSync(showsDir)) {
      for (const name of fs.readdirSync(showsDir)) {
        if (!name.endsWith(".show")) continue;
        const file = path.join(showsDir, name);
        const id = showIdOfFile(file);
        if (!id || !targets.has(id)) continue;
        fs.mkdirSync(trash, { recursive: true });
        fs.renameSync(file, path.join(trash, name));
        moved.push(name);
      }
    }
    removeFromIndex(path.join(appDataDir(), "shows.json"), targets);
    removeFromIndex(path.join(root, "Config", "shows.json"), targets);
    // FreeShow keeps projects in two files; count the larger cleanup (they normally match)
    const projectItemsRemoved = Math.max(
      removeFromProjects(path.join(appDataDir(), "projects.json"), targets),
      removeFromProjects(path.join(root, "Config", "projects.json"), targets)
    );
    return { moved, trash, projectItemsRemoved };
  });

  return {
    deleted: result.moved.map((f) => f.replace(/\.show$/, "")),
    ...(result.projectItemsRemoved && { projectItemsRemoved: result.projectItemsRemoved }),
    recoverableFrom: result.moved.length ? result.trash : undefined,
    ...restart,
  };
}

// Overlays live in two files, like shows and projects. Merge new/updated overlays into both.
export function writeOverlays(overlays: Record<string, unknown>) {
  for (const file of [path.join(appDataDir(), "overlays.json"), path.join(dataDir(), "Config", "overlays.json")]) {
    if (!fs.existsSync(file)) continue;
    const existing = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...existing, ...overlays }), "utf8");
  }
}

export function readOverlays(): Record<string, { name?: string; category?: string }> {
  try {
    return JSON.parse(fs.readFileSync(path.join(appDataDir(), "overlays.json"), "utf8"));
  } catch {
    return {};
  }
}

// Templates, like overlays, live in two files
export function writeTemplates(templates: Record<string, unknown>, removeIds: string[] = []) {
  for (const file of [path.join(appDataDir(), "templates.json"), path.join(dataDir(), "Config", "templates.json")]) {
    if (!fs.existsSync(file)) continue;
    const existing = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const id of removeIds) delete existing[id];
    fs.writeFileSync(file, JSON.stringify({ ...existing, ...templates }), "utf8");
  }
}

// Merge keys into FreeShow's synced settings (e.g. scriptureSettings), in both copies
export function updateSyncedSettings(update: (settings: Record<string, any>) => void) {
  for (const file of [path.join(appDataDir(), "settings_synced.json"), path.join(dataDir(), "Config", "settings_synced.json")]) {
    if (!fs.existsSync(file)) continue;
    const settings = JSON.parse(fs.readFileSync(file, "utf8"));
    update(settings);
    fs.writeFileSync(file, JSON.stringify(settings), "utf8");
  }
}
