# NOTICE — provenance and licensing

## 1. Our code
The extension (client, server, tests, CI) is GPL-3.0 (LICENSE).

## 2. The TextMate grammar and language configuration
`syntaxes/xenoncode.tmLanguage.json` and `language-configuration.json`
seed from the **dev's own VS Code extension** in the XenonCode fork
(github.com/Joeppie/XenonCode, `vscode_extension/`, by batcholi /
FloDKSM) — kept close to the original, extended with dotted `$vars`,
color/constant keywords and the `#NODES` first-line comment. Attribution
in the spirit of the blueprint family's NOTICE terms; no permissions are
claimed.

## 3. The language engine
All analysis, vocabulary and the decompose/pack codec come from the
**xenoncore** package (github.com/Joeppie/xenoncore) — including the
pinned XenonCode interpreter provenance documented there. No game
binaries, assets, data, or machine-local paths ship in this repo.
