// Whether this worker tick posts a snapshot. Kept out of WorkerEntry so tests can
// drive the ack gate without importing the worker (that module assigns self.onmessage).

export interface SnapshotGateInput {
  hasPostedSnapshot: boolean;
  awaitingAck: boolean;
  lastScaledDt: number;
  stateMutatedThisTick: boolean;
  placementHoldActive: boolean;
  placementHoldPosted: boolean;
  bonusPickerActive: boolean;
  bonusPickerPosted: boolean;
}

export interface SnapshotGateDecision {
  post: boolean;
  pausedMutation: boolean;
  awaitingAck: boolean;
  placementHoldPosted: boolean;
  bonusPickerPosted: boolean;
}

export function decideSnapshotPost(input: SnapshotGateInput): SnapshotGateDecision {
  // The hold is armed inside engine.update, not by a command, and that step also
  // pauses the run. Later ticks are idle and will not retry a snapshot the ack
  // gate dropped, so the block cards would stay hidden until some other command.
  const placementHoldNeedsPost = input.placementHoldActive && !input.placementHoldPosted;
  // Same shape as the hold: a tower-fired cache break opens the picker inside
  // engine.update, pauses the run, and would otherwise lose its announcement
  // snapshot to the ack gate (the click-open path is a command and needs no help).
  const bonusPickerNeedsPost = input.bonusPickerActive && !input.bonusPickerPosted;
  const idle =
    input.lastScaledDt === 0 && !input.stateMutatedThisTick && !placementHoldNeedsPost && !bonusPickerNeedsPost;
  if (idle && input.hasPostedSnapshot) {
    return {
      post: false,
      pausedMutation: false,
      awaitingAck: input.awaitingAck,
      placementHoldPosted: input.placementHoldPosted,
      bonusPickerPosted: input.bonusPickerPosted,
    };
  }

  const pausedMutation = input.lastScaledDt === 0 && input.stateMutatedThisTick;
  const isBaseline = !input.hasPostedSnapshot;
  const forced = isBaseline || input.stateMutatedThisTick || placementHoldNeedsPost || bonusPickerNeedsPost;
  if (input.awaitingAck && !forced) {
    return {
      post: false,
      pausedMutation,
      awaitingAck: true,
      placementHoldPosted: input.placementHoldPosted,
      bonusPickerPosted: input.bonusPickerPosted,
    };
  }

  return {
    post: true,
    pausedMutation,
    awaitingAck: !pausedMutation,
    placementHoldPosted: input.placementHoldActive,
    bonusPickerPosted: input.bonusPickerActive,
  };
}
