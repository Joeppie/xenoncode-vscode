# xenoncode-vscode — XenonCode for Visual Studio Code

Write **XenonCode** (the language of `Archean` craft computers) in VS Code
with the same brain the [Archean blueprint app](https://joeppie.github.io/archean-blueprint-tools/)
uses: all intelligence comes from the [**xenoncore**](https://github.com/Joeppie/xenoncore)
package — the analyzer, the function vocabulary, the reference docs and
the craft codec. The plan: [REWRITE § P10](https://github.com/Joeppie/archean-blueprint-tools/blob/main/REWRITE.md).

## Features

- **Language support** for `.xc` files: TextMate highlighting, comments
  (`;`), brackets, the `@function` / `$variable` / `include` shapes.
- **Diagnostics** as you type (`source: xenoncore`): undeclared
  `@functions`, unknown functions/methods, missing returns, duplicates,
  unknown includes — the analyzer that ships ZERO false positives on the
  shipped game disks (ChipOS, the Badger).
- **Completion**: the device-shim + language vocabulary, project
  `@functions`, declared `$variables`.
- **Hover**: signature + one-line description + ORIGIN (interpreter ⇄
  shim), and your own `@functions` with their declaration site.
- **Go to definition** for `@calls`; **document symbols** for functions
  and globals.

## The COMPILE function (craft workspaces)

XenonCode lives INSIDE a craft's blueprint (`data.hdd.xc_files`). The
commands turn a craft into a folder of real files and back:

1. **`XenonCode: Decompose Craft`** — pick a `blueprint.json` (an in-game
   save: the game writes these on every SAVE) and a folder → `craft.json`
   (the disk manifest) + `src/<disk>/*.xc` (real files, editor + git
   friendly). Open the folder and edit with full language support.
2. **`XenonCode: Pack Craft`** — writes the `.xc` files back into the
   blueprint with **byte surgery**: every byte outside the edited
   program texts rides unchanged (the corpus proves it). Pack IN PLACE
   (a `.bak` kept) or to `packed.json` — load it in-game and the computer
   reboots on it, exactly like an in-game IDE save.

The same loop exists headless: `npx xenon decompose/pack/programs/diagnose`
and an MCP server (`xenon-mcp`) for AI-assisted program design.

## Parity & testing

[PARITY.md](PARITY.md) audits us against the game developer's own `xenoncode`
extension (v0.0.9 — grammar + tabs + a per-line native-linter spawn): basics
met (their grammar is our seed), exceeded on diagnostics, the full IDE
surface and the COMPILE function. [TESTING.md](TESTING.md) is the living
test/dev inventory (T0 landed → T6).

## Status / limits (v0.3.0)

- The debugger v1 runs a program against an EMPTY craft: `input_number`
  reads 0, outputs print to the debug console. The simulation webview
  (screens, io, pilot inputs) is the next slice (T6).
- The alias census (CraftSpec) is not wired into the analyzer yet, so
  `input_number("alias",…)` alias checks stay off in the extension.
- Game files: point Decompose at your `client/blueprints/<id>/blueprint.json`
  (an in-game save of the craft you fly). The extension ships NO game
  data and never writes into world saves.

## Development

```bash
npm install && npm test          # the pure logic tier (L1, node, no editor)
npm run typecheck && npm compile # bundles → dist/client.js + dist/server.js
npx @vscode/vsce package         # → .vsix (F5 in VS Code = Extension Development Host)
```

Licensing: GPL-3.0 (LICENSE, NOTICE).
