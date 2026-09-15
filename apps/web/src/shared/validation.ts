import { config } from "zod/v4/core";

// Load before schemas in each browser/worker realm so CSP never sees an eval probe.
config({ jitless: true });
