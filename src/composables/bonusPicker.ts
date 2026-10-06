import type { Command } from "@/sim/Command.js";

// The picker's options in tab order, so the keyboard cursor and the rendered
// buttons are the same list rather than two that can drift. An offer is always
// three cards (`BonusOffer` is a tuple), so a claimed site needs no card count.
export interface BonusPickerOption {
  kind: "card" | "unlock" | "leave";
  cardIndex: number;
}

const CARD_OPTIONS: readonly BonusPickerOption[] = [
  { kind: "card", cardIndex: 0 },
  { kind: "card", cardIndex: 1 },
  { kind: "card", cardIndex: 2 },
];

const UNLOCK_OPTION: BonusPickerOption = { kind: "unlock", cardIndex: -1 };
const LEAVE_OPTION: BonusPickerOption = { kind: "leave", cardIndex: -1 };

// A sealed cache shows no cards: the unlock fee and the leave button are the
// only claims it takes, so that is what the cursor cycles.
export function bonusPickerOptions(locked: boolean): readonly BonusPickerOption[] {
  return locked ? [UNLOCK_OPTION, LEAVE_OPTION] : [...CARD_OPTIONS, LEAVE_OPTION];
}

export function cycleBonusPickerOptionIndex(current: number, count: number, offset: number): number {
  if (count <= 0) return 0;
  return (current + offset + count) % count;
}

// One command per option, so a click on a button and Enter on the highlighted
// one are the same dispatch. The caller supplies the command id (the keyboard
// path numbers its own, the buttons reuse the 0 every component dispatch uses).
export function bonusPickerOptionCommand(option: BonusPickerOption, commandId: number): Command {
  if (option.kind === "card") return { commandId, type: "action:pickBonus", index: option.cardIndex };
  if (option.kind === "unlock") return { commandId, type: "action:unlockCache" };
  return { commandId, type: "action:dismissBonus" };
}
