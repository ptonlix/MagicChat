import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"

const execute = promisify(execFile)

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return
  const plistPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    "Contents",
    "Info.plist",
  )
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
}
