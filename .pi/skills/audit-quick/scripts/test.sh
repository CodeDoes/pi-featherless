#!/bin/bash

# Find test files and run tests

# Check for standard test runners
if [ -f "package.json" ]; then
  # npm test
  if grep -q '"test"' package.json; then
    echo "Running npm test..."
    npm test -- --bail
    return $?
  fi

  # jest
  if command -v jest &> /dev/null; then
    echo "Running Jest..."
    jest --silent --coverage --bail
    return $?
  fi

  # vitest
  if [ -f "vitest.config.*" ] || command -v vitest &> /dev/null; then
    echo "Running Vitest..."
    vitest run --silent
    return $?
  fi

  # jest (global)
  if command -v jest &> /dev/null; then
    echo "Running Jest (global)..."
    jest --silent --coverage --bail
    return $?
  fi
fi

# Try finding test files
TEST_FILES=$(find . -name "*-test.js" -o -name "*-test.ts" -o -name "* test.ts" -o -name "* test.js" -o -path "*/test/**/*" | grep -v node_modules | grep -v ".pi")

if [ -z "$TEST_FILES" ]; then
  echo "⚠️  No test files found"
  echo "   Create test files or configure a test runner in package.json"
  return 0
fi

echo "Running tests manually on found test files..."
for file in $TEST_FILES; do
  echo "   Testing: $file"
  if [ -f "$file" ]; then
    if [[ "$file" == *.ts || "$file" == *.tsx ]]; then
      npx tsx "$file" < /dev/null || echo "✗ Failed: $file"
    else
      node "$file" < /dev/null || echo "✗ Failed: $file"
    fi
  fi
done

echo "✅ Manual test run complete"