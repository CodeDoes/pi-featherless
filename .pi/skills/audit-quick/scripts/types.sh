#!/bin/bash

# Type checking

echo "🔍 Checking TypeScript types..."

# Check if tsconfig exists
if [ ! -f "tsconfig.json" ] && [ ! -f "tsconfig.base.json" ]; then
  echo "⚠️  No tsconfig.json found"
  echo "   TypeScript not configured in this project"
  return 0
fi

# Check for node_modules/ts-node
if [ -d "node_modules/ts-node" ]; then
  echo "Running ts-node type check..."
  npx tsc --noEmit --project tsconfig.json 2>&1 | head -50
  return $?
fi

# TypeScript via npm script
if [ -f "package.json" ]; then
  if grep -q '"typeCheck"' package.json || grep -q '"check-types"' package.json; then
    if grep -q '"typeCheck": "tsc --noEmit"' package.json || grep -q '"check-types": "tsc --noEmit"' package.json; then
      echo "Running tsc type check..."
      npm run typeCheck -- --noEmit || true
      return $?
    fi
  fi
fi

# Try running tsc directly
if command -v tsc &> /dev/null; then
  echo "Running tsc directly..."
  tsc --noEmit --project tsconfig.json 2>&1 | head -50
  return $?
fi

echo "⚠️  TypeScript not installed"
echo "   Install with: npm install -D typescript"
return 0