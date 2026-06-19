import { spawn } from 'node:child_process';
import { INIT_REQUEST, reduce } from './appserver-protocol.mjs';

// codex app-server --stdio 를 spawn 해 handshake 후 5h 한도를 읽는다.
// 실패·타임아웃이면 null. (milestone 1 spike에서 실측 검증된 흐름.)
export async function readAppServerRateLimit({ timeoutMs = 15000, command = 'codex' } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, ['app-server', '--stdio'], { shell: true });
    } catch {
      resolve(null);
      return;
    }

    let buf = '';
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch {}
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const send = (o) => { try { child.stdin.write(JSON.stringify(o) + '\n'); } catch {} };

    child.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        const out = reduce(msg);
        if (out.send) out.send.forEach(send);
        if (out.result !== undefined) finish(out.result);
        if (out.error !== undefined) finish(null);
      }
    });
    child.on('error', () => finish(null));
    child.on('exit', () => finish(null));

    send(INIT_REQUEST);
  });
}
