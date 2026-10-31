// client/extension.ts — the VS Code client: starts the language server and
// registers the COMPILE function commands (decompose/pack) on the xenoncore
// CLI (spawned through the package's bin subpath export — the SAME code
// line `npx xenon` runs).
import * as vscode from 'vscode';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import {
  LanguageClient, LanguageClientOptions, ServerOptions, TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;
const require_ = createRequire(__filename);
let out: vscode.OutputChannel | undefined;

function runCli(args: string[]): { ok: boolean; output: string } {
  const bin = require_.resolve('xenoncore/bin/xenon.mjs');
  const r = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { ok: r.status === 0, output };
}

export function activate(context: vscode.ExtensionContext) {
  out = vscode.window.createOutputChannel('XenonCode');
  const serverOptions: ServerOptions = {
    run: { module: context.asAbsolutePath('dist/server.js'), transport: TransportKind.ipc },
    debug: { module: context.asAbsolutePath('dist/server.js'), transport: TransportKind.ipc },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'xenoncode' }],
    synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher('**/*.xc') },
  };
  client = new LanguageClient('xenoncore', 'XenonCode (xenoncore)', serverOptions, clientOptions);
  client.start().catch(() => { /* the server is optional: the commands work without it */ });

  context.subscriptions.push(
    // THE MODERN ADAPTER REGISTRATION (v0.3.1): manifest runtime/program
    // launches are retired by 2026 contribution validation — a debugger
    // contribution carrying them is DROPPED silently (no gutter, no F9,
    // inert F5 — the exact field-missing symptom we shipped into). The
    // descriptor factory is the supported path.
    vscode.debug.registerDebugAdapterDescriptorFactory('xenoncode', {
      createDebugAdapterDescriptor() {
        return new vscode.DebugAdapterExecutable(process.execPath, [
          context.asAbsolutePath('dist/debugAdapter.js'),
        ]);
      },
    }),
    // F5 on an open .xc with no launch.json: point the debugger AT the
    // program folder the file lives in (a decomposed src/<disk> dir).
    vscode.debug.registerDebugConfigurationProvider('xenoncode', {
      resolveDebugConfiguration(_folder, config) {
        if (!config.program) {
          const ed = vscode.window.activeTextEditor;
          if (ed && ed.document.fileName.endsWith('.xc'))
            config.program = path.dirname(ed.document.fileName);
          else if (vscode.workspace.workspaceFolders?.[0])
            config.program = vscode.workspace.workspaceFolders[0].uri.fsPath;
        }
        return config;
      },
    }),
    vscode.commands.registerCommand('xenon.decompose', async () => {
      const bp = await vscode.window.showOpenDialog({
        canSelectFiles: true, canSelectFolders: false, openLabel: 'blueprint.json',
        filters: { 'Archean blueprint': ['json'] },
        title: 'Decompose: choose the craft blueprint.json',
      });
      if (!bp?.[0]) return;
      const ws = await vscode.window.showOpenDialog({
        canSelectFiles: false, canSelectFolders: true, openLabel: 'Decompose INTO this folder',
        title: 'Decompose: choose the workspace folder',
      });
      if (!ws?.[0]) return;
      const dir = ws[0].fsPath;
      const r = runCli(['decompose', bp[0].fsPath, dir]);
      out!.clear(); out!.appendLine(r.output); out!.show(true);
      if (!r.ok) { vscode.window.showErrorMessage(`Decompose failed — see the XenonCode output.`); return; }
      const open = await vscode.window.showInformationMessage(
        'Craft decomposed: craft.json + src/<disk>/*.xc. Open the folder?', 'Open folder');
      if (open) await vscode.commands.executeCommand('vscode.openFolder', ws[0], true);
    }),

    vscode.commands.registerCommand('xenon.pack', async () => {
      const ws = await vscode.window.showOpenDialog({
        canSelectFiles: false, canSelectFolders: true, openLabel: 'Workspace (has craft.json)',
        title: 'Pack: choose the workspace folder',
      });
      if (!ws?.[0]) return;
      const dir = ws[0].fsPath;
      if (!existsSync(`${dir}/craft.json`)) {
        vscode.window.showErrorMessage('No craft.json here — decompose a craft first (XenonCode: Decompose Craft).');
        return;
      }
      const packInPlace = await vscode.window.showQuickPick(
        [{ label: 'Pack IN PLACE', detail: 'writes the source blueprint.json (a .bak rides along)', v: 'inplace' },
          { label: 'Pack to packed.json', detail: 'writes <workspace>/packed.json', v: 'file' }],
        { title: 'Pack: where does the blueprint go?' });
      if (!packInPlace) return;
      const bp = readBlueprintPath(`${dir}/craft.json`);
      const args = packInPlace.v === 'inplace' && bp
        ? ['pack', dir, bp] : ['pack', dir];
      const r = runCli(args);
      out!.appendLine(r.output); out!.show(true);
      if (r.ok) vscode.window.showInformationMessage(`Packed ✓ ${packInPlace.v === 'inplace' ? '(in place, .bak kept)' : '→ packed.json'}`);
      else vscode.window.showErrorMessage('Pack failed — see the XenonCode output.');
    }),

    vscode.commands.registerCommand('xenon.programs', async () => {
      const bp = await vscode.window.showOpenDialog({
        canSelectFiles: true, canSelectFolders: false, openLabel: 'blueprint.json',
        filters: { 'Archean blueprint': ['json'] },
        title: 'List programs of a craft blueprint.json',
      });
      if (!bp?.[0]) return;
      const r = runCli(['programs', bp[0].fsPath]);
      out!.clear(); out!.appendLine(r.output); out!.show(true);
    }),
  );
}

function readBlueprintPath(craftJson: string): string | null {
  try {
    const wp = JSON.parse(require_('node:fs').readFileSync(craftJson, 'utf8'));
    return typeof wp.blueprint === 'string' ? wp.blueprint : null;
  } catch { return null; }
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
