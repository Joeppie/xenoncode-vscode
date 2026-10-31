// server/lib.ts — the LSP LOGIC, pure (the pyramid's L1: no connection,
// no vscode, no fs). Everything the editor shows is computed from a plain
// file list ({name, code}) — the SAME xenoncore analyzer the Archean
// blueprint app's IDE runs, so a red squiggle here is a red squiggle there.

import {
  DiagnosticSeverity, CompletionItemKind, SymbolKind,
  type CompletionItem, type Diagnostic, type Hover, type SymbolInformation,
} from 'vscode-languageserver-protocol';
import {
  analyzeProject, xcDoc, projectFunctions, projectDecls, definitionOf,
  XC_SHIM_FUNCTIONS, XC_LANG_FUNCTIONS,
  type XCFile, type XCDiagnostic,
} from 'xenoncore';

/** the HARD class: real defects (the analyzer's error/warning severities) */
const SEV: Record<string, DiagnosticSeverity> = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  hint: DiagnosticSeverity.Hint,
};

export function toDiagnostics(diags: XCDiagnostic[]): Diagnostic[] {
  return diags.map(d => ({
    range: {
      start: { line: Math.max(0, d.line - 1), character: Math.max(0, d.from) },
      end: { line: Math.max(0, d.line - 1), character: Math.max(d.from, d.to) },
    },
    severity: SEV[d.severity] ?? DiagnosticSeverity.Information,
    code: d.code,
    source: 'xenoncore',
    message: d.message,
  }));
}

/** the word under/just-before the caret (keeps @ and $ sigils, no dots). */
export function wordAt(line: string, col: number): string {
  let s = col, e = col;
  const ok = (ch: string | undefined) => !!ch && /[\w]/.test(ch);
  while (s > 0 && ok(line[s - 1])) s--;
  if (s > 0 && (line[s - 1] === '@' || line[s - 1] === '$')) s--;
  while (e < line.length && ok(line[e])) e++;
  return line.slice(s, e);
}

export function analyze(files: XCFile[], aliases: string[]): XCDiagnostic[] {
  return analyzeProject(files, aliases.length ? { aliases } : {});
}

/** completion: the kind-gated vocabulary + the project's @functions + $decls */
export function completions(files: XCFile[], line: string, col: number): CompletionItem[] {
  const w = wordAt(line, col).toLowerCase().replace(/^[$@]/, '');
  const items: CompletionItem[] = [];
  for (const name of XC_SHIM_FUNCTIONS)
    if (!w || name.toLowerCase().startsWith(w))
      items.push({ label: name, kind: CompletionItemKind.Function, detail: 'device (xc_host)' });
  for (const name of XC_LANG_FUNCTIONS)
    if (!w || name.toLowerCase().startsWith(w))
      items.push({ label: name, kind: CompletionItemKind.Keyword, detail: 'language' });
  for (const f of projectFunctions(files))
    if (!w || f.name.toLowerCase().startsWith(w))
      items.push({ label: `@${f.name}`, kind: CompletionItemKind.Function, detail: f.display });
  for (const d of projectDecls(files))
    if (!w || d.name.toLowerCase().replace(/^\$/, '').startsWith(w))
      items.push({ label: d.name, kind: CompletionItemKind.Variable, detail: `var (${d.file})` });
  return items;
}

/** hover: the xenoncore reference (sig + description + ORIGIN) — the same
 *  doc table the app's editor shows; project @functions add their file. */
export function hover(files: XCFile[], line: string, col: number): Hover | null {
  const word = wordAt(line, col);
  if (!word) return null;
  if (word.startsWith('@')) {
    const fn = projectFunctions(files).find(f => f.name === word.slice(1).toLowerCase());
    if (fn) return { contents: { kind: 'markdown', value: `\`${fn.display}\`\n\n_declared in ${fn.file}:${fn.line}_` } };
  }
  const doc = xcDoc(word.replace(/^[$@]/, ''));
  if (!doc) return null;
  return { contents: { kind: 'markdown', value: `\`${doc.sig}\`\n\n${doc.desc}\n\n— _${doc.origin}_` } };
}

/** document symbols: @functions + global declarations */
export function symbols(files: XCFile[], fileName: string): SymbolInformation[] {
  const out: SymbolInformation[] = [];
  for (const f of projectFunctions(files))
    if (f.file === fileName)
      out.push({
        name: `@${f.name}`, kind: SymbolKind.Function,
        location: { uri: fileName, range: { start: { line: f.line - 1, character: 0 }, end: { line: f.line - 1, character: 0 } } },
      });
  for (const d of projectDecls(files))
    if (d.file === fileName)
      out.push({
        name: d.name, kind: SymbolKind.Variable,
        location: { uri: fileName, range: { start: { line: d.line - 1, character: 0 }, end: { line: d.line - 1, character: 0 } } },
      });
  return out;
}

/** go-to-definition for @function calls */
export function definition(files: XCFile[], line: string, col: number) {
  const word = wordAt(line, col);
  if (!word.startsWith('@')) return null;
  const fn = definitionOf(projectFunctions(files), word.slice(1));
  return fn ? { file: fn.file, line: fn.line, display: fn.display } : null;
}

/**
 * THE TAB LAW (the dev's rule, ported from their extension's aggressive
 * auto-convert): the game's parser scopes block bodies by TABS — four
 * leading spaces (then two) collapse to one tab, recursively, only in the
 * leading whitespace. Text bodies ride untouched. (The dev's extension
 * rewrites the editor on every keystroke; here it is a FORMAT command —
 * same law, no surprises.)
 */
export function leadingSpacesToTabs(text: string): string {
  return text
    .split('\n')
    .map(line => {
      const m = /^([ \t]+)(.*)$/.exec(line);
      if (!m) return line;
      const lead = m[1]!
        .replace(/    /g, '\t')      // four spaces first (the dev's order)
        .replace(/  /g, '\t');
      return lead + m[2];
    })
    .join('\n');
}
