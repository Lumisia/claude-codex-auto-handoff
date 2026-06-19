import { execFile } from 'node:child_process';

export function notifyCommand(platform, title, body) {
  if (platform === 'darwin') {
    return { cmd: 'osascript', args: ['-e', `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`] };
  }
  if (platform === 'win32') {
    const script = `[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');` +
      `$n=New-Object System.Windows.Forms.NotifyIcon;$n.Icon=[System.Drawing.SystemIcons]::Information;` +
      `$n.Visible=$true;$n.ShowBalloonTip(5000, ${JSON.stringify(title)}, ${JSON.stringify(body)}, 'Info')`;
    return { cmd: 'powershell', args: ['-NoProfile', '-Command', script] };
  }
  return { cmd: 'notify-send', args: [title, body] };
}

export function notify(title, body) {
  try {
    const { cmd, args } = notifyCommand(process.platform, title, body);
    execFile(cmd, args, () => {});
    return true;
  } catch {
    return false;
  }
}

// Route a notification according to the user's `notification` config.
//   method "os"       → OS notification (falls back to terminal on failure)
//   method "terminal" → write to the terminal (stderr)
//   method "off"      → deliver nothing
export function sendNotification(
  title, body, { method = 'os', fallback = 'terminal' } = {}, deps = {},
) {
  const osNotify = deps.osNotify || notify;
  const toTerminal = deps.toTerminal || ((t, b) => process.stderr.write(`[handoff] ${t}: ${b}\n`));
  if (method === 'off') return false;
  if (method === 'terminal') { toTerminal(title, body); return true; }
  if (osNotify(title, body)) return true;
  if (fallback === 'terminal') { toTerminal(title, body); return true; }
  return false;
}
