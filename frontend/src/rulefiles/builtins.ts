/**
 * Built-in Rulefiles - Pre-defined rulefiles for common use cases
 */

import { Rulefile, Rule } from './types';

const now = new Date();

// Helper to create a rule
const rule = (id: string, name: string, content: string, priority = 0): Rule => ({
  id,
  name,
  description: '',
  content,
  priority,
  enabled: true,
});

/**
 * TypeScript Coding Standards
 */
const typescriptRulefile: Rulefile = {
  id: 'builtin-typescript',
  name: 'TypeScript Standards',
  description: 'Best practices and coding standards for TypeScript development',
  version: '1.0.0',
  category: 'coding',
  tags: ['typescript', 'javascript', 'coding'],
  createdAt: now,
  updatedAt: now,
  isBuiltin: true,
  rules: [
    rule('ts-strict', 'Strict Mode', 'Always use TypeScript strict mode. Enable all strict compiler options.', 10),
    rule('ts-interfaces', 'Prefer Interfaces', 'Prefer interfaces over types for object shapes. Use types for unions, intersections, and mapped types.'),
    rule('ts-explicit', 'Explicit Types', 'Use explicit return types for public functions. Avoid `any` - use `unknown` when type is truly unknown.'),
    rule('ts-null', 'Null Safety', 'Use strict null checks. Prefer optional chaining (?.) and nullish coalescing (??) over manual null checks.'),
  ],
  content: `# TypeScript Standards

## Strict Mode
Always use TypeScript strict mode. Enable all strict compiler options.

## Prefer Interfaces
Prefer interfaces over types for object shapes. Use types for unions, intersections, and mapped types.

## Explicit Types
Use explicit return types for public functions. Avoid \`any\` - use \`unknown\` when type is truly unknown.

## Null Safety
Use strict null checks. Prefer optional chaining (?.) and nullish coalescing (??) over manual null checks.`,
};

/**
 * Code Review Guidelines
 */
const codeReviewRulefile: Rulefile = {
  id: 'builtin-code-review',
  name: 'Code Review',
  description: 'Guidelines for thorough and constructive code reviews',
  version: '1.0.0',
  category: 'quality',
  tags: ['review', 'quality', 'pr'],
  createdAt: now,
  updatedAt: now,
  isBuiltin: true,
  rules: [
    rule('review-focus', 'Review Focus', 'Focus on: correctness, edge cases, error handling, security, performance, readability.', 10),
    rule('review-constructive', 'Be Constructive', 'Provide specific, actionable feedback. Explain why changes are needed, not just what to change.'),
    rule('review-tests', 'Verify Tests', 'Ensure adequate test coverage. Check that tests actually test the intended behavior.'),
    rule('review-security', 'Security Check', 'Look for: SQL injection, XSS, CSRF, auth bypasses, secrets in code, insecure dependencies.'),
  ],
  content: `# Code Review Guidelines

## Review Focus
Focus on: correctness, edge cases, error handling, security, performance, readability.

## Be Constructive
Provide specific, actionable feedback. Explain why changes are needed, not just what to change.

## Verify Tests
Ensure adequate test coverage. Check that tests actually test the intended behavior.

## Security Check
Look for: SQL injection, XSS, CSRF, auth bypasses, secrets in code, insecure dependencies.`,
};

/**
 * Git Workflow
 */
const gitWorkflowRulefile: Rulefile = {
  id: 'builtin-git-workflow',
  name: 'Git Workflow',
  description: 'Git conventions for commits, branches, and PRs',
  version: '1.0.0',
  category: 'process',
  tags: ['git', 'workflow', 'commits'],
  createdAt: now,
  updatedAt: now,
  isBuiltin: true,
  rules: [
    rule('git-commits', 'Commit Messages', 'Use conventional commits: feat:, fix:, docs:, refactor:, test:, chore:. Keep subject under 72 chars.', 10),
    rule('git-branches', 'Branch Names', 'Use descriptive branch names: feature/add-login, fix/null-pointer, refactor/auth-module.'),
    rule('git-small', 'Small PRs', 'Keep PRs small and focused. One logical change per PR. Makes review easier and safer to deploy.'),
  ],
  content: `# Git Workflow

## Commit Messages
Use conventional commits: feat:, fix:, docs:, refactor:, test:, chore:. Keep subject under 72 chars.

## Branch Names
Use descriptive branch names: feature/add-login, fix/null-pointer, refactor/auth-module.

## Small PRs
Keep PRs small and focused. One logical change per PR. Makes review easier and safer to deploy.`,
};

/**
 * Security Guidelines
 */
const securityRulefile: Rulefile = {
  id: 'builtin-security',
  name: 'Security Guidelines',
  description: 'Security best practices for application development',
  version: '1.0.0',
  category: 'security',
  tags: ['security', 'auth', 'data'],
  createdAt: now,
  updatedAt: now,
  isBuiltin: true,
  rules: [
    rule('sec-secrets', 'No Secrets in Code', 'NEVER commit secrets, API keys, or credentials. Use environment variables or secret managers.', 10),
    rule('sec-input', 'Validate Input', 'Validate and sanitize ALL user input. Never trust client-side validation alone.'),
    rule('sec-auth', 'Auth & Authz', 'Implement proper authentication and authorization. Check permissions on every request.'),
    rule('sec-deps', 'Dependency Security', 'Keep dependencies updated. Run security audits regularly. Avoid unnecessary dependencies.'),
  ],
  content: `# Security Guidelines

## No Secrets in Code
NEVER commit secrets, API keys, or credentials. Use environment variables or secret managers.

## Validate Input
Validate and sanitize ALL user input. Never trust client-side validation alone.

## Auth & Authz
Implement proper authentication and authorization. Check permissions on every request.

## Dependency Security
Keep dependencies updated. Run security audits regularly. Avoid unnecessary dependencies.`,
};

/**
 * Concise Agent Persona
 */
const concisePersonaRulefile: Rulefile = {
  id: 'builtin-concise',
  name: 'Concise Communicator',
  description: 'Agent persona focused on brief, clear communication',
  version: '1.0.0',
  category: 'persona',
  tags: ['persona', 'communication', 'brief'],
  createdAt: now,
  updatedAt: now,
  isBuiltin: true,
  rules: [
    rule('concise-brief', 'Be Brief', 'Give concise answers. Avoid unnecessary preamble. Get to the point quickly.', 10),
    rule('concise-code', 'Code First', 'When asked for code, provide the code first, then explain if needed.'),
    rule('concise-ask', 'Ask When Unclear', 'If requirements are ambiguous, ask clarifying questions rather than assuming.'),
  ],
  content: `# Concise Communicator

## Be Brief
Give concise answers. Avoid unnecessary preamble. Get to the point quickly.

## Code First
When asked for code, provide the code first, then explain if needed.

## Ask When Unclear
If requirements are ambiguous, ask clarifying questions rather than assuming.`,
};

/**
 * Test-Driven Development
 */
const tddRulefile: Rulefile = {
  id: 'builtin-tdd',
  name: 'Test-Driven Development',
  description: 'Guidelines for TDD workflow',
  version: '1.0.0',
  category: 'quality',
  tags: ['testing', 'tdd', 'quality'],
  createdAt: now,
  updatedAt: now,
  isBuiltin: true,
  rules: [
    rule('tdd-first', 'Tests First', 'Write tests before implementation. Red -> Green -> Refactor.', 10),
    rule('tdd-unit', 'Unit Tests', 'Test small units in isolation. Mock dependencies. Fast execution.'),
    rule('tdd-coverage', 'Coverage Goals', 'Aim for high coverage on business logic. Don\'t test framework code.'),
    rule('tdd-names', 'Descriptive Names', 'Test names should describe behavior: "should return empty array when no items match".'),
  ],
  content: `# Test-Driven Development

## Tests First
Write tests before implementation. Red -> Green -> Refactor.

## Unit Tests
Test small units in isolation. Mock dependencies. Fast execution.

## Coverage Goals
Aim for high coverage on business logic. Don't test framework code.

## Descriptive Names
Test names should describe behavior: "should return empty array when no items match".`,
};

export const BUILTIN_RULEFILES: Rulefile[] = [
  typescriptRulefile,
  codeReviewRulefile,
  gitWorkflowRulefile,
  securityRulefile,
  concisePersonaRulefile,
  tddRulefile,
];

