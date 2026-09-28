/* Error alerts that explain team limits (DESIGN.md §11.1) instead of showing a generic failure. */
import { limitError } from "../api/client";
import { Alert, ErrorAlert, type ErrorAlertProps } from "@/components/ui/alert/alert";

/**
 * Like ErrorAlert, but a team limit (409 limit_reached, 429 rate_limited) is
 * shown as a warning with a title, e.g. "Team limit reached: Your team has
 * reached its limit of 100 data sources. Ask a platform admin to raise it."
 */
export function ApiErrorAlert({ error, title, ...props }: ErrorAlertProps) {
  const limit = limitError(error);
  if (limit) {
    return (
      <Alert tone="warning" title={limit.title} {...props}>
        {limit.message}
      </Alert>
    );
  }
  return <ErrorAlert error={error} title={title} {...props} />;
}
