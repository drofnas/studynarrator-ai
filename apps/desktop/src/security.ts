export const SECURE_WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true
});

export function isApprovedExternalUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "https:" && (url.hostname === "speaches.ai" || url.hostname === "www.speaches.ai");
  } catch {
    return false;
  }
}
