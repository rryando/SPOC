// ---------------------------------------------------------------------------
// CLI Envelope Format Tests — validates the new registry-based JSON envelope
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { runCommand } from "./helpers/cli-runner.js";
import { withTempDataDir } from "./helpers/temp-data-dir.js";

// ---------------------------------------------------------------------------
// Helper: create a test project through the registry
// ---------------------------------------------------------------------------

async function createTestProject(slug = "test-proj"): Promise<void> {
  await runCommand("project init", [slug, "--description=Test project"]);
}

// ---------------------------------------------------------------------------
// Success envelope shape
// ---------------------------------------------------------------------------

describe("CLI envelope format — success", () => {
  it("project list returns ok envelope with array", async () => {
    await withTempDataDir(async () => {
      const result = await runCommand("project list", []);
      expect(result.ok).toBe(true);
      if (result.ok) expect(Array.isArray(result.data)).toBe(true);
    });
  });

  it("task list returns ok envelope with array", async () => {
    await withTempDataDir(async () => {
      await createTestProject();
      const result = await runCommand("task list", ["test-proj"]);
      expect(result.ok).toBe(true);
      if (result.ok) expect(Array.isArray(result.data)).toBe(true);
    });
  });

  it("knowledge list returns ok envelope with array", async () => {
    await withTempDataDir(async () => {
      await createTestProject();
      const result = await runCommand("knowledge list", ["test-proj"]);
      expect(result.ok).toBe(true);
      if (result.ok) expect(Array.isArray(result.data)).toBe(true);
    });
  });

  it("project get returns ok envelope with object", async () => {
    await withTempDataDir(async () => {
      await createTestProject();
      const result = await runCommand("project get", ["test-proj"]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveProperty("name");
      }
    });
  });

  it("validate returns ok envelope", async () => {
    await withTempDataDir(async () => {
      await createTestProject();
      const result = await runCommand("validate", ["test-proj"]);
      expect(result.ok).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Error envelope shape
// ---------------------------------------------------------------------------

describe("CLI envelope format — errors", () => {
  it("unknown flag returns structured error with code", async () => {
    await withTempDataDir(async () => {
      const result = await runCommand("project list", ["--bogus=flag"]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("unknown_flag");
        expect(result.message).toContain("--bogus");
      }
    });
  });

  it("missing required param returns error with param name", async () => {
    await withTempDataDir(async () => {
      const result = await runCommand("task transition", ["--slug=test-proj"]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("missing_param");
        expect(result.param).toBeDefined();
      }
    });
  });

  it("invalid enum value returns invalid_enum error", async () => {
    await withTempDataDir(async () => {
      await createTestProject();
      const result = await runCommand("task list", ["test-proj", "--status=invalid_status"]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("invalid_enum");
        expect(result.hint).toContain("backlog");
      }
    });
  });

  it("project_not_found returns proper error envelope", async () => {
    await withTempDataDir(async () => {
      const result = await runCommand("task list", ["nonexistent"]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("project_not_found");
        expect(result.hint).toBeDefined();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Dry-run behavior
// ---------------------------------------------------------------------------

describe("CLI envelope format — dry-run", () => {
  it("project init --dry-run returns dryRun without creating", async () => {
    await withTempDataDir(async () => {
      const result = await runCommand("project init", [
        "dry-test",
        "--description=Dry run test",
        "--dry-run",
      ]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as Record<string, unknown>;
        expect(data.dryRun).toBe(true);
      }
      // Project should not actually exist
      const listResult = await runCommand("project list", []);
      if (listResult.ok) {
        expect(listResult.data).toEqual([]);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Help flag
// ---------------------------------------------------------------------------

describe("CLI envelope format — help", () => {
  it("--help returns early with help data", async () => {
    await withTempDataDir(async () => {
      const result = await runCommand("task list", ["--help"]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as Record<string, unknown>;
        expect(data.help).toBe(true);
        expect(data.path).toBe("task list");
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

describe("CLI envelope format — search", () => {
  it("search returns ok envelope", async () => {
    await withTempDataDir(async () => {
      await createTestProject();
      const result = await runCommand("search", ["test-proj", "--query=something"]);
      expect(result.ok).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Batch --list-ops
// ---------------------------------------------------------------------------

describe("CLI envelope format — batch", () => {
  it("batch --list-ops returns available operations", async () => {
    await withTempDataDir(async () => {
      await createTestProject();
      const result = await runCommand("batch", ["--file=dummy.json", "--list-ops"]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as Record<string, unknown>;
        expect(data.ops).toBeDefined();
      }
    });
  });

  it("--commands --json is wrapped in {ok,data} envelope", async () => {
    const { execSync } = await import("node:child_process");
    const raw = execSync("node scripts/arcs-cli.mjs --commands --json", {
      encoding: "utf8",
      cwd: `${import.meta.dirname}/..`,
    });
    const parsed = JSON.parse(raw);
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.data.commands)).toBe(true);
    expect(Array.isArray(parsed.data.errorCodes)).toBe(true);
  });
});
