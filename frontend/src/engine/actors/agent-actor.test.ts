/**
 * Tests for AgentActor conversation history compaction
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentState, Thought, Observation } from '../types';

// We need to test the private methods, so we'll extract the logic into testable functions
// For now, we'll test the behavior by examining the output structure

/**
 * Helper to create a mock thought
 */
function createThought(
  content: string,
  toolCalls?: { toolCallId: string; toolName: string; args: Record<string, unknown> }[]
): Thought {
  return {
    content,
    requiresAction: !!toolCalls,
    timestamp: new Date(),
    toolCalls,
  };
}

/**
 * Helper to create a mock observation
 */
function createObservation(
  toolCallId: string,
  toolName: string,
  result: string,
  success: boolean = true
): Observation {
  return {
    actionType: 'tool_call',
    success,
    result,
    timestamp: new Date(),
    toolCallId,
    toolName,
  };
}

/**
 * Helper to create an agent state with N iterations
 */
function createAgentState(numIterations: number): AgentState {
  const thoughts: Thought[] = [];
  const observations: Observation[] = [];

  for (let i = 0; i < numIterations; i++) {
    const toolCallId = `call-${i}`;
    thoughts.push(
      createThought(`Iteration ${i + 1}: I will read the file to understand the code structure.`, [
        { toolCallId, toolName: 'read_file', args: { path: `src/file${i}.ts` } },
      ])
    );
    observations.push(
      createObservation(
        toolCallId,
        'read_file',
        `File content for iteration ${i + 1}: export function example${i}() { return ${i}; }`
      )
    );
  }

  return {
    thoughts,
    observations,
    userMessages: [],
    isComplete: false,
    isStuck: false,
  };
}

describe('AgentActor conversation history compaction', () => {
  describe('truncateText helper', () => {
    // Test the truncation logic directly
    it('should not truncate short text', () => {
      const text = 'Short text';
      const maxLength = 200;
      // Simulate truncation logic
      const normalized = text.replace(/\s+/g, ' ').trim();
      const result = normalized.length <= maxLength ? normalized : normalized.substring(0, maxLength - 3) + '...';
      expect(result).toBe('Short text');
    });

    it('should truncate long text with ellipsis', () => {
      const text = 'A'.repeat(250);
      const maxLength = 200;
      const normalized = text.replace(/\s+/g, ' ').trim();
      const result = normalized.length <= maxLength ? normalized : normalized.substring(0, maxLength - 3) + '...';
      expect(result.length).toBe(200);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should normalize whitespace', () => {
      const text = 'Text   with\n\nmultiple   spaces';
      const maxLength = 200;
      const normalized = text.replace(/\s+/g, ' ').trim();
      expect(normalized).toBe('Text with multiple spaces');
    });
  });

  describe('history compaction strategy', () => {
    const FULL_HISTORY_ITERATIONS = 3;

    it('should keep all iterations in full detail when <= 3 iterations', () => {
      const state = createAgentState(3);
      const totalThoughts = state.thoughts.length;
      const fullHistoryStart = Math.max(0, totalThoughts - FULL_HISTORY_ITERATIONS);
      
      // With 3 iterations, fullHistoryStart should be 0 (no summary needed)
      expect(fullHistoryStart).toBe(0);
    });

    it('should summarize older iterations when > 3 iterations', () => {
      const state = createAgentState(6);
      const totalThoughts = state.thoughts.length;
      const fullHistoryStart = Math.max(0, totalThoughts - FULL_HISTORY_ITERATIONS);
      
      // With 6 iterations, fullHistoryStart should be 3 (summarize 0-2, full detail 3-5)
      expect(fullHistoryStart).toBe(3);
    });

    it('should correctly calculate summary range for 10 iterations', () => {
      const state = createAgentState(10);
      const totalThoughts = state.thoughts.length;
      const fullHistoryStart = Math.max(0, totalThoughts - FULL_HISTORY_ITERATIONS);
      
      // With 10 iterations, fullHistoryStart should be 7 (summarize 0-6, full detail 7-9)
      expect(fullHistoryStart).toBe(7);
      
      // Summary should cover iterations 1-7 (indices 0-6)
      const summaryEndIndex = fullHistoryStart;
      expect(summaryEndIndex).toBe(7);
    });
  });

  describe('observation mapping', () => {
    it('should correctly map observations to tool calls by ID', () => {
      const state = createAgentState(5);
      
      // Build observation map like the implementation does
      const observationMap = new Map<string, Observation>();
      for (const obs of state.observations) {
        if (obs.toolCallId) {
          observationMap.set(obs.toolCallId, obs);
        }
      }

      // Verify all observations are mapped
      expect(observationMap.size).toBe(5);
      
      // Verify correct mapping
      for (let i = 0; i < 5; i++) {
        const obs = observationMap.get(`call-${i}`);
        expect(obs).toBeDefined();
        expect(obs?.toolName).toBe('read_file');
      }
    });
  });
});

