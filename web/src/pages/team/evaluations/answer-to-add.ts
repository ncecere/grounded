/*
 * What "Add to evaluations" takes from an answer (docs/evaluations.md §1,
 * ADR-0010): the question it replied to, the documents it cited (once
 * each, as the question's expected documents to confirm) and the
 * thumbs-down reason. Kept apart from the dialog, which chat loads lazily.
 */

/** An answer to add: its question, its key (added.ts), the documents it cited and its thumbs-down reason. */
export type AnswerToAdd = { question: string; key: string; cited: { id: string; title: string }[]; reason?: string };

type Answer = { id?: string; key: string; citations: { documentId: string; title: string }[]; feedback?: { reason?: string } };

/** The answer's part of the form: the cited documents once each, in citation order. */
export function answerToAdd(question: string, item: Answer): AnswerToAdd {
  const cited: AnswerToAdd["cited"] = [];
  for (const c of item.citations) if (!cited.some((d) => d.id === c.documentId)) cited.push({ id: c.documentId, title: c.title });
  return { question, key: item.id ? item.id : `session:${item.key}`, cited, reason: item.feedback?.reason };
}

/** The reasons that say the content was wrong: the form asks first what a good answer says. */
export const asksContent = (reason?: string) => reason === "not_helpful" || reason === "incorrect";

/** "The answer used Handbook and Fees. Is that the right source?" */
export function usedNote(cited: AnswerToAdd["cited"]) {
  if (cited.length === 0) return "The answer cited no documents.";
  const names = cited.map((d) => d.title || "Untitled document");
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `The answer used ${list}. Is that the right source?`;
}
