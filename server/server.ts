// server/server.ts — the LSP connection adapter (thin by design: every
// decision is in lib.ts, pinned at the node tier).
//
// PROJECT MODEL v1: the .xc files in the OPEN DOCUMENT'S directory (the
// workspace folder a `xenon decompose` produced) + open documents; the
// analyzer's alias census stays EMPTY (v1: unknown-alias checks off — the
// craft's device table needs craft.json's CraftSpec, an S5+ upgrade).
import {
  createConnection, TextDocuments, ProposedFeatures,
  InitializeResult, TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { XCFile } from 'xenoncore';
import { analyze, completions, definition, hover, symbols, toDiagnostics } from './lib';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

const projectFiles = (docPath: string): XCFile[] => {
  const dir = dirname(docPath);
  const out: XCFile[] = [];
  const seen = new Set<string>();
  if (existsSync(dir))
    for (const f of readdirSync(dir).filter(f => f.endsWith('.xc'))) {
      out.push({ name: f, code: readFileSync(`${dir}/${f}`, 'utf8') });
      seen.add(f.toLowerCase());
    }
  for (const d of documents.all()) {                    // unsaved buffers win
    const p = d.uri.replace(/^file:\/\//, '');
    if (!p.endsWith('.xc')) continue;
    const name = p.slice(p.lastIndexOf('/') + 1);
    if (seen.has(name.toLowerCase())) continue;
    out.push({ name, code: d.getText() });
  }
  return out;
};
const docPath = (uri: string) => {
  try { return fileURLToPath(uri); } catch { return uri.replace(/^file:\/\//, ''); }
};
const docName = (uri: string) => {
  const p = docPath(uri);
  return p.slice(p.lastIndexOf('/') + 1);
};

const validate = (uri: string) => {
  const doc = documents.get(uri);
  if (!doc) return;
  const diags = analyze(projectFiles(docPath(uri)), [])
    .filter(d => d.file.toLowerCase() === docName(uri).toLowerCase());
  connection.sendDiagnostics({ uri, diagnostics: toDiagnostics(diags) });
};

connection.onInitialize((): InitializeResult => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: { triggerCharacters: ['@', '$', '.', '('] },
    hoverProvider: true,
    definitionProvider: true,
    documentSymbolProvider: true,
  },
}));

documents.onDidChangeContent(e => validate(e.document.uri));
documents.onDidOpen(e => validate(e.document.uri));

connection.onCompletion((p) => {
  const doc = documents.get(p.textDocument.uri);
  if (!doc) return [];
  const line = doc.getText({
    start: { line: p.position.line, character: 0 },
    end: { line: p.position.line + 1, character: 0 },
  });
  return completions(projectFiles(docPath(p.textDocument.uri)), line, p.position.character);
});

connection.onHover((p) => {
  const doc = documents.get(p.textDocument.uri);
  if (!doc) return null;
  const line = doc.getText({
    start: { line: p.position.line, character: 0 },
    end: { line: p.position.line + 1, character: 0 },
  });
  return hover(projectFiles(docPath(p.textDocument.uri)), line, p.position.character);
});

connection.onDefinition((p) => {
  const doc = documents.get(p.textDocument.uri);
  if (!doc) return null;
  const line = doc.getText({
    start: { line: p.position.line, character: 0 },
    end: { line: p.position.line + 1, character: 0 },
  });
  const hit = definition(projectFiles(docPath(p.textDocument.uri)), line, p.position.character);
  if (!hit) return null;
  const base = p.textDocument.uri.slice(0, p.textDocument.uri.lastIndexOf('/') + 1);
  return {
    uri: base + hit.file,
    range: { start: { line: hit.line - 1, character: 0 }, end: { line: hit.line - 1, character: 0 } },
  };
});

connection.onDocumentSymbol((p) => {
  const doc = documents.get(p.textDocument.uri);
  if (!doc) return [];
  const files = projectFiles(docPath(p.textDocument.uri));
  const name = docName(p.textDocument.uri);
  return symbols(files, name).map(s => ({
    ...s,
    location: { ...s.location, uri: p.textDocument.uri },
  }));
});


connection.listen();
documents.listen(connection);
