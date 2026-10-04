/*
 * A server refusal shown under the field it is about (AD-20), instead of at the bottom of the form: the message when
 * the error has one of the codes (and, optionally, starts with a prefix, for codes shared by two fields).
 */
import { useRef } from "react";
import { ApiError } from "@/api/client";

export function fieldError(error: unknown, codes: string[], prefix?: string): string | undefined {
  if (!(error instanceof ApiError) || !codes.includes(error.code)) return undefined;
  if (prefix && !error.message.startsWith(prefix)) return undefined;
  return error.message.endsWith(".") ? error.message : `${error.message}.`;
}

/**
 * A save's error while the form still holds what was sent, and nothing once the person edits it. A server error shown
 * under a field marks it invalid, and a form doesn't submit while a field is invalid: kept after the fix, it left the
 * form stuck with Add doing nothing (AD2-04).
 */
export function useCurrentError(error: unknown, form: unknown): unknown {
  const seen = useRef<{ error: unknown; key: string } | null>(null);
  const key = JSON.stringify(form);
  if (!error) seen.current = null;
  else if (seen.current?.error !== error) seen.current = { error, key };
  return error && seen.current?.key === key ? error : undefined;
}
