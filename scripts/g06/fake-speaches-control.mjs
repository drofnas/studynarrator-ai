const controlRoot = process.env.STUDYNARRATOR_FAKE_SPEACHES_URL ?? "http://127.0.0.1:18080";
const [command, value] = process.argv.slice(2);

async function request(path, options) {
  try {
    const response = await fetch(`${controlRoot}${path}`, options);
    const payload = await response.json();
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `Control request failed with ${response.status}.`);
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown fake Speaches control failure.";
    process.stderr.write(`Fake Speaches control failed: ${message}\n`);
    process.exitCode = 1;
  }
}

switch (command) {
  case "inspect":
    await request("/__control/state", { method: "GET" });
    break;
  case "reset":
    await request("/__control/reset", { method: "DELETE" });
    break;
  case "scenario":
    if (!value) {
      process.stderr.write("Usage: npm run fake:speaches:scenario -- <scenario>\n");
      process.exitCode = 2;
      break;
    }
    await request("/__control/scenario", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: value })
    });
    break;
  default:
    process.stderr.write("Use inspect, reset, or scenario <name>.\n");
    process.exitCode = 2;
}
