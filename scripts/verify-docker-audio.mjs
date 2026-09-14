// Exact build applicability, not a severity or local-use risk exception.
// Sources and scope: docs/security/docker-audio-build.md.
const version = "7:7.1.5-0+deb13u1";
const expiresAt = "2026-10-14T00:00:00Z";
const affectedComponents = {
  "CVE-2026-58049": ["RASC_DECODER", "libavcodec/rasc.o"],
  "CVE-2026-64830": ["VOBSUB_DEMUXER", "libavformat/mpeg.o"],
  "CVE-2026-64832": ["NVDEC", "libavcodec/nvdec.o"],
  "CVE-2026-64833": ["SPDIF_MUXER", "libavformat/spdifenc.o"],
  "CVE-2026-64834": ["RTP_DEMUXER", "libavformat/rtpdec_asf.o"],
  "CVE-2026-64835": ["ADPCM_ADX_DECODER", "libavcodec/adxdec.o"],
  "CVE-2026-66036": ["HQDN3D_FILTER", "libavfilter/vf_hqdn3d.o"],
  "CVE-2026-66039": ["MACE6_DECODER", "libavcodec/mace.o"],
  "CVE-2026-66040": ["PNG_ENCODER", "libavcodec/pngenc.o"],
  "CVE-2026-66041": ["QUIRC_FILTER", "libavfilter/vf_quirc.o"],
  "CVE-2026-70628": ["DVBSUB_PARSER", "libavcodec/dvbsub_parser.o"],
  "CVE-2026-70632": ["CFHD_DECODER", "libavcodec/cfhd.o"],
  "CVE-2026-75142": ["MPEG1SYSTEM_MUXER", "libavformat/mpegenc.o"],
  "CVE-2026-75143": ["LIBRIST_PROTOCOL", "libavformat/librist.o"],
  "CVE-2026-75144": ["RTP_MUXER", "libavformat/rtpenc_vc2hq.o"],
  "CVE-2026-75146": ["DASH_DEMUXER", "libavformat/dashdec.o"],
};

// Runs inside the scanned image without a shell, network, or host mounts.
export async function collectAudioEvidence(root = "/") {
  try {
    const { readFile, realpath } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { createHash } = await import("node:crypto");
    const canonicalRoot = (await realpath(root)).replace(/\/$/u, "");
    const read = (path) => readFile(join(root, path), "utf8");
    const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
    const directory = "usr/share/studynarrator/audio";
    const metadata = await read("var/lib/dpkg/status.d/ffmpeg");
    const field = (key) =>
      metadata.match(new RegExp(`^${key}: (.+)$`, "m"))?.[1];
    const configuration = `${await read(`${directory}/config.h`)}\n${await read(`${directory}/config_components.h`)}`;
    const source = await read(`${directory}/source.dsc`);
    const objects = (await read(`${directory}/objects.txt`)).trim().split("\n");
    const binaries = {};
    for (const line of (await read(`${directory}/sha256sums`))
      .trim()
      .split("\n")) {
      const match = line.match(
        /^([a-f0-9]{64}) {2}(usr\/(?:bin|lib)\/[\w./-]+)$/u,
      );
      if (!match || match[2].split("/").includes("..")) throw new Error();
      const [, expected, path] = match;
      const actual = sha256(await readFile(join(root, path)));
      if (actual !== expected) throw new Error();
      binaries[path] = actual;
    }
    const triplet = { arm64: "aarch64-linux-gnu", amd64: "x86_64-linux-gnu" }[
      field("Architecture")
    ];
    if (!triplet) throw new Error();
    const required = [
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
      ].map((name) => `usr/lib/${triplet}/${name}`),
    ];
    for (const path of required) {
      const resolved = await realpath(join(root, path));
      const canonical = resolved.slice(canonicalRoot.length + 1);
      if (!binaries[canonical]) throw new Error();
    }
    return {
      package: field("Package"),
      version: field("Version"),
      architecture: field("Architecture"),
      sourceVersion: source.match(/^Version: (.+)$/mu)?.[1],
      sourceSha256: sha256(source),
      configurationSha256: sha256(configuration),
      configuration: Object.fromEntries(
        [...configuration.matchAll(/^#define CONFIG_(\w+) ([01])$/gmu)].map(
          (match) => [match[1], Number(match[2])],
        ),
      ),
      objects,
      binaries,
    };
  } catch {
    throw new Error(
      "DOCKER VERIFY: audio build evidence could not be collected",
    );
  }
}

export function assessAudioFinding({ finding, evidence, sbom, imageId, now }) {
  const affected = affectedComponents[finding.id];
  if (!affected) return undefined;
  const qualifiers = new URLSearchParams(finding.package.split("?")[1]);
  if (
    finding.name !== "ffmpeg" ||
    finding.installedVersion !== version ||
    finding.package.split("?")[0] !==
      "pkg:deb/debian/ffmpeg@7.1.5-0%2Bdeb13u1" ||
    qualifiers.get("epoch") !== "7" ||
    qualifiers.get("arch") !== evidence?.architecture ||
    qualifiers.get("distro") !== "debian-13.7" ||
    [...qualifiers.keys()].sort().join(",") !== "arch,distro,epoch" ||
    !/^sha256:[a-f0-9]{64}$/u.test(imageId ?? "") ||
    finding.fixedVersion !== "" ||
    finding.severity !== "HIGH" ||
    !Number.isFinite(now) ||
    now < Date.parse("2026-09-14T00:00:00Z") ||
    now >= Date.parse(expiresAt) ||
    evidence?.package !== "ffmpeg" ||
    evidence.version !== version ||
    evidence.sourceVersion !== version ||
    !["arm64", "amd64"].includes(evidence.architecture) ||
    evidence.sourceSha256 !==
      "9ed2ed34cbe7f056eeebbe9045c5e2d15e41b5b053fe7c8ba6979a0b6fb081ce" ||
    !/^[a-f0-9]{64}$/u.test(evidence.configurationSha256 ?? "") ||
    !/^[a-f0-9]{64}$/u.test(evidence.binaries?.["usr/bin/ffmpeg"] ?? "") ||
    !/^[a-f0-9]{64}$/u.test(evidence.binaries?.["usr/bin/ffprobe"] ?? "") ||
    evidence.configuration?.[affected[0]] !== 0 ||
    evidence.configuration?.NETWORK !== 0 ||
    evidence.configuration?.LIBXML2 !== 0 ||
    !Array.isArray(evidence.objects) ||
    !evidence.objects.includes("libavformat/wavdec.o") ||
    evidence.objects.includes(affected[1]) ||
    sbom?.bomFormat !== "CycloneDX" ||
    !sbom.metadata?.component?.properties?.some(
      (property) =>
        property.name === "aquasecurity:trivy:ImageID" &&
        property.value === imageId,
    ) ||
    !sbom.components?.some((component) => component.purl === finding.package)
  )
    throw new Error(
      "DOCKER VERIFY: audio assessment scope changed, evidence is incomplete, or assessment expired",
    );
  return {
    id: finding.id,
    status: "not_affected",
    justification: "vulnerable_code_not_present",
    package: finding.package,
    imageId,
    architecture: evidence.architecture,
    sourceSha256: evidence.sourceSha256,
    configurationSha256: evidence.configurationSha256,
    binaries: Object.fromEntries(
      Object.entries(evidence.binaries).filter(
        ([path, hash]) =>
          /^usr\/(?:bin\/(?:ffmpeg|ffprobe|tini)|lib\/(?:aarch64-linux-gnu|x86_64-linux-gnu)\/(?:libavcodec|libavformat|libavfilter|libavutil|libswresample|libmp3lame)\.so\.\d+(?:\.\d+)*)$/u.test(
            path,
          ) && /^[a-f0-9]{64}$/u.test(hash),
      ),
    ),
    absentObject: affected[1],
    assessedAt: new Date(now).toISOString(),
    expiresAt,
    rationale: "docs/security/docker-audio-build.md",
  };
}
