import { describe, expect, it } from "vitest";
import {
  normalizeWorkspacePath,
  matchWorkspace,
  findBestMatch,
} from "../src/utils/workspace-match.js";

describe("normalizeWorkspacePath", () => {
  it("strips trailing slash", () => {
    expect(normalizeWorkspacePath("/foo/bar/")).toBe("/foo/bar");
  });

  it("leaves clean paths unchanged", () => {
    expect(normalizeWorkspacePath("/foo/bar")).toBe("/foo/bar");
  });

  it("preserves root slash", () => {
    expect(normalizeWorkspacePath("/")).toBe("/");
  });

  it("strips multiple trailing slashes", () => {
    expect(normalizeWorkspacePath("/foo/bar///")).toBe("/foo/bar");
  });
});

describe("matchWorkspace", () => {
  it("matches exact path", () => {
    expect(matchWorkspace("/Users/ryan/project", "/Users/ryan/project")).toBe(true);
  });

  it("matches subdirectory", () => {
    expect(matchWorkspace("/Users/ryan/project/src", "/Users/ryan/project")).toBe(true);
  });

  it("rejects partial segment match", () => {
    expect(matchWorkspace("/Users/ryan.ryn/project", "/Users/ryan")).toBe(false);
  });

  it("rejects no-match", () => {
    expect(matchWorkspace("/other/path", "/Users/ryan/project")).toBe(false);
  });

  it("handles trailing slashes in stored path", () => {
    expect(matchWorkspace("/Users/ryan/project/src", "/Users/ryan/project/")).toBe(true);
  });
});

describe("findBestMatch", () => {
  const projects = [
    { slug: "parent", workspacePaths: ["/Users/ryan/projects"] },
    { slug: "child", workspacePaths: ["/Users/ryan/projects/child-app"] },
    { slug: "other", workspacePaths: ["/other/path"] },
  ];

  it("returns most specific match", () => {
    const result = findBestMatch("/Users/ryan/projects/child-app/src", projects);
    expect(result).toEqual({
      kind: "match",
      slug: "child",
      matchedPath: "/Users/ryan/projects/child-app",
    });
  });

  it("returns parent when in parent dir", () => {
    const result = findBestMatch("/Users/ryan/projects/another-thing", projects);
    expect(result).toEqual({
      kind: "match",
      slug: "parent",
      matchedPath: "/Users/ryan/projects",
    });
  });

  it("returns none when no match", () => {
    const result = findBestMatch("/completely/different", projects);
    expect(result).toEqual({ kind: "none" });
  });

  it("skips projects with empty workspacePaths", () => {
    const withEmpty = [...projects, { slug: "empty", workspacePaths: [] }];
    const result = findBestMatch("/completely/different", withEmpty);
    expect(result).toEqual({ kind: "none" });
  });

  it("returns ambiguous for matches at same depth from different projects", () => {
    const ambiguous = [
      { slug: "a", workspacePaths: ["/same/path"] },
      { slug: "b", workspacePaths: ["/same/path"] },
    ];
    const result = findBestMatch("/same/path/sub", ambiguous);
    expect(result).toEqual({
      kind: "ambiguous",
      slugs: ["a", "b"],
    });
  });

  it("returns match when same project has multiple paths at same depth", () => {
    const multiPath = [
      { slug: "mono", workspacePaths: ["/same/path", "/same/path"] },
    ];
    const result = findBestMatch("/same/path/sub", multiPath);
    expect(result).toEqual({
      kind: "match",
      slug: "mono",
      matchedPath: "/same/path",
    });
  });
});
