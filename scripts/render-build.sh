#!/usr/bin/env bash
# Publishes only the public site files to dist/ (SQL, docs and server config stay out).
set -euo pipefail
rm -rf dist && mkdir -p dist
cp -r index.html admin.html superadmin.html privacy.html terms.html child-safety.html delete-account.html cookies.html licenses.html \
      manifest.webmanifest sw.js css js icons fonts dist/
echo "Published $(find dist -type f | wc -l) files"
