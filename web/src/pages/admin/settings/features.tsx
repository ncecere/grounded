/*
 * Admin → Settings › Features (AD-39): the platform's feature switches, moved here from the Overview's Features card
 * (which keeps their state with a link here). Evaluations, the MCP server, its OAuth sign-in for MCP clients and saved
 * answers; platform admins switch them (each confirms what turning it off does, If-Match, audited), auditors see them
 * read-only with the reason.
 */
import { Link } from "@tanstack/react-router";
import { BookOpen, Cable, ClipboardCheck, DatabaseZap, KeyRound } from "lucide-react";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { AnswerCacheSwitch, answerCacheText, useAnswerCacheSetting } from "../overview/answer-cache-switch";
import { EvaluationsSwitch, evaluationsText, useEvaluationsSetting } from "../overview/evaluations-switch";
import { experimental, FeatureList, fromQuery, off, on, type Row } from "../overview/features";
import { MCPSwitch, mcpDocsUrl, mcpText, useMCPSetting } from "../overview/mcp-switch";
import { OAuthSwitch, oauthDocsUrl, oauthFeature, useOAuthSave } from "../overview/oauth-switch";
import o from "../overview/overview.module.css";

export function FeatureSwitches({ isAdmin }: { isAdmin: boolean }) {
  const evaluations = useEvaluationsSetting();
  const mcp = useMCPSetting();
  const oauth = useOAuthSave(mcp);
  const cache = useAnswerCacheSetting();
  const rows: Row[] = [
    fromQuery(
      evaluations.settings,
      {
        id: "evaluations",
        icon: <ClipboardCheck />,
        title: "Evaluations",
        control: <EvaluationsSwitch setting={evaluations} isAdmin={isAdmin} />,
        action: "Evaluation limits",
        link: <Link to="/admin/limits" search={{ tab: "evaluations" }} />,
      },
      (d) => ({ state: d.enabled ? on : off, description: evaluationsText(d.enabled) }),
    ),
    fromQuery(
      mcp.settings,
      {
        id: "mcp",
        icon: <Cable />,
        title: "MCP server",
        control: <MCPSwitch setting={mcp} isAdmin={isAdmin} />,
        action: "Setup guide",
        actionIcon: <BookOpen aria-hidden />,
        link: <a href={mcpDocsUrl} target="_blank" rel="noreferrer" aria-label="MCP server setup guide (opens in a new tab)" />,
      },
      (d) => ({ state: d.enabled ? on : off, description: mcpText(d.enabled) }),
    ),
    fromQuery(
      mcp.settings,
      {
        id: "mcp-oauth",
        icon: <KeyRound />,
        title: "OAuth sign-in for MCP clients",
        badge: experimental,
        control: <OAuthSwitch setting={mcp} save={oauth} isAdmin={isAdmin} />,
        action: "How it works",
        actionIcon: <BookOpen aria-hidden />,
        link: <a href={oauthDocsUrl} target="_blank" rel="noreferrer" aria-label="How OAuth sign-in works (opens in a new tab)" />,
      },
      oauthFeature,
    ),
    fromQuery(
      cache.settings,
      { id: "answer-cache", icon: <DatabaseZap />, title: "Saved answers", control: <AnswerCacheSwitch setting={cache} isAdmin={isAdmin} /> },
      (d) => ({ state: d.enabled ? on : off, description: answerCacheText(d.enabled) }),
    ),
  ];
  const errors: [unknown, string][] = [
    [evaluations.save.error, "Couldn't change evaluations"],
    [mcp.save.error, "Couldn't change the MCP server"],
    [oauth.error, "Couldn't change OAuth sign-in"],
    [cache.save.error, "Couldn't change saved answers"],
  ];
  return (
    <>
      {errors.map(
        ([error, title]) =>
          error != null && (
            <div key={title} className={o.cardAlert}>
              <ErrorAlert error={error} title={title} />
            </div>
          ),
      )}
      <FeatureList rows={rows} />
    </>
  );
}
