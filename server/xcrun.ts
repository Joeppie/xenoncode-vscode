// server/xcrun.ts — the node VM runner for the debug adapter. It boots the
// SAME artifacts the browser app runs: the glue + wasm SHIPPED IN THE
// xenoncore package (tools/xenoncode/xenoncode.js + .wasm, git LFS), the
// vmharness boot law (the ENVIRONMENT=web glue fetches its wasm by URL →
// we serve the shipped bytes through a fetch shim), and XenonRun.open's
// boot sequence (write files, screens FIRST-WINS incl the plain 'main'
// target, capacity, set_cycle_ms 40, hook_live 0 — the main-thread host's
// debugger is the pair+depth stream). Deliberately minimal for v1: NO
// devices (io reads 0, writes log), no beacons, no audio — a program
// debugged in VS Code runs against an empty craft. THE STEPPER LAW comes
// from xenoncore/stepper.ts — the SAME pinned law the app pump walks.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const require_ = createRequire(__filename);

export interface RunnerScreen { alias: string; channel: number; w: number; h: number }
export interface RunnerFile { name: string; code: string }
export interface RunnerEvent { e: string; io?: string | number; v?: number | string }
export interface RunnerVar { name: string; t: number; v: string }
export interface RunnerLocal extends RunnerVar { s: number }

let wasmBytes: Buffer | null = null;
let assetDir = '';
function assets(): string {
  if (assetDir) return assetDir;
  const pkg = require_.resolve('xenoncore/package.json');
  assetDir = join(dirname(pkg), 'tools', 'xenoncode');
  return assetDir;
}
function serveWasm(): void {
  if (wasmBytes) return;
  wasmBytes = readFileSync(join(assets(), 'xenoncode.wasm'));
  const realFetch = globalThis.fetch;
  const bytes = wasmBytes;
  globalThis.fetch = (async (u: unknown, o?: RequestInit) => {
    const s = String(typeof u === 'object' && u !== null && 'url' in u
      ? (u as { url: string }).url : u);
    if (s.includes('xenoncode.wasm'))
      return new Response(bytes.slice(0), { status: 200,
        headers: { 'content-type': 'application/wasm' } });
    return (realFetch as (u: unknown, o?: RequestInit) => Promise<Response>)(u, o);
  }) as typeof fetch;
}

export class XcRunner {
  private constructor(private mod: any) {}
  running = false;
  error = '';

  static async open(files: RunnerFile[], screens: RunnerScreen[]): Promise<XcRunner> {
    serveWasm();
    const glue = await import(pathToFileURL(join(assets(), 'xenoncode.js')).href);
    const mod = await glue.default({ locateFile: () => 'xenoncode.wasm' });
    const run = new XcRunner(mod);
    const put = (name: string, code: string) => {
      // UTF-8 BYTE length, not string length (the non-ASCII truncation law)
      const nb = new TextEncoder().encode(code).length + 1;
      const cp = mod._malloc(nb); mod.stringToUTF8(code, cp, nb);
      const np = mod._malloc(name.length + 1); mod.stringToUTF8(name, np, name.length + 1);
      mod._xc_write_file(np, cp);
      mod._free(np); mod._free(cp);
    };
    mod._xc_reset_screens();
    mod._xc_reset_devices();
    mod._xc_set_capability(0, 65536);
    for (const f of files) put(f.name, f.code);
    for (const sc of screens) {
      const nb = new TextEncoder().encode(sc.alias).length + 1;
      const np = mod._malloc(nb);
      mod.stringToUTF8(sc.alias, np, nb);
      mod._xc_add_screen(np, sc.channel, sc.w, sc.h);
      mod._free(np);
    }
    // THE BUILT-IN PLAIN TARGET: 'main' at the panel size, before boot
    const mp = mod._malloc(5);
    mod.stringToUTF8('main', mp, 5);
    mod._xc_add_screen(mp, 0, screens[0]?.w ?? 640, screens[0]?.h ?? 480);
    mod._free(mp);
    if (typeof mod._xc_set_cycle_ms === 'function') mod._xc_set_cycle_ms(40);   // 25 Hz CADENCE LAW
    if (typeof mod._xc_hook_live === 'function') mod._xc_hook_live(0);          // main-thread host
    if (mod._xc_boot()) { run.error = mod.UTF8ToString(mod._xc_error()); return run; }
    run.running = true;
    return run;
  }

  cycle(): { evs: RunnerEvent[]; pausedAt: { idx: number; line: number } | null } {
    if (!this.running) return { evs: [], pausedAt: null };
    const m = this.mod;
    const rc = m._xc_cycle();
    if (rc === 1) { this.error = m.UTF8ToString(m._xc_error()); this.running = false; return { evs: [], pausedAt: null }; }
    const evs = JSON.parse(m.UTF8ToString(m._xc_events())) as RunnerEvent[];
    if (rc === 2 && typeof m._xc_pause_file === 'function' && typeof m._xc_pause_line === 'function')
      return { evs, pausedAt: { idx: m._xc_pause_file(), line: m._xc_pause_line() } };
    return { evs, pausedAt: null };
  }

  cyclePairs(): number[] {
    if (typeof this.mod._xc_cycle_pairs !== 'function') return [];
    try { return JSON.parse(this.mod.UTF8ToString(this.mod._xc_cycle_pairs())) as number[]; } catch { return []; }
  }
  cycleDepths(): number[] {
    if (typeof this.mod._xc_cycle_depths !== 'function') return [];
    try { return JSON.parse(this.mod.UTF8ToString(this.mod._xc_cycle_depths())) as number[]; } catch { return []; }
  }
  sourceFiles(): string[] {
    if (typeof this.mod._xc_source_files !== 'function') return [];
    try {
      return (JSON.parse(this.mod.UTF8ToString(this.mod._xc_source_files())) as string[])
        .map(f => f.split(/[\\/]/).pop() ?? f);
    } catch { return []; }
  }
  vars(): RunnerVar[] {
    try {
      const j = JSON.parse(this.mod.UTF8ToString(this.mod._xc_vars())) as { name: string; t: number; v: string }[];
      return Array.isArray(j) ? j.map(e => ({ name: e.name, t: e.t | 0, v: String(e.v ?? '') })) : [];
    } catch { return []; }
  }
  locals(fileIdx: number, line: number): RunnerLocal[] {
    return typeof this.mod._xc_locals_json === 'function'
      ? ((): RunnerLocal[] => {
          try {
            const j = JSON.parse(this.mod.UTF8ToString(this.mod._xc_locals_json(fileIdx, line)));
            return Array.isArray(j) ? j : [];
          } catch { return []; }
        })()
      : [];
  }
  writeVar(fileIdx: number, line: number, name: string, t: number, v: string): { ok: boolean; error?: string } {
    if (typeof this.mod._xc_write_var !== 'function')
      return { ok: false, error: 'the shipped wasm lacks the writer' };
    const ne = new TextEncoder().encode(name), ve = new TextEncoder().encode(v);
    const np = this.mod._malloc(ne.length + 1), vp = this.mod._malloc(ve.length + 1);
    this.mod.stringToUTF8(name, np, ne.length + 1);
    this.mod.stringToUTF8(v, vp, ve.length + 1);
    try {
      return JSON.parse(this.mod.UTF8ToString(this.mod._xc_write_var(fileIdx, line, np, t, vp)));
    } finally {
      this.mod._free(np); this.mod._free(vp);
    }
  }
  debugTrack(on: boolean) {
    if (typeof this.mod._xc_debug_track === 'function') this.mod._xc_debug_track(on ? 1 : 0);
  }
  requestPause() {
    if (typeof this.mod._xc_pause_request === 'function') this.mod._xc_pause_request();
  }
}
