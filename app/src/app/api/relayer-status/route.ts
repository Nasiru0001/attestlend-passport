import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * The worker updates state.json as it completes source block windows. For the
 * local hackathon deployment, a recent modification time is a lightweight
 * heartbeat that does not require adding an HTTP server to the worker.
 */
export async function GET() {
  const statePath = resolve(process.cwd(), "../worker/state.json");

  try {
    const [metadata, contents] = await Promise.all([stat(statePath), readFile(statePath, "utf8")]);
    const state = JSON.parse(contents) as { lastScannedBlock?: number };
    const ageMs = Date.now() - metadata.mtimeMs;

    return NextResponse.json({
      watching: ageMs < 90_000,
      lastScannedBlock: state.lastScannedBlock ?? null,
      lastHeartbeat: metadata.mtime.toISOString(),
    });
  } catch {
    return NextResponse.json({ watching: false, lastScannedBlock: null, lastHeartbeat: null });
  }
}
