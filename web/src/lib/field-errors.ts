/*
 * A server refusal shown under the field it is about (AD-20), instead of at the bottom of the form: the message when
 * the error has one of the codes (and, optionally, starts with a prefix, for codes shared by two fields).
 */
import { ApiError } from "@/api/client";

export function fieldError(error: unknown, codes: string[], prefix?: string): string | undefined {
  if (!(error instanceof ApiError) || !codes.includes(error.code)) return undefined;
  if (prefix && !error.message.startsWith(prefix)) return undefined;
  return error.message.endsWith(".") ? error.message : `${error.message}.`;
}
