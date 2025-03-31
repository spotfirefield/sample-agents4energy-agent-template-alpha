#!/bin/bash

# Get script directory and repository root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Create directory for PuLP package
echo "Creating temporary directory for PuLP package..."
mkdir -p /tmp/pulp_package
cd /tmp/pulp_package || { echo "Failed to cd to /tmp/pulp_package"; exit 1; }

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is required for this script."
    exit 1
fi

# Create a Dockerfile in the temporary directory
cat > Dockerfile << 'EOF'
FROM python:3.9-slim

WORKDIR /opt/build
RUN apt-get update && apt-get install -y zip unzip

RUN mkdir /tmp/unpacked

# Install PuLP with dependencies and Python-based solvers
RUN pip install pulp --target=/tmp/unpacked
# Install additional Python-based solvers
RUN pip install docplex cplex --target=/tmp/unpacked

# Zip the package in one command
RUN cd /tmp/unpacked && zip -r9 ../pulp_library.zip .

EOF

# Build the Docker image
echo "Building Docker image..."
docker build --platform linux/amd64 -t pulp-packager . || { echo "Failed to build Docker image"; exit 1; }

# Check if the zip file was created
if [ -f "pulp_library.zip" ]; then
    echo "PuLP library has been packaged into /tmp/pulp_package/pulp_library.zip"
else
    echo "Error: Failed to generate pulp_library.zip"
    exit 1
fi

# Get the bucket name from amplify_outputs.json
echo "Reading bucket name from amplify_outputs.json..."
if [ ! -f "$REPO_ROOT/amplify_outputs.json" ]; then
    echo "Error: amplify_outputs.json not found"
    exit 1
fi

BUCKET_NAME=$(grep -o '"bucket_name": "[^"]*"' "$REPO_ROOT/amplify_outputs.json" | head -1 | cut -d'"' -f4)

if [ -z "$BUCKET_NAME" ]; then
    echo "Error: Could not find bucket_name in amplify_outputs.json"
    exit 1
fi
# Upload to S3
echo "Uploading pulp_library.zip to s3://$BUCKET_NAME/pypi/"
aws s3 cp pulp_library.zip "s3://$BUCKET_NAME/pypi/" || { echo "Failed to upload to S3"; exit 1; }
aws s3 cp README.txt "s3://$BUCKET_NAME/pypi/" 2>/dev/null || echo "README.txt not uploaded (not critical)"

echo "Successfully uploaded pulp_library.zip to s3://$BUCKET_NAME/pypi/"
