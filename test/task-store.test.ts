// ---------------------------------------------------------------------------
// Tests for task-store dependsOn field
// ---------------------------------------------------------------------------

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTask, updateTask } from "../src/utils/task-store.js";

const tempDirs: string[] = [];

function makeProjectDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "arcs-task-store-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("task-store: dependsOn field", () => {
  it("creates task without dependsOn — backward compat", async () => {
    const dir = makeProjectDir();
    const task = await createTask(dir, { title: "Task A" });
    expect(task.dependsOn).toBeUndefined();
  });

  it("creates task with empty dependsOn — stores no field", async () => {
    const dir = makeProjectDir();
    const task = await createTask(dir, { title: "Task A", dependsOn: [] });
    expect(task.dependsOn).toBeUndefined();
  });

  it("creates task with valid dependsOn", async () => {
    const dir = makeProjectDir();
    const dep = await createTask(dir, { title: "Dep Task" });
    const task = await createTask(dir, { title: "Dependent Task", dependsOn: [dep.normalizedId] });
    expect(task.dependsOn).toEqual([dep.normalizedId]);
  });

  it("rejects dependsOn with unknown task ID", async () => {
    const dir = makeProjectDir();
    await expect(
      createTask(dir, { title: "Task A", dependsOn: ["nonexistent-task"] }),
    ).rejects.toThrow("does not exist");
  });

  it("rejects dependsOn creating a direct cycle", async () => {
    const dir = makeProjectDir();
    const a = await createTask(dir, { title: "Task A" });
    const b = await createTask(dir, { title: "Task B", dependsOn: [a.normalizedId] });
    // Now try to make A depend on B — would create cycle
    await expect(
      updateTask(dir, { id: a.normalizedId, dependsOn: [b.normalizedId] }),
    ).rejects.toThrow("cycle detected");
  });

  it("rejects dependsOn creating indirect cycle", async () => {
    const dir = makeProjectDir();
    const a = await createTask(dir, { title: "Task A" });
    const b = await createTask(dir, { title: "Task B", dependsOn: [a.normalizedId] });
    const c = await createTask(dir, { title: "Task C", dependsOn: [b.normalizedId] });
    // a -> b -> c, now try a depends on c
    await expect(
      updateTask(dir, { id: a.normalizedId, dependsOn: [c.normalizedId] }),
    ).rejects.toThrow("cycle detected");
  });

  it("updates task dependsOn to valid value", async () => {
    const dir = makeProjectDir();
    const a = await createTask(dir, { title: "Task A" });
    const b = await createTask(dir, { title: "Task B" });
    const updated = await updateTask(dir, { id: b.normalizedId, dependsOn: [a.normalizedId] });
    expect(updated.dependsOn).toEqual([a.normalizedId]);
  });

  it("removes dependsOn by passing null", async () => {
    const dir = makeProjectDir();
    const a = await createTask(dir, { title: "Task A" });
    const b = await createTask(dir, { title: "Task B", dependsOn: [a.normalizedId] });
    expect(b.dependsOn).toEqual([a.normalizedId]);
    const updated = await updateTask(dir, { id: b.normalizedId, dependsOn: null });
    expect(updated.dependsOn).toBeUndefined();
  });

  it("removes dependsOn by passing empty array", async () => {
    const dir = makeProjectDir();
    const a = await createTask(dir, { title: "Task A" });
    const b = await createTask(dir, { title: "Task B", dependsOn: [a.normalizedId] });
    const updated = await updateTask(dir, { id: b.normalizedId, dependsOn: [] });
    expect(updated.dependsOn).toBeUndefined();
  });

  it("error message includes cycle path", async () => {
    const dir = makeProjectDir();
    const a = await createTask(dir, { title: "Task A" });
    const b = await createTask(dir, { title: "Task B", dependsOn: [a.normalizedId] });
    await expect(
      updateTask(dir, { id: a.normalizedId, dependsOn: [b.normalizedId] }),
    ).rejects.toThrow(/→/);
  });

  it("tasks without dependsOn field work as before — update other fields", async () => {
    const dir = makeProjectDir();
    const task = await createTask(dir, { title: "Task A" });
    const updated = await updateTask(dir, { id: task.normalizedId, status: "in_progress" });
    expect(updated.status).toBe("in_progress");
    expect(updated.dependsOn).toBeUndefined();
  });
});
