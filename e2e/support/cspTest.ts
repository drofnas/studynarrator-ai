import { test as base, expect } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (/content[- ]security[- ]policy/iu.test(message.text())) {
        violations.push(message.text());
      }
    });
    await use(page);
    expect(violations, "Unexpected browser CSP violations").toEqual([]);
  },
});
