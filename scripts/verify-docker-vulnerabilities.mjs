// This assessment is deliberately specific, not a general critical-CVE allowlist.
// Source analysis and renewal/removal criteria: docs/security/CVE-2026-52490.md.
const assessedCve = "CVE-2026-52490";
const assessedVersion = "4.7.0-3+deb13u3";
const expiresAt = "2026-10-01T00:00:00Z";

function requireEvidence(condition, message) {
  if (!condition) throw new Error(`DOCKER VERIFY: ${message}`);
}

// Self-contained so the verifier can execute this function inside the exact
// image being assessed. No shell, network, user volume, or host filesystem reads.
export async function collectTiffEvidence(root = "/") {
  let phase = "metadata";
  try {
    const { readFile, readdir, readlink } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { createHash } = await import("node:crypto");
    const read = (path) => readFile(join(root, path), "utf8");
    const osRelease = await read("etc/os-release");
    const field = (key) =>
      osRelease.match(new RegExp(`^${key}="?([^"\\n]+)"?$`, "m"))?.[1];
    const paragraphs = (await read("var/lib/dpkg/status")).split(/\n\s*\n/u);
    const packages = paragraphs.map((paragraph) =>
      Object.fromEntries(
        paragraph.split("\n").flatMap((line) => {
          const match = line.match(/^([\w-]+): (.*)$/u);
          return match ? [[match[1], match[2]]] : [];
        }),
      ),
    );
    const tiffPackages = packages
      .filter(
        (pkg) =>
          pkg.Status === "install ok installed" &&
          ((pkg.Source ?? pkg.Package)?.split(" ")[0] === "tiff" ||
            /tiff/iu.test(pkg.Package ?? "")),
      )
      .map((pkg) => ({
        name: pkg.Package,
        version: pkg.Version,
        source: (pkg.Source ?? pkg.Package).split(" ")[0],
        architecture: pkg.Architecture,
      }));
    let tiffcropPresent = false;
    const walk = async (directory) => {
      for (const entry of await readdir(join(root, directory), {
        withFileTypes: true,
      })) {
        // These are runtime mounts, not image contents. /data is a fresh tmpfs.
        if (
          directory === "" &&
          ["proc", "sys", "dev", "data"].includes(entry.name)
        )
          continue;
        const path = join(directory, entry.name);
        if (/tiffcrop/iu.test(entry.name)) tiffcropPresent = true;
        if (entry.isSymbolicLink()) {
          if (/tiffcrop/iu.test(await readlink(join(root, path))))
            tiffcropPresent = true;
        } else if (entry.isDirectory()) await walk(path);
      }
    };
    phase = "filesystem";
    await walk("");
    phase = "library";
    const library = tiffPackages.find((pkg) => pkg.name === "libtiff6");
    const triplet = {
      arm64: "aarch64-linux-gnu",
      amd64: "x86_64-linux-gnu",
    }[library?.architecture];
    if (!triplet) throw new Error("Unsupported TIFF package inventory");
    const libraryPath = `usr/lib/${triplet}/libtiff.so.6.1.0`;
    const bytes = await readFile(join(root, libraryPath));
    const checksums = await read(
      `var/lib/dpkg/info/libtiff6:${library.architecture}.md5sums`,
    );
    const expectedMd5 = checksums
      .split("\n")
      .map((line) => line.trim().split(/\s+/u))
      .find(([, path]) => path === libraryPath)?.[0];
    return {
      os: {
        id: field("ID"),
        version: field("VERSION_ID"),
        codename: field("VERSION_CODENAME"),
      },
      tiffPackages,
      tiffcropPresent,
      libraryMatchesPackage:
        createHash("md5").update(bytes).digest("hex") === expectedMd5,
      librarySha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch {
    // Never include raw filesystem paths, process output, or injected content.
    throw new Error(
      `DOCKER VERIFY: TIFF image evidence could not be collected (${phase})`,
    );
  }
}

function assessTiffcrop({ finding, sbom, evidence, imageId, now }) {
  const purl = (name) =>
    `pkg:deb/debian/${name}@4.7.0-3%2Bdeb13u3?os_distro=trixie&os_name=debian&os_version=13`;
  requireEvidence(
    finding.package === purl("tiff") &&
      finding.fixedVersion === "not fixed" &&
      now >= Date.parse("2026-09-01T00:00:00Z") &&
      now < Date.parse(expiresAt),
    "TIFF assessment scope changed or expired; review CVE-2026-52490",
  );
  requireEvidence(
    /^sha256:[a-f0-9]{64}$/u.test(imageId ?? "") &&
      sbom?.bomFormat === "CycloneDX" &&
      sbom.metadata?.component?.purl?.split("@")[1]?.split("?")[0] === imageId,
    "TIFF assessment needs the SBOM for this exact image ID",
  );
  const components = [];
  const visit = (items) => {
    requireEvidence(
      Array.isArray(items),
      "TIFF SBOM component inventory is invalid",
    );
    for (const item of items) {
      requireEvidence(
        item && typeof item === "object",
        "TIFF SBOM component is invalid",
      );
      components.push(item);
      if (item.components !== undefined) visit(item.components);
    }
  };
  visit(sbom.components);
  requireEvidence(
    components.some((item) => item.purl === purl("tiff")) &&
      components.some((item) => item.purl === purl("libtiff6")) &&
      !components.some((item) =>
        /tiffcrop|libtiff-tools/iu.test(JSON.stringify(item)),
      ),
    "TIFF SBOM does not establish absence of the affected tool",
  );
  const pkg = evidence?.tiffPackages?.[0];
  requireEvidence(
    evidence?.os?.id === "debian" &&
      evidence.os.version === "13" &&
      evidence.os.codename === "trixie" &&
      evidence.tiffPackages?.length === 1 &&
      pkg.name === "libtiff6" &&
      pkg.source === "tiff" &&
      pkg.version === assessedVersion &&
      ["arm64", "amd64"].includes(pkg.architecture) &&
      evidence.tiffcropPresent === false &&
      evidence.libraryMatchesPackage === true &&
      /^[a-f0-9]{64}$/u.test(evidence.librarySha256 ?? ""),
    "TIFF filesystem/package evidence does not establish vulnerable-code absence",
  );
  return {
    id: assessedCve,
    status: "not_affected",
    justification: "vulnerable_code_not_present",
    package: purl("tiff"),
    imageId,
    architecture: pkg.architecture,
    librarySha256: evidence.librarySha256,
    tiffcropPresent: false,
    libraryMatchesPackage: true,
    assessedAt: new Date(now).toISOString(),
    expiresAt,
    rationale: "docs/security/CVE-2026-52490.md",
  };
}

export function assertScoutPolicy({
  report,
  exceptions,
  sbom,
  evidence,
  imageId,
  now = Date.now(),
}) {
  requireEvidence(
    report?.version === "2.1.0" &&
      Array.isArray(report.runs) &&
      report.runs.length > 0,
    "Scout SARIF report is invalid",
  );
  requireEvidence(
    exceptions?.schemaVersion === 1 && Array.isArray(exceptions.exceptions),
    "Scout exception document is invalid",
  );
  const used = new Set();
  const assessments = [];
  for (const run of report.runs) {
    requireEvidence(
      Array.isArray(run.results),
      "Scout SARIF results are missing",
    );
    for (const result of run.results) {
      const message = result?.message?.text;
      requireEvidence(typeof message === "string", "Scout finding is invalid");
      const value = (label) =>
        message
          .match(new RegExp(`^${label}\\s*:([^\\n]+)`, "m"))?.[1]
          ?.trim() ?? "";
      const finding = {
        id: value("Vulnerability") || result.ruleId,
        severity: value("Severity"),
        package: value("Package"),
        fixedVersion: value("Fixed version"),
      };
      requireEvidence(
        typeof finding.id === "string" &&
          /^CVE-\d{4}-\d+$/u.test(finding.id) &&
          ["CRITICAL", "HIGH"].includes(finding.severity) &&
          finding.package.startsWith("pkg:") &&
          finding.fixedVersion.length > 0,
        "Scout finding fields are missing or unexpected",
      );
      if (finding.id === assessedCve) {
        assessments.push(
          assessTiffcrop({ finding, sbom, evidence, imageId, now }),
        );
        continue;
      }
      requireEvidence(
        finding.severity !== "CRITICAL",
        "unassessed critical vulnerability; see the raw Scout report",
      );
      requireEvidence(
        finding.fixedVersion === "not fixed",
        "high vulnerability has a fix and must be remediated; see the raw Scout report",
      );
      const exception = exceptions.exceptions.find(
        (candidate) =>
          candidate.id === finding.id &&
          finding.package.startsWith(candidate.package),
      );
      requireEvidence(
        exception &&
          typeof exception.package === "string" &&
          exception.package.startsWith("pkg:") &&
          typeof exception.reason === "string" &&
          exception.reason.length >= 80,
        "high vulnerability lacks a narrow documented exception",
      );
      requireEvidence(
        Date.parse(`${exception.expiresAt}T00:00:00Z`) > now,
        "high vulnerability exception has expired",
      );
      used.add(exception.id);
    }
  }
  for (const exception of exceptions.exceptions) {
    requireEvidence(
      used.has(exception.id),
      "Scout high exception is stale or no longer needed",
    );
  }
  return { schemaVersion: 1, assessments };
}
