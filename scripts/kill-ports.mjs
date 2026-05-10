#!/usr/bin/env node
// Frees the ports MoneyControl uses (3000 = web, 3001 = server) by killing
// whatever process is currently bound to them. Cross-platform: PowerShell on
// Windows, `lsof + kill` on macOS / Linux.
//
// Usage:
//   npm run kill-ports                 # frees 3000 + 3001
//   npm run kill-ports -- 4000 4001    # frees specific ports

import { spawnSync } from "node:child_process";
import process from "node:process";

const DEFAULT_PORTS = [3000, 3001];
const args = process.argv.slice(2);
const ports = args.length
  ? args.map(Number).filter((n) => Number.isFinite(n) && n > 0 && n < 65536)
  : DEFAULT_PORTS;

if (ports.length === 0) {
  console.error("usage: node scripts/kill-ports.mjs [port ...]");
  process.exit(1);
}

console.log(`Freeing port(s): ${ports.join(", ")}`);

let exitCode = 0;
if (process.platform === "win32") {
  // Inline PowerShell — passed as a single -Command argument so we don't
  // need to deal with cmd-shell quoting. Renames the loop variable from
  // $pid (a PowerShell automatic) to $procId to avoid shadowing.
  const ps = `
$ports = @(${ports.join(",")})
$conns = Get-NetTCPConnection -LocalPort $ports -ErrorAction SilentlyContinue
if ($conns) {
  $procIds = $conns | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 }
  foreach ($procId in $procIds) {
    try {
      $proc = Get-Process -Id $procId -ErrorAction Stop
      Stop-Process -Id $procId -Force -ErrorAction Stop
      Write-Output ("  killed pid {0} ({1})" -f $procId, $proc.ProcessName)
    } catch {
      Write-Output ("  could not kill pid {0}: {1}" -f $procId, $_.Exception.Message)
    }
  }
} else {
  Write-Output "  no processes on those ports"
}
`.trim();
  const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
  exitCode = r.status ?? 0;
} else {
  // POSIX. `lsof -ti` prints just PIDs. xargs handles the empty-list case
  // poorly across BSD/GNU, so we loop manually.
  const sh = `pids=$(lsof -ti:${ports.join(",")} 2>/dev/null); if [ -n "$pids" ]; then for pid in $pids; do if kill -9 "$pid" 2>/dev/null; then echo "  killed pid $pid"; else echo "  could not kill pid $pid"; fi; done; else echo "  no processes on those ports"; fi`;
  const r = spawnSync("sh", ["-c", sh], { stdio: "inherit" });
  exitCode = r.status ?? 0;
}

console.log("Done.");
process.exit(exitCode);
