function safeError(error) {
  return {
    errorCode: String(error?.code || "MAIL_IMPORT_REPORT_ACCESS_FAILED").slice(0, 100),
    message: (error instanceof Error ? error.message : String(error || "Apple Mail konnte nicht abgefragt werden.")).slice(0, 500),
    timedOut: error?.timedOut === true,
    exitSignal: String(error?.exitSignal || "").slice(0, 30),
  };
}

export async function runMailRuntimeProbe(options) {
  if (!options?.mailAdapter?.inspectSetup || !options?.mailAdapter?.findCandidates || options.mailAdapter.readOnly !== true) {
    throw new Error("Der Mail-Runtime-Probe fehlt ein explizit read-only Apple-Mail-Adapter.");
  }
  const clock = options.clock || (() => Date.now());
  const now = options.now || (() => new Date().toISOString());
  const startedAt = now();
  const startedMs = clock();
  let stage = "inspect-setup";
  try {
    const setupStartedMs = clock();
    const setup = await options.mailAdapter.inspectSetup();
    const setupDurationMs = Math.max(0, clock() - setupStartedMs);
    stage = "find-candidates";
    const scanStartedMs = clock();
    const candidates = await options.mailAdapter.findCandidates({ lookbackHours: options.lookbackHours || 720 });
    const scanDurationMs = Math.max(0, clock() - scanStartedMs);
    return {
      ok: true,
      startedAt,
      endedAt: now(),
      durationMs: Math.max(0, clock() - startedMs),
      setupDurationMs,
      scanDurationMs,
      helperProcessId: process.pid,
      helperParentProcessId: process.ppid,
      accountName: setup.accountName,
      mailboxName: setup.mailboxName,
      mailboxClass: setup.mailboxClass,
      candidateCount: candidates.length,
      readOnly: true,
      mailMutations: 0,
    };
  } catch (error) {
    return {
      ok: false,
      startedAt,
      endedAt: now(),
      durationMs: Math.max(0, clock() - startedMs),
      helperProcessId: process.pid,
      helperParentProcessId: process.ppid,
      stage,
      ...safeError(error),
      readOnly: true,
      mailMutations: 0,
    };
  }
}
