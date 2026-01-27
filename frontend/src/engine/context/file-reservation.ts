/**
 * File Reservation Manager - Prevents concurrent writes to the same file
 *
 * When multiple agents work in parallel on the same filesystem, they may
 * attempt to write to the same file simultaneously. This manager provides
 * a lightweight locking mechanism to prevent conflicts.
 *
 * Features:
 * - Claim files before writing
 * - Auto-expire claims after timeout (prevents deadlocks)
 * - Track who has claimed each file
 */

export interface FileReservation {
  agentId: string;
  agentName: string;
  filePath: string;
  operation: string;
  timestamp: Date;
}

export interface ClaimResult {
  success: boolean;
  error?: string;
  claimedBy?: FileReservation;
}

// Default claim timeout: 2 minutes
const DEFAULT_CLAIM_TIMEOUT_MS = 2 * 60 * 1000;

class FileReservationManager {
  private claims: Map<string, FileReservation> = new Map();
  private claimTimeoutMs: number;

  constructor(claimTimeoutMs: number = DEFAULT_CLAIM_TIMEOUT_MS) {
    this.claimTimeoutMs = claimTimeoutMs;
  }

  /**
   * Normalize a file path for consistent lookups
   */
  private normalizePath(path: string): string {
    // Remove trailing slashes, normalize to absolute-ish path
    return path.replace(/\/+$/, '').replace(/\/+/g, '/');
  }

  /**
   * Check if a claim has expired
   */
  private isExpired(reservation: FileReservation): boolean {
    const age = Date.now() - reservation.timestamp.getTime();
    return age > this.claimTimeoutMs;
  }

  /**
   * Clean up expired claims
   */
  private cleanupExpiredClaims(): void {
    const expiredPaths: string[] = [];
    for (const [path, reservation] of this.claims.entries()) {
      if (this.isExpired(reservation)) {
        expiredPaths.push(path);
      }
    }
    for (const path of expiredPaths) {
      console.log(`[FileReservation] Auto-releasing expired claim: ${path}`);
      this.claims.delete(path);
    }
  }

  /**
   * Attempt to claim a file for writing.
   * Returns success if the file is unclaimed or claimed by the same agent.
   * Returns error with claim info if claimed by another agent.
   */
  claim(
    filePath: string,
    agentId: string,
    agentName: string,
    operation: string
  ): ClaimResult {
    this.cleanupExpiredClaims();

    const normalizedPath = this.normalizePath(filePath);
    const existingClaim = this.claims.get(normalizedPath);

    // If already claimed by same agent, update the claim
    if (existingClaim && existingClaim.agentId === agentId) {
      existingClaim.timestamp = new Date();
      existingClaim.operation = operation;
      return { success: true };
    }

    // If claimed by another agent, return error
    if (existingClaim) {
      const ageSeconds = Math.floor((Date.now() - existingClaim.timestamp.getTime()) / 1000);
      return {
        success: false,
        error: `File "${filePath}" is currently being modified by ${existingClaim.agentName} (${existingClaim.operation}, ${ageSeconds}s ago). Wait for them to finish or choose a different file.`,
        claimedBy: existingClaim,
      };
    }

    // Claim the file
    const reservation: FileReservation = {
      agentId,
      agentName,
      filePath: normalizedPath,
      operation,
      timestamp: new Date(),
    };
    this.claims.set(normalizedPath, reservation);
    console.log(`[FileReservation] ${agentName} claimed: ${normalizedPath} (${operation})`);
    return { success: true };
  }

  /**
   * Release a claim on a file.
   * Only the agent that claimed it can release it.
   */
  release(filePath: string, agentId: string): boolean {
    const normalizedPath = this.normalizePath(filePath);
    const existingClaim = this.claims.get(normalizedPath);

    if (!existingClaim) {
      return true; // Already released
    }

    if (existingClaim.agentId !== agentId) {
      console.warn(`[FileReservation] Agent ${agentId} tried to release claim owned by ${existingClaim.agentId}`);
      return false;
    }

    this.claims.delete(normalizedPath);
    console.log(`[FileReservation] Released: ${normalizedPath}`);
    return true;
  }

  /**
   * Get all current claims (for debugging/UI)
   */
  getAllClaims(): FileReservation[] {
    this.cleanupExpiredClaims();
    return Array.from(this.claims.values());
  }

  /**
   * Check if a file is claimed (without claiming it)
   */
  isFileClaimed(filePath: string): FileReservation | null {
    this.cleanupExpiredClaims();
    const normalizedPath = this.normalizePath(filePath);
    return this.claims.get(normalizedPath) || null;
  }

  /**
   * Clear all claims (useful for board stop/reset)
   */
  clearAll(): void {
    console.log(`[FileReservation] Clearing all claims (${this.claims.size} claims)`);
    this.claims.clear();
  }
}

// Singleton instance
export const fileReservationManager = new FileReservationManager();

