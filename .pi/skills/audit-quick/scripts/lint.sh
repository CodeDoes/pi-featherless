#!/bin/bash

# Find linting config files
if [ -f "package.json" ]; then
  if grep -q '"eslint"' package.json; then
    echo "Running ESLint..."
    npx eslint src/ --max-warnings=0 --format=compact
  elif grep -q '"eslintConfig"' package.json; then
    echo "Running ESLint..."
    npx eslint src/ --max-warnings=0 --format=compact
  elif command -v eslint &> /dev/null; then
    echo "Running ESLint (global)..."
    eslint src/ --max-warnings=0 --format=compact
  fi
fi

if [ -n "$(ls -A *.js *.jsx *.ts *.tsx 2>/dev/null)" ]; then
  echo "No package.json found, checking for .eslintrc..."
  if ! command -v eslint &> /dev/null; then
    echo "⚠️  ESLint not found. Install with: npm install -D eslint"
    return 1
  fi
  eslint . --ext .js,.jsx,.ts,.tsx --max-warnings=0 --format=compact
fi

# Try other linters
if grep -q '"stylelint"' package.json; then
  echo "Running Stylelint..."
  npx stylelint "**/*.{css,scss,less,html}" --format=compact
fi

echo "✅ Lint check complete"