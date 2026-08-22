import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { BoundaryErrorSchema } from "@studynarrator/shared-types";
import {
  DEFAULT_HOST_ALLOWLIST,
  createHostAllowlistMiddleware,
} from "./hostAllowlist.js";
import { resolveServerHostAllowlist } from "./runtimeConfig.js";

const staticDirectories: string[] = [];

afterEach(() => {
  for (const directory of staticDirectories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

function createTestApplication(allowedHosts: readonly string[]) {
  const app = express();
  app.use(createHostAllowlistMiddleware(allowedHosts));
  app.get("/api/health", (_request, response) => {
    response.json({ ready: true });
  });
  return app;
}

async function requestWithRawHttp(
  app: ReturnType<typeof express>,
  rawRequest: string,
) {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Expected the test server to listen on TCP.");
    return await new Promise<{ body: string; status: number }>(
      (resolve, reject) => {
        const socket = createConnection({
          host: "127.0.0.1",
          port: address.port,
        });
        let response = "";
        socket.setEncoding("utf8");
        socket.once("connect", () => {
          socket.write(rawRequest);
        });
        socket.on("data", (chunk: string) => {
          response += chunk;
        });
        socket.once("error", reject);
        socket.once("close", () => {
          const [head = "", body = ""] = response.split("\r\n\r\n");
          const status = /^HTTP\/1\.1 (\d{3})/u.exec(head)?.[1];
          resolve({ body, status: status === undefined ? 0 : Number(status) });
        });
      },
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

async function requestWithoutHost(app: ReturnType<typeof express>) {
  return requestWithRawHttp(app, "GET /api/health HTTP/1.0\r\n\r\n");
}

describe("host allowlist middleware", () => {
  it("rejects an unexpected API Host with a boundary error body", async () => {
    const app = createTestApplication(DEFAULT_HOST_ALLOWLIST);

    const response = await request(app)
      .get("/api/health")
      .set("Host", "evil.example.com")
      .expect(403);

    expect(BoundaryErrorSchema.parse(response.body)).toEqual({
      error: {
        code: "HOST_NOT_ALLOWED",
        message: "The request host is not allowed.",
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("evil.example.com");
  });

  it("allows loopback and configured hosts with or without a port", async () => {
    const app = createTestApplication(
      resolveServerHostAllowlist({
        STUDYNARRATOR_ALLOWED_HOSTS: "additional.example.test, [fd00::1]",
        STUDYNARRATOR_LISTEN_HOST: "configured.example.test",
      }),
    );

    for (const host of [
      "localhost",
      "localhost:4310",
      "127.0.0.1",
      "127.0.0.1:4310",
      "[::1]",
      "[::1]:4310",
      "configured.example.test",
      "configured.example.test:4310",
      "additional.example.test",
      "additional.example.test:4310",
      "[fd00::1]",
      "[fd00::1]:4310",
    ]) {
      await request(app)
        .get("/api/health")
        .set("Host", host)
        .expect(200, { ready: true });
    }
  });

  it("protects static assets as well as API routes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "studynarrator-host-"));
    staticDirectories.push(directory);
    writeFileSync(
      join(directory, "application.js"),
      "export const ready = true;",
    );
    const app = createTestApplication(DEFAULT_HOST_ALLOWLIST);
    app.use(express.static(directory));

    await request(app)
      .get("/application.js")
      .set("Host", "evil.example.com")
      .expect(403);
    await request(app)
      .get("/application.js")
      .set("Host", "127.0.0.1:4310")
      .expect(200, "export const ready = true;");
  });

  it.each(["", "localhost:0", "localhost:invalid", "::1", "[::1]:0"])(
    "rejects malformed Host header %j",
    async (host) => {
      const app = createTestApplication(DEFAULT_HOST_ALLOWLIST);
      const response = await request(app)
        .get("/api/health")
        .set("Host", host)
        .expect(403);

      expect(() => BoundaryErrorSchema.parse(response.body)).not.toThrow();
    },
  );

  it("rejects a missing Host header", async () => {
    const app = createTestApplication(DEFAULT_HOST_ALLOWLIST);

    const response = await requestWithoutHost(app);

    expect(response.status).toBe(403);
    expect(() =>
      BoundaryErrorSchema.parse(JSON.parse(response.body)),
    ).not.toThrow();
  });

  it("rejects duplicate Host headers even if the first is allowed", async () => {
    const app = createTestApplication(DEFAULT_HOST_ALLOWLIST);

    const response = await requestWithRawHttp(
      app,
      [
        "GET /api/health HTTP/1.1",
        "Host: 127.0.0.1",
        "Host: evil.example.com",
        "Connection: close",
        "",
        "",
      ].join("\r\n"),
    );

    expect(response.status).toBe(403);
    expect(BoundaryErrorSchema.parse(JSON.parse(response.body))).toEqual({
      error: {
        code: "HOST_NOT_ALLOWED",
        message: "The request host is not allowed.",
      },
    });
    expect(response.body).not.toContain("evil.example.com");
  });

  it("validates configured additional hosts", () => {
    expect(
      resolveServerHostAllowlist({
        STUDYNARRATOR_ALLOWED_HOSTS: "additional.example.test:4310, [fd00::2]",
        STUDYNARRATOR_LISTEN_HOST: "configured.example.test",
      }),
    ).toEqual([
      "localhost",
      "127.0.0.1",
      "::1",
      "configured.example.test",
      "additional.example.test",
      "fd00::2",
    ]);
    expect(() =>
      resolveServerHostAllowlist({
        STUDYNARRATOR_ALLOWED_HOSTS: "additional.example.test, invalid host",
      }),
    ).toThrow("STUDYNARRATOR_ALLOWED_HOSTS");
  });
});
