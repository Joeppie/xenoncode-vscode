// server/dap.ts — the XenonCode DEBUG ADAPTER (TESTING.md T5). A real
// Debug Adapter Protocol server over the real XenonCode wasm: breakpoints,
// F10/F11 stepping, pause-at-line (PARK LAW), globals + locals at the
// pause, and value WRITEBACK — the stepping is the pinned stepperLaw from
// xenoncore (the SAME law the Archean app's in-browser debugger walks),
// the VM is the shipped glue+wasm, the cadence is the 25 Hz CADENCE LAW.
//
// v1 boundary: one program (a decomposed craft's src/<disk> dir), NO
// devices — input_number reads 0, outputs print to the debug console.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  LoggingDebugSession, InitializedEvent, StoppedEvent, TerminatedEvent,
  OutputEvent, Thread, Source, Scope,
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { pickEntry, stepperLaw, type StepperState } from 'xenoncore';
import { XcRunner } from './xcrun';

const CYCLE_MS = 40;                                   // 25 Hz CADENCE LAW
const GLOBALS_REF = 1, LOCALS_REF = 2;

interface LaunchArgs { program?: string; entry?: string }

export class XenonDebugSession extends LoggingDebugSession {
  private runner: XcRunner | null = null;
  private programDir = '';
  private fileTable: string[] = [];
  private breaks = new Map<string, Set<number>>();
  private st: StepperState = XenonDebugSession.freshState();
  private paused = false;
  private timer: NodeJS.Timeout | null = null;
  private cycles = 0;

  static freshState(): StepperState {
    return { stepMode: 'off', pausedFile: '', pausedLine: 0, pausedDepth: 0,
      toFile: '', toLine: 0, scope: null };
  }

  constructor() {
    super('xenoncode-debug.txt');
    this.setDebuggerLinesStartAt1(true);
    this.setDebuggerColumnsStartAt1(true);
  }

  protected override initializeRequest(
    response: DebugProtocol.InitializeResponse,
  ): void {
    response.body = {
      ...response.body,
      supportsConfigurationDoneRequest: true,
      supportsTerminateRequest: true,
      supportsSetVariable: true,
      supportsConditionalBreakpoints: false,
      supportsStepBack: false,
    };
    this.sendResponse(response);
  }

  protected override async launchRequest(
    response: DebugProtocol.LaunchResponse,
    args: DebugProtocol.LaunchRequestArguments & LaunchArgs,
  ): Promise<void> {
    try {
      const dir = args.program ? path.resolve(args.program) : process.cwd();
      if (!fs.existsSync(dir)) throw new Error(`program folder not found: ${dir}`);
      const names = fs.readdirSync(dir).filter(f => f.endsWith('.xc'));
      if (!names.length) throw new Error(`no .xc files in ${dir}`);
      const files = names.map(n => ({ name: n, code: fs.readFileSync(path.join(dir, n), 'utf8') }));
      const entry = args.entry && names.includes(args.entry) ? args.entry : pickEntry(names);
      this.logOutput(`XenonCode VM: booting ${names.length} files (entry ${entry ?? '?'}) from ${dir}`);
      this.programDir = dir;
      this.runner = await XcRunner.open(files, [{ alias: 'main', channel: 0, w: 640, h: 480 }]);
      if (this.runner.error) throw new Error(`compile/boot error: ${this.runner.error}`);
      this.fileTable = this.runner.sourceFiles();
      this.st = XenonDebugSession.freshState();
      this.paused = true;                              // hold until configurationDone
      this.sendResponse(response);
      this.sendEvent(new InitializedEvent());
    } catch (e) {
      this.sendEvent(new TerminatedEvent());
      this.sendErrorResponse(response, 1001, String((e as Error).message ?? e));
    }
  }

  protected override configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse,
  ): void {
    this.sendResponse(response);
    this.paused = false;
    this.startPump();
  }

  private startPump(): void {
    this.stopPump();
    this.timer = setInterval(() => this.tick(), CYCLE_MS);
  }
  private stopPump(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // THE TRACKING GATE: pair recording runs ONLY while the debugger has
  // work (breaks armed / a step armed) — an idle run costs nothing.
  private syncDebugTrack(): void {
    this.runner?.debugTrack(this.breaks.size > 0 || this.st.stepMode !== 'off');
  }

  private tick(): void {
    const r = this.runner;
    if (!r || this.paused) return;
    const { evs, pausedAt } = r.cycle();
    this.cycles++;
    for (const e of evs) {
      if (e.e === 'print' && e.v !== undefined) this.sendEvent(new OutputEvent(String(e.v), 'stdout'));
      else if (e.e === 'out') this.sendEvent(new OutputEvent(`out ${e.io} = ${e.v}\n`, 'console'));
    }
    if (pausedAt) {
      const file = this.fileTable[pausedAt.idx] ?? `#${pausedAt.idx}`;
      this.pauseAt(file, pausedAt.line, pausedAt.idx >= 0 ? pausedAt.idx : 0, 'pause');
      return;
    }
    if (!r.running) {
      this.stopPump();
      this.sendEvent(new OutputEvent(`program error: ${r.error}\n`, 'stderr'));
      this.sendEvent(new TerminatedEvent());
      return;
    }
    const pairs = r.cyclePairs();
    const depths = r.cycleDepths();
    if (this.suppressBp) {
      const sp = this.suppressBp;
      const moved = !pairs.some(p =>
        (this.fileTable[Math.floor(p / 1_000_000)] ?? '') === sp.file
        && p % 1_000_000 === sp.line);
      if (moved) this.suppressBp = null;
    }
    const hit = stepperLaw(pairs, depths, this.fileTable, this.lawBreaks(), this.st);
    if (hit) {
      const idx = this.fileTable.indexOf(hit.file);
      // the law checks breaks FIRST — a stop ON an armed line is the
      // breakpoint, everything else the law returns is a completed step
      const reason = (this.breaks.get(hit.file)?.has(hit.line) ?? false)
        ? 'breakpoint' : 'step';
      this.st = { ...this.st, stepMode: hit.stepMode,
        pausedFile: hit.file, pausedLine: hit.line, pausedDepth: hit.depth };
      this.pauseAt(hit.file, hit.line, idx, reason);
    }
  }

  // STEPPING OFF A BREAKPOINT (the standard adapter semantics): F10/F11
  // from a breakpoint line suppresses THAT line's break for the cycles it
  // takes to leave it — a hot `tick` line must not re-fire on the very
  // next cycle the moment you step. Cleared once a pair moves off it.
  private suppressBp: { file: string; line: number } | null = null;

  private lawBreaks(): Map<string, Set<number>> {
    if (!this.suppressBp) return this.breaks;
    const m = new Map(this.breaks);
    const s = m.get(this.suppressBp.file);
    if (s) {
      const s2 = new Set(s);
      s2.delete(this.suppressBp.line);
      if (s2.size) m.set(this.suppressBp.file, s2);
      else m.delete(this.suppressBp.file);
    }
    return m;
  }

  private armStep(mode: StepperState['stepMode']): void {
    this.suppressBp = this.st.pausedFile
      ? { file: this.st.pausedFile, line: this.st.pausedLine } : null;
    this.st = { ...this.st, stepMode: mode };
    this.syncDebugTrack();
    this.paused = false;
  }

  private pausedIdx = 0;
  private pauseAt(file: string, line: number, idx: number, reason: 'breakpoint' | 'step' | 'pause'): void {
    this.paused = true;
    this.pausedIdx = idx;
    this.st = { ...this.st, pausedFile: file, pausedLine: line };
    this.sendEvent(new StoppedEvent(reason, XenonDebugSession.THREAD));
  }

  private static readonly THREAD = 1;

  protected override setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments,
  ): void {
    const file = path.basename(args.source.path ?? args.source.name ?? 'main.xc');
    const lines = new Set<number>((args.breakpoints ?? []).map(b => b.line));
    if (lines.size) this.breaks.set(file, lines);
    else this.breaks.delete(file);
    this.syncDebugTrack();
    response.body = { breakpoints: (args.breakpoints ?? []).map(b => ({ verified: true, line: b.line })) };
    this.sendResponse(response);
  }

  protected override threadsRequest(
    response: DebugProtocol.ThreadsResponse,
  ): void {
    response.body = { threads: [new Thread(XenonDebugSession.THREAD, 'XenonCode VM')] };
    this.sendResponse(response);
  }

  protected override continueRequest(
    response: DebugProtocol.ContinueResponse,
  ): void {
    this.st = { ...this.st, stepMode: 'off' };
    this.syncDebugTrack();
    this.paused = false;
    response.body = { allThreadsContinued: true };
    this.sendResponse(response);
  }

  protected override nextRequest(
    response: DebugProtocol.NextResponse,
  ): void {
    this.armStep('over');                            // F10
    this.sendResponse(response);
  }

  protected override stepInRequest(
    response: DebugProtocol.StepInResponse,
  ): void {
    this.armStep('into');                            // F11
    this.sendResponse(response);
  }

  protected override stepOutRequest(
    response: DebugProtocol.StepOutResponse,
  ): void {
    // v1: the pair stream carries depth, a true step-out (stop at depth-1
    // in MY frame) is a stepperLaw extension — emulate with F10 for now.
    this.armStep('over');
    this.sendResponse(response);
  }

  protected override pauseRequest(
    response: DebugProtocol.PauseResponse,
  ): void {
    // THE PARK LAW: pause AT the exact executing line (rc=2 → pausedAt)
    this.runner?.requestPause();
    this.sendResponse(response);
  }

  protected override stackTraceRequest(
    response: DebugProtocol.StackTraceResponse,
  ): void {
    const file = this.st.pausedFile || 'main.xc';
    response.body = {
      stackFrames: [{
        id: 1,
        name: `${file}:${this.st.pausedLine}`,
        source: new Source(file, path.join(this.programDir, file)),
        line: this.st.pausedLine, column: 1,
      }],
      totalFrames: 1,
    };
    this.sendResponse(response);
  }

  protected override scopesRequest(
    response: DebugProtocol.ScopesResponse,
  ): void {
    response.body = {
      scopes: [
        new Scope('Globals', GLOBALS_REF, false),
        new Scope('Locals (at the stop)', LOCALS_REF, false),
      ],
    };
    this.sendResponse(response);
  }

  protected override variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments,
  ): void {
    const mapType = (t: number): string =>
      t === 1 ? 'number' : t === 2 ? 'text' : t === 3 ? 'array' : t === 4 ? 'object' : t === 5 ? 'storage' : 'value';
    // THE SIGIL LAW: the VM names vars bare ('t'); Xenon writes them '$t'.
    const sigil = (n: string) => (n.startsWith('$') ? n : `$${n}`);
    const rows = args.variablesReference === GLOBALS_REF
      ? (this.runner?.vars() ?? []).map(v => ({ name: sigil(v.name), value: v.v, type: mapType(v.t), t: v.t }))
      : (this.runner?.locals(this.pausedIdx, this.st.pausedLine) ?? [])
          .map(v => ({ name: sigil(v.s ? `${v.name}#${v.s}` : v.name), value: v.v, type: mapType(v.t), t: v.t }));
    response.body = {
      variables: rows.map(r => ({ name: r.name, value: r.value, type: r.type, variablesReference: 0,
        preserveValue: r.t === 1 || r.t === 2 })),
    };
    (this as any).__varTypes = new Map(rows.map(r => [r.name, r.t]));
    this.sendResponse(response);
  }

  protected override setVariableRequest(
    response: DebugProtocol.SetVariableResponse,
    args: DebugProtocol.SetVariableArguments,
  ): void {
    // THE WRITEBACK LAW: numbers finite-decimal, text free; arrays/objects
    // refuse. Globals write at the paused frame (the VM's own validation).
    const globals = args.variablesReference === GLOBALS_REF;
    const name = args.name.replace(/^\$/, '').replace(/#\d+$/, '');
    const t = ((this as any).__varTypes as Map<string, number> | undefined)?.get(args.name);
    if (globals) {
      const v = this.runner?.vars().find(x => x.name === name);
      if (!v) { this.sendErrorResponse(response, 2001, `no global ${name}`); return; }
      const ack = this.runner!.writeVar(this.pausedIdx, this.st.pausedLine, name, v.t, args.value);
      if (!ack.ok) { this.sendErrorResponse(response, 2002, ack.error ?? 'refused'); return; }
      response.body = { value: args.value };
      this.sendResponse(response);
    } else {
      void t;
      this.sendErrorResponse(response, 2003, 'locals are read-only in v1');
    }
  }

  protected override terminateRequest(
    response: DebugProtocol.TerminateResponse,
  ): void {
    this.stopPump();
    this.runner = null;
    this.sendResponse(response);
    this.sendEvent(new TerminatedEvent());
  }

  private logOutput(text: string): void {
    this.sendEvent(new OutputEvent(text.endsWith('\n') ? text : `${text}\n`, 'console'));
  }
}

if (require.main === module) XenonDebugSession.run(XenonDebugSession);
