// test/lib.test.ts — the LSP logic at the SMALLEST tier (L1): no editor,
// no connection — file lists in, protocol objects out.
import { describe, expect, it } from 'vitest';
import { DiagnosticSeverity, CompletionItemKind, SymbolKind } from 'vscode-languageserver-protocol';
import { analyze, completions, definition, hover, symbols, toDiagnostics, wordAt } from '../server/lib';

const f = (name: string, code: string) => ({ name, code });

describe('wordAt', () => {
  it('keeps sigils and stops at non-word chars', () => {
    const line = '  print(input_number(1, 0))\n';
    expect(wordAt(line, 8)).toBe('input_number');
    expect(wordAt('@fly(1)', 3)).toBe('@fly');
    expect(wordAt('$speed = 1', 4)).toBe('$speed');
  });
});

describe('diagnostics mapping', () => {
  it('1-based analyzer rows become 0-based ranges, severities map, source tags', () => {
    const ds = analyze([f('main.xc', 'init\n\tmade_up_fn(1)\n')], []);
    expect(ds.length).toBeGreaterThan(0);
    const [d] = toDiagnostics(ds);
    expect(d!.range.start.line).toBe(1);
    expect(d!.severity).toBe(DiagnosticSeverity.Warning);   // unknown-function is the analyzer's warning class
    expect(d!.source).toBe('xenoncore');
    expect(String(d!.code)).toMatch(/^xc-/);
  });
});

describe('completion', () => {
  it('prefix-filters the vocabulary + project functions', () => {
    const files = [f('main.xc', 'function @fly_it($a : number)\n\treturn $a\ninit\n\t@fly_it(1)\n')];
    const items = completions(files, '\tfly', 4);
    const labels = items.map(i => i.label);
    expect(labels).toContain('@fly_it');
    expect(items.find(i => i.label === '@fly_it')!.kind).toBe(CompletionItemKind.Function);
  });
  it('variables are offered', () => {
    const items = completions([f('main.xc', 'var $thrust = 0\ninit\n\tprint(1)\n')], '\tth', 3);
    expect(items.map(i => i.label)).toContain('$thrust');
  });
});

describe('hover', () => {
  it('shim functions resolve to sig + description (+ origin line)', () => {
    const h = hover([], '\tprint(input_number(1, 0))\n', 8);
    expect(h).not.toBeNull();
    const v = (h!.contents as { value: string }).value;
    expect(v).toContain('input_number');
    expect(v.length).toBeGreaterThan(30);
  });
  it('project @functions hover with their declaration site', () => {
    const files = [f('main.xc', 'function @fly_it($a : number)\n\treturn $a\ninit\n\t@fly_it(1)\n')];
    const h = hover(files, '\t@fly_it(1)\n', 3);
    expect((h!.contents as { value: string }).value).toContain('main.xc:1');
  });
});

describe('symbols + definition', () => {
  it('document symbols list functions and global vars', () => {
    const files = [f('main.xc', 'var $mode = 0\nfunction @go()\n\tprint(1)\ninit\n\t@go()\nprint($mode)\n')];
    const syms = symbols(files, 'main.xc');
    expect(syms.map(s => s.name)).toEqual(expect.arrayContaining(['@go', '$mode']));
    expect(syms.find(s => s.name === '@go')!.kind).toBe(SymbolKind.Function);
  });
  it('go-to-definition finds the declaration line', () => {
    const files = [f('main.xc', 'function @go()\n\tprint(1)\ninit\n\t@go()\n')];
    const d = definition(files, '\t@go()\n', 3);
    expect(d).not.toBeNull();
    expect(d!.file).toBe('main.xc');
    expect(d!.line).toBe(1);
  });
});
