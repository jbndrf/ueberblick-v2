# C-006 Guests expire after 90 days without activity (supersedes owner Q4)
priority: low        status: accepted
date: 2026-10-06   lead: c   work packages: WP-1073   touches: R14

## Context
Q4 (2026-10-01) deactivated a self-joined guest 90 days after joining, however active they were (v3's `self_join_janitor`).

## Options
- A) Keep 90 days from joining.
- B) 90 days without activity (owner 2026-10-06: "Make guests disappear after 90 days of inactivity by default").

## Chosen
B. Last activity is the later of joining and the last use of the guest's session. Every authenticated request (sync and runs included) renews a participant session at most once a day for 90 days, so "has a live session" means "used within 90 days"; no new column and no write on the hot path. Due = joined over 90 days ago and no live session (`Auth.hasLiveSession`, index `sessions_by_subject`). "Disappear" stays the existing deactivation (`removeParticipant`; history keeps the actor). Precision is one day. Seam: the rule is one function (`expireGuests`); a `last_active_at` column would replace the session lookup.

## Cost to change later
one function and one index.
