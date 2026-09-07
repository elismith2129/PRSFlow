-- Lead AI triage + the play (2026-09-07, the CRM AI push)
-- Flo triages every inbound lead (priority → upper management, volume → the
-- Work-the-List dealer) and keeps a current "play" — the suggested next move
-- + a short message to copy/send. Written ONLY by the server (lib/server/
-- leadAI.ts via /api/lead-ai, the inquiry route, and the nightly sweep);
-- read by the CRM like any other lead column. leads is already in the
-- realtime publication, so play refreshes arrive live.

alter table leads add column if not exists ai_tier text;         -- 'priority' | 'volume'; NULL = not yet triaged
alter table leads add column if not exists ai_tier_reason text;  -- one line: why Flo filed it there
alter table leads add column if not exists ai_play jsonb;        -- {"why": ..., "say": ..., "method": "call"|"text"|"email"}
alter table leads add column if not exists ai_play_at timestamptz;
