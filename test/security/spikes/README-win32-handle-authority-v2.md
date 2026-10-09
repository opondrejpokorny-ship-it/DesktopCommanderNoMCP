# Windows handle-bound file-read experiment (V2 spike)

**Status: EXPERIMENTAL / REWORK. NOT production-ready, not an MCP tool.**
This test-only research is unrelated to customer rollout. The existing NoMCP observer V1 and Owned Remote 40-tool profile must remain unchanged.

## Hypothesis and mechanism

Instead of calling Git CLI, a constrained metadata reader might open a file once and verify the *same* opened native Windows file handle before reading contents. The proof uses `CreateFileW`, `GetFinalPathNameByHandleW` and `GetFileInformationByHandle`; on a successful path and single-link check it hashes at most 65536 bytes with `FileStream(SafeFileHandle)`. It deliberately denies hardlinks with link count other than one. The caller-provided `allowedRoot` is assumed trusted; this proof does NOT derive it from stock Desktop Commander allowedDirectories. It also opens an underlying handle with read access before authorizing the content read; its metadata access is outside the scope of this narrow exercise.

This is NOT an OS-enforced sandbox for a Git subprocess. It cannot provide a full Git status/diff implementation, full filesystem policy parity, safe root identity under concurrent rename or macOS support.

## Repro on the disposable Windows branch

From repo root (Windows, Node.js and Windows PowerShell 5.1):

```powershell
node --test test/security/spikes/win32-handle-authority-v2.test.cjs
node --test test/security/spikes/win32-handle-authority-v2-edge.test.cjs
node --test test/security/spikes/win32-handle-authority-v2-race.test.cjs
```

All fixtures are created under a new random `%TEMP%` directory and removed after each suite. No ACL or global policy modifications. PowerShell `Add-Type -Path` compiles the checked-in C# source *inside the child PowerShell process*; there is no installer, native binary or persistent service.

## Actual observed local evidence (2026-10-08; Cube / DESKTOP-IJDUDT9)

- Base suite: 8/8 PASS (seven subtests plus parent).
- Race suite: 1/1 PASS, 300 observations while the test toggled one junction 355 times between allowed and disallowed fixture directories. No forbidden fixture digest returned.
- Additional edge suite: 6 PASS, 0 FAIL, 1 SKIPPED. The file-symlink test was skipped because the Windows account lacks that privilege; it is NOT a passed security check.
- Edges: allowed file, external file, adjacent sibling prefix, missing file, junction escape, cross-boundary hardlink, nested file, root case variation, exactly 64 KiB, 64 KiB + 1, extended Win32 path spelling, and alternate data stream rejection behavior.
- Codex CLI Terra read-only fact-packet review: REWORK (not a source-complete review). It flagged trusted-root identity, reparse variations, path identity changes after open and the need to prove API failure handling.

## Unresolved before any security GO

1. Trusted `allowedRoot` is a string parameter. The verifier needs an immutable binding to stock-authorized directory identity, not just a prior `realpath` string. Root/ancestor rename and replacement must fail closed.
2. No proof against untested symlink, mount-point and reparse tags. Real file symlink negative is still SKIPPED.
3. This is only a returned-hash check. It does not instrument kernel file OPEN/READ events; an absence of returned forbidden bytes is weaker than proving *zero unauthorized reads*.
4. The handle can be opened before policy authorization; threat-model metadata existence disclosure, access-control timing and error side channels separately.
5. NTFS hardlinks are conservatively refused, which can deny otherwise legitimate files. Verify ID, volume identity, stream/ADS semantics, case and device path behavior across Windows filesystems.
6. File replacement and trusted root/ancestor rename while a handle is already open need dedicated stress tests; the junction race is not equivalent.
7. Output is only a hash, not safe Git parsing. Packed refs, index, packed objects, alternates, linked worktrees, config includes, diff-index fidelity and consistency remain unsolved. Without an independent approved parser, no Git subprocess may run.
8. Read/write/terminal stock policy and exact Commercial ALLOW/DENY/REQUIRE APPROVAL, device authorization, broker dispatch, cancellation, privacy, bounded resource use and negative tests are not integrated.
9. Windows and macOS require independent native validation. Windows Job Objects alone do NOT restrict arbitrary filesystem reads.
10. Existing NoMCP INTERNAL_REPO_OBSERVE_V1 has 33 tests: 27 PASS, 6 security RED FAIL. It remains NO-GO and must not be merged on the strength of these spike tests.

## Next justified task

Prototype root-handle/volume/inode binding and negative rename/replacement tests in the isolated spike. Instrument Windows file access externally to verify actual no-outside-read behavior in a disposable fixture. Only then consider a tightly scoped read-only Git metadata parser for a small ordinary-repository subset, with comprehensive RED tests. Never modify production/manifest/installer/customer runtime, and do not claim #41/#42 checkpoint completion.

## 2026-10-09 root-identity follow-up: REWORK; atomic authority still absent

Added experimental `CaptureRootIdentity(root)` and `ObserveBound(root, file, trustedRootId)` to the **test-only C# fixture**. The capture opens the root directory through a Windows handle, checks final opened path, directory/reparse attributes, and captures volume serial + file index together with a path fingerprint. The separate `ObserveBound` API checks the token before calling the original pathname-based observer and rechecks afterwards. No model-facing APIs, production source, installer, stock policy or live runtime changed.

The token is **not a secure capability**: it is reconstructible and must not be treated as authorization, supplied by an untrusted caller or exposed as a model-facing parameter. The POC assumes a trusted pre-established root; real stock allowedDirectories policy binding, true root-handle-relative child resolution, trusted token custody, and cancellation remain unsolved. The public method demonstrates a stable-state root swap check, **not an atomic read boundary**.

First root-binding test run was RED (missing capture API); second surfaced a malformed-token failure; after validating the fixed token shape the new suite turned GREEN. Deterministic fixture evidence:
- Old path-only `Observe` **did return** the digest of a different directory placed at the previously approved path.
- Bound stable-state observer returned `DENY_ROOT_IDENTITY` after the root directory was replaced, `DENY_ROOT_PATH` when original root moved, and rejected malformed identity tokens and a root junction.
- A separate **sequential interleaving demonstration** (not a live exploit of `ObserveBound`) proved that two identity observations can both match while an insecure read between them observes an attacker-supplied replacement. This makes the unavoidable check/open/check TOCTOU limitation explicit. Post-checking cannot undo an already executed unauthorized read.

Fresh combined four-suite Windows run on Cube: **24 total = 23 PASS, 0 FAIL, 1 SKIP** (file symlink privilege unavailable); junction retarget suite 300 observations and 367 retargets. Test-only `node --test test/security/spikes/win32-handle-authority-v2-root-binding.test.cjs` reproduces the new edge cases.

**Next security prerequisite:** a proof of handle-relative/no-reparse traversal anchored to the *same already-authorized root directory handle*, kernel-level file-OPEN/READ tracing, and verified refusal of any file outside the root under deliberate parent/ancestor renames. Extend to configs, packs, refs and macOS separately. Do not integrate #41/#42 or claim a Git subprocess is sandboxed on the strength of these tests.

Build verification on the isolated branch: `npm ci --ignore-scripts --no-audit --no-fund` completed successfully, then `npm run build` exited 0. **Do not run broad `npm test` on the shared Cube login without independently isolated HOME/config:** its `test/test.js` changes `configManager.allowedDirectories` in the user's `~/.claude-server-commander/config.json`; a broad-suite attempt was intentionally terminated at that first module upon inspecting its source. No full-suite PASS is claimed. Post-stop metadata inspection showed four configured allowed directories and none matching this spike test directory; no pre-run content digest exists, so this is not proof of no transient configuration mutation.

Codex CLI Terra source-direct read-only review was attempted and blocked by managed file-read policy; no independent source-reviewed security verdict is claimed. The fixed C# helper remains research-only despite passing its narrow tests.
