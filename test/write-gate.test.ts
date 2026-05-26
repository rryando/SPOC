import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWriteProposal,
  consumeWriteProposal,
  getWriteProposal,
  clearWriteProposals,
  normalizeOpName,
  requireWriteGate,
  enableWriteGateBypass,
  disableWriteGateBypass,
  type WriteProposal,
  type WriteProposalInput,
  WriteGateError,
} from "../src/utils/write-gate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<WriteProposalInput> = {}): WriteProposalInput {
  return {
    slug: "my-project",
    summary: "Update overview document",
    operations: ["update_project_doc:overview"],
    ttlMs: 60_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("write-gate token model", () => {
  let now: number;

  beforeEach(() => {
    clearWriteProposals();
    now = Date.now();
  });

  describe("createWriteProposal", () => {
    it("returns a proposal with expected fields", () => {
      const proposal = createWriteProposal(makeInput(), now);

      expect(proposal.token).toMatch(/^wp_/);
      expect(proposal.token.length).toBeGreaterThan(10);
      expect(proposal.slug).toBe("my-project");
      expect(proposal.summary).toBe("Update overview document");
      expect(proposal.operations).toEqual(["update_project_doc:overview"]);
      expect(proposal.createdAt).toBe(new Date(now).toISOString());
      expect(proposal.expiresAt).toBe(new Date(now + 60_000).toISOString());
      expect(proposal.consumedAt).toBeNull();
    });

    it("generates unique tokens across calls with different summaries", () => {
      const a = createWriteProposal(makeInput(), now);
      const b = createWriteProposal(makeInput({ summary: "different summary" }), now + 1);
      expect(a.token).not.toBe(b.token);
    });

    it("returns existing proposal for idempotent calls with same slug+ops+summary", () => {
      const a = createWriteProposal(makeInput(), now);
      const b = createWriteProposal(makeInput(), now + 1);
      expect(a.token).toBe(b.token);
    });
  });

  describe("consumeWriteProposal", () => {
    it("marks proposal as consumed", () => {
      const proposal = createWriteProposal(makeInput(), now);
      const consumed = consumeWriteProposal(proposal, "my-project", now + 1000);

      expect(consumed.consumedAt).toBe(new Date(now + 1000).toISOString());
    });

    it("rejects already-consumed proposal", () => {
      const proposal = createWriteProposal(makeInput(), now);
      const consumed = consumeWriteProposal(proposal, "my-project", now + 1000);

      expect(() => consumeWriteProposal(consumed, "my-project", now + 2000)).toThrow(
        WriteGateError,
      );
      expect(() => consumeWriteProposal(consumed, "my-project", now + 2000)).toThrow(
        /already consumed/,
      );
    });

    it("rejects expired proposal", () => {
      const proposal = createWriteProposal(makeInput({ ttlMs: 5000 }), now);

      expect(() => consumeWriteProposal(proposal, "my-project", now + 6000)).toThrow(
        WriteGateError,
      );
      expect(() => consumeWriteProposal(proposal, "my-project", now + 6000)).toThrow(/expired/);
    });

    it("rejects proposal with mismatched project scope", () => {
      const proposal = createWriteProposal(makeInput({ slug: "project-a" }), now);

      expect(() => consumeWriteProposal(proposal, "project-b", now + 1000)).toThrow(
        WriteGateError,
      );
      expect(() => consumeWriteProposal(proposal, "project-b", now + 1000)).toThrow(
        /scope mismatch/,
      );
    });

    it("accepts proposal at exact expiry boundary", () => {
      const proposal = createWriteProposal(makeInput({ ttlMs: 5000 }), now);
      // At exactly now + 5000, expiresAt = now + 5000, should still be valid
      const consumed = consumeWriteProposal(proposal, "my-project", now + 5000);
      expect(consumed.consumedAt).toBe(new Date(now + 5000).toISOString());
    });
  });

  describe("multi-op proposals (per-op consumption budget)", () => {
    beforeEach(() => {
      disableWriteGateBypass();
    });
    afterEach(() => {
      enableWriteGateBypass();
    });

    it("allows N consumptions when ops list has N entries with the same op", () => {
      // Regression for bug 3: a proposal listing task-transition 3 times should
      // authorize three task-transition mutations, not one.
      const proposal = createWriteProposal(
        makeInput({ operations: ["task-transition", "task-transition", "task-transition"] }),
        now,
      );

      // Three successive consumptions all succeed
      expect(() =>
        requireWriteGate(proposal.token, "my-project", "task-transition", now + 1000),
      ).not.toThrow();
      expect(() =>
        requireWriteGate(proposal.token, "my-project", "task-transition", now + 2000),
      ).not.toThrow();
      expect(() =>
        requireWriteGate(proposal.token, "my-project", "task-transition", now + 3000),
      ).not.toThrow();
    });

    it("rejects the (N+1)th consumption once budget is exhausted", () => {
      const proposal = createWriteProposal(
        makeInput({ operations: ["task-transition", "task-transition"] }),
        now,
      );

      requireWriteGate(proposal.token, "my-project", "task-transition", now + 1000);
      requireWriteGate(proposal.token, "my-project", "task-transition", now + 2000);

      expect(() =>
        requireWriteGate(proposal.token, "my-project", "task-transition", now + 3000),
      ).toThrow(/exhausted|already consumed|no remaining budget/i);
    });

    it("matches consumption requests by canonical op name", () => {
      // Proposal lists canonical 'plan-create'; handler passes legacy
      // 'tool:create_project_plan'. Both must resolve to the same budget slot.
      const proposal = createWriteProposal(
        makeInput({ operations: ["plan-create", "task-create"] }),
        now,
      );

      expect(() =>
        requireWriteGate(proposal.token, "my-project", "tool:create_project_plan", now + 1000),
      ).not.toThrow();
      expect(() =>
        requireWriteGate(proposal.token, "my-project", "create_project_task", now + 2000),
      ).not.toThrow();
    });

    it("rejects requested op not in the budget", () => {
      const proposal = createWriteProposal(
        makeInput({ operations: ["task-transition"] }),
        now,
      );

      expect(() =>
        requireWriteGate(proposal.token, "my-project", "plan-create", now + 1000),
      ).toThrow(/operation mismatch|not authorized/i);
    });

    it("preserves existing single-op behavior for consumeWriteProposal", () => {
      // consumeWriteProposal (used by 'spoc write apply') treats the entire
      // proposal as one-shot regardless of ops length. This is by design — it's
      // the explicit-consume API. Per-op budgeting only applies via
      // requireWriteGate (handler-driven consumption).
      const proposal = createWriteProposal(
        makeInput({ operations: ["task-transition", "task-transition"] }),
        now,
      );
      consumeWriteProposal(proposal, "my-project", now + 1000);
      expect(() => consumeWriteProposal(proposal, "my-project", now + 2000)).toThrow(
        /already consumed/,
      );
    });
  });

  describe("getWriteProposal (in-memory store)", () => {
    it("retrieves a stored proposal by token", () => {
      const proposal = createWriteProposal(makeInput(), now);
      const retrieved = getWriteProposal(proposal.token);
      expect(retrieved).toEqual(proposal);
    });

    it("returns undefined for unknown token", () => {
      expect(getWriteProposal("wp_nonexistent")).toBeUndefined();
    });
  });

  describe("normalizeOpName", () => {
    it("strips tool: prefix and normalizes underscores", () => {
      expect(normalizeOpName("tool:sync_agents_md")).toBe("sync-agents-md");
    });

    it("strips cli: prefix and normalizes underscores", () => {
      expect(normalizeOpName("cli:task_create")).toBe("task-create");
    });

    it("resolves snake_case legacy aliases to canonical kebab-case", () => {
      // create_project_task is a known legacy alias of task-create (see op-names.ts)
      expect(normalizeOpName("create_project_task")).toBe("task-create");
    });

    it("falls back to generic kebab-case for unknown ops", () => {
      // not in the registry — generic transform applies
      expect(normalizeOpName("custom_unregistered_op")).toBe("custom-unregistered-op");
    });

    it("lowercases the result", () => {
      expect(normalizeOpName("Tool:Sync_Agents")).toBe("sync-agents");
    });

    it("passes through already-normalized names", () => {
      expect(normalizeOpName("task-create")).toBe("task-create");
    });

    it("resolves canonical and tool: prefixed alias to the same value", () => {
      // Regression: handler passes "tool:create_project_plan", proposal lists "plan-create".
      // Both must normalize to the same canonical so the gate match succeeds.
      expect(normalizeOpName("tool:create_project_plan")).toBe(normalizeOpName("plan-create"));
      expect(normalizeOpName("tool:create_project_plan")).toBe("plan-create");
    });
  });
});
