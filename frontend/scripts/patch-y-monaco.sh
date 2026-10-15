#!/bin/bash
# Post-install script to patch y-monaco for Next.js compatibility

echo "Patching y-monaco for Next.js..."

# Patch y-monaco to use correct monaco-editor import
if [ -f "node_modules/y-monaco/dist/y-monaco.cjs" ]; then
  sed -i "s|require('monaco-editor/esm/vs/editor/editor.api.js')|require('monaco-editor')|g" node_modules/y-monaco/dist/y-monaco.cjs
  echo "✓ Patched dist/y-monaco.cjs"
fi

if [ -f "node_modules/y-monaco/src/y-monaco.js" ]; then
  sed -i "s|'monaco-editor/esm/vs/editor/editor.api.js'|'monaco-editor'|g" node_modules/y-monaco/src/y-monaco.js
  echo "✓ Patched src/y-monaco.js"
fi

if [ -f "node_modules/y-monaco/dist/test.js" ]; then
  sed -i 's|"monaco-editor/esm/vs/editor/editor.api.js"|"monaco-editor"|g' node_modules/y-monaco/dist/test.js
  echo "✓ Patched dist/test.js"
fi

echo "✅ y-monaco patched successfully!"
