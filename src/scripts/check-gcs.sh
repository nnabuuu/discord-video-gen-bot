#!/bin/bash

# Quick script to check if video files exist for a generation
# Usage: bash src/scripts/check-gcs.sh <gcs-prefix> [bucket-name]
#
# Example:
# bash src/scripts/check-gcs.sh "discord/.../e4a21a65-2e3e-4540-8054-8a25d394222e/"
# bash src/scripts/check-gcs.sh "discord/.../e4a21a65-2e3e-4540-8054-8a25d394222e/" "my-custom-bucket"

PREFIX="$1"
BUCKET="${2:-${OUTPUT_BUCKET:-discord-video-gen-bot-test}}"

if [ -z "$PREFIX" ]; then
  echo "Usage: $0 <gcs-prefix> [bucket-name]"
  echo ""
  echo "Arguments:"
  echo "  gcs-prefix    Required. The GCS prefix to check"
  echo "  bucket-name   Optional. Defaults to OUTPUT_BUCKET env var or 'discord-video-gen-bot-test'"
  echo ""
  echo "Example:"
  echo "  $0 'discord/1077872624052490341/1077872624580952166/358732924339879936/e4a21a65-2e3e-4540-8054-8a25d394222e/'"
  echo "  $0 'discord/.../e4a21a65/' 'my-custom-bucket'"
  exit 1
fi

echo "🔍 Checking gs://${BUCKET}/${PREFIX}"
echo ""

# List files
echo "Files found:"
gsutil ls "gs://${BUCKET}/${PREFIX}" 2>/dev/null

if [ $? -ne 0 ]; then
  echo "❌ No files found or prefix doesn't exist"
  exit 1
fi

echo ""
echo "✅ Files exist!"

# Show details
echo ""
echo "File details:"
gsutil ls -lh "gs://${BUCKET}/${PREFIX}"
