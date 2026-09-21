import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHelperLaunchAgentPlist,
  buildUiLaunchAgentPlist,
  HELPER_LAUNCH_AGENT_LABEL,
  UI_LAUNCH_AGENT_LABEL,
} from "../helper-launch-agent.mjs";

test("user LaunchAgent is Aqua-bound, single-instance and contains no credentials", () => {
  const plist = buildHelperLaunchAgentPlist({
    homeDirectory: "/Users/example",
    projectRoot: "/Users/example/Fabian & Pascal/Inseratestudio",
    nodePath: "/Users/example/.local/bin/node",
  });
  assert.match(plist, new RegExp(HELPER_LAUNCH_AGENT_LABEL, "u"));
  assert.match(plist, /<key>LimitLoadToSessionType<\/key>\s*<string>Aqua<\/string>/u);
  assert.match(plist, /<key>ProcessType<\/key>\s*<string>Interactive<\/string>/u);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/u);
  assert.match(plist, /local-helper-launcher\.mjs/u);
  assert.match(plist, /Fabian &amp; Pascal/u);
  assert.match(
    plist,
    /<key>WorkingDirectory<\/key>\s*<string>\/Users\/example\/Library\/Application Support\/Fabian-Pascal Inseratestudio\/helper-runtime-context<\/string>/u,
  );
  assert.doesNotMatch(
    plist,
    /<key>WorkingDirectory<\/key>\s*<string>\/Users\/example\/Fabian &amp; Pascal\/Inseratestudio<\/string>/u,
  );
  assert.doesNotMatch(plist, /FPI_SESSION_TOKEN|password|passwort|credential|ftp|secret/iu);
});

test("the UI LaunchAgent uses the same release root and never contains credentials", () => {
  const plist = buildUiLaunchAgentPlist({
    homeDirectory: "/Users/example",
    projectRoot: "/Users/example/Fabian & Pascal/Inseratestudio",
    nodePath: "/Users/example/.local/bin/node",
  });
  assert.match(plist, new RegExp(UI_LAUNCH_AGENT_LABEL, "u"));
  assert.match(plist, /production-server\.mjs/u);
  assert.match(plist, /Fabian &amp; Pascal/u);
  assert.doesNotMatch(plist, /FPI_SESSION_TOKEN|password|passwort|credential|ftp|secret/iu);
});
