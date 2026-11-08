/**
 * Refuses to start a dev server on a port something is already listening on.
 *
 *   node scripts/check-port.mjs 8787
 *
 * Why: on Windows, a second server can bind a port that an old one still holds and print "Ready", while the OLD
 * server keeps answering requests with its OLD code and settings. The symptom is baffling ("I added the Google
 * credentials but it still says not configured"). Failing loudly here costs nothing.
 */
import net from "node:net";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("Usage: node scripts/check-port.mjs <port>");
  process.exit(2);
}

const socket = net.connect({ port, host: "127.0.0.1" });
const done = (inUse) => {
  socket.destroy();
  if (inUse) {
    console.error(
      [
        `Port ${port} is already in use, so this server would not be the one answering requests.`,
        "An old dev server is probably still running (stopping a terminal does not always stop its worker).",
        "",
        "Find it (PowerShell):  Get-NetTCPConnection -LocalPort " + port + " -State Listen | Select-Object OwningProcess",
        "Then stop that process (Stop-Process -Id <id>) and run this again.",
      ].join("\n"),
    );
    process.exit(1);
  }
  process.exit(0);
};
socket.setTimeout(800, () => done(false));
socket.once("connect", () => done(true));
socket.once("error", () => done(false)); // refused = nothing is listening = free
