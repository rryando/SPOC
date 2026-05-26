// ---------------------------------------------------------------------------
// CLI Envelope Format Tests — validates the new registry-based JSON envelope
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { runCommand } from "./helpers/cli-runner.js";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { enableWriteGateBypass, disableWriteGateBypass } from "../src/utils/write-gate.js";

// ---------------------------------------------------------------------------
// Helper: create a test project through the registry
// ---------------------------------------------------------------------------

async function createTestProject(slug = "test-proj"): Promise<void> {
  enableWriteGateBypass();
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
      const result = await runCommand("write propose", ["--slug=spoc"]);
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
// Write-gate errors
// ---------------------------------------------------------------------------

describe("CLI envelope format — write-gate", () => {
  it("write command without token returns error", async () => {
    await withTempDataDir(async () => {
      await createTestProject();
      disableWriteGateBypass();
      try {
        const result = await runCommand("project init", ["another-proj", "--description=Test"]);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBeDefined();
          expect(result.message).toBeDefined();
        }
      } finally {
        enableWriteGateBypass();
      }
    });
  });

  it("write propose with valid args succeeds", async () => {
    await withTempDataDir(async () => {
      await createTestProject();
      const result = await runCommand("write propose", [
        "--summary=test change",
        "--ops=tool:test",
        "--slug=test-proj",
      ]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as Record<string, unknown>;
        expect(data.token).toBeDefined();
        expect(data.slug).toBe("test-proj");
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Dry-run behavior
// ---------------------------------------------------------------------------

describe("CLI envelope format — dry-run", () => {
  it("write propose --dry-run returns dryRun in data", async () => {
    await withTempDataDir(async () => {
      await createTestProject();
      const result = await runCommand("write propose", [
        "--summary=test",
        "--ops=tool:test",
        "--slug=test-proj",
        "--dry-run",
      ]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as Record<string, unknown>;
        expect(data.dryRun).toBe(true);
        expect(data.wouldCreate).toBeDefined();
      }
    });
  });

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

  it("--help skips required param validation", async () => {
    await withTempDataDir(async () => {
      // write propose normally requires summary, ops, slug — but --help should bypass
      const result = await runCommand("write propose", ["--help"]);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const data = result.data as Record<string, unknown>;
        expect(data.help).toBe(true);
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
});
