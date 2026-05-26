import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DagError } from "../src/utils/errors.js";
import {
  cancelLoop,
  clearLoopState,
  DEFAULT_COMPLETION_PROMISE,
  DEFAULT_MAX_ITERATIONS,
  findActiveLoop,
  incrementLoopIteration,
  LOOP_STATE_FILE,
  type LoopState,
  readLoopState,
  startLoop,
  writeLoopState,
} from "../src/utils/loop-state.js";

const tempDirs: string[] = [];

function makeProjectDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "spoc-loop-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeLoopState(overrides: Partial<LoopState> = {}): LoopState {
  return {
    active: true,
    iteration: 0,
    maxIterations: 100,
    completionPromise: "DONE",
    startedAt: "2026-04-10T12:00:00.000Z",
    prompt: "Fix all bugs",
    sessionId: "session-abc",
    strategy: "continue",
    projectSlug: "my-project",
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// readLoopState
// ---------------------------------------------------------------------------

describe("readLoopState", () => {
  it("returns null for non-existent file", async () => {
    const projectDir = makeProjectDir();
    const result = await readLoopState(projectDir);
    expect(result).toBeNull();
  });

  it("returns parsed state for valid file", async () => {
    const projectDir = makeProjectDir();
    const state = makeLoopState();
    writeFileSync(join(projectDir, LOOP_STATE_FILE), JSON.stringify(state), "utf-8");

    const result = await readLoopState(projectDir);
    expect(result).toEqual(state);
  });

  it("returns null for corrupted JSON", async () => {
    const projectDir = makeProjectDir();
    writeFileSync(join(projectDir, LOOP_STATE_FILE), "{not-valid-json", "utf-8");

    const result = await readLoopState(projectDir);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// writeLoopState / readLoopState roundtrip
// ---------------------------------------------------------------------------

describe("writeLoopState / readLoopState roundtrip", () => {
  it("writes state then reads it back with equality", async () => {
    const projectDir = makeProjectDir();
    const state = makeLoopState({
      iteration: 5,
      maxIterations: 50,
      completionPromise: "ALL_DONE",
      strategy: "reset",
      messageCountAtStart: 3,
    });

    await writeLoopState(projectDir, state);
    const result = await readLoopState(projectDir);
    expect(result).toEqual(state);
  });
});

// ---------------------------------------------------------------------------
// clearLoopState
// ---------------------------------------------------------------------------

describe("clearLoopState", () => {
  it("returns true when file exists and is cleared", async () => {
    const projectDir = makeProjectDir();
    writeFileSync(join(projectDir, LOOP_STATE_FILE), "{}", "utf-8");

    const result = await clearLoopState(projectDir);
    expect(result).toBe(true);
    expect(existsSync(join(projectDir, LOOP_STATE_FILE))).toBe(false);
  });

  it("returns false when no file exists", async () => {
    const projectDir = makeProjectDir();

    const result = await clearLoopState(projectDir);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// incrementLoopIteration
// ---------------------------------------------------------------------------

describe("incrementLoopIteration", () => {
  it("increments iteration count by 1", async () => {
    const projectDir = makeProjectDir();
    const state = makeLoopState({ iteration: 3 });
    await writeLoopState(projectDir, state);

    const result = await incrementLoopIteration(projectDir);
    expect(result).not.toBeNull();
    expect(result!.iteration).toBe(4);
  });

  it("returns null when no state file", async () => {
    const projectDir = makeProjectDir();
    const result = await incrementLoopIteration(projectDir);
    expect(result).toBeNull();
  });

  it("persists the incremented state", async () => {
    const projectDir = makeProjectDir();
    const state = makeLoopState({ iteration: 7 });
    await writeLoopState(projectDir, state);

    await incrementLoopIteration(projectDir);

    const persisted = await readLoopState(projectDir);
    expect(persisted).not.toBeNull();
    expect(persisted!.iteration).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// startLoop
// ---------------------------------------------------------------------------

describe("startLoop", () => {
  it("creates initial state with defaults", async () => {
    const projectDir = makeProjectDir();

    const state = await startLoop(projectDir, {
      sessionId: "sess-1",
      prompt: "Do the thing",
      projectSlug: "test-proj",
    });

    expect(state.active).toBe(true);
    expect(state.iteration).toBe(0);
    expect(state.maxIterations).toBe(DEFAULT_MAX_ITERATIONS);
    expect(state.completionPromise).toBe(DEFAULT_COMPLETION_PROMISE);
    expect(state.strategy).toBe("continue");
    expect(state.sessionId).toBe("sess-1");
    expect(state.prompt).toBe("Do the thing");
    expect(state.projectSlug).toBe("test-proj");
    expect(state.startedAt).toBeTruthy();
    expect(state.messageCountAtStart).toBeUndefined();
  });

  it("respects custom options", async () => {
    const projectDir = makeProjectDir();

    const state = await startLoop(projectDir, {
      sessionId: "sess-2",
      prompt: "Custom loop",
      projectSlug: "custom-proj",
      maxIterations: 25,
      completionPromise: "FINISHED",
      strategy: "reset",
      messageCountAtStart: 10,
    });

    expect(state.maxIterations).toBe(25);
    expect(state.completionPromise).toBe("FINISHED");
    expect(state.strategy).toBe("reset");
    expect(state.messageCountAtStart).toBe(10);
  });

  it("throws DagError with code LOOP_ALREADY_ACTIVE when a loop is already active", async () => {
    const projectDir = makeProjectDir();

    await startLoop(projectDir, {
      sessionId: "sess-first",
      prompt: "First loop",
      projectSlug: "proj-1",
    });

    await expect(
      startLoop(projectDir, {
        sessionId: "sess-second",
        prompt: "Second loop",
        projectSlug: "proj-1",
      }),
    ).rejects.toThrow(DagError);

    try {
      await startLoop(projectDir, {
        sessionId: "sess-second",
        prompt: "Second loop",
        projectSlug: "proj-1",
      });
    } catch (err) {
      expect(err).toBeInstanceOf(DagError);
      expect((err as DagError).code).toBe("LOOP_ALREADY_ACTIVE");
    }
  });

  it("allows starting if previous loop was not active", async () => {
    const projectDir = makeProjectDir();
    const inactiveState = makeLoopState({ active: false });
    await writeLoopState(projectDir, inactiveState);

    const state = await startLoop(projectDir, {
      sessionId: "sess-new",
      prompt: "New loop",
      projectSlug: "proj-2",
    });

    expect(state.active).toBe(true);
    expect(state.sessionId).toBe("sess-new");
  });
});

// ---------------------------------------------------------------------------
// cancelLoop
// ---------------------------------------------------------------------------

describe("cancelLoop", () => {
  it("returns true and clears when session matches", async () => {
    const projectDir = makeProjectDir();
    await startLoop(projectDir, {
      sessionId: "sess-cancel",
      prompt: "Cancel me",
      projectSlug: "proj-cancel",
    });

    const result = await cancelLoop(projectDir, "sess-cancel");
    expect(result).toBe(true);
    expect(existsSync(join(projectDir, LOOP_STATE_FILE))).toBe(false);
  });

  it("returns false when session doesn't match", async () => {
    const projectDir = makeProjectDir();
    await startLoop(projectDir, {
      sessionId: "sess-real",
      prompt: "Real session",
      projectSlug: "proj-mismatch",
    });

    const result = await cancelLoop(projectDir, "sess-wrong");
    expect(result).toBe(false);
    // State file should still exist
    expect(existsSync(join(projectDir, LOOP_STATE_FILE))).toBe(true);
  });

  it("returns false when no active loop", async () => {
    const projectDir = makeProjectDir();
    const result = await cancelLoop(projectDir, "sess-none");
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findActiveLoop
// ---------------------------------------------------------------------------

describe("findActiveLoop", () => {
  let originalDataDir: string | undefined;
  let spocDataDir: string;

  beforeEach(() => {
    originalDataDir = process.env.SPOC_DATA_DIR;
    spocDataDir = mkdtempSync(resolve(tmpdir(), "spoc-loop-find-"));
    tempDirs.push(spocDataDir);
    process.env.SPOC_DATA_DIR = spocDataDir;
  });

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.SPOC_DATA_DIR;
    } else {
      process.env.SPOC_DATA_DIR = originalDataDir;
    }
  });

  function setupMeta(projects: Array<{ id: string }>): void {
    writeFileSync(
      join(spocDataDir, "meta.json"),
      JSON.stringify({ version: "1.0", projects }),
      "utf-8",
    );
    for (const p of projects) {
      mkdirSync(join(spocDataDir, "projects", p.id), { recursive: true });
    }
  }

  it("returns null when no meta.json exists", async () => {
    const result = await findActiveLoop();
    expect(result).toBeNull();
  });

  it("returns null when no projects exist", async () => {
    setupMeta([]);
    const result = await findActiveLoop();
    expect(result).toBeNull();
  });

  it("returns null when no active loops", async () => {
    setupMeta([{ id: "proj-a" }, { id: "proj-b" }]);

    // Write an inactive loop state to proj-a
    const inactiveState = makeLoopState({ active: false, projectSlug: "proj-a" });
    writeFileSync(
      join(spocDataDir, "projects", "proj-a", LOOP_STATE_FILE),
      JSON.stringify(inactiveState),
      "utf-8",
    );

    const result = await findActiveLoop();
    expect(result).toBeNull();
  });

  it("returns the active loop with slug, projectDir, and state", async () => {
    setupMeta([{ id: "proj-a" }, { id: "proj-b" }]);

    const activeState = makeLoopState({ active: true, projectSlug: "proj-b" });
    writeFileSync(
      join(spocDataDir, "projects", "proj-b", LOOP_STATE_FILE),
      JSON.stringify(activeState),
      "utf-8",
    );

    const result = await findActiveLoop();
    expect(result).not.toBeNull();
    expect(result!.slug).toBe("proj-b");
    expect(result!.projectDir).toBe(join(spocDataDir, "projects", "proj-b"));
    expect(result!.state).toEqual(activeState);
  });
});
