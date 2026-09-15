import { assessAudioFinding } from "./verify-docker-audio.mjs";

function requireEvidence(condition, message) {
  if (!condition) throw new Error(`DOCKER VERIFY: ${message}`);
}

export function assertTrivyPolicy({
  report,
  exceptions,
  sbom,
  audioEvidence,
  imageId,
  now = Date.now(),
}) {
  requireEvidence(
    report?.SchemaVersion === 2 &&
      report.ArtifactType === "container_image" &&
      typeof report.Metadata?.ImageID === "string" &&
      Array.isArray(report.Results),
    "Trivy JSON report is invalid",
  );
  requireEvidence(
    report.Metadata.ImageID === imageId,
    "Trivy report needs this exact image ID",
  );
  requireEvidence(
    exceptions?.schemaVersion === 1 && Array.isArray(exceptions.exceptions),
    "container exception document is invalid",
  );
  for (const exception of exceptions.exceptions) {
    requireEvidence(
      exception &&
        typeof exception.id === "string" &&
        /^CVE-\d{4}-\d+$/u.test(exception.id) &&
        typeof exception.package === "string" &&
        exception.package.startsWith("pkg:") &&
        typeof exception.reason === "string" &&
        exception.reason.length >= 80 &&
        /^\d{4}-\d{2}-\d{2}$/u.test(exception.expiresAt) &&
        Number.isFinite(Date.parse(`${exception.expiresAt}T00:00:00Z`)),
      "container exception entry is invalid",
    );
  }
  const used = new Set();
  const assessments = [];
  for (const result of report.Results) {
    requireEvidence(
      result &&
        typeof result.Target === "string" &&
        typeof result.Class === "string" &&
        typeof result.Type === "string" &&
        (result.Vulnerabilities === undefined ||
          Array.isArray(result.Vulnerabilities)),
      "Trivy result is invalid",
    );
    for (const vulnerability of result.Vulnerabilities ?? []) {
      const finding = {
        id: vulnerability?.VulnerabilityID,
        severity: vulnerability?.Severity,
        name: vulnerability?.PkgName,
        package: vulnerability?.PkgIdentifier?.PURL,
        installedVersion: vulnerability?.InstalledVersion,
        fixedVersion:
          vulnerability?.FixedVersion === undefined
            ? ""
            : vulnerability.FixedVersion,
      };
      requireEvidence(
        typeof finding.id === "string" &&
          /^CVE-\d{4}-\d+$/u.test(finding.id) &&
          ["CRITICAL", "HIGH"].includes(finding.severity) &&
          typeof finding.name === "string" &&
          finding.name.length > 0 &&
          typeof finding.installedVersion === "string" &&
          finding.installedVersion.length > 0 &&
          typeof finding.package === "string" &&
          finding.package.startsWith("pkg:") &&
          typeof finding.fixedVersion === "string",
        "Trivy finding fields are missing or unexpected",
      );
      const audioAssessment = assessAudioFinding({
        finding,
        evidence: audioEvidence,
        sbom,
        imageId,
        now,
      });
      if (audioAssessment) {
        assessments.push(audioAssessment);
        continue;
      }
      requireEvidence(
        finding.severity !== "CRITICAL",
        "unassessed critical vulnerability; see the raw Trivy report",
      );
      requireEvidence(
        finding.fixedVersion === "",
        "high vulnerability has a fix and must be remediated; see the raw Trivy report",
      );
      const exception = exceptions.exceptions.find(
        (candidate) =>
          candidate.id === finding.id &&
          finding.package.startsWith(candidate.package),
      );
      requireEvidence(
        exception,
        "high vulnerability lacks a narrow documented exception",
      );
      requireEvidence(
        Date.parse(`${exception.expiresAt}T00:00:00Z`) > now,
        "high vulnerability exception has expired",
      );
      used.add(exception);
    }
  }
  for (const exception of exceptions.exceptions) {
    requireEvidence(
      used.has(exception),
      "container high exception is stale or no longer needed",
    );
  }
  return { schemaVersion: 1, assessments };
}
