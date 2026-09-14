#!/bin/sh
set -eu

# Debian's signed source index supplies the release and distribution patches.
version='7:7.1.5-0+deb13u1'
sed -i 's/^Types: deb$/Types: deb deb-src/' /etc/apt/sources.list.d/debian.sources
apt-get update
apt-get install --yes --no-install-recommends \
  build-essential dpkg-dev pkg-config nasm libmp3lame-dev tini
mkdir /source
cd /source
apt-get source --download-only "ffmpeg=$version"
printf '%s  %s\n' '9ed2ed34cbe7f056eeebbe9045c5e2d15e41b5b053fe7c8ba6979a0b6fb081ce' /source/*.dsc | sha256sum --check -
dpkg-source --extract ./*.dsc ffmpeg
cd ffmpeg

triplet="$(dpkg-architecture -qDEB_HOST_MULTIARCH)"
./configure --prefix=/usr --libdir="/usr/lib/$triplet" \
  --disable-everything --disable-autodetect --disable-network \
  --disable-doc --disable-debug --disable-static --enable-shared \
  --disable-avdevice --disable-postproc --disable-swscale \
  --enable-ffmpeg --enable-ffprobe --disable-ffplay \
  --enable-libmp3lame \
  --enable-protocol=file,pipe \
  --enable-demuxer=wav,mp3,concat \
  --enable-muxer=wav,mp3,pcm_s16le \
  --enable-parser=mpegaudio \
  --enable-decoder=pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,pcm_u8,pcm_alaw,pcm_mulaw,mp3float \
  --enable-encoder=pcm_s16le,libmp3lame \
  --enable-filter=abuffer,abuffersink,aformat,anull,aresample,atrim,volume,alimiter
make -j4
make install DESTDIR=/runtime
rm -rf /runtime/usr/include /runtime/usr/lib/"$triplet"/pkgconfig
cp -a /usr/lib/"$triplet"/libmp3lame.so.0* /runtime/usr/lib/"$triplet"/
cp /usr/bin/tini /runtime/usr/bin/tini
install -d -m 0750 -o 10001 -g 10001 /runtime/data
install -d /runtime/var/lib/dpkg/status.d /runtime/usr/share/studynarrator/audio

# Keep custom FFmpeg and copied libraries visible to Debian-aware scanners.
architecture="$(dpkg --print-architecture)"
cat > /runtime/var/lib/dpkg/status.d/ffmpeg <<EOF
Package: ffmpeg
Status: install ok installed
Architecture: $architecture
Version: $version
Source: ffmpeg
Description: StudyNarrator audio-only build from the Debian FFmpeg source package
EOF
for package in libmp3lame0 tini; do
  dpkg-query --status "$package" > "/runtime/var/lib/dpkg/status.d/$package"
done
cp config.h config_components.h /runtime/usr/share/studynarrator/audio/
cp /source/*.dsc /runtime/usr/share/studynarrator/audio/source.dsc
cp COPYING.LGPLv2.1 LICENSE.md /runtime/usr/share/studynarrator/audio/
cp /usr/share/doc/libmp3lame0/copyright /runtime/usr/share/studynarrator/audio/lame-copyright
cp /usr/share/doc/tini/copyright /runtime/usr/share/studynarrator/audio/tini-copyright
find libavcodec libavformat libavfilter libavutil libswresample fftools \
  -name '*.o' -type f | sort > /runtime/usr/share/studynarrator/audio/objects.txt
cd /runtime
find usr/bin usr/lib -type f -exec sha256sum {} + | sort \
  > usr/share/studynarrator/audio/sha256sums
