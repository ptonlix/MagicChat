import { spawn, type ChildProcess } from "node:child_process"
import { chmod, copyFile, rm } from "node:fs/promises"

type DesktopPackageInstallerOptions = Readonly<{
  appImagePath?: string
  downloadedPath: string
  openPath: (filePath: string) => Promise<string>
  platform: NodeJS.Platform
  quit: () => void
  runtimePid?: number
  runtimeExecutablePath?: string
  spawnDetached?: typeof spawn
}>

export async function installDesktopPackage(
  options: DesktopPackageInstallerOptions,
): Promise<void> {
  if (options.platform === "darwin") {
    const executablePath = options.runtimeExecutablePath ?? process.execPath
    const targetAppPath = executablePath.split("/Contents/")[0]
    const script = `
set -eu
parent_pid="$1"
dmg_path="$2"
target_app="$3"
mount_path="$(mktemp -d /tmp/magicchat-update.XXXXXX)"
while kill -0 "$parent_pid" 2>/dev/null; do sleep 1; done
mounted=0
cleanup() {
  if [ "$mounted" -eq 1 ]; then hdiutil detach "$mount_path" -quiet || true; fi
  rmdir "$mount_path" 2>/dev/null || true
}
trap cleanup EXIT
hdiutil attach "$dmg_path" -mountpoint "$mount_path" -nobrowse -readonly -quiet
mounted=1
source_app="$(find "$mount_path" -maxdepth 1 -name '*.app' -print -quit)"
if [ -z "$source_app" ]; then exit 1; fi
ditto "$source_app" "$target_app"
open "$target_app"
`.trim()
    const child = (options.spawnDetached ?? spawn)(
      "/bin/sh",
      [
        "-c",
        script,
        "magicchat-macos-updater",
        String(options.runtimePid ?? process.pid),
        options.downloadedPath,
        targetAppPath,
      ],
      { detached: true, stdio: "ignore" },
    )
    await waitForSpawn(child)
    child.unref()
    options.quit()
    return
  }
  if (options.platform === "win32") {
    const child = (options.spawnDetached ?? spawn)(options.downloadedPath, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    })
    await waitForSpawn(child)
    child.unref()
    options.quit()
    return
  }
  if (options.platform !== "linux" || !options.appImagePath) {
    throw new Error("platform installation source unsupported")
  }
  const script = `
set -eu
parent_pid="$1"
target_path="$2"
staged_path="$3"
backup_path="$4"
while kill -0 "$parent_pid" 2>/dev/null; do sleep 1; done
if [ -e "$target_path" ]; then mv "$target_path" "$backup_path"; fi
if mv "$staged_path" "$target_path"; then
  chmod 700 "$target_path"
  rm -f "$backup_path"
  exec "$target_path"
fi
if [ -e "$backup_path" ]; then mv "$backup_path" "$target_path"; fi
exit 1
`.trim()
  const target = options.appImagePath
  const staged = `${target}.magicchat-update`
  await copyFile(options.downloadedPath, staged)
  await chmod(staged, 0o700)
  try {
    const child = (options.spawnDetached ?? spawn)(
      "/bin/sh",
      [
        "-c",
        script,
        "magicchat-appimage-updater",
        String(options.runtimePid ?? process.pid),
        target,
        staged,
        `${target}.magicchat-backup`,
      ],
      { detached: true, stdio: "ignore" },
    )
    await waitForSpawn(child)
    child.unref()
    options.quit()
  } catch (error) {
    await rm(staged, { force: true }).catch(() => undefined)
    throw error
  }
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve)
    child.once("error", reject)
  })
}
