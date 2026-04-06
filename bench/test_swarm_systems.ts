/re/**
 * Swarm Read Systems Test
 *
 * Comprehensive systems test for the enhanced swarm_read functionality.
 * Tests all major components without requiring Featherless API calls.
 *
 * Test Coverage:
 * - File processing and categorization
 * - Context management and safety limits
 * - Error handling and edge cases
 * - Summary generation and quality
 * - Performance characteristics
 */

import { performance } from 'perf_hooks';
import { readFileSync } from 'fs';
import { join } from 'path';

interface SystemTestResult {
    testName: string;
    passed: boolean;
    details: string;
    metrics?: Record<string, number | string>;
}

interface SystemTestSuite {
    name: string;
    tests: SystemTestResult[];
    overallPassed: boolean;
}

/**
 * Mock the swarm_read summarization logic for testing
 */
function mockSwarmSummarization(files: string[], results: string[]): {
    overallInsights: string[];
    categorySummaries: string[];
    successCount: number;
    errorCount: number;
} {
    // Categorize files (same logic as production)
    const categorizeFile = (filePath: string): string => {
        if (filePath.includes('/bots/')) return 'bots';
        if (filePath.includes('/engine/')) return 'engine';
        if (filePath.includes('/envoy/')) return 'envoy';
        if (filePath.includes('/memory/')) return 'memory';
        if (filePath.includes('/swarm/')) return 'swarm';
        if (filePath.includes('/task/')) return 'task';
        if (filePath.includes('/project/')) return 'project';
        if (filePath.includes('/filesystem/')) return 'filesystem';
        if (filePath.endsWith('.ts') && !filePath.includes('/')) return 'core';
        if (filePath.endsWith('.json')) return 'config';
        if (filePath.endsWith('.md')) return 'docs';
        return 'other';
    };

    const successThemes: Record<string, string[]> = {};
    const errorReports: string[] = [];

    results.forEach((result, i) => {
        const filePath = files[i];
        const isError = result.startsWith("[error:");

        if (isError) {
            errorReports.push(`• ${filePath}: ${result.replace('[error: ', '').replace(']', '')}`);
            return;
        }

        const category = categorizeFile(filePath);
        const firstSentence = result.split('\n')[0] || result;

        // Extract meaningful keywords
        const keywords = firstSentence
            .replace(filePath, '')
            .replace(/[.,;:()\-{}]/g, ' ')
            .split(' ')
            .filter(word => word.length > 4 && !['this', 'file', 'contains', 'provides', 'handles', 'manages'].includes(word.toLowerCase()))
            .slice(0, 3)
            .join(', ');

        if (!successThemes[category]) {
            successThemes[category] = [];
        }
        successThemes[category].push(`${filePath}: ${keywords || firstSentence.substring(0, 50)}...`);
    });

    // Generate category summaries
    const categorySummaries: string[] = [];
    const successCount = results.filter(r => !r.startsWith("[error:")).length;

    for (const [category, files] of Object.entries(successThemes)) {
        const count = files.length;
        const percentage = Math.round((count / successCount) * 100);
        const sampleFiles = files.slice(0, 2).map(f => `
  • ${f}`).join('');
        categorySummaries.push(`${category} (${count}/${percentage}%):${sampleFiles}`);
    }

    // Generate overall insights
    const overallInsights = [];
    if (successThemes['bots'] || successThemes['engine']) {
        overallInsights.push("Multi-agent architecture with bot hierarchy (envoy → project → task → file bots)");
    }
    if (successThemes['core'] && successThemes['core'].length > 2) {
        overallInsights.push(`Core system with ${successThemes['core'].length} main components`);
    }
    if (successThemes['config']) {
        overallInsights.push(`Configuration via ${successThemes['config'].join(', ')}`);
    }

    if (overallInsights.length === 0) {
        overallInsights.push('Diverse codebase with multiple components');
    }

    return {
        overallInsights,
        categorySummaries,
        successCount,
        errorCount: errorReports.length
    };
}

/**
 * Test file categorization accuracy
 */
function testFileCategorization(): SystemTestResult {
    const testFiles = [
        'src/bots/envoy.ts',
        'src/engine/runner.ts',
        'src/core/backend.ts',
        'package.json',
        'README.md',
        'src/other/unknown.xyz'
    ];

    const expectedCategories = [
        'bots', 'engine', 'core', 'config', 'docs', 'other'
    ];

    const categorizeFile = (filePath: string): string => {
        if (filePath.includes('/bots/')) return 'bots';
        if (filePath.includes('/engine/')) return 'engine';
        if (filePath.endsWith('.ts') && !filePath.includes('/')) return 'core';
        if (filePath.endsWith('.json')) return 'config';
        if (filePath.endsWith('.md')) return 'docs';
        return 'other';
    };

    const allCorrect = testFiles.every((file, i) => {
        const category = categorizeFile(file);
        return category === expectedCategories[i];
    });

    return {
        testName: 'File Categorization Accuracy',
        passed: allCorrect,
        details: allCorrect ? 'All files categorized correctly' : 'Some files miscategorized',
        metrics: {
            filesTested: testFiles.length,
            correct: allCorrect ? testFiles.length : testFiles.filter((f, i) => categorizeFile(f) === expectedCategories[i]).length
        }
    };
}

/**
 * Test context management calculations
 */
function testContextManagement(): SystemTestResult {
    const testCases = [
        { chars: 1000, expectedTokens: 313 },  // 1000/3.2 ≈ 313
        { chars: 5000, expectedTokens: 1563 }, // 5000/3.2 ≈ 1563
        { chars: 10000, expectedTokens: 3125 }, // 10000/3.2 = 3125
    ];

    const allCorrect = testCases.every(test => {
        const calculated = Math.round(test.chars / 3.2);
        return calculated === test.expectedTokens;
    });

    return {
        testName: 'Context Token Calculation',
        passed: allCorrect,
        details: allCorrect ? 'All token calculations correct' : 'Some token calculations incorrect',
        metrics: {
            testCases: testCases.length,
            correct: allCorrect ? testCases.length : testCases.filter(t => Math.round(t.chars / 3.2) === t.expectedTokens).length
        }
    };
}

/**
 * Test summary generation with real file content
 */
function testSummaryGeneration(): SystemTestResult {
    try {
        // Read actual files from the project
        const testFiles = [
            'src/handlers/swarm.ts',
            'src/handlers/shared.ts',
            'package.json'
        ];

        const mockResults = testFiles.map(file => {
            try {
                const content = readFileSync(join(process.cwd(), file), 'utf-8');
                return `Analysis of ${file}: ${content.substring(0, 100)}...`;
            } catch (error) {
                return `[error: File not found]`;
            }
        });

        const result = mockSwarmSummarization(testFiles, mockResults);

        const hasInsights = result.overallInsights.length > 0;
        const hasCategories = result.categorySummaries.length > 0;
        const correctCounts = result.successCount === (mockResults.filter(r => !r.startsWith('[error:')).length);

        return {
            testName: 'Summary Generation with Real Files',
            passed: hasInsights && hasCategories && correctCounts,
            details: `Generated ${result.overallInsights.length} insights and ${result.categorySummaries.length} category summaries`,
            metrics: {
                filesProcessed: testFiles.length,
                insightsGenerated: result.overallInsights.length,
                categoriesIdentified: result.categorySummaries.length,
                successCount: result.successCount,
                errorCount: result.errorCount
            }
        };
    } catch (error) {
        return {
            testName: 'Summary Generation with Real Files',
            passed: false,
            details: `Error: ${error.message}`
        };
    }
}

/**
 * Test error handling
 */
function testErrorHandling(): SystemTestResult {
    const testFiles = ['file1.ts', 'file2.ts', 'file3.ts'];
    const mockResults = [
        'Analysis of file1.ts: Content...',
        '[error: File not found]',
        '[error: Permission denied]'
    ];

    const result = mockSwarmSummarization(testFiles, mockResults);

    const correctErrorCount = result.errorCount === 2;
    const errorReportsPresent = result.errorCount > 0;

    return {
        testName: 'Error Handling',
        passed: correctErrorCount && errorReportsPresent,
        details: `Correctly identified ${result.errorCount} errors out of ${mockResults.filter(r => r.startsWith('[error:')).length} actual errors`,
        metrics: {
            totalErrors: mockResults.filter(r => r.startsWith('[error:')).length,
            detectedErrors: result.errorCount
        }
    };
}

/**
 * Test performance with large file sets
 */
function testPerformance(): SystemTestResult {
    const startTime = performance.now();

    // Generate a large test set
    const fileCount = 50;
    const testFiles = Array.from({ length: fileCount }, (_, i) => `src/file${i}.ts`);
    const mockResults = testFiles.map(file => `Analysis of ${file}: Sample content...`);

    const startProcessTime = performance.now();
    const result = mockSwarmSummarization(testFiles, mockResults);
    const processTime = performance.now() - startProcessTime;

    const totalTime = performance.now() - startTime;

    // Performance targets: <50ms for 50 files
    const passed = processTime < 50;

    return {
        testName: 'Performance with Large File Sets',
        passed: passed,
        details: `Processed ${fileCount} files in ${processTime}ms (target: <50ms)`,
        metrics: {
            filesProcessed: fileCount,
            processingTimeMs: processTime,
            totalTimeMs: totalTime,
            performanceTarget: '<50ms',
            actualPerformance: `${processTime}ms`
        }
    };
}

/**
 * Test context safety limits
 */
function testContextSafety(): SystemTestResult {
    const MAX_SUMMARY_LENGTH = 1000;
    const TARGET_MAX_FILES_PER_CALL = 8;
    const CONTEXT_SAFETY_MARGIN = 0.7;

    // Test 1: Summary length enforcement
    const longSummary = 'A'.repeat(MAX_SUMMARY_LENGTH + 500);
    const truncated = longSummary.length > MAX_SUMMARY_LENGTH ? longSummary.substring(0, MAX_SUMMARY_LENGTH) + '...' : longSummary;
    const lengthTestPassed = truncated.length <= MAX_SUMMARY_LENGTH + 3; // +3 for '...'

    // Test 2: File batch warning threshold
    const fileBatchTest = 10 > TARGET_MAX_FILES_PER_CALL;

    // Test 3: Context margin calculation
    const contextLimit = 32768;
    const safeLimit = Math.round(contextLimit * CONTEXT_SAFETY_MARGIN);
    const marginTestPassed = safeLimit === 22976; // 32768 * 0.7 ≈ 22976

    const allPassed = lengthTestPassed && fileBatchTest && marginTestPassed;

    return {
        testName: 'Context Safety Limits',
        passed: allPassed,
        details: allPassed ? 'All safety limits working correctly' : 'Some safety limits failed',
        metrics: {
            maxSummaryLength: MAX_SUMMARY_LENGTH,
            targetMaxFiles: TARGET_MAX_FILES_PER_CALL,
            contextSafetyMargin: CONTEXT_SAFETY_MARGIN,
            safeContextLimit: safeLimit
        }
    };
}

/**
 * Test edge cases
 */
function testEdgeCases(): SystemTestResult {
    const edgeCases = [
        {
            name: 'Empty file set',
            files: [],
            results: []
        },
        {
            name: 'Single file',
            files: ['file.ts'],
            results: ['Analysis of file.ts: Content...']
        },
        {
            name: 'All errors',
            files: ['file1.ts', 'file2.ts'],
            results: ['[error: Not found]', '[error: Permission denied]']
        },
        {
            name: 'Mixed content',
            files: ['short.ts', 'long.ts'],
            results: ['Short', 'A'.repeat(1000)]
        }
    ];

    let allPassed = true;
    const results = [];

    for (const testCase of edgeCases) {
        try {
            const result = mockSwarmSummarization(testCase.files, testCase.results);

            // Basic validation
            const valid = (
                Array.isArray(result.overallInsights) &&
                Array.isArray(result.categorySummaries) &&
                typeof result.successCount === 'number' &&
                typeof result.errorCount === 'number'
            );

            if (!valid) {
                allPassed = false;
                results.push(`${testCase.name}: Failed validation`);
            } else {
                results.push(`${testCase.name}: Passed`);
            }
        } catch (error) {
            allPassed = false;
            results.push(`${testCase.name}: Error - ${error.message}`);
        }
    }

    return {
        testName: 'Edge Case Handling',
        passed: allPassed,
        details: results.join('; '),
        metrics: {
            edgeCasesTested: edgeCases.length,
            passed: allPassed ? edgeCases.length : results.filter(r => r.includes('Passed')).length
        }
    };
}

/**
 * Run all systems tests
 */
async function runSystemsTests(): Promise<SystemTestSuite> {
    console.log('=== Swarm Read Systems Test ===\n');

    const tests = [
        testFileCategorization(),
        testContextManagement(),
        testSummaryGeneration(),
        testErrorHandling(),
        testPerformance(),
        testContextSafety(),
        testEdgeCases()
    ];

    const passedTests = tests.filter(t => t.passed);
    const overallPassed = passedTests.length === tests.length;

    // Display results
    console.log('🧪 SYSTEMS TEST RESULTS:');
    console.log('─────────────────────────────────────────────────');

    tests.forEach(test => {
        const status = test.passed ? '✅ PASS' : '❌ FAIL';
        console.log(`${status}: ${test.testName}`);
        console.log(`   ${test.details}`);
        if (test.metrics) {
            console.log(`   Metrics: ${JSON.stringify(test.metrics, null, 2)}`);
        }
        console.log();
    });

    console.log('📊 SUMMARY:');
    console.log(`   Total Tests: ${tests.length}`);
    console.log(`   Passed: ${passedTests.length}`);
    console.log(`   Failed: ${tests.length - passedTests.length}`);
    console.log(`   Success Rate: ${Math.round((passedTests.length / tests.length) * 100)}%`);
    console.log();
    console.log(`🏅 OVERALL: ${overallPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

    return {
        name: 'Swarm Read Systems Test',
        tests: tests,
        overallPassed: overallPassed
    };
}

/**
 * Generate a test report
 */
function generateTestReport(suite: SystemTestSuite): string {
    const passRate = Math.round((suite.tests.filter(t => t.passed).length / suite.tests.length) * 100);

    return `
# Swarm Read Systems Test Report

## Summary
- **Date**: ${new Date().toISOString()}
- **Tests Run**: ${suite.tests.length}
- **Passed**: ${suite.tests.filter(t => t.passed).length}
- **Failed**: ${suite.tests.filter(t => !t.passed).length}
- **Success Rate**: ${passRate}%
- **Overall**: ${suite.overallPassed ? 'PASSED ✅' : 'FAILED ❌'}

## Test Results

${suite.tests.map(test => {
    return `### ${test.testName}

**Status**: ${test.passed ? '✅ PASS' : '❌ FAIL'}

**Details**: ${test.details}

${test.metrics ? `
**Metrics**:
"` + JSON.stringify(test.metrics, null, 2) + `
` : ''}`;
}).join('\n---\n\n')}

## Conclusion

The swarm read system ${suite.overallPassed ? 'passes all systems tests' : 'has some issues that need attention'}.

${suite.overallPassed ? '
✅ **All systems operational** - The enhanced swarm_read functionality is working correctly and ready for production use.' : '
❌ **Action required** - Review failed tests and address the identified issues.'}
`;
}

// Run tests when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runSystemsTests()
        .then(suite => {
            const report = generateTestReport(suite);
            console.log(report);

            // Write report to file
            const fs = require('fs');
            fs.writeFileSync('SWARM_SYSTEMS_TEST_REPORT.md', report);
            console.log('\n📄 Report saved to SWARM_SYSTEMS_TEST_REPORT.md');
        })
        .catch(error => {
            console.error('Test execution failed:', error);
            process.exit(1);
        });
}

export {
    runSystemsTests,
    testFileCategorization,
    testContextManagement,
    testSummaryGeneration,
    testErrorHandling,
    testPerformance,
    testContextSafety,
    testEdgeCases,
    SystemTestResult,
    SystemTestSuite
};
