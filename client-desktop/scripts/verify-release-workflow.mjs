import path from "node:path"
import { readWorkflow, validateDesktopReleaseWorkflow } from "./workflow-tools.mjs"

const workflowPath = path.resolve(
  import.meta.dirname,
  "../../.github/workflows/desktop-release.yml",
)
validateDesktopReleaseWorkflow(await readWorkflow(workflowPath))
console.log(JSON.stringify({ workflow: workflowPath, status: "ok" }))
