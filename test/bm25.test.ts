import { describe, expect, it } from "vitest";
import { tokenize, createBm25Index } from "../src/retrieval/bm25.js";

describe("tokenize", () => {
  it("lowercases input", () => {
    expect(tokenize("Hello World")).toEqual(["hello", "world"]);
  });

  it("splits on non-alphanumeric characters", () => {
    expect(tokenize("foo-bar_baz.qux")).toEqual(["foo", "bar", "baz", "qux"]);
  });

  it("filters tokens shorter than 2 characters", () => {
    expect(tokenize("I am a big dog")).toEqual(["am", "big", "dog"]);
  });

  it("returns empty array for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("createBm25Index", () => {
  const docs = [
    { id: "1", fields: { title: "TypeScript programming", body: "Learn TypeScript basics" } },
    { id: "2", fields: { title: "JavaScript guide", body: "JavaScript is versatile" } },
    { id: "3", fields: { title: "Python tutorial", body: "Python for data science" } },
  ];

  it("returns scored results sorted by score descending", () => {
    const index = createBm25Index(docs, { title: 2, body: 1 });
    const results = index.search("typescript");
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("1");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("applies field weights — higher weight means higher score contribution", () => {
    const indexTitleHeavy = createBm25Index(docs, { title: 10, body: 1 });
    const indexBodyHeavy = createBm25Index(docs, { title: 1, body: 10 });

    // "typescript" appears in both title and body of doc 1
    const titleResult = indexTitleHeavy.search("typescript");
    const bodyResult = indexBodyHeavy.search("typescript");

    // Both find doc 1 but with different scores
    expect(titleResult[0].id).toBe("1");
    expect(bodyResult[0].id).toBe("1");
    expect(titleResult[0].score).not.toEqual(bodyResult[0].score);
  });

  it("returns empty results for empty query", () => {
    const index = createBm25Index(docs, { title: 1, body: 1 });
    expect(index.search("")).toEqual([]);
  });

  it("returns empty results for no matching documents", () => {
    const index = createBm25Index(docs, { title: 1, body: 1 });
    expect(index.search("rust")).toEqual([]);
  });

  it("returns empty results for empty documents array", () => {
    const index = createBm25Index([], { title: 1, body: 1 });
    expect(index.search("anything")).toEqual([]);
  });

  it("respects limit parameter", () => {
    const manyDocs = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      fields: { title: `document about code ${i}` },
    }));
    const index = createBm25Index(manyDocs, { title: 1 });
    const results = index.search("code");
    expect(results.length).toBe(10); // default limit

    const limited = index.search("code", 3);
    expect(limited.length).toBe(3);
  });

  it("counts document frequency once even if term appears in multiple fields", () => {
    // "typescript" appears in both title and body of doc 1
    // df should be 1, not 2
    const index = createBm25Index(docs, { title: 1, body: 1 });
    const results = index.search("typescript");
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("1");
  });

  it("only returns documents with score > 0", () => {
    const index = createBm25Index(docs, { title: 1, body: 1 });
    const results = index.search("javascript");
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0);
    }
  });
});
