/*
 * Admin → Limits › Evaluations keeps only the two evaluation limits; the
 * feature's switch is on the Overview's Features card (v0.2.1 I2). This line
 * says the state and where to change it.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { TextLink } from "@/components/ui/text-link/text-link";
import s from "../../shared.module.css";
import { evaluationSettingsQuery } from "../overview/queries";

export function EvaluationsNote() {
  const settings = useQuery(evaluationSettingsQuery());
  const state = settings.data ? (settings.data.enabled ? "on" : "off") : undefined;
  return (
    <p className={s.muted}>
      {state ? `Evaluations are ${state}` : "Evaluations are turned on or off"} (
      <TextLink render={<Link to="/admin" hash="features" />}>Overview → Features</TextLink>).
    </p>
  );
}
