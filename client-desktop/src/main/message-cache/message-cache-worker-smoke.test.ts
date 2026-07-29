// @vitest-environment node
import { Worker } from "node:worker_threads"
import { describe, expect, it } from "vitest"

describe("消息缓存 Worker 开发环境门槛", () => {
  it("在 Worker 中加载 node:sqlite、执行事务并关闭临时库", async () => {
    const result = await new Promise<string>((resolve, reject) => {
      const worker = new Worker(
        `
          const { parentPort } = require("node:worker_threads");
          const { DatabaseSync } = require("node:sqlite");
          const database = new DatabaseSync(":memory:");
          database.exec("BEGIN; CREATE TABLE smoke (value TEXT); INSERT INTO smoke VALUES ('ok'); COMMIT;");
          const row = database.prepare("SELECT value FROM smoke").get();
          database.close();
          parentPort.postMessage(row.value);
        `,
        { eval: true },
      )
      worker.once("message", resolve)
      worker.once("error", reject)
    })
    expect(result).toBe("ok")
  })
})
