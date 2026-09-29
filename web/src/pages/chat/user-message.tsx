/*
 * The user's own message. A very long one (a pasted letter, up to 8,000
 * characters) is shown collapsed to its first lines with "Show more", so the
 * answer isn't pushed far down the page.
 */
import { useId, useState } from "react";
import { Button } from "@/components/ui/button/button";
import { Message, MessageContent } from "@/components/ui/message/message";
import a from "./answer.module.css";
import c from "./chat.module.css";

/** Longer than this (characters or lines) starts collapsed. */
const LONG_CHARS = 700;
const LONG_LINES = 10;

export const isLongMessage = (text: string) => text.length > LONG_CHARS || text.split("\n").length > LONG_LINES;

export function UserMessage({ text }: { text: string }) {
  const long = isLongMessage(text);
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return (
    <Message from="user">
      <MessageContent className={c.userText}>
        <div id={id} className={long && !expanded ? a.collapsed : undefined}>
          {text}
        </div>
        {long && (
          <Button variant="ghost" size="sm" className={a.showMore} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show less" : "Show more"}
          </Button>
        )}
      </MessageContent>
    </Message>
  );
}
