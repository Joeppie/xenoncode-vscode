# TESTING.md — the test & development inventory for `xenoncode-vscode`

The pyramid laws of the family (docs/TEST-PYRAMID.md in
archean-blueprint-tools) apply: every law at the SMALLEST tier,
`// e2e-tier because:` on everything above node. This is the full
punchlist — ✅ landed, 🔜 planned, with the exact next commands.

## T0 — pure logic (vitest, plain node) — ✅ LANDED, 11 pins
`test/lib.test.ts`: wordAt · diagnostics mapping (1-based→0-based,
severities, `source:xenoncore`) · completion (vocabulary + project +
vars) · hover (sig/desc/origin, project fns) · symbols · definition ·
THE TAB LAW (dev rule + deep indent).
Rule: **no `vscode` import** in this tier (enforced by convention; add
an import-boundary grep to CI at next touch).

## T1 — protocol (node, no editor) — 🔜 NEXT, ~half a day
The LSP server over an in-memory JSON-RPC pair (`vscode-jsonrpc`):
- [ ] initialize → capabilities (completion/hover/definition/symbols/formatting)
- [ ] didOpen fixture with `made_up_fn(1)` → publishDiagnostics carries
      `xc-unknown-function` (source `xenoncore`) — the squiggle law
      without an editor
- [ ] completion request mid-word → vocabulary + `@localfn` in the list
- [ ] hover on `input_number` → sig + origin in the markdown
- [ ] definition on `@go` → the declaration file:line
- [ ] formatting request on space-indented code → the tab fix (TAB LAW
      end-to-end through the server)
Playground for it: `node dist/server.js --stdio` + a tiny client.

## T2 — real extension host (`@vscode/test-electron`, `xvfb-run`) — 🔜
Nightly (per § P10), ≤ 6 legs, e2e-tier because: real editor, real
renderer, real process:
- [ ] activation on `.xc` + `craft.json` workspace
- [ ] grammar: tokenize a bench program → expected scope list (snapshot)
- [ ] a red squiggle is VISIBLE = the DiagnosticsCollection has the row
- [ ] completion popup resolves `input_number` (editor.executeCompletionItems)
- [ ] F5-less smoke of `xenon.decompose` via the command palette into a
      temp dir → craft.json + src/*.xc exist; `xenon.pack` in place →
      byte-bounded diff (the fixture: xenoncore's bench disks)
- [ ] install the CI VSIX artifact into the test host (installs as
      shipped, not as source)

## T3 — the game roundtrip (manual, per release) — 🔜
The loop the whole feature exists for:
- [ ] pick a craft you fly → SAVE in-game (packs `blueprint.json`) →
      Decompose → edit a program (completion/hover visible) → Pack IN
      PLACE → load the craft in-game → the computer reboots on the
      edited program (watch the in-game screen).
- [ ] byte-safety: `git diff --stat` on a saves folder — only
      `blueprint.json` files change, and only after an intentional Pack.
- [ ] `#NODES` disks (programs authored in the in-game node editor):
      Decompose→Pack keeps the first-line header byte-identical (pinned
      in xenoncore; verify once in the real flow).
- [ ] phone-free: the extension never writes `server/worlds/**` (world
      saves are read-only sources by law).

## T4 — the dev-extension parity leg: REAL-parser syntax checks — 🔜
The ONE thing the dev extension has that we lack: parse errors from the
interpreter's own parser. HOW they get it (main.cpp, verified
2026-11-01): their repo ships a native CLI (`xenoncode`) around the C++
interpreter — `-parse-line[-generic]`, `-parse-file`, `-compile <dir>`
(parse+compile a program dir with a main.xc → writes the
`XC_PROGRAM_EXECUTABLE` = the `xc_program.bin` format found in the
game's HUD dirs!), `-run <dir> -hz <n>` (a bare desktop simulator).
The extension is a remote control for a binary the USER builds.
Two paths to parity-plus:
- [ ] **T4-A (day parity):** settings `xenoncode.cliPath`; ONE
      `xenoncode -compile <srcDir>` call per project on save/decompose —
      the decomposed workspace IS their program-dir shape (main.xc
      entry!), so this is project-wide real-parser diagnostics —
      strictly better than their per-line spawns. Optional: `-run` in a
      terminal = quick program smoke.
- [ ] **T4-B (the exceed):** run the REAL XenonCode wasm (it ships in
      xenoncore) as a COMPILE CHECKER in the extension host:
- [ ] rebuild the wasm with `-sENVIRONMENT=web,worker,node` (REWRITE
      § P10 S0 item; xenoncore build.sh) → node-loadable glue
- [ ] a compile-only entry (the shim's compile path, no cycles): file
      set in → `{ok}` | `{error: "…:line: msg"}` out
- [ ] wire as a SECOND diagnostics source (`xenon-parse`) beside
      `xenoncore`; debounce per PROJECT not per line (their per-line
      spawn cost is the flaw we must not copy)
- [ ] TRUE-NEGATIVE law: the bench disks compile clean (pin)

## T5 — debugger (DAP) — ✅ LANDED v0.3.0 (2026-11-01)
`server/dap.ts` (adapter, debug type `xenoncode`) + `server/xcrun.ts`
(node VM runner: the glue+wasm SHIPPED IN xenoncore, the vmharness
fetch-shim boot law, 25 Hz cadence, the tracking gate). Stepping = the
pinned `xenoncore/stepper.ts` law; pause = THE PARK LAW (`requestPause`
→ rc=2 exact-line); globals + locals scopes; THE WRITEBACK LAW on
setVariable (globals; locals read-only in v1); STEPPING OFF A BREAKPOINT
suppresses the current line's break until you leave it. The smoke
(`test/dap.test.ts`) spawns the BUILT adapter and speaks real DAP on
real wasm: initialize→launch→setBreakpoints→configurationDone→
Stopped(breakpoint)→next→Stopped(step)→stackTrace→variables($t)→
disconnect. LESSONS: npm git-deps get LFS POINTERS (xenoncore v0.3.2
un-LFS'd the shipped wasm); clients must send `pathFormat:'path'`;
the VM's vars ride BARE names — the sigil is display.
v1 boundary: no devices (io reads 0), single frame (stepOut = F10),
no conditional breakpoints, no screens pane (webview = T6).
Tightenings: stepOut via the depth stream; io device stubs from
craft.json; screens rendered from the shim's RAM buffers.

## T6 — simulation panel (webview) — 🔜 after S3 (CraftSpec)
Screens canvas (real wasm via the webview), io pin view, pilot pads;
compositor laws tested at jsdom, the webview keeps pixels (per § P10).

## Dev loop (today)
```bash
npm ci && npm test && npm run typecheck && npm run compile
code .                              # F5 = Extension Development Host
#   in the host: open a folder containing craft.json + src/*.xc
#   (make one: node node_modules/xenoncore/dist/bin/xenon.mjs
#              decompose <your>/blueprint.json ./ws)
npx @vscode/vsce package            # VSIX (CI uploads it every push)
```
Marketplace (publish day, needs the user's go + tokens): MS Marketplace
publisher id + `vsce publish`, OpenVSX `ovsx publish` — CI gates:
typecheck + tests + VSIX green first. Icon, CHANGELOG.md, README
screenshots/GIF (the decompose→edit→pack→in-game loop) are publish-day
items.

## Fixtures
Every leg runs on xenoncore's bench disks (INTERCOM 9000009010, LIVE
9000009040, ANALYSIS 9000009090 — one deliberate defect per analyzer
code) — never a truck craft. Real saves are T3-manual only.
