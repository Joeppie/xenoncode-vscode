// dap.test.ts — THE DEBUGGER SMOKE (T5): spawn the BUILT adapter as a real
// process, speak real DAP over stdio, debug a real program on the shipped
// wasm: breakpoint → StoppedEvent(breakpoint) → F10 → StoppedEvent(step) →
// globals carry $t. The adapter, the runner, the wasm and the stepper law
// are all the shipped artifacts — this is the feature, not a mock.
import { describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ADAPTER = join(dirname(fileURLToPath(import.meta.url)), '../dist/debugAdapter.js');

const PROG = [
  'var $t = 0',                    // 1
  '',                              // 2
  'init',                          // 3
  '\tprint("dap-smoke")',          // 4
  '',                              // 5
  'tick',                          // 6
  '\t$t = $t + 1',                 // 7  ← breakpoint
  '\tprint("tick")',               // 8  ← the F10 stop
  '',                              // 9
].join('\n');

interface DapMsg { seq: number; type: string; command?: string; event?: string;
  body?: any; request_seq?: number; success?: boolean }

class DapClient {
  private buf = Buffer.alloc(0);
  private seq = 0;
  readonly events: DapMsg[] = [];
  private waiters: ((e: DapMsg) => void)[] = [];
  private pending = new Map<number, (m: DapMsg) => void>();
  constructor(private p: ChildProcessWithoutNullStreams) {
    p.stdout.on('data', (c: Buffer) => {                        // ONE consumer
      this.buf = Buffer.concat([this.buf, c]);
      for (;;) {
        const h = this.buf.indexOf('\r\n\r\n');
        if (h < 0) return;
        const len = Number(/Content-Length: *(\d+)/i.exec(this.buf.subarray(0, h).toString())?.[1] ?? -1);
        if (this.buf.length < h + 4 + len) return;
        const m = JSON.parse(this.buf.subarray(h + 4, h + 4 + len).toString()) as DapMsg;
        this.buf = this.buf.subarray(h + 4 + len);
        if (m.type === 'event') {
          this.events.push(m);
          for (let i = this.waiters.length - 1; i >= 0; i--)
            if (this.waiters[i]!(m)) this.waiters.splice(i, 1);   // stay until MATCHED
        } else if (m.type === 'response' && m.request_seq !== undefined) {
          const res = this.pending.get(m.request_seq);
          if (res) { this.pending.delete(m.request_seq); res(m); }
        }
      }
    });
  }
  send(command: string, args: Record<string, unknown> = {}): Promise<DapMsg> {
    const seq = ++this.seq;
    return new Promise((res, rej) => {
      this.pending.set(seq, res);
      this.p.once('exit', (c: number | null) => rej(new Error(`adapter exited (${c}) during ${command}`)));
      const body = JSON.stringify({ seq, type: 'request', command, arguments: args });
      this.p.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    });
  }
  async waitForEvent(event: string, ms = 8000): Promise<DapMsg> {
    const hit = this.events.find(e => e.event === event);
    if (hit) return hit;
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`no ${event}; saw ${this.events.map(e => e.event).join(',')}`)), ms);
      const check = (m: DapMsg): boolean => {
        if (m.event !== event) return false;
        clearTimeout(t); res(m); return true;
      };
      this.waiters.push(check);
    });
  }
}

describe('the DAP adapter (real process, real wasm, real DAP)', () => {
  it('breakpoint → stop → F10 → step-stop → globals', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xcrun-dap-'));
    const child = spawn(process.execPath, [ADAPTER], { stdio: ['pipe', 'pipe', 'pipe'] });
    const c = new DapClient(child);
    try {
      writeFileSync(join(dir, 'main.xc'), PROG);
      const init = await c.send('initialize', { adapterID: 'xenoncode', clientID: 'test',
        pathFormat: 'path', linesStartAt1: true, columnsStartAt1: true });
      expect(init.success).toBe(true);
      const launch = await c.send('launch', { program: dir, noDebug: false });
      expect(launch.success).toBe(true);
      await c.waitForEvent('initialized', 15_000);           // wasm boot + compile
      const bp = await c.send('setBreakpoints', {
        source: { name: 'main.xc', path: join(dir, 'main.xc') },
        breakpoints: [{ line: 7 }],
      });
      expect(bp.body.breakpoints[0].verified).toBe(true);
      await c.send('configurationDone', {});
      const stop1 = await c.waitForEvent('stopped', 15_000);
      expect(stop1.body.reason).toBe('breakpoint');
      expect(stop1.body.line ?? 7).toBe(7);
      const st = await c.send('stackTrace', { threadId: 1 });
      expect(st.body.stackFrames[0].line).toBe(7);
      const nx = await c.send('next', { threadId: 1 });
      expect(nx.success).toBe(true);
      c.events.length = 0;                                    // next stop only
      const stop2 = await c.waitForEvent('stopped', 15_000);
      expect(stop2.body.reason).toBe('step');
      const st2 = await c.send('stackTrace', { threadId: 1 });
      expect(st2.body.stackFrames[0].line).toBe(8);
      await c.send('scopes', { frameId: 1 });
      const vars = await c.send('variables', { variablesReference: 1 });
      const names: string[] = vars.body.variables.map((v: { name: string }) => v.name);
      expect(names).toContain('$t');
      const dc = await c.send('disconnect', { terminateDebuggee: true });
      expect(dc.success).toBe(true);            // disconnect closes the session
    } finally {
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
