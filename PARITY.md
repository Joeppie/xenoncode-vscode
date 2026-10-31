# PARITY — vs the developer's `xenoncode` VS Code extension (v0.0.9)

The game developer ships a XenonCode extension in the XenonCode repo
(`vscode_extension/`, github.com/Joeppie/XenonCode — 91-line
`extension.js`). We audited it in full; this is the feature-by-feature
table (2026-11-01).

| Capability | dev `xenoncode` 0.0.9 | ours `xenoncode-vscode` |
|---|---|---|
| `.xc` language id + grammar | ✅ (seed of ours) | ✅ (their grammar + dotted `$vars`, color/const keywords, `#NODES` header) |
| language configuration | ✅ | ✅ (theirs, verbatim) |
| tabs warning | ✅ popup | ✅ **fixed by default**: `[xenoncode]` ships `insertSpaces:false` + no-indent-detection |
| spaces→tabs conversion | ✅ aggressive — rewrites the editor on every change, one `editor.edit` per line | ✅ the SAME law as a **Format Document** provider (on demand, pure + pinned) |
| syntax checking | ⚠ per LINE: spawns the native `xenoncode -parse-line-generic` binary **once per line** on every edit (needs the binary on PATH; no project view) | ✅ **project-wide** analyzer (xenoncore): undeclared `@functions`, unknown functions/methods, missing returns, duplicates, unknown includes — with the TRUE-NEGATIVE law (zero hard diagnostics on the shipped ChipOS/Badger/HUD disks, pinned in CI) |
| completion | ❌ | ✅ device vocabulary (the shim's own declarations, pinned to the binary), language functions, project `@functions`, `$variables` |
| hover docs | ❌ | ✅ signature + description + **origin** (interpreter ⇄ shim), project functions with their declaration site |
| go-to-definition | ❌ | ✅ `@function` calls → declaration |
| document symbols | ❌ | ✅ functions + globals |
| craft integration | ❌ | ✅ **COMPILE function**: Decompose a `blueprint.json` (an in-game save) into `craft.json` + `src/*.xc`, Pack back with **byte surgery** (every byte outside the edited programs rides unchanged) |
| craft awareness | ❌ | ✅ program kind, entry law, disk manifest (`craft.json`); alias census = next |
| debugging | ❌ | 🔜 planned (DAP on the stepper law — the package's `stepper.ts` is its pinned core; the app already ships this debugger in-browser) |
| simulation | ❌ | 🔜 planned (webview: real XenonCode wasm, screens, io, pilot inputs) |
| AI integration | ❌ | ✅ `xenon-mcp` (the package): diagnose / analyze_code / vocabulary / decompose / pack over MCP |
| runs without extra binaries | ❌ (needs the native linter on PATH) | ✅ everything ships in the VSIX (TS; wasm later in-browser style) |
| license | repo's | GPL-3.0, NOTICE with their grammar attribution |

**Parity: met** on language basics (grammar/language-config are theirs).
**Exceeded** on: diagnostics (project-wide + true-negative-pinned, vs
per-line binary spawns), the whole IDE surface they lack (completion,
hover, definition, symbols), the tab law (fixed defaults + on-demand
format instead of rewriting the buffer), and everything craft-shaped
(COMPILE function, MCP). **Not yet**: their exact per-line native parse
messages — the path to matching that is running the REAL interpreter
wasm as a compile-checker in the extension host (needs the
`-sENVIRONMENT=web,worker,node` wasm build documented in REWRITE § P10
S0) — tracked in TESTING.md as tier-T4.

Sources: `vscode_extension/src/extension.js` (read in full 2026-11-01),
`vscode_extension/package.json` (contributes: languages, grammar,
`xenoncode.linter_executable`), `www/xc_mode.js` (their web editor
tokenizer).
