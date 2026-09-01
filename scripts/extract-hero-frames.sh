#!/usr/bin/env bash
# Extract the GAV hero scroll-video into a numbered JPEG frame sequence.
#
# The 169 frames at assets/hero-frames/hero-frame-001.jpg ... hero-frame-169.jpg
# are produced this way. The source video (gav/hero/box_rotation.mp4) is only
# 1080x606 — scale targets 1920x1080 with lanczos (sharper upscale than the
# ffmpeg default bilinear); scripts/optimize-hero-frames.mjs then applies a
# light sharpen() pass on top to counter the softness that any upscale
# introduces. Re-run this only if the source video is re-cut/re-rendered (or
# a genuinely higher-resolution source becomes available); then re-run
# `node scripts/optimize-hero-frames.mjs` to regenerate the mobile/desktop
# WebP sets the site actually loads.
#
# Usage: ./scripts/extract-hero-frames.sh path/to/box_rotation_source.mp4
set -euo pipefail

SRC="${1:?Usage: extract-hero-frames.sh <source-video>}"
OUT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/assets/hero-frames"
FRAME_COUNT=169

mkdir -p "$OUT_DIR"

# Pull the video's exact duration so FRAME_COUNT frames are spread evenly
# across the whole clip (not tied to the source's native fps) — this is
# what keeps "frame 069" / "frame 169" meaningful as fixed story beats even
# if the source is re-timed later.
DURATION="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SRC")"
FPS="$(python3 -c "print(${FRAME_COUNT} / max(${DURATION} - 0.001, 0.001))")"

ffmpeg -y -i "$SRC" \
  -vf "fps=${FPS},scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080" \
  -frame_pts 0 -q:v 2 \
  -frames:v "$FRAME_COUNT" \
  "$OUT_DIR/hero-frame-%03d.jpg"

echo "Extracted frames to $OUT_DIR"
echo "Next: node scripts/optimize-hero-frames.mjs"
