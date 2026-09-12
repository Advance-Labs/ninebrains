# Security policy

Ninebrains launches coding agents that run shell commands on your machine. We treat security
reports as the highest-priority work on the project.

## Reporting a vulnerability

Email **security@advancelabs.dev**. Please do not open a public GitHub issue, discussion or pull
request for a suspected vulnerability.

Include what you can:

- the affected version (`Help → About`) and operating system;
- the component (Brain endpoint, brain-mcp, launch config, dispatcher, gates, lane browser, packs,
  unattended runs, updater or release artifacts);
- steps to reproduce, or a proof of concept;
- the impact you think it has.

We will:

1. confirm receipt within **3 business days**;
2. give an initial assessment within **10 business days**;
3. keep you updated at least every **14 days** until it is resolved;
4. credit you in the release notes, unless you would rather not be named.

## Disclosure window

We follow coordinated disclosure with a **90-day** window from the date we confirm receipt. We aim
to ship a fix well before then. If a fix needs more time, we will agree an extension with you before
the window ends. If a vulnerability is being actively exploited, we may publish an advisory sooner,
and we will tell you before we do.

## Supported versions

Ninebrains is pre-1.0. Only the latest release receives security fixes.

| Version | Supported |
|---|---|
| latest 0.x release | yes |
| older 0.x releases | no, please upgrade |
| unreleased branches and forks | no |

## Scope

**In scope**

- The Ninebrains desktop app and the packages in this repository, including `brain-mcp`,
  `brain-core`, `gates-core` and `citations`.
- Lane isolation failures: a lane reaching another lane's token, worktree or messages, the Brain
  database, or files outside its sandbox policy.
- The localhost Brain endpoint, when reached from a web page, another local process or a
  different lane.
- Verification gates that can be bypassed or forged (for example, a reviewer that can write to the
  worktree, or a fact-check that accepts unverified claims).
- SSRF through gate fetches, and path traversal in evidence or attachments.
- Secrets exposed in transcripts, logs, evidence or configuration files.
- Unattended runs that exceed their budget, survive STOP, or take an outbound action without the
  plan's allowlist.
- Bundled discipline packs as we ship them, and our release artifacts.

**Out of scope**

- Vulnerabilities in the `claude` or `codex` CLIs themselves. Report those to Anthropic or OpenAI.
- Vulnerabilities in upstream Emdash that Ninebrains does not change. Report those to
  `generalaction/emdash` as well as to us if they affect Ninebrains.
- Third-party MCP servers and websites that you load in a lane.
- Prompt injection against an **attended** lane that only succeeds after you approve the
  provider's permission prompt, or with the lane sandbox turned off. These are documented accepted
  risks in `docs/THREAT-MODEL.md` §7. Reports that get past a default control are in scope.
- Attacks that need prior code execution as your user outside Ninebrains, or physical access.
- Denial of service against your own machine by processes you started.
- Missing hardening headers, or findings from automated scanners with no demonstrated impact.

## Safe harbour

We will not pursue legal action against good-faith research that follows this policy. That means
you avoid privacy violations, data destruction and service disruption, test only against your own
installs and accounts, and give us the disclosure window above. We do not run a paid bug bounty.

## Verifying downloads

Until builds are code-signed, verify every download against the `SHA256SUMS` file attached to its
GitHub release (`shasum -a 256 -c SHA256SUMS`). That proves you have the exact bytes CI uploaded,
not who built them. Build-provenance attestations are not available while the repository is
private. Once the repository is public, `gh attestation verify <file> --repo
Advance-Labs/ninebrains` will also prove which workflow built the file. Until then that command
fails, and a failure means nothing about the file. Unsigned builds do not auto-update. The release
guide in the repository (`docs/RELEASING.md`, "Verifying a download") has the commands for each OS.
