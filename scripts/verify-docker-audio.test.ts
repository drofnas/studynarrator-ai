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
import { collectAudioEvidence } from "./verify-docker-audio.mjs";
import { assertTrivyPolicy } from "./verify-docker-vulnerabilities.mjs";

const sourceSha256 =
  "9ed2ed34cbe7f056eeebbe9045c5e2d15e41b5b053fe7c8ba6979a0b6fb081ce";
const imageId = `sha256:${"a".repeat(64)}`;
const purl =
  "pkg:deb/debian/ffmpeg@7.1.5-0%2Bdeb13u1?arch=arm64&distro=debian-13.7&epoch=7";
const sentinel = "sentinel-private-endpoint-secret";

function options() {
  const audioEvidence: Awaited<ReturnType<typeof collectAudioEvidence>> = {
    package: "ffmpeg",
    version: "7:7.1.5-0+deb13u1",
    architecture: "arm64",
    sourceVersion: "7:7.1.5-0+deb13u1",
    sourceSha256,
    configurationSha256: "b".repeat(64),
    configuration: { CFHD_DECODER: 0, NETWORK: 0, LIBXML2: 0 },
    objects: ["libavformat/wavdec.o"],
    binaries: {
      "usr/bin/ffmpeg": "c".repeat(64),
      "usr/bin/ffprobe": "d".repeat(64),
    },
  };
  return {
    imageId,
    now: Date.parse("2026-09-14T12:00:00Z"),
    audioEvidence,
    exceptions: { schemaVersion: 1, exceptions: [] },
    report: {
      SchemaVersion: 2,
      ArtifactType: "container_image",
      Metadata: { ImageID: imageId },
      Results: [
        {
          Target: "image (debian 13)",
          Class: "os-pkgs",
          Type: "debian",
          Vulnerabilities: [
            {
              VulnerabilityID: "CVE-2026-70632",
              PkgName: "ffmpeg",
              InstalledVersion: "7:7.1.5-0+deb13u1",
              PkgIdentifier: { PURL: purl },
              Severity: "HIGH",
              FixedVersion: "",
            },
          ],
        },
      ],
    },
    sbom: {
      bomFormat: "CycloneDX",
      metadata: {
        component: {
          properties: [{ name: "aquasecurity:trivy:ImageID", value: imageId }],
        },
      },
      components: [{ purl }],
    },
  };
}

describe("restricted FFmpeg image assessment", () => {
  it("retains the raw finding and records the excluded decoder for the exact image", () => {
    const input = options();
    const raw = JSON.stringify(input.report);
    expect(assertTrivyPolicy(input).assessments).toEqual([
      expect.objectContaining({
        id: "CVE-2026-70632",
        imageId,
        justification: "vulnerable_code_not_present",
        absentObject: "libavcodec/cfhd.o",
        expiresAt: "2026-10-14T00:00:00Z",
      }),
    ]);
    expect(JSON.stringify(input.report)).toBe(raw);
  });

  it.each<[string, (input: ReturnType<typeof options>) => void]>([
    [
      "enabled decoder",
      (input) => {
        input.audioEvidence.configuration.CFHD_DECODER = 1;
      },
    ],
    [
      "missing decoder configuration",
      (input) => {
        delete input.audioEvidence.configuration.CFHD_DECODER;
      },
    ],
    [
      "compiled vulnerable object",
      (input) => {
        input.audioEvidence.objects.push("libavcodec/cfhd.o");
      },
    ],
    [
      "network support",
      (input) => {
        input.audioEvidence.configuration.NETWORK = 1;
      },
    ],
    [
      "XML support",
      (input) => {
        input.audioEvidence.configuration.LIBXML2 = 1;
      },
    ],
    [
      "source tampering",
      (input) => {
        input.audioEvidence.sourceSha256 = "e".repeat(64);
      },
    ],
    [
      "missing executable",
      (input) => {
        delete input.audioEvidence.binaries["usr/bin/ffprobe"];
      },
    ],
    [
      "changed package",
      (input) => {
        input.audioEvidence.version = "7:8.1.2-1";
      },
    ],
    [
      "changed architecture",
      (input) => {
        input.audioEvidence.architecture = "riscv64";
      },
    ],
    [
      "expired assessment",
      (input) => {
        input.now = Date.parse("2026-10-14");
      },
    ],
    [
      "invalid time",
      (input) => {
        input.now = Number.NaN;
      },
    ],
    [
      "another image SBOM",
      (input) => {
        input.sbom.metadata.component.properties[0]!.value = `sha256:${"f".repeat(64)}`;
      },
    ],
    [
      "missing SBOM package",
      (input) => {
        input.sbom.components = [];
      },
    ],
    [
      "available fix",
      (input) => {
        input.report.Results[0]!.Vulnerabilities[0]!.FixedVersion = "7:7.1.6-1";
      },
    ],
    [
      "severity escalation",
      (input) => {
        input.report.Results[0]!.Vulnerabilities[0]!.Severity = "CRITICAL";
      },
    ],
    [
      "unreviewed finding",
      (input) => {
        input.report.Results[0]!.Vulnerabilities[0]!.VulnerabilityID =
          "CVE-2026-99999";
      },
    ],
  ])("rejects %s", (_name, mutate) => {
    const input = options();
    mutate(input);
    expect(() => assertTrivyPolicy(input)).toThrow(/DOCKER VERIFY:/u);
  });

  it("requires collected evidence and does not export unrelated values", () => {
    expect(() =>
      assertTrivyPolicy({ ...options(), audioEvidence: undefined }),
    ).toThrow(/evidence/u);
    const input = options();
    input.audioEvidence.binaries[sentinel] = "e".repeat(64);
    expect(
      JSON.stringify(
        assertTrivyPolicy({
          ...input,
          audioEvidence: { ...input.audioEvidence, endpoint: sentinel },
        }),
      ),
    ).not.toContain(sentinel);
  });

  it("rejects unexpected PURL qualifiers without exporting their values", () => {
    const input = options();
    input.report.Results[0]!.Vulnerabilities[0]!.PkgIdentifier.PURL += `&token=${sentinel}`;
    expect(() => assertTrivyPolicy(input)).toThrow(
      "DOCKER VERIFY: audio assessment scope changed, evidence is incomplete, or assessment expired",
    );
  });
});

describe("audio build filesystem evidence", () => {
  let root: string;
  const directory = "usr/share/studynarrator/audio";
  const put = (path: string, value: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "studynarrator-audio-evidence-"));
    put(
      "var/lib/dpkg/status.d/ffmpeg",
      "Package: ffmpeg\nVersion: 7:7.1.5-0+deb13u1\nArchitecture: arm64\n",
    );
    put(`${directory}/source.dsc`, "Version: 7:7.1.5-0+deb13u1\n");
    put(
      `${directory}/config.h`,
      "#define CONFIG_NETWORK 0\n#define CONFIG_LIBXML2 0\n",
    );
    put(`${directory}/config_components.h`, "#define CONFIG_CFHD_DECODER 0\n");
    put(`${directory}/objects.txt`, "libavformat/wavdec.o\n");
    const binaries = [
      "usr/bin/ffmpeg",
      "usr/bin/ffprobe",
      "usr/bin/tini",
      ...[
        "libavcodec.so.61",
        "libavformat.so.61",
        "libavfilter.so.10",
        "libavutil.so.59",
        "libswresample.so.5",
        "libmp3lame.so.0",
      ].map((name) => `usr/lib/aarch64-linux-gnu/${name}`),
    ];
    const checksum = createHash("sha256").update("binary").digest("hex");
    for (const path of binaries) put(path, "binary");
    put(
      `${directory}/sha256sums`,
      binaries.map((path) => `${checksum}  ${path}`).join("\n"),
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("collects verified binaries and build configuration in an isolated Node process", async () => {
    const evidence = await collectAudioEvidence(root);
    expect(evidence.configuration).toEqual({
      NETWORK: 0,
      LIBXML2: 0,
      CFHD_DECODER: 0,
    });
    expect(Object.keys(evidence.binaries)).toHaveLength(9);
    const source = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { collectAudioEvidence } from ${JSON.stringify(new URL("./verify-docker-audio.mjs", import.meta.url).href)}; process.stdout.write(collectAudioEvidence.toString())`,
      ],
      { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } },
    );
    const separate: unknown = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `process.stdout.write(JSON.stringify(await (${source})(${JSON.stringify(root)})))`,
        ],
        { encoding: "utf8" },
      ),
    );
    expect(separate).toEqual(evidence);
  });

  it.each(["usr/bin/ffprobe", "usr/lib/aarch64-linux-gnu/libavcodec.so.61"])(
    "rejects altered %s without exposing content",
    async (path) => {
      put(path, sentinel);
      await expect(collectAudioEvidence(root)).rejects.toThrow(
        "DOCKER VERIFY: audio build evidence could not be collected",
      );
    },
  );

  it("rejects omitted checksums and unexpected library symlink targets", async () => {
    const path = "usr/lib/aarch64-linux-gnu/libavcodec.so.61";
    rmSync(join(root, path));
    put("usr/lib/replacement.so", "binary");
    symlinkSync("../replacement.so", join(root, path));
    await expect(collectAudioEvidence(root)).rejects.toThrow(/evidence/u);
    put(`${directory}/sha256sums`, "");
    await expect(collectAudioEvidence(root)).rejects.toThrow(/evidence/u);
  });

  it("rejects traversal paths before reading outside the image root", async () => {
    put(
      `${directory}/sha256sums`,
      `${"a".repeat(64)}  usr/lib/../../${sentinel}`,
    );
    await expect(collectAudioEvidence(root)).rejects.toThrow(
      "DOCKER VERIFY: audio build evidence could not be collected",
    );
  });
});
