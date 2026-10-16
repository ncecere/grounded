/* Under a router's answer: which agent answered, and where to carry on with it (docs/specs/v0.6.0/DESIGN.md §4). */
import { Link } from "@tanstack/react-router";
import { CornerDownRight } from "lucide-react";
import type { Schemas } from "../../api/client";
import a from "./answer.module.css";

export function AnsweredBy({ routed, canContinue }: { routed: Schemas["RoutedTo"]; canContinue: boolean }) {
  const name = routed.gone ? `${routed.name || "An agent"} (removed since)` : routed.name;
  const link = canContinue && !routed.gone && routed.conversationId;
  return (
    <p className={a.answeredBy}>
      <CornerDownRight aria-hidden />
      <span>
        Answered by <strong>{name}</strong>
        {routed.teamName ? ` · ${routed.teamName}` : ""}
      </span>
      {link && (
        <Link to="/a/$team/$agent" params={{ team: routed.teamSlug, agent: routed.slug }} search={{ c: routed.conversationId }} className={a.continueLink}>
          Continue there
        </Link>
      )}
    </p>
  );
}
