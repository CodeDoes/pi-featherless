#!/bin/bash

echo "🔍 Running complete project audit..."
echo ""

# Track overall status
ALL_PASS=true

# 1. Lint
echo "📚 Checking code quality (lint)..."
if ./scripts/lint.sh; then
  echo "✅ Lint passed"
else
  echo "❌ Lint failed"
  ALL_PASS=false
fi
echo ""

# 2. Format
echo "📐 Checking code formatting..."
if ./scripts/format.sh; then
  echo "✅ Format passed"
else
  echo "❌ Format failed"
  ALL_PASS=false
fi
echo ""

# 3. Types
echo "🔬 Checking TypeScript types..."
if ./scripts/types.sh; then
  echo "✅ Types passed"
else
  echo "❌ Types failed"
  ALL_PASS=false
fi
echo ""

# 4. Test
echo "🧪 Running tests..."
if ./scripts/test.sh; then
  echo "✅ Tests passed"
else
  echo "❌ Tests failed"
  ALL_PASS=false
fi
echo ""

# Summary
if [ "$ALL_PASS" = true ]; then
  echo "🎉 All checks passed!"
else
  echo "⚠️  Some checks failed. Please review the output above."
fi