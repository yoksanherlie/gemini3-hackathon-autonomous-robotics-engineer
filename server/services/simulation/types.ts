// Simulation Service Type Definitions

export interface PhysicsConfig {
  gravity: number;           // m/s^2, default 9.81
  friction_coefficient: number;  // 0.0 to 1.0
  terrain_type: 'sand' | 'concrete' | 'grass' | 'gravel';
  terrain_roughness: number; // 0.0 to 1.0
}

export interface MotorParams {
  joint_id: string;
  torque_limit: number;      // Nm
  pid_p: number;             // Proportional gain
  pid_i: number;             // Integral gain
  pid_d: number;             // Derivative gain
  max_velocity: number;      // rad/s
}

export interface TelemetryFrame {
  timestamp: number;         // ms from simulation start
  joint_positions: Record<string, number>;   // radians
  joint_velocities: Record<string, number>;  // rad/s
  joint_torques: Record<string, number>;     // Nm
  imu: {
    pitch: number;           // degrees
    roll: number;            // degrees
    yaw: number;             // degrees
    accel_x: number;         // m/s^2
    accel_y: number;
    accel_z: number;
  };
  power: {
    voltage: number;         // V
    current: number;         // A
    temperature: number;     // Celsius
  };
  contacts: {
    leg_id: string;
    in_contact: boolean;
    force: number;           // N
    slip_detected: boolean;
  }[];
}

export interface SimulationEvent {
  timestamp: number;
  type: 'slip' | 'overheat' | 'collision' | 'gait_mismatch' | 'stability_warning' | 'rollover';
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  data?: Record<string, any>;
}

export interface SimulationRun {
  run_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at: number;
  completed_at?: number;
  duration_requested: number;
  duration_actual?: number;
  physics_config: PhysicsConfig;
  motor_configs: Map<string, MotorParams>;
  telemetry: TelemetryFrame[];
  events: SimulationEvent[];
  metrics?: SimulationMetrics;
  video_url?: string;
}

export interface SimulationMetrics {
  stability_score: number;        // 0-100
  efficiency_score: number;       // 0-100
  gait_symmetry: number;          // 0-1
  max_pitch_deviation: number;    // degrees
  max_roll_deviation: number;     // degrees
  slip_events: number;
  total_energy_consumed: number;  // Joules
  avg_joint_temperature: number;  // Celsius
}

export interface SessionState {
  session_id: string;
  created_at: number;
  last_accessed: number;
  physics: PhysicsConfig;
  motors: Map<string, MotorParams>;
  runs: SimulationRun[];
  current_run?: SimulationRun;
}

export interface ToolExecutionResult<T = any> {
  success: boolean;
  result?: T;
  error?: ToolError;
  executionTimeMs: number;
}

export interface ToolError {
  code: string;
  message: string;
  recoverable: boolean;
  details?: Record<string, any>;
}

// Tool-specific result types

export interface ConfigurePhysicsResult {
  status: 'success' | 'partial' | 'failed';
  message: string;
  applied_config: PhysicsConfig;
  warnings?: string[];
}

export interface UpdateMotorResult {
  status: 'success' | 'failed';
  message: string;
  joint_id: string;
  applied_params: Partial<MotorParams>;
}

export interface RunSimulationResult {
  run_id: string;
  status: 'completed' | 'failed' | 'interrupted';
  telemetry_summary: string;
  video_url: string;
  duration_actual: number;
  metrics: SimulationMetrics;
  events_summary?: string[];
}

export interface AnalyzeVideoResult {
  analysis: string;
  findings: string[];
  recommendations: string[];
  confidence: number;
  video_url?: string;
  frame_annotations?: {
    frame: number;
    annotation: string;
    confidence: number;
  }[];
}

export interface SearchKnowledgeBaseResult {
  query: string;
  results: {
    date: string;
    experiment: string;
    outcome: string;
    relevance_score: number;
    key_findings?: string[];
  }[];
  total_matches: number;
}

export interface StartAutonomousResearchResult {
  status: 'initiated' | 'failed';
  message: string;
  research_id?: string;
  max_iterations: number;
  success_criteria: string;
}

// Default configurations
export const DEFAULT_PHYSICS: PhysicsConfig = {
  gravity: 9.81,
  friction_coefficient: 0.5,
  terrain_type: 'concrete',
  terrain_roughness: 0.3
};

export const DEFAULT_MOTOR_PARAMS: Omit<MotorParams, 'joint_id'> = {
  torque_limit: 5.0,
  pid_p: 1.0,
  pid_i: 0.1,
  pid_d: 0.05,
  max_velocity: 5.0
};

// Hexapod joint IDs
export const HEXAPOD_JOINTS = [
  'leg_1_coxa', 'leg_1_femur', 'leg_1_tibia',
  'leg_2_coxa', 'leg_2_femur', 'leg_2_tibia',
  'leg_3_coxa', 'leg_3_femur', 'leg_3_tibia',
  'leg_4_coxa', 'leg_4_femur', 'leg_4_tibia',
  'leg_5_coxa', 'leg_5_femur', 'leg_5_tibia',
  'leg_6_coxa', 'leg_6_femur', 'leg_6_tibia'
];

// ============================================
// Drone/UAV Types
// ============================================

// Drone-specific physics (extends terrain with airspace)
export type AirspaceCondition = 'calm' | 'light_wind' | 'gusty' | 'turbulent';

export interface DronePhysicsConfig {
  air_density: number;         // kg/m³ (1.225 at sea level)
  wind_speed: number;          // m/s
  wind_direction: number;      // degrees (0-360)
  airspace_condition: AirspaceCondition;
}

// Drone telemetry frame
export interface DroneTelemetryFrame {
  timestamp: number;
  position: { lat: number; lon: number; alt: number };  // GPS
  velocity: { vx: number; vy: number; vz: number };     // m/s
  attitude: { pitch: number; roll: number; yaw: number };
  rotor_speeds: number[];      // RPM for each rotor (4 for quad)
  battery: { voltage: number; current: number; remaining: number };
  gps_quality: number;         // 0-100
  signal_strength: number;     // dBm
}

// Drone failure events
export type DroneEventType =
  | 'motor_failure' | 'gps_loss' | 'low_battery' | 'signal_lost'
  | 'geofence_breach' | 'wind_warning' | 'obstacle_detected' | 'flyaway';

// Drone simulation event (extends base SimulationEvent)
export interface DroneSimulationEvent {
  timestamp: number;
  type: DroneEventType;
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  data?: Record<string, any>;
}

// Quadcopter rotors
export const QUADCOPTER_ROTORS = ['rotor_fl', 'rotor_fr', 'rotor_bl', 'rotor_br'];

// Drone simulation metrics
export interface DroneSimulationMetrics {
  hover_accuracy: number;           // % time within position threshold
  altitude_stability: number;       // %
  battery_efficiency: number;       // % vs theoretical
  wind_compensation_events: number;
  max_altitude_deviation: number;   // meters
  avg_rotor_rpm: number;
  gps_quality_avg: number;
}

// Drone flight path data
export interface DroneFlightPath {
  waypoints_completed: number;
  total_distance: number;           // meters
  max_speed: number;                // m/s
  avg_speed: number;
}

// Drone run simulation result
export interface DroneRunSimulationResult {
  run_id: string;
  status: 'completed' | 'failed' | 'interrupted';
  telemetry_summary: string;
  video_url: string;
  duration_actual: number;
  metrics: DroneSimulationMetrics;
  flight_path: DroneFlightPath;
  events_summary?: string[];
}

// Enhanced autonomous research result
export interface EnhancedAutonomousResearchResult {
  status: 'initiated' | 'failed';
  research_id: string;
  message: string;
  max_iterations: number;
  success_criteria: string;
  estimated_duration_minutes: number;
  research_plan: {
    phases: {
      id: number;
      name: string;
      iterations: number;
      focus: string;
    }[];
    initial_hypothesis: string;
    parameter_ranges: {
      friction_coefficient?: { min: number; max: number; step: number };
      pid_p?: { min: number; max: number; step: number };
      pid_d?: { min: number; max: number; step: number };
    };
  };
  checkpoints: {
    after_iteration: number;
    expected_metric: string;
    action_if_failed: string;
  }[];
  early_termination: {
    success_threshold: number;
    failure_conditions: string[];
  };
}
