import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  assertTrivyPolicy,
  collectTiffEvidence,
} from "./verify-docker-vulnerabilities.mjs";

const sentinel = "sentinel-private-endpoint-secret";
const imageId = `sha256:${"a".repeat(64)}`;
const purl = (name: string): string =>
  `pkg:deb/debian/${name}@4.7.0-3%2Bdeb13u3?arch=arm64&distro=debian-13`;
function finding(
  id = "CVE-2026-52490",
  severity = "CRITICAL",
  pkg = purl("libtiff6"),
  fixed = "",
): {
  FixedVersion?: string;
  InstalledVersion: string;
  PkgIdentifier: { PURL: string };
  PkgName: string;
  Severity: string;
  VulnerabilityID: string;
} {
  return {
    VulnerabilityID: id,
    Severity: severity,
    PkgName: pkg.includes("libtiff6") ? "libtiff6" : "cjson",
    PkgIdentifier: { PURL: pkg },
    InstalledVersion: pkg.includes("libtiff6")
      ? "4.7.0-3+deb13u3"
      : "1.7.18-3.1+deb13u1",
    ...(fixed ? { FixedVersion: fixed } : {}),
  };
}
function options(): Parameters<typeof assertTrivyPolicy>[0] & {
  report: {
    SchemaVersion: number;
    ArtifactType: string;
    Metadata: { ImageID: string };
    Results: {
      Target: string;
      Class: string;
      Type: string;
      Vulnerabilities: ReturnType<typeof finding>[];
    }[];
  };
  exceptions: {
    schemaVersion: number;
    exceptions: {
      id: string;
      package: string;
      reason: string;
      expiresAt: string;
    }[];
  };
  sbom: {
    bomFormat: string;
    metadata: {
      component: {
        properties: { name: string; value: string }[];
      };
    };
    components: {
      purl?: string;
      name?: string;
      components?: { name: string }[];
    }[];
  };
  evidence: Awaited<ReturnType<typeof collectTiffEvidence>>;
} {
  return {
    now: Date.parse("2026-09-01T12:00:00Z"),
    imageId,
    report: {
      SchemaVersion: 2,
      ArtifactType: "container_image",
      Metadata: { ImageID: imageId },
      Results: [
        {
          Target: "studynarrator:verify (debian 13)",
          Class: "os-pkgs",
          Type: "debian",
          Vulnerabilities: [finding()],
        },
      ],
    },
    exceptions: { schemaVersion: 1, exceptions: [] },
    sbom: {
      bomFormat: "CycloneDX",
      metadata: {
        component: {
          properties: [{ name: "aquasecurity:trivy:ImageID", value: imageId }],
        },
      },
      components: [{ purl: purl("libtiff6") }],
    },
    evidence: {
      os: { id: "debian", version: "13", codename: "trixie" },
      tiffPackages: [
        {
          name: "libtiff6",
          source: "tiff",
          version: "4.7.0-3+deb13u3",
          architecture: "arm64",
        },
      ],
      tiffcropPresent: false,
      libraryMatchesPackage: true,
      librarySha256: "b".repeat(64),
    },
  };
}

describe("Docker vulnerability applicability policy", () => {
  it("records exact-image vulnerable-code absence without changing the raw critical finding", () => {
    const input = options();
    const original = JSON.stringify(input.report);
    const result = assertTrivyPolicy(input);
    expect(result.assessments).toEqual([
      expect.objectContaining({
        id: "CVE-2026-52490",
        status: "not_affected",
        justification: "vulnerable_code_not_present",
        imageId,
        expiresAt: "2026-10-01T00:00:00Z",
      }),
    ]);
    expect(JSON.stringify(input.report)).toBe(original);
  });

  it.each<[(input: ReturnType<typeof options>) => void]>([
    [
      (input) => {
        input.evidence.tiffcropPresent = true;
      },
    ],
    [
      (input) => {
        input.evidence.libraryMatchesPackage = false;
      },
    ],
    [
      (input) => {
        input.evidence.tiffPackages.push({
          name: "libtiff-tools",
          source: "tiff",
          version: "4.7.0-3+deb13u3",
          architecture: "arm64",
        });
      },
    ],
    [
      (input) => {
        input.evidence.tiffPackages[0]!.version = "4.7.2-1";
      },
    ],
    [
      (input) => {
        input.evidence.tiffPackages[0]!.architecture = "riscv64";
      },
    ],
    [
      (input) => {
        input.evidence.os.codename = "bookworm";
      },
    ],
    [
      (input) => {
        input.sbom.metadata.component.properties[0]!.value = `sha256:${"c".repeat(64)}`;
      },
    ],
    [
      (input) => {
        input.sbom.components = [];
      },
    ],
    [
      (input) => {
        input.sbom.components.push({ name: "libtiff-tools" });
      },
    ],
    [
      (input) => {
        input.sbom.components.push({
          components: [{ name: "/usr/bin/tiffcrop" }],
        });
      },
    ],
    [
      (input) => {
        input.now = Date.parse("2026-10-01T00:00:00Z");
      },
    ],
    [
      (input) => {
        input.now = Date.parse("2026-08-31T23:59:59Z");
      },
    ],
    [
      (input) => {
        input.report.Results[0]!.Vulnerabilities[0]!.PkgName = "tiff";
      },
    ],
    [
      (input) => {
        input.report.Results[0]!.Vulnerabilities[0]!.FixedVersion = "4.7.2-1";
      },
    ],
  ])("fails closed when reviewed scope or evidence changes (%#)", (mutate) => {
    const input = options();
    mutate(input);
    expect(() => assertTrivyPolicy(input)).toThrow(/DOCKER VERIFY:/u);
  });

  it("requires fresh runtime evidence and an image identity", () => {
    expect(() =>
      assertTrivyPolicy({ ...options(), evidence: undefined }),
    ).toThrow(/evidence/u);
    const withoutImage = options();
    delete withoutImage.imageId;
    expect(() => assertTrivyPolicy(withoutImage)).toThrow(/exact image/u);
  });

  it("does not exempt any other critical finding, even alongside an assessed one", () => {
    const input = options();
    input.report.Results[0]!.Vulnerabilities.push(finding("CVE-2026-99999"));
    expect(() => assertTrivyPolicy(input)).toThrow(/unassessed critical/u);
  });

  it.each([
    {},
    { SchemaVersion: 2, ArtifactType: "container_image", Results: [{}] },
    {
      SchemaVersion: 2,
      ArtifactType: "container_image",
      Results: [
        {
          Target: sentinel,
          Class: "os-pkgs",
          Type: "debian",
          Vulnerabilities: [{}],
        },
      ],
    },
  ])(
    "rejects malformed scan reports without exposing their content",
    (report) => {
      expect(() => assertTrivyPolicy({ ...options(), report })).toThrow(
        /DOCKER VERIFY:/u,
      );
      try {
        assertTrivyPolicy({ ...options(), report });
      } catch (error) {
        expect(String(error)).not.toContain(sentinel);
      }
    },
  );

  it("exports only reviewed fields and sanitizes failures", () => {
    const input = options();
    const result = assertTrivyPolicy({
      ...input,
      evidence: { ...input.evidence, privateEndpoint: sentinel },
    });
    expect(JSON.stringify(result)).not.toContain(sentinel);
    input.report.Results[0]!.Vulnerabilities = [
      finding("CVE-2026-99999", "CRITICAL", `pkg:${sentinel}`),
    ];
    expect(() => assertTrivyPolicy(input)).toThrow(
      "DOCKER VERIFY: unassessed critical vulnerability; see the raw Trivy report",
    );
  });

  it("preserves the narrow, expiring unfixed-high policy and stale-entry rejection", () => {
    const input = options();
    const id = "CVE-2026-67216";
    const pkg = "pkg:deb/debian/libcjson1@1.7.18-3.1%2Bdeb13u1";
    input.report.Results[0]!.Vulnerabilities = [finding(id, "HIGH", pkg)];
    expect(() => assertTrivyPolicy(input)).toThrow(
      /narrow documented exception/u,
    );
    input.exceptions.exceptions = [
      {
        id,
        package: "pkg:deb/debian/libcjson1@",
        reason:
          "Reviewed FFmpeg dependency with a documented, specific risk rationale. ".repeat(
            2,
          ),
        expiresAt: "2026-11-13",
      },
    ];
    expect(assertTrivyPolicy(input).assessments).toEqual([]);
    input.report.Results[0]!.Vulnerabilities = [
      finding(id, "HIGH", pkg, "1.8.0"),
    ];
    expect(() => assertTrivyPolicy(input)).toThrow(/has a fix/u);
    input.report.Results[0]!.Vulnerabilities = [finding(id, "HIGH", pkg)];
    expect(() =>
      assertTrivyPolicy({ ...input, now: Date.parse("2026-11-13") }),
    ).toThrow(/expired/u);
    input.report.Results[0]!.Vulnerabilities = [];
    expect(() => assertTrivyPolicy(input)).toThrow(/stale/u);
  });

  it("needs no TIFF assessment if the scanner no longer reports this CVE", () => {
    const input = options();
    input.report.Results[0]!.Vulnerabilities = [];
    expect(
      assertTrivyPolicy({
        ...input,
        evidence: undefined,
        now: Date.parse("2027-01-01"),
      }).assessments,
    ).toEqual([]);
  });
});

describe("TIFF image filesystem inspection", () => {
  let root: string;
  const put = (path: string, content: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "studynarrator-tiff-evidence-"));
    put(
      "etc/os-release",
      'ID=debian\nVERSION_ID="13"\nVERSION_CODENAME=trixie\n',
    );
    put(
      "var/lib/dpkg/status",
      "Package: libtiff6\nStatus: install ok installed\nSource: tiff\nVersion: 4.7.0-3+deb13u3\nArchitecture: arm64\n\n",
    );
    put("usr/lib/aarch64-linux-gnu/libtiff.so.6.1.0", "fixture library");
    put(
      "var/lib/dpkg/info/libtiff6:arm64.md5sums",
      `${createHash("md5").update("fixture library").digest("hex")}  usr/lib/aarch64-linux-gnu/libtiff.so.6.1.0\n`,
    );
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("checks actual packages, filesystem and library bytes in a standalone Node process", async () => {
    const evidence = await collectTiffEvidence(root);
    expect(evidence).toEqual({
      ...options().evidence,
      librarySha256: createHash("sha256")
        .update("fixture library")
        .digest("hex"),
    });
    // Load the native module before serializing, just as verify-docker.mjs does;
    // Vitest rewrites dynamic imports in its own module runtime.
    const source = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { collectTiffEvidence } from ${JSON.stringify(new URL("./verify-docker-vulnerabilities.mjs", import.meta.url).href)}; process.stdout.write(collectTiffEvidence.toString())`,
      ],
      { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } },
    );
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `process.stdout.write(JSON.stringify(await (${source})(${JSON.stringify(root)})))`,
      ],
      { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } },
    );
    expect(JSON.parse(output)).toEqual(evidence);
  });

  it("finds unowned copies outside PATH and detects package-file tampering", async () => {
    put("opt/private/TiffCrop.copy", sentinel);
    put("usr/lib/aarch64-linux-gnu/libtiff.so.6.1.0", "modified library");
    const evidence = await collectTiffEvidence(root);
    expect(evidence.tiffcropPresent).toBe(true);
    expect(evidence.libraryMatchesPackage).toBe(false);
    expect(JSON.stringify(evidence)).not.toContain(sentinel);
  });

  it("detects tool symlinks without traversing cycles or runtime mounts", async () => {
    symlinkSync(".", join(root, "cycle"));
    symlinkSync("/usr/bin/tiffcrop", join(root, "renamed-tool"));
    expect((await collectTiffEvidence(root)).tiffcropPresent).toBe(true);
  });

  it("ignores only the ephemeral mount roots", async () => {
    put("proc/tiffcrop", "ephemeral");
    put("sys/tiffcrop", "ephemeral");
    put("dev/tiffcrop", "ephemeral");
    put("data/tiffcrop", "ephemeral");
    expect((await collectTiffEvidence(root)).tiffcropPresent).toBe(false);
    put("app/data/tiffcrop", "image contents");
    expect((await collectTiffEvidence(root)).tiffcropPresent).toBe(true);
  });

  it("fails closed without leaking paths when inventory is missing", async () => {
    await expect(collectTiffEvidence(join(root, sentinel))).rejects.toThrow(
      "DOCKER VERIFY: TIFF image evidence could not be collected",
    );
  });
});
