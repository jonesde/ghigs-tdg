/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { decideSnapshotPost, type SnapshotGateInput } from "@/sim/snapshotGate.js";

function gate(overrides: Partial<SnapshotGateInput>): SnapshotGateInput {
  return {
    hasPostedSnapshot: true,
    awaitingAck: false,
    lastScaledDt: 0,
    stateMutatedThisTick: false,
    placementHoldActive: false,
    placementHoldPosted: false,
    bonusPickerActive: false,
    bonusPickerPosted: false,
    ...overrides,
  };
}

describe("decideSnapshotPost", () => {
  it("forces the playing tick that arms a placement hold through the ack gate", () => {
    const decision = decideSnapshotPost(gate({ awaitingAck: true, lastScaledDt: 1 / 60, placementHoldActive: true }));
    expect(decision.post).toBe(true);
    expect(decision.pausedMutation).toBe(false);
    expect(decision.awaitingAck).toBe(true);
    expect(decision.placementHoldPosted).toBe(true);
  });

  it("does not post a later paused tick once that hold snapshot was posted", () => {
    const decision = decideSnapshotPost(
      gate({ awaitingAck: true, placementHoldActive: true, placementHoldPosted: true }),
    );
    expect(decision.post).toBe(false);
    expect(decision.placementHoldPosted).toBe(true);
    expect(decision.awaitingAck).toBe(true);
  });

  it("retries a paused tick when the hold snapshot has not been posted yet", () => {
    const decision = decideSnapshotPost(gate({ awaitingAck: true, placementHoldActive: true }));
    expect(decision.post).toBe(true);
    expect(decision.pausedMutation).toBe(false);
    expect(decision.awaitingAck).toBe(true);
    expect(decision.placementHoldPosted).toBe(true);
  });

  it("posts nothing for an ordinary paused idle tick", () => {
    const decision = decideSnapshotPost(gate({ awaitingAck: true }));
    expect(decision.post).toBe(false);
    expect(decision.placementHoldPosted).toBe(false);
  });

  it("still posts the baseline while paused and idle", () => {
    const decision = decideSnapshotPost(gate({ hasPostedSnapshot: false, awaitingAck: true }));
    expect(decision.post).toBe(true);
    expect(decision.placementHoldPosted).toBe(false);
  });

  it("posts a paused command and leaves the ack gate open", () => {
    const decision = decideSnapshotPost(gate({ awaitingAck: true, stateMutatedThisTick: true }));
    expect(decision.post).toBe(true);
    expect(decision.pausedMutation).toBe(true);
    expect(decision.awaitingAck).toBe(false);
    expect(decision.placementHoldPosted).toBe(false);
  });

  it("still posts a reroll command after the hold snapshot was already posted", () => {
    const decision = decideSnapshotPost(
      gate({ awaitingAck: true, stateMutatedThisTick: true, placementHoldActive: true, placementHoldPosted: true }),
    );
    expect(decision.post).toBe(true);
    expect(decision.pausedMutation).toBe(true);
    expect(decision.awaitingAck).toBe(false);
    expect(decision.placementHoldPosted).toBe(true);
  });

  it("clears the hold latch on a snapshot posted after the hold ends", () => {
    const decision = decideSnapshotPost(
      gate({ lastScaledDt: 1 / 60, stateMutatedThisTick: true, placementHoldPosted: true }),
    );
    expect(decision.post).toBe(true);
    expect(decision.pausedMutation).toBe(false);
    expect(decision.placementHoldPosted).toBe(false);
  });

  it("forces the playing tick that opens a bonus picker through the ack gate", () => {
    const decision = decideSnapshotPost(gate({ awaitingAck: true, lastScaledDt: 1 / 60, bonusPickerActive: true }));
    expect(decision.post).toBe(true);
    expect(decision.pausedMutation).toBe(false);
    expect(decision.awaitingAck).toBe(true);
    expect(decision.bonusPickerPosted).toBe(true);
  });

  it("does not post a later paused tick once that picker snapshot was posted", () => {
    const decision = decideSnapshotPost(gate({ awaitingAck: true, bonusPickerActive: true, bonusPickerPosted: true }));
    expect(decision.post).toBe(false);
    expect(decision.bonusPickerPosted).toBe(true);
    expect(decision.awaitingAck).toBe(true);
  });

  it("retries a paused tick when the picker snapshot has not been posted yet", () => {
    const decision = decideSnapshotPost(gate({ awaitingAck: true, bonusPickerActive: true }));
    expect(decision.post).toBe(true);
    expect(decision.pausedMutation).toBe(false);
    expect(decision.awaitingAck).toBe(true);
    expect(decision.bonusPickerPosted).toBe(true);
  });

  it("clears the picker latch on a snapshot posted after the picker closes", () => {
    const decision = decideSnapshotPost(
      gate({ lastScaledDt: 1 / 60, stateMutatedThisTick: true, bonusPickerPosted: true }),
    );
    expect(decision.post).toBe(true);
    expect(decision.bonusPickerPosted).toBe(false);
  });

  it("drops a running tick that is waiting for an ack and has no hold to announce", () => {
    const decision = decideSnapshotPost(gate({ awaitingAck: true, lastScaledDt: 1 / 60 }));
    expect(decision.post).toBe(false);
    expect(decision.placementHoldPosted).toBe(false);
    expect(decision.bonusPickerPosted).toBe(false);
    expect(decision.awaitingAck).toBe(true);
  });
});
