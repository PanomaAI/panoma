"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  XAxis,
} from "recharts";
import { useLocale, useT } from "./i18n-provider";
import type { Locale } from "@/lib/i18n";

/*
  The initials of the days, in the order returned by `Date.getDay()` — Sunday first.
  In code and not in the dictionary because this is a date format, like `relativeDate` in
  `primitives.tsx`: seven single-letter keys would not be better understood in `i18n.ts` than a
  row next to another is understood here. And by hand and not with `Intl` because the Spanish of
  `Intl` distinguishes Wednesday with an "X" and this grid carries two "M".
 */
const DAY_LABELS: Record<Locale, string[]> = {
  es: ["D", "L", "M", "M", "J", "V", "S"],
  en: ["S", "M", "T", "W", "T", "F", "S"],
};

export function HealthScoreRing({ score }: { score: number }) {
  const translate = useT();
  const value = Math.max(0, Math.min(100, score));
  /*
    The same three tones and the same cuts as the catalog ring, which in turn are the ones that
    distribute the notes in the engine: A and B are fine, C warns, D and F do not. Before, there
    were four bands and one of them was purple, so the same 65 was rendered purple here and amber
    on the cover — two colors for the same fact.
   */
  const color = value >= 70 ? "#189a5b" : value >= 55 ? "#b0800f" : "#cd3d3d";

  return (
    /*
      The ring is announced with the same code as the header badge: it is the same number over the
      same total, and the 'general' I mentioned before distinguished nothing because there is no
      other health entry on the record to confuse it with.
     */
    <div className="health-score-ring" aria-label={translate("project.healthTitle", { n: value })}>
      <RadialBarChart
        width={138}
        height={138}
        cx={69}
        cy={69}
        innerRadius={48}
        outerRadius={59}
        barSize={10}
        data={[{ value, fill: color }]}
        startAngle={90}
        endAngle={-270}
      >
        <RadialBar dataKey="value" background={{ fill: "#ececec" }} cornerRadius={8} />
      </RadialBarChart>
      <span className="health-score-ring__value">{value}</span>
      <span className="health-score-ring__total">{translate("project.outOf100")}</span>
    </div>
  );
}

/**
 * The commits from each of the last seven days.
 *
 * The numbers come counted from the server —from git, not from a photo— and here they are just
 * given the day's label in the language of the screen. Previously, they were counted right here by
 * filtering `recentCommits`, which are the **last twenty**: in an active project, those twenty
 * don’t even last a day, so the graph would show one bar and six zeros that weren’t zeros. The day
 * of the week comes with the number and isn’t recalculated: counting it twice is risking that the
 * server and the browser won’t match on which day it is today.
 */
export function CommitActivityChart({
  week,
}: {
  week: { weekday: number; value: number }[];
}) {
  const translate = useT();
  const locale = useLocale();
  const data = useMemo(
    () =>
      week.map((day, index) => ({
        day: DAY_LABELS[locale][day.weekday],
        value: day.value,
        current: index === week.length - 1,
      })),
    [week, locale],
  );

  return (
    <div className="commit-activity-chart" aria-label={translate("project.commitChartAria")}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#5c5c5c", fontSize: 10 }}
          />
          <Bar dataKey="value" radius={[2, 2, 0, 0]} minPointSize={4} maxBarSize={17}>
            {data.map((entry, index) => (
              <Cell key={`${entry.day}-${index}`} fill={entry.current ? "#0a0a0a" : "#e6e6e6"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
