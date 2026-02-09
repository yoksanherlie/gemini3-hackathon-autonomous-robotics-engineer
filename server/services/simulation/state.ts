// Session State Store - In-memory storage with TTL cleanup

import {
  SessionState,
  PhysicsConfig,
  MotorParams,
  SimulationRun,
  DEFAULT_PHYSICS,
  DEFAULT_MOTOR_PARAMS,
  HEXAPOD_JOINTS,
  DronePhysicsConfig,
  QUADCOPTER_ROTORS
} from './types';

// ============================================
// Drone Defaults
// ============================================

export const DEFAULT_DRONE_PHYSICS: DronePhysicsConfig = {
  air_density: 1.225,
  wind_speed: 2.0,
  wind_direction: 180,
  airspace_condition: 'light_wind'
};

export const DEFAULT_ROTOR_PARAMS = {
  max_rpm: 8000,
  min_rpm: 1000,
  response_time: 0.05  // seconds
};

export const DEFAULT_DRONE_MOTOR_PARAMS = {
  kv_rating: 2300,      // RPM per volt
  max_current: 25,      // Amps
  efficiency: 0.85      // 85%
};

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class InMemoryStateStore {
  private sessions: Map<string, SessionState> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanup();
  }

  /**
   * Get or create a session state
   */
  getOrCreate(sessionId: string): SessionState {
    let session = this.sessions.get(sessionId);

    if (!session) {
      session = this.createDefaultSession(sessionId);
      this.sessions.set(sessionId, session);
      console.log(`[StateStore] Created new session: ${sessionId}`);
    } else {
      session.last_accessed = Date.now();
    }

    return session;
  }

  /**
   * Get a session if it exists
   */
  get(sessionId: string): SessionState | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.last_accessed = Date.now();
    }
    return session;
  }

  /**
   * Update physics configuration for a session
   */
  updatePhysics(sessionId: string, physics: Partial<PhysicsConfig>): PhysicsConfig {
    const session = this.getOrCreate(sessionId);
    session.physics = { ...session.physics, ...physics };
    console.log(`[StateStore] Updated physics for ${sessionId}:`, session.physics);
    return session.physics;
  }

  /**
   * Update motor parameters for a joint
   */
  updateMotor(sessionId: string, jointId: string, params: Partial<MotorParams>): MotorParams {
    const session = this.getOrCreate(sessionId);

    const existing = session.motors.get(jointId) || {
      joint_id: jointId,
      ...DEFAULT_MOTOR_PARAMS
    };

    const updated: MotorParams = { ...existing, ...params, joint_id: jointId };
    session.motors.set(jointId, updated);

    console.log(`[StateStore] Updated motor ${jointId} for ${sessionId}:`, updated);
    return updated;
  }

  /**
   * Add a simulation run to the session
   */
  addRun(sessionId: string, run: SimulationRun): void {
    const session = this.getOrCreate(sessionId);
    session.runs.push(run);
    session.current_run = run;

    // Keep only last 10 runs to avoid memory bloat
    if (session.runs.length > 10) {
      session.runs = session.runs.slice(-10);
    }

    console.log(`[StateStore] Added run ${run.run_id} for ${sessionId}`);
  }

  /**
   * Get the latest run for a session
   */
  getLatestRun(sessionId: string): SimulationRun | undefined {
    const session = this.get(sessionId);
    return session?.current_run || session?.runs[session.runs.length - 1];
  }

  /**
   * Get a specific run by ID
   */
  getRun(sessionId: string, runId: string): SimulationRun | undefined {
    const session = this.get(sessionId);
    return session?.runs.find(r => r.run_id === runId);
  }

  /**
   * Delete a session
   */
  delete(sessionId: string): boolean {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      console.log(`[StateStore] Deleted session: ${sessionId}`);
    }
    return deleted;
  }

  /**
   * Get session count for monitoring
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Clean up expired sessions
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions) {
      if (now - session.last_accessed > SESSION_TTL_MS) {
        this.sessions.delete(sessionId);
        cleaned++;
        console.log(`[StateStore] Cleaned up expired session: ${sessionId}`);
      }
    }

    if (cleaned > 0) {
      console.log(`[StateStore] Cleaned ${cleaned} expired sessions. Active: ${this.sessions.size}`);
    }

    return cleaned;
  }

  /**
   * Start periodic cleanup
   */
  private startCleanup(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);

    // Don't prevent process exit
    this.cleanupInterval.unref();
  }

  /**
   * Stop cleanup (for graceful shutdown)
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Create a default session state
   */
  private createDefaultSession(sessionId: string): SessionState {
    const motors = new Map<string, MotorParams>();

    // Initialize all hexapod joints with default params
    for (const jointId of HEXAPOD_JOINTS) {
      motors.set(jointId, {
        joint_id: jointId,
        ...DEFAULT_MOTOR_PARAMS
      });
    }

    return {
      session_id: sessionId,
      created_at: Date.now(),
      last_accessed: Date.now(),
      physics: { ...DEFAULT_PHYSICS },
      motors,
      runs: []
    };
  }
}

// Singleton instance
export const stateStore = new InMemoryStateStore();
