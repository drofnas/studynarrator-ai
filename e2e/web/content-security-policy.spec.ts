import { expect, test } from "../support/studyNarratorTest.js";

test("blocks injected code, style attributes, remote requests, plugins, and framing", async ({
  context,
  studyNarrator,
}) => {
  // Deliberate violations use separate pages; normal acceptance pages retain
  // the fixture's zero-violation assertion.
  const probe = await context.newPage();
  await probe.goto(studyNarrator.baseUrl);
  await expect(
    probe.getByRole("heading", { name: "Connect the voice workshop" }),
  ).toBeVisible();
  const before = studyNarrator.fakeSpeaches.getState().requests;
  const violations = await probe.evaluate(async (remoteUrl) => {
    const blocked = new Set<string>();
    const complete = new Promise<string[]>((resolve) => {
      document.addEventListener("securitypolicyviolation", (event) => {
        blocked.add(event.effectiveDirective);
        if (blocked.size === 4) resolve([...blocked].sort());
      });
    });
    const script = document.createElement("script");
    script.textContent = "document.title = 'csp-sentinel-script-executed'";
    document.body.append(script);
    const styled = document.createElement("span");
    styled.setAttribute("style", "color: red");
    document.body.append(styled);
    const object = document.createElement("object");
    object.data = remoteUrl;
    object.type = "text/html";
    document.body.append(object);
    await fetch(remoteUrl).catch(() => undefined);
    return complete;
  }, `${studyNarrator.fakeSpeaches.baseUrl}/v1/models?secret=csp-sentinel`);
  expect(violations).toEqual([
    "connect-src",
    "object-src",
    "script-src-elem",
    "style-src-attr",
  ]);
  await expect(probe).toHaveTitle("StudyNarrator AI");
  expect(studyNarrator.fakeSpeaches.getState().requests).toEqual(before);

  const frameHost = await context.newPage();
  const frameBlocked = frameHost.waitForEvent("console", {
    predicate: (message) => message.text().includes("frame-ancestors"),
  });
  await frameHost.setContent(
    `<iframe src="${studyNarrator.baseUrl}"></iframe>`,
  );
  await frameBlocked;
  await expect(
    frameHost.frameLocator("iframe").getByRole("heading"),
  ).toHaveCount(0);
});
