-- Invite-only email sign-in: rows are allowed to request a magic link (validated by Edge Function).
-- No RLS policies → anon/authenticated PostgREST clients cannot read or write; service role bypasses RLS.

CREATE TABLE signup_allowlist (
  email TEXT PRIMARY KEY,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE signup_allowlist ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE signup_allowlist IS
  'Emails permitted to sign in via request-magic-link Edge Function (invite + allowlist gate).';
