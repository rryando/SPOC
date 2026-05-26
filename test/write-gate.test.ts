import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWriteProposal,
  consumeWriteProposal,
  getWriteProposal,
  clearWriteProposals,
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
});
