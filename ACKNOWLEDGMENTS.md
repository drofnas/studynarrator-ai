# Acknowledgments

StudyNarrator AI is an independent project licensed under Apache-2.0.

Workflow inspiration and thanks go to [Kokoro Local GUI / Kokoro Studio](https://github.com/AcTePuKc/Kokoro-Local-Gui), maintained by Shteryan Nikolaev (`AcTePuKc`) and contributors. Particular credit goes to `syedusama5556` for upstream progress, waveform, memory-use, and history-control improvements.

These acknowledgments describe product and user-experience inspiration. StudyNarrator AI is not affiliated with, sponsored by, endorsed by, or a distribution of Kokoro Local GUI. No Kokoro Local GUI source code is included in this project.

The Docker image includes a restricted build of [FFmpeg](https://ffmpeg.org/),
dynamically linked with [LAME](https://lame.sourceforge.io/), and
[Tini](https://github.com/krallin/tini). FFmpeg and LAME retain their LGPL licenses;
Tini retains its MIT license. Their notices and build evidence are installed at
`/usr/share/studynarrator/audio/`. The source versions, reproducible build recipe,
and runtime provenance are documented in the
[Docker audio build assessment](docs/security/docker-audio-build.md).
