Auto Mode 0.1.10 supports Harness `0.1.5-rc.2`, the recommended RC pairing, while retaining all five previously supported exact hosts.

- Fix startup on `0.1.5-rc.2`: version 0.1.9 rejected it in the plugin compatibility guard. The consumed RC permission, tool, approval, session and Web menu implementations are unchanged, so approval policy remains unchanged.
- Pin the development dependency cohort and include RC.2 in the CI artifact matrix; add regression tests for RC.2, mixed cohorts and unverified versions.
- Document exact installation commands, RC-first support and recovery with `dsh plugin --profile <name> remove @nanmicoder/dsh-auto-mode`.
- Harness `0.1.6-alpha.*` is not supported. Alpha.2 reserves `auto`; renaming only the preset or bypassing the guard is not a fix. Unsupported versions remain fail-closed rather than silently leaving Auto without its policy.
- Locally validated the same tarball through six exact Harness CLI cohorts, real DeepSeek API flows on RC.2, and the actual Web UI in Ego Lite. See VALIDATION.md and validation/0.1.10 for sanitized evidence. Windows and Linux checks run separately in CI.

---

Auto Mode 0.1.9 supports the exact Harness cohort `0.1.5-rc.1`, `0.1.2-rc.1`, `0.1.2-alpha.5`, `0.1.2-alpha.3`, and `0.1.2-alpha.2`. `0.1.5-rc.1` is the current npm `latest` host and is now the recommended pair; installs on it previously failed because the plugin declared support only up to `0.1.2-rc.1`. Use `dsh --version` to check the running host before upgrading the plugin. Harness `0.1.1-rc.2` must migrate to a supported pair; this release does not backport the old host API.

- Support the exact `0.1.5-rc.1` host cohort. The resolved closure gained 17 packages and lost 4 relative to `0.1.2-rc.1`, so the override list was regenerated from the resolved graph rather than re-versioned in place. The previously failing `plugin tree failed to load ... unsupported or mixed Harness packages` report is reproduced and fixed.
- Keep the existing four `0.1.2-*` hosts on the same build: the permission, tool-pipeline, session-event and approval seams Auto Mode consumes are unchanged across this range, so no runtime branches were added.
- Read the real-API model id from the running host settings instead of a hard-coded `deepseek-v4-flash`; `0.1.5-rc.1` renamed the default to `deepseek-flash` and the id is a pass-through wire value.
- Mount the official `@deepseek-ai/dsh-tool-str-replace-editor` package in the acceptance profile, because `0.1.5-rc.1` removed it from the base composition, so the native-editor acceptance keeps exercising the real tool.
- Repair the real-API boundary-guidance probe, which matched a string the guidance never contained and therefore always reported false.
- Verify the Web surface in a real browser on `0.1.5-rc.1`: localized access-mode menu and risk acknowledgement, acknowledgement-gated confirmation, a real-API authorized deletion through the classifier, and Auto plus the injected icon surviving a reload.
- Vendor nine pinned community maintenance skills instead of seven, and refresh them to the reviewed upstream commit: adds the `0.1.3-alpha.1`/`0.1.3-alpha.2` migration cards, the precision checklist, `inject-lint`, `dsh-plugin-development`, `plugin-heavy-dep` and `dsh-benchmark-case`. The migration cards still stop at `0.1.3-alpha.2`; `0.1.5-rc.1` was verified against the exact host artifacts and this project's own probes instead.

---

Auto Mode 0.1.7 supports the exact Harness cohort `0.1.2-rc.1`, `0.1.2-alpha.5`, `0.1.2-alpha.3`, and `0.1.2-alpha.2`. Use `dsh --version` to check the running host before upgrading the plugin. Harness `0.1.1-rc.2` must migrate to a supported pair; this release does not backport the old host API.

- Read modern Session events through `seq`/`eventAt`, retain the Alpha event-array fallback, and fail early on old or mixed peer versions instead of crashing during a user turn (#13).
- Restore translated Auto labels and icons in current Chinese permission menus (#10).
- Explain permission boundaries before tool use and recover from redundant `workspace-write` arguments without changing standing authority (#8, #12; adapted from #11).
- Build Git installs through `prepare`, while registry packages retain prebuilt server and browser entries (#7).
- Expand classifier secret redaction and encoded URL credential detection; conservatively inspect patch paths and keep third-party patch execution behind manual approval (#6, sanitizer concern in #4).
- Allow literal PowerShell assignments and recursively review command-valued assignments; preserve dynamic execution and critical deletion guards (selected correction from #3).
- Vendor seven pinned community maintenance skills; verify exact host cohorts, diagnose profile/artifact identity, and publish only the tarball verified by the full CI matrix.

Contribution decisions and reproduction/verification details are in [the maintenance record](https://github.com/NanmiCoder/dsh-auto-mode/blob/main/docs/maintenance-2026-09-06/README.md). PR #3's authorization cache and blanket retry, PR #4's content-based write restriction, and PR #6's broad patch auto-approval are intentionally not included.
