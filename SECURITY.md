# Security policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub's private vulnerability reporting](https://github.com/carlosrendonduque/conato/security/advisories/new)
rather than opening a public issue.

Include what you can: affected version or commit, reproduction steps, and what
an attacker gains. You should get an acknowledgement within a week. This is a
side project maintained by one person, so please be patient with fixes.

## What is in scope

Conato is a **self-hosted, single-user application**. Bugs that let someone
bypass the access gate, read or write the corpus without the shared secret,
extract server-side API keys, inject SQL, or execute code on the host are in
scope.

## What is not a vulnerability

These are documented design decisions, not bugs:

- **There are no user accounts.** Access is one shared secret. Anyone who has
  it has full read and write access to the entire corpus. Conato is not built
  for untrusted multi-user deployments.
- **The session cookie carries no identity**, only a signed issue timestamp. A
  single valid session is indistinguishable from any other.
- **`/editor/<token>` shares read access by URL.** Anyone holding the token can
  read files flagged `share_external`. Tokens in URLs leak through referrers
  and browser history; treat them as unlisted, not secret.
- **Login rate limiting is in-process and best-effort.** On a serverless host,
  each instance keeps its own counters. It raises the cost of guessing; it does
  not make a weak secret safe.
- **Weak configuration.** The app rejects placeholder and low-entropy secrets
  at startup, but choosing a poor secret, exposing the database, or committing
  your `.env.local` is on the operator.

If you think one of these design decisions is wrong, open a normal issue — that
is a design discussion, and a welcome one.

## For operators

- Generate secrets with a CSPRNG:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Never commit `.env.local`. It is gitignored; keep it that way.
- Always serve over HTTPS. The session cookie is only marked `secure` in
  production.
- The Anthropic API key is read server-side only. If you fork and add a
  provider, keep it that way — never expose a key to the client bundle.
