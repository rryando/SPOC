import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runCommand } from "./helpers/cli-runner.js";
import { withTempDataDir } from "./helpers/temp-data-dir.js";

describe("diagram init", () => {
  it("creates .mmd with correct content from plan tasks", async () => {
    await withTempDataDir(async () => {
      await runCommand("project init", ["testproj", "--description=Test project"]);
      const planResult = await runCommand("plan create", [
        "testproj",
        "Test Plan",
        "--summary=test",
        "--status=planned",
      ]);
      expect(planResult.ok).toBe(true);
      const planId = (planResult.data as { id: string }).id;

      await runCommand("task create", ["testproj", "Task One", `--planId=${planId}`]);
      await runCommand("task create", ["testproj", "Task Two", `--planId=${planId}`]);

      const result = await runCommand("diagram init", ["testproj", planId]);

      expect(result.ok).toBe(true);
      expect((result.data as { nodeCount: number }).nodeCount).toBe(2);

      const mmd = await readFile((result.data as { path: string }).path, "utf-8");
      expect(mmd).toContain("flowchart TD");
      expect(mmd).toContain("classDef backlog");
      expect(mmd).toContain("Task One");
      expect(mmd).toContain(`%% plan: ${planId}`);
      expect(mmd).toContain("T001[");
    });
  });

  it("returns entity_not_found when plan has no tasks", async () => {
    await withTempDataDir(async () => {
      await runCommand("project init", ["testproj", "--description=Test project"]);
      const planResult = await runCommand("plan create", [
        "testproj",
        "Empty Plan",
        "--summary=empty",
        "--status=planned",
      ]);
      const planId = (planResult.data as { id: string }).id;

      const result = await runCommand("diagram init", ["testproj", planId]);

      expect(result.ok).toBe(false);
      expect((result as { code: string }).code).toBe("entity_not_found");
    });
  });

  it("returns conflict when .mmd exists without --force", async () => {
    await withTempDataDir(async () => {
      await runCommand("project init", ["testproj", "--description=Test project"]);
      const planResult = await runCommand("plan create", [
        "testproj",
        "Test Plan",
        "--summary=s",
        "--status=planned",
      ]);
      const planId = (planResult.data as { id: string }).id;
      await runCommand("task create", ["testproj", "T1", `--planId=${planId}`]);

      await runCommand("diagram init", ["testproj", planId]);
      const second = await runCommand("diagram init", ["testproj", planId]);

      expect(second.ok).toBe(false);
      expect((second as { code: string }).code).toBe("conflict");
    });
  });

  it("--force overwrites existing .mmd", async () => {
    await withTempDataDir(async () => {
      await runCommand("project init", ["testproj", "--description=Test project"]);
      const planResult = await runCommand("plan create", [
        "testproj",
        "Test Plan",
        "--summary=s",
        "--status=planned",
      ]);
      const planId = (planResult.data as { id: string }).id;
      await runCommand("task create", ["testproj", "T1", `--planId=${planId}`]);

      await runCommand("diagram init", ["testproj", planId]);
      const result = await runCommand("diagram init", ["testproj", planId, "--force"]);

      expect(result.ok).toBe(true);
    });
  });
});
