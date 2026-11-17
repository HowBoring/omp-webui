import type { PendingInteraction, UIAnswer } from "../contracts/interactions.ts";
import type { UIAnswer as NativeUIAnswer } from "../contracts/generated/omp-wire.ts";

/** Keep exact optional fields at the generated Native boundary. */
export function nativeAnswer(answer: UIAnswer): NativeUIAnswer {
  if (answer.type === "cancel") return answer.timedOut === undefined ? { type: "cancel" } :
    { type: "cancel", timedOut: answer.timedOut };
  if (answer.type !== "ask") return answer;
  return { type: "ask", answers: answer.answers.map(value => ({ id: value.id, selectedOptions: value.selectedOptions,
    ...(value.customInput === undefined ? {} : { customInput: value.customInput }) })) };
}

/** Exact labels and question order follow the matched public Native UI contract. */
export function validAnswer(card: PendingInteraction, answer: UIAnswer): boolean {
  if (answer.type === "cancel") return answer.timedOut !== true; // Only the Host clock may declare expiry.
  if (card.method === "confirm") return answer.type === "confirm";
  if (card.method === "input" || card.method === "editor") return answer.type === "value";
  if (card.method === "select") return answer.type === "value" && !!card.options?.includes(answer.value);
  if (answer.type !== "ask" || !card.questions || answer.answers.length !== card.questions.length) return false;
  return card.questions.every((question, index) => {
    const value = answer.answers[index];
    return value !== undefined && value.id === question.id &&
      new Set(value.selectedOptions).size === value.selectedOptions.length &&
      (question.multi === true || value.selectedOptions.length <= 1) &&
      value.selectedOptions.every(label => question.options.some(option => option.label === label)) &&
      (value.selectedOptions.length > 0 || !!value.customInput?.trim());
  });
}
