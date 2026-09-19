import test from "node:test";
import assert from "node:assert/strict";
import {
  getGitStatus,
  getGitLog,
  getGitBranches,
  getGitFiles,
  getGitFileContent,
} from "../lib/server/git-service";

test("getGitStatus returns valid repository status", () => {
  const status = getGitStatus();
  assert.ok(status.branch, "Branch must be defined");
  assert.ok(typeof status.clean === "boolean", "Clean status must be boolean");
  assert.ok(Array.isArray(status.files), "Files must be an array");
  assert.ok(status.totalCommits >= 1, "Total commits must be at least 1");
});

test("getGitLog returns recent commits with expected fields", () => {
  const commits = getGitLog(5);
  assert.ok(Array.isArray(commits), "Commits must be an array");
  assert.ok(commits.length > 0, "Must return at least one commit");
  const first = commits[0];
  assert.ok(first.hash, "Commit must have hash");
  assert.ok(first.author, "Commit must have author");
  assert.ok(first.message, "Commit must have message");
});

test("getGitBranches lists current branch and remote branches", () => {
  const branches = getGitBranches();
  assert.ok(Array.isArray(branches), "Branches must be an array");
  assert.ok(branches.some((b) => b.current), "Must have one current branch");
});

test("getGitFiles lists files from repository", () => {
  const files = getGitFiles();
  assert.ok(Array.isArray(files), "Files must be an array");
  assert.ok(files.length > 0, "Must list repository files");
  assert.ok(files.includes("package.json"), "package.json must be in file list");
});

test("getGitFileContent safely reads package.json", () => {
  const result = getGitFileContent("package.json");
  assert.ok(!result.error, "Should not error on valid file");
  assert.ok(result.content.includes("self-hosted-control-center"), "Content must match");
});

test("getGitFileContent blocks directory traversal", () => {
  const result = getGitFileContent("../../windows/system32/cmd.exe");
  assert.ok(result.error, "Must block directory traversal attempt");
});

test("getGitFileContent blocks sensitive files like .env", () => {
  const result = getGitFileContent(".env");
  assert.ok(result.error, "Must block reading .env file");
  assert.equal(result.content, "");
});
