# Docker audio build applicability

Reviewed 2026-09-14. Assessment expires 2026-10-14 UTC.

## Runtime change

The Docker image uses the official Debian 13 Distroless Node 24 runtime, pinned
by image-index digest. The application build still uses the existing Node 24
Debian builder. Both inspected images provide Node 24.21.0; local development
continues to use the repository's pinned Node 24.19.0/npm 11.19.0.

[Distroless](https://github.com/GoogleContainerTools/distroless) supplies the
runtime libraries and certificate store without a shell or package manager.
The Dockerfile adds FFmpeg/FFprobe, their required audio libraries, and Tini.
The existing non-root UID/GID, read-only filesystem, loopback publication,
capability restrictions, and persistent `/data` volume remain applicable.

The FFmpeg build uses Debian source version `7:7.1.5-0+deb13u1`, including its
distribution patches. APT verifies the signed repository index and source
checksums; the build additionally pins the source descriptor SHA-256 to
`9ed2ed34cbe7f056eeebbe9045c5e2d15e41b5b053fe7c8ba6979a0b6fb081ce`.
The [build script](../../deploy/docker/build-audio.sh) is the reproducible source
and configuration recipe. It dynamically links LGPL FFmpeg and LAME libraries;
their licenses, source descriptor, configuration, and object inventory ship
under `/usr/share/studynarrator/audio/`.

The build enables WAV/MP3 inputs, generated concat lists, PCM/MP3 audio decoding,
PCM/LAME encoding, the application's audio filters, and file/pipe access.
FFmpeg enables some internal video transform filters as command-line program
dependencies, but this build has no video decoders or video input formats.
Network protocols, XML, RIST, device capture, and automatic external-library
detection are disabled. Speaches HTTP/HTTPS access remains in the application.

This replaces the broad Debian FFmpeg binary dependency tree. The image no
longer contains libxml2, cJSON, TIFF, Expat, libsndfile, util-linux, ncurses, ACL,
systemd libraries, PCRE2, gzip, or system SQLite. Native application SQLite
remains embedded in `better-sqlite3`; the inspected runtime reports 3.53.4.
The five previously fixable highs disappear with their unused OS packages.
The cJSON exceptions are removed because that library is absent.

## Findings retained and assessed

The custom FFmpeg build and copied LAME/Tini packages remain in Debian package
metadata and the CycloneDX inventory. Trivy still reports FFmpeg's source-package
CVEs. No severity is changed and no raw finding is suppressed.

The following individual CVEs concern components not compiled into this build.
The source references are the official Debian security records and the affected
paths in the authenticated FFmpeg source. The assessment checks the corresponding
disabled configuration symbol and absence of the object in the build inventory.

| CVE                                                                      | Excluded component      | Absent object                |
| ------------------------------------------------------------------------ | ----------------------- | ---------------------------- |
| [2026-58049](https://security-tracker.debian.org/tracker/CVE-2026-58049) | RASC video decoder      | `libavcodec/rasc.o`          |
| [2026-64830](https://security-tracker.debian.org/tracker/CVE-2026-64830) | VobSub demuxer          | `libavformat/mpeg.o`         |
| [2026-64832](https://security-tracker.debian.org/tracker/CVE-2026-64832) | NVDEC hardware decoding | `libavcodec/nvdec.o`         |
| [2026-64833](https://security-tracker.debian.org/tracker/CVE-2026-64833) | S/PDIF muxer            | `libavformat/spdifenc.o`     |
| [2026-64834](https://security-tracker.debian.org/tracker/CVE-2026-64834) | RTP/ASF input           | `libavformat/rtpdec_asf.o`   |
| [2026-64835](https://security-tracker.debian.org/tracker/CVE-2026-64835) | ADX decoder             | `libavcodec/adxdec.o`        |
| [2026-66036](https://security-tracker.debian.org/tracker/CVE-2026-66036) | HQDN3D video filter     | `libavfilter/vf_hqdn3d.o`    |
| [2026-66039](https://security-tracker.debian.org/tracker/CVE-2026-66039) | MACE6 decoder           | `libavcodec/mace.o`          |
| [2026-66040](https://security-tracker.debian.org/tracker/CVE-2026-66040) | PNG/APNG encoding       | `libavcodec/pngenc.o`        |
| [2026-66041](https://security-tracker.debian.org/tracker/CVE-2026-66041) | QR video filter         | `libavfilter/vf_quirc.o`     |
| [2026-70628](https://security-tracker.debian.org/tracker/CVE-2026-70628) | DVB subtitle parser     | `libavcodec/dvbsub_parser.o` |
| [2026-70632](https://security-tracker.debian.org/tracker/CVE-2026-70632) | CFHD decoder            | `libavcodec/cfhd.o`          |
| [2026-75142](https://security-tracker.debian.org/tracker/CVE-2026-75142) | MPEG-PS muxing          | `libavformat/mpegenc.o`      |
| [2026-75143](https://security-tracker.debian.org/tracker/CVE-2026-75143) | RIST protocol           | `libavformat/librist.o`      |
| [2026-75144](https://security-tracker.debian.org/tracker/CVE-2026-75144) | VC-2 RTP packetizer     | `libavformat/rtpenc_vc2hq.o` |
| [2026-75146](https://security-tracker.debian.org/tracker/CVE-2026-75146) | DASH demuxer            | `libavformat/dashdec.o`      |

The verifier collects evidence inside the exact scanned image without network
access, elevated capabilities, a writable root filesystem, or host/user mounts.
It checks FFmpeg/FFprobe, Tini, all five FFmpeg libraries, and LAME against their
build SHA-256 values and follows the runtime library symlinks. The assessment
binds the source descriptor, build configuration, package/version, architecture,
binary checksums, raw report, and SBOM to the image ID.

This relies on the reviewed build recipe and authenticated source; it is not an
independent reverse-engineering proof of arbitrary binaries. Never apply it to
an unreviewed replacement build. New findings, an available fix, changed source,
enabled affected code, missing evidence, or expiry fail verification. Other
critical/high findings retain the existing blocking policy.

The historical low-risk decision for CVE-2026-70632 still applies to the owner's
trusted native local-use scenario. This Docker build instead receives a scoped
`not_affected` assessment because CFHD code is absent. This does not assess
host-installed FFmpeg or certify a CVE-free Electron distribution.

## Update and validation

Check Debian security records and upstream FFmpeg release notes before changing
the runtime digest, source version/hash, features, or assessment. A newer version
alone does not prove a fix. Renew assessments from source and current scan
evidence; never extend their date automatically.

Run the focused Docker policy tests and `npm run verify`. Confirm raw scan/SBOM
inventory, startup, WAV synthesis, normalization, concatenation, MP3 encoding,
metadata rewriting, waveform extraction, browser workflows, volume persistence,
and cleanup. Compare deterministic audio outputs and timings against the previous
image. Store generated evidence under `.tmp/verify-docker/` and record actual
results in the R27a story report before declaring completion.

The verified arm64 image scan contains 17 Debian packages and 85 npm packages,
zero critical findings, and the 16 FFmpeg findings above. This is a dated
high/critical scan result, not a guarantee of zero CVEs at every severity or in
every bundled component. Full acceptance and architecture-specific evidence are
recorded in the [R27a story report](../implement-prd-stories/r27a-render-activity.md).
