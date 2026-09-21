# 0.1.10 acceptance — Harness RC.2

2026-09-21. Baseline: `d865109` / plugin 0.1.9. Reproduced before changes using the official npm tarball: coherent Harness 0.1.5-rc.2 exits 1 in the plugin's version guard; coherent 0.1.6-alpha.2 exits 1 in the host permission constructor (`"auto" is reserved and cannot name a configured preset`). RC.1 passes the existing product fixture. The fan's exact installed dependency graph remains unknown.

## Changes and contract audit

Recommend 0.1.5-rc.2, retain the previous five exact supported hosts, update exact development dependencies/overrides and the pnpm lockfile. CI derives its host matrix from compatibility.json. Runtime error text includes removal instructions; the guard remains fail-closed. README explains fixed versions, RC priority, historical Alpha exceptions and startup recovery. New 0.1.6-alpha releases are unsupported; the static Auto preset and workspace-write/ask policy have not been renamed or relaxed.

Official installed RC.1 and RC.2 artifacts were compared: JS and declarations in permission-presets, tools, llm, session, user-approval, system-prompt, client-locale and client-ui-permission-presets are identical. An independent reviewer also compared bash-sandbox and fs-sandbox. Version-card coverage does not extend to this corridor; these conclusions come from exact npm artifacts and actual startup tests.

Seven touchpoints: profile composition is exercised by the packaged CLI fixture; session events, services, guard/pipeline hooks and approvals by real tool calls; filesystem ownership and subprocess teardown by the fixture's file/canary/process assertions; UI by Ego Lite and a real model turn. The plugin has no custom network channel. There are no newly adopted host capabilities or policy API migrations.

## Local validation

All acceptance uses existing `/tmp`, isolated HOME/DSH_HOME, and the same artifact:

`7b123e67cb93aea8f74d9e5989e63fd467efa642050b4ada7198709a226b67e3`

Packed with Node 24.20.0 / npm 11.19.0. Local runtime tests use macOS / Node 26.7.0. Credentials, raw session logs and screenshots remain outside the repository. Committed evidence contains sanitized summaries only.

- Initial baseline lacked node_modules; after frozen-lockfile installation, `pnpm verify` passed 190 tests, with five Windows-only tests skipped. No baseline product failures.
- After changes: typecheck, build, package check and 200 tests passed; five Windows-only tests skipped.
- Maintenance contract: six exact hosts, 120 unchanged vendored skill files. Doctor/release metadata scripts: 29 tests passed.
- Packaged CLI fixture: 22 assertions on each of six exact hosts, all passed. Full dependency/identity and artifact checks passed; target RC.2 has 231 DSH packages. The fixture model is deterministic. [Evidence](validation/0.1.10/fixture.json).
- RC.2 real API: 24 assertions passed over 17 real deepseek-official/deepseek-flash requests. Native editor create/replace/view; authorized deletion via classifier; redundant sandbox request rejection followed by an actually exercised fieldless retry; unauthorized deletion refusal; resistance to argument authority injection; sibling sentinel unchanged. [Evidence](validation/0.1.10/real-api.json).
- RC.2 Web: existing /tmp workspace selected; four Chinese permission entries; risk dialog confirmation disabled until acknowledgement; cancel preserves workspace-write; confirmation selects Auto; actual bash deletion through one real classifier request; target absent and sibling bytes unchanged; Auto, icon and reply persist after reload. Five real requests, two bash calls. [Evidence](validation/0.1.10/web.json).

## Independent review and limits

Two independent adversarial reviewers found no blockers. Recovery command syntax was checked against both RC.2 and Alpha.2 CLI code: plugin removal runs independently of the failing profile and reconciles the bundle after uninstall. No global host or user profile was changed.

The development pnpm store retains old RC.1 directories after upgrade; it is not used as runtime acceptance evidence. Isolated runtime doctors passed with exact cohorts, including an independent 231-package RC.2 audit.

Not locally verified: Windows/PowerShell, Linux, migration/downgrade of real user sessions, or functionality on unsupported Alpha hosts. Cross-platform CI and byte-for-byte CI artifact comparison are pending at the time of this local record. Unsupported hosts still refuse startup with the plugin installed; this release documents recovery rather than claiming safe automatic deactivation.

---

# 0.1.9 acceptance

Production and real API acceptance completed before this commit. Every run used the existing `/tmp` workspace (macOS resolves it to `/private/tmp`), so no workspace picker was involved. The npm candidate was packed from the frozen tree with Node **24.20.0** and npm **11.19.0** — the same toolchain the publish workflow uses — and that pack reproduced the CI tarball hash byte-for-byte. Its SHA-256 is:

`1094c9fae16f7ff94164cba70bcb2160837978d31014b79537d3f00c1f12e464`

## Automated and product checks

- `pnpm verify`: **190 passed**, five Windows-only tests skipped on macOS; typecheck, server/client build and package contract passed.
- Maintenance contract: five exact host versions and 120 unchanged upstream skill files verified.
- Doctor: **7 tests passed**, including mixed versions, duplicate identities, nested copies, modified module bytes, extra modules, profile metadata and Windows tar CRLF output.
- Official CLI product fixture: **22 assertions per host on all five hosts**, with all 69 packaged files matched against the same tarball. `0.1.5-rc.1` resolves a 231-package DSH cohort; the `0.1.2.*` hosts resolve 214/215. Runtime services and actual Session objects share the expected module identity. The model in this suite is explicitly a deterministic fixture.

[Product fixture evidence](validation/0.1.9/fixture.json)

## Real API in Harness

Run against the exact `0.1.5-rc.1` cohort with the configured real `deepseek-official` provider and the model id read from the running host settings (`deepseek-flash`). **30 checks passed** over 20 requests (118,339 total tokens), 3 of them classifier calls.

| Exact host / composition | Requests | Result |
| --- | ---: | --- |
| `0.1.5-rc.1`, headless | 20 | Passed |

Exercised on the real provider: native `str_replace_editor` create/replace/view; an explicitly authorized deletion approved by the real classifier; a redundant `sandbox_permissions: workspace-write` request denied with the Auto recovery marker followed by a successful field-less retry (**the recovery branch was actually exercised, not merely attempted**); the real classifier refusing an unauthorized deletion and resisting argument-level authority injection; the Auto boundary guidance present on every agent request (the remaining requests are session-title calls with no tools); and an untouched sibling sentinel. [Real API evidence](validation/0.1.9/real-api.json)

Two harness changes required acceptance-tooling adaptation, not policy changes: `0.1.5-rc.1` removed `str_replace_editor` from the base composition, so the acceptance profile mounts the official `@deepseek-ai/dsh-tool-str-replace-editor` package explicitly; and the model id is now read from the host settings instead of a hard-coded `deepseek-v4-flash`. The boundary-guidance probe was also repaired — it previously matched a string the guidance never contained and so always reported false.

### Web UI in a real browser

Driven through the actual Web UI in Ego Lite against the same exact `0.1.5-rc.1` cohort and real provider. The session was created from the UI (the web profile composes agent-plane tools from the `standard` agent preset, so the headless driver's `ctx.agents.create()` does not see them) with the workspace registered by `scripts/acceptance/web-observer.mjs`, matching the 0.1.7 method.

Checked: the access-mode menu renders all four presets in Chinese with the Auto row marked by the injected icon; the risk acknowledgement dialog appears in Chinese with its confirmation disabled until the checkbox is ticked; cancelling leaves the previous preset selected; confirming selects Auto; a real prompt then deleted an explicitly authorized `/tmp` file through a `bash` call plus **one real classifier request**, with a sibling file left intact and no manual approval; and Auto plus the injected marker both survive a page reload. [Web evidence](validation/0.1.9/web.json)

## Adversarial review and boundaries

The plugin's host-facing surface (permission preset projection, tool guard and pipeline events, approval seam, system-prompt context, session event reader, locale service) is unchanged across `0.1.2-rc.1` → `0.1.5-rc.1`, which the exact-artifact fixture run confirms: **no runtime source change was needed for the new host**. The differences are confined to the dependency cohort, the default tool composition and the default model id.

This remains the project's bounded, sandbox-first policy. Ordinary opaque shell content may still run inside the write sandbox; parsed dynamic interpreter/assignment checks do not prove the semantics of every possible shell expression. The write sandbox does not constrain all reads or network effects. Third-party patch executors remain manual because no official sandbox contract was verified for them.

Not performed on this machine: PowerShell and Windows ACL acceptance, and live user-data migration. Windows coverage runs in the CI matrix. The Web client bundle is byte-identical to `0.1.7` (`8d819f59…bec62a`), and it was exercised in a real browser as described above.

Raw logs and credentials remain outside Git and npm. The committed JSON contains sanitized summaries only.
