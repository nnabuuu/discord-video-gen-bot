#!/bin/bash

# Setup GCS lifecycle policy to auto-delete videos after 1 day
# Run: bash scripts/setup-lifecycle.sh

BUCKET_NAME="${OUTPUT_BUCKET:-discord-video-gen-bot-test}"

echo "Setting up lifecycle policy for bucket: gs://${BUCKET_NAME}"

# Create lifecycle configuration
cat > /tmp/lifecycle.json <<EOF
{
  "lifecycle": {
    "rule": [
      {
        "action": {
          "type": "Delete"
        },
        "condition": {
          "age": 1,
          "matchesPrefix": ["discord/"]
        }
      }
    ]
  }
}
EOF

# Apply lifecycle policy
gcloud storage buckets update gs://${BUCKET_NAME} \
  --lifecycle-file=/tmp/lifecycle.json

echo "✅ Lifecycle policy applied!"
echo "Videos in discord/ prefix will be automatically deleted after 1 day"

# Verify
gcloud storage buckets describe gs://${BUCKET_NAME} --format="json(lifecycle)"

# Cleanup
rm /tmp/lifecycle.json
