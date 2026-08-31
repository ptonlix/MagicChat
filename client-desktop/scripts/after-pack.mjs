import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"

const execute = promisify(execFile)

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return
  const applicationPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  )
  const plistPath = path.join(applicationPath, "Contents", "Info.plist")
  await execute("/usr/bin/plutil", [
    "-replace",
    "NSAppTransportSecurity.NSAllowsArbitraryLoads",
    "-bool",
    "NO",
    plistPath,
  ])
  await execute("/usr/bin/plutil", [
    "-replace",
    "NSAppTransportSecurity.NSAllowsLocalNetworking",
    "-bool",
    "NO",
    plistPath,
  ])
  await execute("/usr/bin/plutil", [
    "-remove",
    "NSAppTransportSecurity.NSExceptionDomains",
    plistPath,
  ]).catch(() => undefined)
  await execute("/usr/bin/xattr", ["-cr", applicationPath])
}
