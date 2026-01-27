/**
 * Context Management Module
 *
 * Provides coordination mechanisms for parallel agent execution:
 * - File reservation: Prevents concurrent writes to the same file
 * - Change tracking: Keeps agents informed of recent filesystem changes
 * - Filesystem context: Per-filesystem-hex read tracking and staleness detection
 */

export { fileReservationManager, type FileReservation, type ClaimResult } from './file-reservation';
export { changeTracker, type FileChange } from './change-tracker';
export {
  filesystemContextManager,
  type FileReadRecord,
  type StalenessResult,
  type ReadBeforeWriteResult,
} from './filesystem-context-manager';

