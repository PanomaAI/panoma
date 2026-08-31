/*
  The two states that an agent considers pending work. They are literally those filtered by
  `getAgentContext` when preparing its context: if this list and that query do not match, the
  record promises a note that the agent will not see.
  It lives in `lib` rather than `capture-task.tsx` for a React plumbing reason: that module is
  `"use client"`, and what a server component imports from a client module is not the value but a
  reference — the token (server) decides with this same list which tasks remain in the queue, and
  with the reference instead of the array, it would break.
 */
export const OPEN_STATUSES = ["open", "in-progress"];
