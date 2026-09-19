import test from "node:test";
import assert from "node:assert/strict";
import {
  readContentOsState,
  addMemoryNote,
  deleteMemoryNote,
  runWorkflowStage,
  resetWorkflow,
  addWarRoomMessage,
  updateTokenSettings,
  toggleAgentStatus,
} from "../lib/content-os-store";

test("Agent OS State: verifies default seeding, agents, memories, pipelines, and token config", () => {
  const state = readContentOsState();

  // Agent Fleet
  assert.ok(Array.isArray(state.agents));
  assert.ok((state.agents?.length ?? 0) >= 8, "Expected at least 8 agents in fleet");
  const hermes = state.agents?.find((a) => a.name.includes("Hermes"));
  assert.ok(hermes, "Hermes 3 agent should exist");
  assert.equal(hermes?.role, "Autonomous Executive & Fast Router");

  // Obsidian Vault Memories
  assert.ok(Array.isArray(state.memories));
  assert.ok((state.memories?.length ?? 0) >= 4, "Expected default memory notes");
  const sop = state.memories?.find((m) => m.category === "sop");
  assert.ok(sop, "Default SOP memory note should exist");

  // Production Workflow Pipelines
  assert.ok(Array.isArray(state.pipelines));
  assert.ok((state.pipelines?.length ?? 0) >= 4, "Expected 4 core pipelines");
  const seoPipe = state.pipelines?.find((p) => p.name.includes("SEO"));
  assert.ok(seoPipe, "SEO Pipeline should exist");
  assert.ok((seoPipe?.stages.length ?? 0) >= 3, "SEO Pipeline should have multiple stages");

  // Token Optimization Cockpit
  assert.ok(state.tokenOptimization);
  if (state.tokenOptimization) {
    assert.equal(typeof state.tokenOptimization.fastMode, "boolean");
    assert.ok(["low", "balanced", "deep"].includes(state.tokenOptimization.effortLevel));
  }

  // Local Ollama Models Benchmark
  assert.ok(Array.isArray(state.localModels));
  assert.ok((state.localModels?.length ?? 0) >= 4, "Expected local benchmark models");
});

test("Agent OS Operations: memory CRUD, pipeline runner, war room, and token settings", () => {
  // Test memory addition
  const initialCount = readContentOsState().memories?.length ?? 0;
  const newNote = addMemoryNote({
    title: "Automated QA Protocol",
    category: "sop",
    tags: ["qa", "testing", "validation"],
    content: "Verify all endpoints return 200 and maintain <50ms TTFT.",
    source_agent: "user",
  });
  assert.ok(newNote.id);
  assert.equal(newNote.title, "Automated QA Protocol");
  const afterAdd = readContentOsState();
  assert.equal(afterAdd.memories?.length, initialCount + 1);

  // Test memory deletion
  const deleted = deleteMemoryNote(newNote.id);
  assert.equal(deleted, true);
  const afterDelete = readContentOsState();
  assert.equal(afterDelete.memories?.length, initialCount);

  // Test pipeline reset
  const initialPipe = readContentOsState().pipelines?.[0];
  assert.ok(initialPipe, "Pipeline should exist");
  const resetPipe = resetWorkflow(initialPipe.id);
  assert.ok(resetPipe);
  assert.equal(resetPipe.status, "active");
  assert.equal(resetPipe.stages[0].status, "completed");
  assert.equal(resetPipe.stages[1].status, "running");

  // Test pipeline runner
  const updatedPipe = runWorkflowStage(initialPipe.id);
  assert.ok(updatedPipe);
  assert.ok(["active", "completed"].includes(updatedPipe.status));

  // Test war room message
  const msg = addWarRoomMessage({
    sender: "Commander",
    role: "user",
    avatar: "terminal",
    content: "Status report on Q3 autonomous SEO rollout?",
  });
  assert.ok(msg.id);
  const warRoomState = readContentOsState();
  assert.ok(warRoomState.warRoomMessages?.some((m) => m.id === msg.id));

  // Test token settings update
  const updatedTokens = updateTokenSettings({
    fastMode: true,
    effortLevel: "low",
    smartRoutingEnabled: true,
  });
  assert.equal(updatedTokens.fastMode, true);
  assert.equal(updatedTokens.effortLevel, "low");

  // Test agent toggle
  const agent = readContentOsState().agents?.[0];
  assert.ok(agent, "Agent should exist");
  const toggled = toggleAgentStatus(agent.id);
  assert.ok(toggled);
  assert.notEqual(toggled.status, agent.status);
  // Restore status
  toggleAgentStatus(agent.id);
});
