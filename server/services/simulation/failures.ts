// Failure Injection System - Realistic failure scenarios for simulation

import {
  PhysicsConfig,
  SimulationEvent,
  TelemetryFrame,
  DronePhysicsConfig,
  DroneTelemetryFrame,
  DroneSimulationEvent,
  DroneEventType
} from './types';

export type FailureType =
  | 'motor_overheat'
  | 'slip_event'
  | 'gait_mismatch'
  | 'rollover'
  | 'power_fluctuation'
  | 'sensor_noise'
  | 'joint_limit_exceeded';

export interface FailureScenario {
  type: FailureType;
  probability: number;  // Base probability (0-1)
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  affectedComponents?: string[];
  recoverable: boolean;
}

const BASE_FAILURE_RATE = 0.12; // 12% base chance

/**
 * Get terrain-adjusted failure probabilities
 */
function getTerrainModifiers(terrain: PhysicsConfig['terrain_type']): Record<FailureType, number> {
  const modifiers: Record<string, Record<FailureType, number>> = {
    sand: {
      motor_overheat: 1.5,      // Sand = more resistance = more heat
      slip_event: 2.0,          // Sand is slippery
      gait_mismatch: 1.3,       // Harder to maintain gait
      rollover: 1.4,
      power_fluctuation: 1.2,
      sensor_noise: 1.1,
      joint_limit_exceeded: 1.2
    },
    concrete: {
      motor_overheat: 0.8,
      slip_event: 0.3,
      gait_mismatch: 0.7,
      rollover: 0.6,
      power_fluctuation: 0.9,
      sensor_noise: 0.8,
      joint_limit_exceeded: 1.1  // Hard impacts
    },
    grass: {
      motor_overheat: 1.0,
      slip_event: 1.2,
      gait_mismatch: 1.0,
      rollover: 0.9,
      power_fluctuation: 1.0,
      sensor_noise: 1.0,
      joint_limit_exceeded: 0.9
    },
    gravel: {
      motor_overheat: 1.3,
      slip_event: 1.5,
      gait_mismatch: 1.4,
      rollover: 1.3,
      power_fluctuation: 1.1,
      sensor_noise: 1.2,
      joint_limit_exceeded: 1.3
    }
  };

  return modifiers[terrain] || modifiers.concrete;
}

/**
 * Base failure scenarios
 */
const FAILURE_SCENARIOS: Record<FailureType, Omit<FailureScenario, 'probability'>> = {
  motor_overheat: {
    type: 'motor_overheat',
    severity: 'warning',
    message: 'Motor temperature exceeded threshold',
    affectedComponents: ['leg_2_femur', 'leg_5_femur'],
    recoverable: true
  },
  slip_event: {
    type: 'slip_event',
    severity: 'warning',
    message: 'Traction loss detected during stance phase',
    affectedComponents: ['leg_1', 'leg_4'],
    recoverable: true
  },
  gait_mismatch: {
    type: 'gait_mismatch',
    severity: 'warning',
    message: 'Gait phase synchronization error between leg pairs',
    affectedComponents: ['leg_2', 'leg_5'],
    recoverable: true
  },
  rollover: {
    type: 'rollover',
    severity: 'critical',
    message: 'Body orientation exceeded safe limits - rollover imminent',
    recoverable: false
  },
  power_fluctuation: {
    type: 'power_fluctuation',
    severity: 'info',
    message: 'Minor power supply fluctuation detected',
    recoverable: true
  },
  sensor_noise: {
    type: 'sensor_noise',
    severity: 'info',
    message: 'Elevated sensor noise detected in IMU readings',
    recoverable: true
  },
  joint_limit_exceeded: {
    type: 'joint_limit_exceeded',
    severity: 'error',
    message: 'Joint position limit exceeded - emergency stop triggered',
    affectedComponents: ['leg_3_tibia'],
    recoverable: true
  }
};

/**
 * Determine if a failure should be injected
 */
export function shouldInjectFailure(
  physics: PhysicsConfig,
  simulationProgress: number,  // 0-1
  existingEvents: SimulationEvent[]
): FailureScenario | null {
  // Don't inject too many failures
  const criticalCount = existingEvents.filter(e => e.severity === 'critical').length;
  if (criticalCount > 0) return null;

  const warningCount = existingEvents.filter(e => e.severity === 'warning' || e.severity === 'error').length;
  if (warningCount >= 3) return null;

  // Random check against base failure rate
  if (Math.random() > BASE_FAILURE_RATE) return null;

  const terrainModifiers = getTerrainModifiers(physics.terrain_type);

  // Select a failure type based on weighted probabilities
  const failureTypes = Object.keys(FAILURE_SCENARIOS) as FailureType[];
  const weights = failureTypes.map(type => {
    let weight = terrainModifiers[type];

    // Adjust based on friction
    if (type === 'slip_event') {
      weight *= (1.2 - physics.friction_coefficient);
    }

    // More likely to overheat later in simulation
    if (type === 'motor_overheat') {
      weight *= (0.5 + simulationProgress);
    }

    // Rollover more likely with high gravity
    if (type === 'rollover') {
      weight *= (physics.gravity / 9.81) * 0.3; // Reduce overall probability
    }

    return weight;
  });

  // Weighted random selection
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * totalWeight;

  for (let i = 0; i < failureTypes.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      const type = failureTypes[i];
      const scenario = FAILURE_SCENARIOS[type];
      return {
        ...scenario,
        probability: weights[i] / totalWeight
      };
    }
  }

  return null;
}

/**
 * Generate simulation events based on telemetry analysis
 */
export function generateSimulationEvents(
  frames: TelemetryFrame[],
  physics: PhysicsConfig
): SimulationEvent[] {
  const events: SimulationEvent[] = [];

  // Sample frames for potential failures (not every frame)
  const sampleRate = Math.floor(frames.length / 10);

  for (let i = sampleRate; i < frames.length; i += sampleRate) {
    const frame = frames[i];
    const progress = i / frames.length;

    // Check for slip events in telemetry
    for (const contact of frame.contacts) {
      if (contact.slip_detected) {
        events.push({
          timestamp: frame.timestamp,
          type: 'slip',
          severity: 'warning',
          message: `Slippage detected on ${contact.leg_id} tarsus`,
          data: { leg: contact.leg_id, force: contact.force }
        });
        break; // Only one slip event per check
      }
    }

    // Check for stability issues
    if (Math.abs(frame.imu.pitch) > 20) {
      events.push({
        timestamp: frame.timestamp,
        type: 'stability_warning',
        severity: frame.imu.pitch > 25 ? 'error' : 'warning',
        message: `Body pitch deviation: ${frame.imu.pitch.toFixed(1)}°`,
        data: { pitch: frame.imu.pitch, roll: frame.imu.roll }
      });
    }

    // Check for potential rollover
    if (Math.abs(frame.imu.pitch) > 30 || Math.abs(frame.imu.roll) > 25) {
      events.push({
        timestamp: frame.timestamp,
        type: 'rollover',
        severity: 'critical',
        message: 'Orientation exceeded safe limits',
        data: { pitch: frame.imu.pitch, roll: frame.imu.roll }
      });
    }

    // Check for overheat
    if (frame.power.temperature > 50) {
      events.push({
        timestamp: frame.timestamp,
        type: 'overheat',
        severity: 'warning',
        message: `Motor temperature elevated: ${frame.power.temperature}°C`,
        data: { temperature: frame.power.temperature }
      });
    }

    // Inject random failures based on conditions
    const injectedFailure = shouldInjectFailure(physics, progress, events);
    if (injectedFailure) {
      events.push({
        timestamp: frame.timestamp,
        type: injectedFailure.type as SimulationEvent['type'],
        severity: injectedFailure.severity,
        message: injectedFailure.message,
        data: { affectedComponents: injectedFailure.affectedComponents }
      });
    }
  }

  // Limit total events
  return events.slice(0, 10);
}

/**
 * Determine if simulation should be marked as failed
 */
export function shouldSimulationFail(events: SimulationEvent[]): boolean {
  const criticalEvents = events.filter(e => e.severity === 'critical');
  return criticalEvents.length > 0;
}

/**
 * Generate failure-based recommendations
 */
export function generateRecommendations(
  events: SimulationEvent[],
  physics: PhysicsConfig
): string[] {
  const recommendations: string[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'slip':
        if (physics.friction_coefficient < 0.7) {
          recommendations.push(`Increase friction_coefficient to ${Math.min(1.0, physics.friction_coefficient + 0.15).toFixed(2)} for ${physics.terrain_type} terrain`);
        }
        recommendations.push('Consider reducing gait speed during stance phase');
        break;

      case 'overheat':
        recommendations.push('Reduce pid_p gain to decrease motor effort');
        recommendations.push('Consider implementing thermal throttling');
        break;

      case 'stability_warning':
      case 'rollover':
        recommendations.push('Lower center of mass by reducing femur joint angles');
        recommendations.push('Increase pid_d on affected legs to dampen oscillations');
        break;

      case 'gait_mismatch':
        recommendations.push(`Reduce pid_p on ${event.data?.affectedComponents?.[0] || 'leg_2'}_femur to dampen oscillation`);
        recommendations.push('Verify gait timing synchronization');
        break;
    }
  }

  // Remove duplicates
  return [...new Set(recommendations)].slice(0, 5);
}

// ============================================
// Drone Failure System
// ============================================

export type DroneFailureType =
  | 'motor_failure'
  | 'gps_loss'
  | 'low_battery'
  | 'signal_lost'
  | 'geofence_breach'
  | 'wind_warning'
  | 'obstacle_detected'
  | 'flyaway';

export interface DroneFailureScenario {
  type: DroneFailureType;
  probability: number;
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  affectedComponents?: string[];
  recoverable: boolean;
}

const DRONE_BASE_FAILURE_RATE = 0.08; // 8% base chance per check

/**
 * Get airspace-adjusted failure probabilities for drones
 */
function getAirspaceModifiers(condition: DronePhysicsConfig['airspace_condition']): Record<DroneFailureType, number> {
  const modifiers: Record<string, Record<DroneFailureType, number>> = {
    calm: {
      motor_failure: 0.5,
      gps_loss: 0.6,
      low_battery: 1.0,
      signal_lost: 0.7,
      geofence_breach: 0.8,
      wind_warning: 0.1,
      obstacle_detected: 1.0,
      flyaway: 0.3
    },
    light_wind: {
      motor_failure: 0.8,
      gps_loss: 0.8,
      low_battery: 1.2,
      signal_lost: 0.9,
      geofence_breach: 1.0,
      wind_warning: 0.5,
      obstacle_detected: 1.0,
      flyaway: 0.5
    },
    gusty: {
      motor_failure: 1.2,
      gps_loss: 1.0,
      low_battery: 1.5,
      signal_lost: 1.2,
      geofence_breach: 1.3,
      wind_warning: 2.0,
      obstacle_detected: 0.8,
      flyaway: 1.0
    },
    turbulent: {
      motor_failure: 1.8,
      gps_loss: 1.3,
      low_battery: 2.0,
      signal_lost: 1.5,
      geofence_breach: 1.5,
      wind_warning: 3.0,
      obstacle_detected: 0.6,
      flyaway: 1.5
    }
  };

  return modifiers[condition] || modifiers.calm;
}

/**
 * Drone failure scenarios
 */
const DRONE_FAILURE_SCENARIOS: Record<DroneFailureType, Omit<DroneFailureScenario, 'probability'>> = {
  motor_failure: {
    type: 'motor_failure',
    severity: 'error',
    message: 'Motor RPM variance exceeded threshold - degraded performance',
    affectedComponents: ['rotor_fr'],
    recoverable: true
  },
  gps_loss: {
    type: 'gps_loss',
    severity: 'warning',
    message: 'GPS signal degraded - position accuracy reduced',
    recoverable: true
  },
  low_battery: {
    type: 'low_battery',
    severity: 'warning',
    message: 'Battery level critical - return to home recommended',
    recoverable: true
  },
  signal_lost: {
    type: 'signal_lost',
    severity: 'error',
    message: 'RC link signal strength below threshold',
    recoverable: true
  },
  geofence_breach: {
    type: 'geofence_breach',
    severity: 'warning',
    message: 'Approaching operational boundary - course correction initiated',
    recoverable: true
  },
  wind_warning: {
    type: 'wind_warning',
    severity: 'warning',
    message: 'Wind speed exceeding safe operational limits',
    recoverable: true
  },
  obstacle_detected: {
    type: 'obstacle_detected',
    severity: 'info',
    message: 'Obstacle detected - avoidance maneuver executed',
    recoverable: true
  },
  flyaway: {
    type: 'flyaway',
    severity: 'critical',
    message: 'Loss of control detected - failsafe triggered',
    recoverable: false
  }
};

/**
 * Determine if a drone failure should be injected
 */
export function shouldInjectDroneFailure(
  physics: DronePhysicsConfig,
  flightProgress: number,
  existingEvents: DroneSimulationEvent[]
): DroneFailureScenario | null {
  // Don't inject too many failures
  const criticalCount = existingEvents.filter(e => e.severity === 'critical').length;
  if (criticalCount > 0) return null;

  const warningCount = existingEvents.filter(e => e.severity === 'warning' || e.severity === 'error').length;
  if (warningCount >= 3) return null;

  // Random check against base failure rate
  if (Math.random() > DRONE_BASE_FAILURE_RATE) return null;

  const airspaceModifiers = getAirspaceModifiers(physics.airspace_condition);

  // Select a failure type based on weighted probabilities
  const failureTypes = Object.keys(DRONE_FAILURE_SCENARIOS) as DroneFailureType[];
  const weights = failureTypes.map(type => {
    let weight = airspaceModifiers[type];

    // Adjust based on wind speed
    if (type === 'wind_warning') {
      weight *= (physics.wind_speed / 5); // Higher weight for stronger winds
    }

    // Low battery more likely later in flight
    if (type === 'low_battery') {
      weight *= (0.3 + flightProgress);
    }

    // GPS issues more common at low altitude
    if (type === 'gps_loss') {
      weight *= (1 - flightProgress * 0.3);
    }

    // Flyaway very rare
    if (type === 'flyaway') {
      weight *= 0.1;
    }

    return weight;
  });

  // Weighted random selection
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * totalWeight;

  for (let i = 0; i < failureTypes.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      const type = failureTypes[i];
      const scenario = DRONE_FAILURE_SCENARIOS[type];
      return {
        ...scenario,
        probability: weights[i] / totalWeight
      };
    }
  }

  return null;
}

/**
 * Generate drone simulation events based on telemetry analysis
 */
export function generateDroneSimulationEvents(
  frames: DroneTelemetryFrame[],
  physics: DronePhysicsConfig
): DroneSimulationEvent[] {
  const events: DroneSimulationEvent[] = [];

  // Sample frames for potential failures
  const sampleRate = Math.floor(frames.length / 10);

  for (let i = sampleRate; i < frames.length; i += sampleRate) {
    const frame = frames[i];
    const progress = i / frames.length;

    // Check for GPS quality issues
    if (frame.gps_quality < 70) {
      events.push({
        timestamp: frame.timestamp,
        type: 'gps_loss',
        severity: frame.gps_quality < 50 ? 'error' : 'warning',
        message: `GPS quality degraded to ${frame.gps_quality}%`,
        data: { gps_quality: frame.gps_quality }
      });
    }

    // Check for low battery
    if (frame.battery.remaining < 20) {
      events.push({
        timestamp: frame.timestamp,
        type: 'low_battery',
        severity: frame.battery.remaining < 10 ? 'critical' : 'warning',
        message: `Battery critical: ${frame.battery.remaining.toFixed(0)}% remaining`,
        data: { battery_remaining: frame.battery.remaining, voltage: frame.battery.voltage }
      });
    }

    // Check for signal strength
    if (frame.signal_strength < -70) {
      events.push({
        timestamp: frame.timestamp,
        type: 'signal_lost',
        severity: 'warning',
        message: `RC signal weak: ${frame.signal_strength}dBm`,
        data: { signal_strength: frame.signal_strength }
      });
    }

    // Check for attitude anomalies (possible wind)
    if (Math.abs(frame.attitude.roll) > 15 || Math.abs(frame.attitude.pitch) > 15) {
      events.push({
        timestamp: frame.timestamp,
        type: 'wind_warning',
        severity: 'warning',
        message: `Excessive attitude deviation: roll=${frame.attitude.roll.toFixed(1)}°, pitch=${frame.attitude.pitch.toFixed(1)}°`,
        data: { roll: frame.attitude.roll, pitch: frame.attitude.pitch }
      });
    }

    // Check for rotor RPM variance (motor issues)
    const avgRPM = frame.rotor_speeds.reduce((a, b) => a + b, 0) / 4;
    const maxVariance = Math.max(...frame.rotor_speeds.map(r => Math.abs(r - avgRPM)));
    if (maxVariance > 500) {
      const problemRotor = frame.rotor_speeds.findIndex(r => Math.abs(r - avgRPM) === maxVariance);
      events.push({
        timestamp: frame.timestamp,
        type: 'motor_failure',
        severity: maxVariance > 1000 ? 'error' : 'warning',
        message: `Rotor ${problemRotor + 1} showing ${maxVariance.toFixed(0)} RPM variance`,
        data: { rotor: problemRotor, variance: maxVariance, rpm: frame.rotor_speeds[problemRotor] }
      });
    }

    // Inject random failures based on conditions
    const injectedFailure = shouldInjectDroneFailure(physics, progress, events);
    if (injectedFailure) {
      events.push({
        timestamp: frame.timestamp,
        type: injectedFailure.type,
        severity: injectedFailure.severity,
        message: injectedFailure.message,
        data: { affectedComponents: injectedFailure.affectedComponents }
      });
    }
  }

  // Limit total events
  return events.slice(0, 10);
}

/**
 * Determine if drone simulation should be marked as failed
 */
export function shouldDroneSimulationFail(events: DroneSimulationEvent[]): boolean {
  const criticalEvents = events.filter(e => e.severity === 'critical');
  return criticalEvents.length > 0;
}

/**
 * Generate drone failure-based recommendations
 */
export function generateDroneRecommendations(
  events: DroneSimulationEvent[],
  physics: DronePhysicsConfig
): string[] {
  const recommendations: string[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'motor_failure':
        recommendations.push('Check motor and ESC connections for affected rotor');
        recommendations.push('Calibrate ESCs to ensure synchronized response');
        break;

      case 'gps_loss':
        recommendations.push('Consider GPS/visual odometry fusion for improved positioning');
        recommendations.push('Avoid flying near structures that cause multipath interference');
        break;

      case 'low_battery':
        recommendations.push('Reduce flight time or use higher capacity battery');
        recommendations.push('Monitor power consumption and optimize flight profile');
        break;

      case 'signal_lost':
        recommendations.push('Check antenna alignment and orientation');
        recommendations.push('Consider using diversity receiver for better coverage');
        break;

      case 'wind_warning':
        recommendations.push('Increase roll PID gains for better wind rejection');
        recommendations.push('Reduce flight altitude in gusty conditions');
        if (physics.wind_speed > 5) {
          recommendations.push('Consider postponing flight until wind conditions improve');
        }
        break;

      case 'geofence_breach':
        recommendations.push('Review and expand geofence boundaries if safe');
        recommendations.push('Enable automatic return-to-home at boundary');
        break;

      case 'obstacle_detected':
        recommendations.push('Verify obstacle avoidance sensor calibration');
        recommendations.push('Increase minimum safe distance parameter');
        break;

      case 'flyaway':
        recommendations.push('Check compass calibration and magnetic interference');
        recommendations.push('Verify failsafe settings are configured correctly');
        recommendations.push('Review flight logs for root cause analysis');
        break;
    }
  }

  // Remove duplicates
  return [...new Set(recommendations)].slice(0, 5);
}
