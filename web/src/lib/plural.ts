/** A count with its noun: "1 document", "1,204 documents"; `many` for a plural that isn't the noun plus "s" ("1 match", "2 matches"). */
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
