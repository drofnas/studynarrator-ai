import { assertTrivyPolicy } from "./verify-docker-vulnerabilities.mjs";

const sentinel = "sentinel-private-endpoint-secret";
const imageId = `sha256:${"a".repeat(64)}`;
function options() {
  return {
    now: Date.parse("2026-09-14T12:00:00Z"),
    imageId,
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
              VulnerabilityID: "CVE-2026-6653",
              Severity: "CRITICAL",
              PkgName: "libxml2",
              PkgIdentifier: { PURL: "pkg:deb/debian/libxml2@2.9.14" },
              InstalledVersion: "2.9.14",
              FixedVersion: "",
            },
          ],
        },
      ],
    },
    exceptions: {
      schemaVersion: 1,
      exceptions: [] as {
        id: string;
        package: string;
        reason: string;
        expiresAt: string;
      }[],
    },
  };
}

describe("Docker vulnerability policy", () => {
  it.each(["CVE-2026-6653", "CVE-2026-52490", "CVE-2026-99999"])(
    "rejects unassessed critical %s, including the retired TIFF assessment",
    (id) => {
      const input = options();
      input.report.Results[0]!.Vulnerabilities[0]!.VulnerabilityID = id;
      expect(() => assertTrivyPolicy(input)).toThrow(/unassessed critical/u);
    },
  );

  it("passes a clean report without an applicability assessment", () => {
    const input = options();
    input.report.Results[0]!.Vulnerabilities = [];
    expect(assertTrivyPolicy(input).assessments).toEqual([]);
  });

  it("requires a narrow unexpired exception for unfixed highs and rejects stale exceptions", () => {
    const input = options();
    const vulnerability = input.report.Results[0]!.Vulnerabilities[0]!;
    vulnerability.Severity = "HIGH";
    expect(() => assertTrivyPolicy(input)).toThrow(
      /narrow documented exception/u,
    );
    input.exceptions.exceptions.push({
      id: vulnerability.VulnerabilityID,
      package: "pkg:deb/debian/libxml2@",
      reason:
        "A fixture-only rationale for a specific reviewed package and vulnerability, never an actual runtime acceptance.",
      expiresAt: "2026-10-14",
    });
    expect(assertTrivyPolicy(input).assessments).toEqual([]);
    vulnerability.FixedVersion = "2.15.4";
    expect(() => assertTrivyPolicy(input)).toThrow(/has a fix/u);
    vulnerability.FixedVersion = "";
    expect(() =>
      assertTrivyPolicy({ ...input, now: Date.parse("2026-10-14") }),
    ).toThrow(/expired/u);
    input.report.Results[0]!.Vulnerabilities = [];
    expect(() => assertTrivyPolicy(input)).toThrow(/stale/u);
  });

  it.each([
    {},
    { SchemaVersion: 2, ArtifactType: "container_image", Results: [{}] },
  ])("rejects malformed reports", (report) => {
    expect(() => assertTrivyPolicy({ ...options(), report })).toThrow(
      /Trivy JSON report is invalid/u,
    );
  });

  it("rejects another image, malformed findings, and malformed exceptions without exposing input", () => {
    const input = options();
    expect(() =>
      assertTrivyPolicy({ ...input, imageId: `sha256:${"b".repeat(64)}` }),
    ).toThrow(/exact image/u);
    input.report.Results[0]!.Vulnerabilities[0]!.VulnerabilityID = sentinel;
    expect(() => assertTrivyPolicy(input)).toThrow(
      "DOCKER VERIFY: Trivy finding fields are missing or unexpected",
    );
    expect(() =>
      assertTrivyPolicy({
        ...input,
        exceptions: { schemaVersion: 1, exceptions: [{ reason: sentinel }] },
      }),
    ).toThrow("DOCKER VERIFY: container exception entry is invalid");
  });
});
