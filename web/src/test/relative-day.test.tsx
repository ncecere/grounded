/* Relative dates by calendar day (v0.4.2 US-07) and relative times in conversation lists (VI-16). */
import { render, screen } from "@testing-library/react";
import { RelativeTime } from "../components/templates/list-page";
import { needsCalendarDay, relativeDay } from "../lib/relative-day";

describe("relative dates by calendar day", () => {
  const now = new Date(2026, 9, 4, 10, 0); // Sunday 10:00

  it("says 2 days ago for Friday evening and Friday morning alike", () => {
    expect(relativeDay(new Date(2026, 9, 2, 22, 19), now)).toBe("2 days ago");
    expect(relativeDay(new Date(2026, 9, 2, 10, 41), now)).toBe("2 days ago");
    expect(relativeDay(new Date(2026, 9, 3, 8, 0), now)).toBe("yesterday");
    // bitop-ui's formatter now counts calendar days too (v0.4.2 M5), so lists need no override for it.
    expect(needsCalendarDay(new Date(2026, 9, 2, 22, 19), now)).toBe(false);
  });

  it("keeps hours within half a day, and weeks from a week on", () => {
    expect(relativeDay(new Date(2026, 9, 4, 7, 0), now)).toBe("3 hours ago");
    expect(relativeDay(new Date(2026, 9, 3, 23, 0), now)).toBe("11 hours ago");
    expect(relativeDay(new Date(2026, 8, 20, 9, 0), now)).toBe("2 weeks ago");
    expect(relativeDay("not a date", now, "—")).toBe("—");
  });

  it("lists show the calendar-day wording with the exact date on hover", () => {
    const friday = new Date(Date.now() - 2 * 86_400_000);
    friday.setHours(23, 0, 0, 0);
    render(<RelativeTime value={friday.toISOString()} />);
    const time = screen.getByText("2 days ago");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("title");
  });
});
