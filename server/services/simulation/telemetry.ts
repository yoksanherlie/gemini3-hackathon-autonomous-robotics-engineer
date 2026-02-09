// Telemetry Generator - Creates realistic simulation telemetry data

import {
  TelemetryFrame,
  PhysicsConfig,
  MotorParams,
  SimulationMetrics,
  HEXAPOD_JOINTS,
  DroneTelemetryFrame,
  DronePhysicsConfig,
  DroneSimulationMetrics,
  DroneFlightPath,
  QUADCOPTER_ROTORS
} from './types';

/**
 * Generate Gaussian noise
 */
function gaussianNoise(mean: number = 0, stdDev: number = 1): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * stdDev + mean;
}

/**
 * Clamp a value between min and max
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Get terrain-specific parameters
 */
function getTerrainParams(terrainType: PhysicsConfig['terrain_type']) {
  const params = {
    sand: {
      slipProbability: 0.15,
      frictionVariance: 0.2,
      impactDamping: 0.7,
      sinkage: 0.02
    },
    concrete: {
      slipProbability: 0.02,
      frictionVariance: 0.05,
      impactDamping: 0.95,
      sinkage: 0
    },
    grass: {
      slipProbability: 0.08,
      frictionVariance: 0.15,
      impactDamping: 0.8,
      sinkage: 0.01
    },
    gravel: {
      slipProbability: 0.12,
      frictionVariance: 0.18,
      impactDamping: 0.75,
      sinkage: 0.015
    }
  };
  return params[terrainType] || params.concrete;
}

/**
 * Simulate PID controller response
 */
function pidResponse(
  current: number,
  target: number,
  pid_p: number,
  pid_d: number,
  velocity: number,
  dt: number
): { position: number; velocity: number } {
  const error = target - current;
  const pTerm = pid_p * error;
  const dTerm = -pid_d * velocity;

  const acceleration = pTerm + dTerm;
  const newVelocity = velocity + acceleration * dt;
  const newPosition = current + newVelocity * dt;

  return {
    position: newPosition,
    velocity: clamp(newVelocity, -5, 5)
  };
}

/**
 * Generate a complete telemetry stream for a simulation run
 */
export function generateTelemetryStream(
  durationSeconds: number,
  physics: PhysicsConfig,
  motors: Map<string, MotorParams>,
  sampleRateHz: number = 100
): TelemetryFrame[] {
  const frames: TelemetryFrame[] = [];
  const totalSamples = Math.floor(durationSeconds * sampleRateHz);
  const dt = 1 / sampleRateHz;
  const terrainParams = getTerrainParams(physics.terrain_type);

  // State tracking
  const jointState: Record<string, { position: number; velocity: number; torque: number }> = {};
  let pitch = 0;
  let roll = 0;
  let yaw = 0;
  let temperature = 35; // Starting temperature

  // Initialize joint states
  for (const jointId of HEXAPOD_JOINTS) {
    jointState[jointId] = {
      position: gaussianNoise(0, 0.1),
      velocity: 0,
      torque: 0
    };
  }

  // Gait cycle parameters (tripod gait)
  const gaitFrequency = 2; // Hz
  const gaitAmplitude = {
    coxa: 0.3,  // radians
    femur: 0.6,
    tibia: 0.8
  };

  for (let i = 0; i < totalSamples; i++) {
    const t = i * dt;
    const gaitPhase = (t * gaitFrequency * 2 * Math.PI) % (2 * Math.PI);

    // Update each joint with gait pattern
    const jointPositions: Record<string, number> = {};
    const jointVelocities: Record<string, number> = {};
    const jointTorques: Record<string, number> = {};

    for (const jointId of HEXAPOD_JOINTS) {
      const motor = motors.get(jointId) || { pid_p: 1.0, pid_d: 0.05, torque_limit: 5.0 };
      const state = jointState[jointId];

      // Determine leg number and joint type
      const legNum = parseInt(jointId.split('_')[1]);
      const jointType = jointId.split('_')[2] as 'coxa' | 'femur' | 'tibia';

      // Phase offset for tripod gait (legs 1,3,5 vs 2,4,6)
      const phaseOffset = (legNum % 2 === 0) ? Math.PI : 0;
      const amplitude = gaitAmplitude[jointType] || 0.5;

      // Target position from gait pattern
      const target = amplitude * Math.sin(gaitPhase + phaseOffset);

      // Apply PID control
      const pidResult = pidResponse(
        state.position,
        target,
        motor.pid_p,
        motor.pid_d,
        state.velocity,
        dt
      );

      // Add terrain-dependent noise
      const noiseScale = 0.01 * (1 + terrainParams.frictionVariance);
      state.position = pidResult.position + gaussianNoise(0, noiseScale);
      state.velocity = pidResult.velocity + gaussianNoise(0, noiseScale * 2);

      // Calculate torque (simplified)
      state.torque = clamp(
        motor.pid_p * (target - state.position) + gaussianNoise(0, 0.1),
        -motor.torque_limit,
        motor.torque_limit
      );

      jointPositions[jointId] = state.position;
      jointVelocities[jointId] = state.velocity;
      jointTorques[jointId] = state.torque;
    }

    // IMU simulation with terrain influence
    const gravityEffect = physics.gravity / 9.81;
    const pitchOscillation = 2 * Math.sin(gaitPhase * 2) * gravityEffect;
    const rollOscillation = 1.5 * Math.sin(gaitPhase * 2 + Math.PI / 4) * gravityEffect;

    pitch = clamp(
      pitch * 0.95 + pitchOscillation * 0.05 + gaussianNoise(0, 0.3),
      -30, 30
    );
    roll = clamp(
      roll * 0.95 + rollOscillation * 0.05 + gaussianNoise(0, 0.2),
      -20, 20
    );
    yaw += gaussianNoise(0, 0.1);

    // Temperature increases slowly during operation
    temperature = Math.min(55, temperature + 0.001 + Math.abs(gaussianNoise(0, 0.01)));

    // Power simulation
    const avgTorque = Object.values(jointTorques).reduce((a, b) => Math.abs(a) + Math.abs(b), 0) / 18;
    const current = 2 + avgTorque * 0.5 + gaussianNoise(0, 0.2);

    // Contact simulation for each leg
    const contacts = [];
    for (let leg = 1; leg <= 6; leg++) {
      const legPhase = (gaitPhase + (leg % 2 === 0 ? Math.PI : 0)) % (2 * Math.PI);
      const inContact = legPhase < Math.PI; // Stance phase

      // Slip detection based on terrain and friction
      const slipChance = terrainParams.slipProbability * (1 - physics.friction_coefficient);
      const slipDetected = inContact && Math.random() < slipChance * 0.1;

      contacts.push({
        leg_id: `leg_${leg}`,
        in_contact: inContact,
        force: inContact ? 8 + gaussianNoise(0, 2) : 0,
        slip_detected: slipDetected
      });
    }

    frames.push({
      timestamp: Math.round(t * 1000),
      joint_positions: jointPositions,
      joint_velocities: jointVelocities,
      joint_torques: jointTorques,
      imu: {
        pitch: Number(pitch.toFixed(2)),
        roll: Number(roll.toFixed(2)),
        yaw: Number(yaw.toFixed(2)),
        accel_x: Number(gaussianNoise(0, 0.5).toFixed(3)),
        accel_y: Number(gaussianNoise(0, 0.5).toFixed(3)),
        accel_z: Number((physics.gravity + gaussianNoise(0, 0.3)).toFixed(3))
      },
      power: {
        voltage: Number((24 - current * 0.1 + gaussianNoise(0, 0.05)).toFixed(2)),
        current: Number(current.toFixed(2)),
        temperature: Number(temperature.toFixed(1))
      },
      contacts
    });
  }

  return frames;
}

/**
 * Analyze telemetry and compute metrics
 */
export function analyzeTelemetry(frames: TelemetryFrame[]): SimulationMetrics {
  if (frames.length === 0) {
    return {
      stability_score: 0,
      efficiency_score: 0,
      gait_symmetry: 0,
      max_pitch_deviation: 0,
      max_roll_deviation: 0,
      slip_events: 0,
      total_energy_consumed: 0,
      avg_joint_temperature: 0
    };
  }

  let maxPitch = 0;
  let maxRoll = 0;
  let slipEvents = 0;
  let totalEnergy = 0;
  let tempSum = 0;

  // Gait symmetry calculation
  let leftLegPhaseSum = 0;
  let rightLegPhaseSum = 0;

  for (const frame of frames) {
    maxPitch = Math.max(maxPitch, Math.abs(frame.imu.pitch));
    maxRoll = Math.max(maxRoll, Math.abs(frame.imu.roll));

    for (const contact of frame.contacts) {
      if (contact.slip_detected) slipEvents++;

      // Crude phase estimation
      const legNum = parseInt(contact.leg_id.split('_')[1]);
      if (legNum % 2 === 1) {
        leftLegPhaseSum += contact.in_contact ? 1 : 0;
      } else {
        rightLegPhaseSum += contact.in_contact ? 1 : 0;
      }
    }

    // Energy = V * I * dt (simplified)
    totalEnergy += frame.power.voltage * frame.power.current * 0.01;
    tempSum += frame.power.temperature;
  }

  // Calculate scores
  const stabilityPenalty = (maxPitch / 30) * 30 + (maxRoll / 20) * 20 + (slipEvents / frames.length) * 50;
  const stability_score = Math.max(0, Math.round(100 - stabilityPenalty));

  // Efficiency based on energy vs distance (simplified)
  const efficiencyRaw = 100 - (totalEnergy / frames.length) * 2;
  const efficiency_score = Math.max(0, Math.min(100, Math.round(efficiencyRaw)));

  // Gait symmetry: compare left vs right leg contact ratios
  const symmetryDiff = Math.abs(leftLegPhaseSum - rightLegPhaseSum) / frames.length;
  const gait_symmetry = Number(Math.max(0, 1 - symmetryDiff * 0.5).toFixed(2));

  return {
    stability_score,
    efficiency_score,
    gait_symmetry,
    max_pitch_deviation: Number(maxPitch.toFixed(1)),
    max_roll_deviation: Number(maxRoll.toFixed(1)),
    slip_events: slipEvents,
    total_energy_consumed: Number(totalEnergy.toFixed(2)),
    avg_joint_temperature: Number((tempSum / frames.length).toFixed(1))
  };
}

/**
 * Generate a human-readable telemetry summary
 */
export function generateTelemetrySummary(
  frames: TelemetryFrame[],
  metrics: SimulationMetrics
): string {
  const parts: string[] = [];

  // Overall assessment
  if (metrics.stability_score >= 90) {
    parts.push('Gait cycle completed successfully.');
  } else if (metrics.stability_score >= 70) {
    parts.push('Gait cycle completed with minor issues.');
  } else {
    parts.push('Gait cycle completed with significant stability concerns.');
  }

  // Slip events
  if (metrics.slip_events > 0) {
    const slipFrames = frames.filter((f, i) =>
      f.contacts.some(c => c.slip_detected)
    ).slice(0, 3);

    if (slipFrames.length > 0) {
      const slipTimes = slipFrames.map(f => `t=${(f.timestamp / 1000).toFixed(1)}s`);
      const slipLegs = slipFrames.flatMap(f =>
        f.contacts.filter(c => c.slip_detected).map(c => c.leg_id.replace('leg_', ''))
      );
      parts.push(`Minor slip detected at ${slipTimes[0]} on leg ${slipLegs[0]} tarsus.`);
    }
  }

  // Stability
  parts.push(`Stability score: ${metrics.stability_score}%`);

  // Temperature warning
  if (metrics.avg_joint_temperature > 50) {
    parts.push(`Warning: Elevated joint temperatures (avg ${metrics.avg_joint_temperature}°C).`);
  }

  return parts.join(' ');
}

// ============================================
// Drone Telemetry Functions
// ============================================

/**
 * Get airspace condition parameters
 */
function getAirspaceParams(condition: DronePhysicsConfig['airspace_condition']) {
  const params = {
    calm: {
      turbulenceIntensity: 0.1,
      gustProbability: 0.02,
      positionVariance: 0.05
    },
    light_wind: {
      turbulenceIntensity: 0.25,
      gustProbability: 0.08,
      positionVariance: 0.15
    },
    gusty: {
      turbulenceIntensity: 0.5,
      gustProbability: 0.2,
      positionVariance: 0.35
    },
    turbulent: {
      turbulenceIntensity: 0.8,
      gustProbability: 0.4,
      positionVariance: 0.6
    }
  };
  return params[condition] || params.calm;
}

/**
 * Flight phase enumeration
 */
type FlightPhase = 'takeoff' | 'hover' | 'waypoint' | 'land';

/**
 * Generate drone telemetry stream for a flight simulation
 */
export function generateDroneTelemetryStream(
  durationSeconds: number,
  physics: DronePhysicsConfig,
  sampleRateHz: number = 50
): DroneTelemetryFrame[] {
  const frames: DroneTelemetryFrame[] = [];
  const totalSamples = Math.floor(durationSeconds * sampleRateHz);
  const dt = 1 / sampleRateHz;
  const airspaceParams = getAirspaceParams(physics.airspace_condition);

  // Starting position (GPS coordinates)
  const startLat = 37.7749;  // San Francisco
  const startLon = -122.4194;
  const startAlt = 0;

  // State tracking
  let lat = startLat;
  let lon = startLon;
  let alt = startAlt;
  let vx = 0, vy = 0, vz = 0;
  let pitch = 0, roll = 0, yaw = 0;
  let batteryRemaining = 100;
  let batteryVoltage = 16.8; // 4S LiPo fully charged

  // Rotor state (4 rotors for quadcopter)
  const rotorSpeeds = [0, 0, 0, 0];
  const hoverRPM = 4500;
  const maxRPM = 8000;
  const minRPM = 1000;

  // Flight plan phases
  const takeoffDuration = durationSeconds * 0.15;
  const hoverDuration = durationSeconds * 0.25;
  const waypointDuration = durationSeconds * 0.4;
  const landDuration = durationSeconds * 0.2;

  // Waypoints for navigation
  const waypoints = [
    { lat: startLat + 0.0001, lon: startLon + 0.0001 },
    { lat: startLat + 0.0002, lon: startLon },
    { lat: startLat + 0.0001, lon: startLon - 0.0001 },
    { lat: startLat, lon: startLon }
  ];
  let currentWaypoint = 0;

  for (let i = 0; i < totalSamples; i++) {
    const t = i * dt;
    const progress = t / durationSeconds;

    // Determine flight phase
    let phase: FlightPhase;
    if (t < takeoffDuration) {
      phase = 'takeoff';
    } else if (t < takeoffDuration + hoverDuration) {
      phase = 'hover';
    } else if (t < takeoffDuration + hoverDuration + waypointDuration) {
      phase = 'waypoint';
    } else {
      phase = 'land';
    }

    // Phase-specific behavior
    switch (phase) {
      case 'takeoff':
        // Smooth ascent to 10m
        const takeoffProgress = t / takeoffDuration;
        const targetAlt = 10 * Math.sin(takeoffProgress * Math.PI / 2);
        vz = (targetAlt - alt) * 2;
        alt += vz * dt;

        // Increase rotor speeds during takeoff
        for (let r = 0; r < 4; r++) {
          rotorSpeeds[r] = clamp(
            minRPM + (hoverRPM - minRPM) * takeoffProgress + gaussianNoise(0, 50),
            minRPM,
            maxRPM
          );
        }
        break;

      case 'hover':
        // Maintain altitude with small corrections
        const hoverTarget = 10;
        vz = (hoverTarget - alt) * 0.5 + gaussianNoise(0, 0.1);
        alt = clamp(alt + vz * dt, 0, 50);

        // Stable hover RPM
        for (let r = 0; r < 4; r++) {
          rotorSpeeds[r] = hoverRPM + gaussianNoise(0, 100);
        }
        break;

      case 'waypoint':
        // Navigate to waypoints
        const wp = waypoints[currentWaypoint];
        const latError = wp.lat - lat;
        const lonError = wp.lon - lon;
        const dist = Math.sqrt(latError * latError + lonError * lonError);

        if (dist < 0.00002 && currentWaypoint < waypoints.length - 1) {
          currentWaypoint++;
        }

        // Move towards waypoint
        vx = latError * 50000;  // Scale for lat/lon
        vy = lonError * 50000;
        lat += vx * dt * 0.00001;
        lon += vy * dt * 0.00001;

        // Maintain altitude
        vz = (10 - alt) * 0.3;
        alt = clamp(alt + vz * dt, 0, 50);

        // Vary rotor speeds based on movement
        for (let r = 0; r < 4; r++) {
          const movementBoost = Math.abs(vx) + Math.abs(vy);
          rotorSpeeds[r] = clamp(
            hoverRPM + movementBoost * 10 + gaussianNoise(0, 150),
            minRPM,
            maxRPM
          );
        }
        break;

      case 'land':
        // Smooth descent
        const landProgress = (t - (durationSeconds - landDuration)) / landDuration;
        const descentRate = -2 * (1 - landProgress * 0.5);
        vz = descentRate;
        alt = clamp(alt + vz * dt, 0, 50);

        // Reduce rotor speeds during landing
        for (let r = 0; r < 4; r++) {
          rotorSpeeds[r] = clamp(
            hoverRPM * (1 - landProgress * 0.6) + gaussianNoise(0, 50),
            alt > 0.5 ? minRPM : 0,
            maxRPM
          );
        }
        break;
    }

    // Wind effects
    const windEffect = physics.wind_speed * airspaceParams.turbulenceIntensity;
    const windAngleRad = physics.wind_direction * Math.PI / 180;

    // Apply wind to position (small drift)
    lat += Math.cos(windAngleRad) * windEffect * 0.000001 * dt;
    lon += Math.sin(windAngleRad) * windEffect * 0.000001 * dt;

    // Wind affects attitude
    const gustActive = Math.random() < airspaceParams.gustProbability * dt;
    if (gustActive) {
      roll += gaussianNoise(0, 5) * airspaceParams.turbulenceIntensity;
      pitch += gaussianNoise(0, 5) * airspaceParams.turbulenceIntensity;
    }

    // Attitude stabilization (PID-like)
    pitch = pitch * 0.95 + gaussianNoise(0, 0.5);
    roll = roll * 0.95 + gaussianNoise(0, 0.5);
    yaw += gaussianNoise(0, 0.2);

    pitch = clamp(pitch, -30, 30);
    roll = clamp(roll, -30, 30);

    // Battery drain (higher drain during movement/climb)
    const powerDrain = 0.001 + Math.abs(vz) * 0.002 + (Math.abs(vx) + Math.abs(vy)) * 0.0001;
    batteryRemaining = clamp(batteryRemaining - powerDrain, 0, 100);
    batteryVoltage = 14.0 + (batteryRemaining / 100) * 2.8; // 14V-16.8V range

    // Current draw based on rotor activity
    const avgRPM = rotorSpeeds.reduce((a, b) => a + b, 0) / 4;
    const current = 5 + (avgRPM / hoverRPM) * 15;

    // GPS quality (varies with altitude and conditions)
    let gpsQuality = 95 + gaussianNoise(0, 3);
    if (alt < 2) gpsQuality -= 10; // Lower quality near ground
    if (physics.airspace_condition === 'turbulent') gpsQuality -= 5;
    gpsQuality = clamp(gpsQuality, 0, 100);

    // Signal strength (RC link)
    const signalStrength = -45 + gaussianNoise(0, 3); // dBm

    frames.push({
      timestamp: Math.round(t * 1000),
      position: {
        lat: Number(lat.toFixed(6)),
        lon: Number(lon.toFixed(6)),
        alt: Number(alt.toFixed(2))
      },
      velocity: {
        vx: Number(vx.toFixed(2)),
        vy: Number(vy.toFixed(2)),
        vz: Number(vz.toFixed(2))
      },
      attitude: {
        pitch: Number(pitch.toFixed(1)),
        roll: Number(roll.toFixed(1)),
        yaw: Number(yaw.toFixed(1))
      },
      rotor_speeds: rotorSpeeds.map(r => Math.round(r)),
      battery: {
        voltage: Number(batteryVoltage.toFixed(2)),
        current: Number(current.toFixed(1)),
        remaining: Number(batteryRemaining.toFixed(1))
      },
      gps_quality: Math.round(gpsQuality),
      signal_strength: Math.round(signalStrength)
    });
  }

  return frames;
}

/**
 * Analyze drone telemetry and compute metrics
 */
export function analyzeDroneTelemetry(frames: DroneTelemetryFrame[]): DroneSimulationMetrics {
  if (frames.length === 0) {
    return {
      hover_accuracy: 0,
      altitude_stability: 0,
      battery_efficiency: 0,
      wind_compensation_events: 0,
      max_altitude_deviation: 0,
      avg_rotor_rpm: 0,
      gps_quality_avg: 0
    };
  }

  // Calculate hover accuracy (time within 0.5m of target position)
  let withinThreshold = 0;
  const hoverAlt = 10; // Target hover altitude
  let maxAltDeviation = 0;
  let totalRPM = 0;
  let totalGPSQuality = 0;
  let windEvents = 0;

  let prevRoll = 0;
  let prevPitch = 0;

  for (const frame of frames) {
    // Altitude deviation
    const altDeviation = Math.abs(frame.position.alt - hoverAlt);
    maxAltDeviation = Math.max(maxAltDeviation, altDeviation);

    if (altDeviation < 0.5) {
      withinThreshold++;
    }

    // Rotor RPM
    totalRPM += frame.rotor_speeds.reduce((a, b) => a + b, 0) / 4;

    // GPS quality
    totalGPSQuality += frame.gps_quality;

    // Wind compensation events (sudden attitude changes)
    const rollChange = Math.abs(frame.attitude.roll - prevRoll);
    const pitchChange = Math.abs(frame.attitude.pitch - prevPitch);
    if (rollChange > 3 || pitchChange > 3) {
      windEvents++;
    }
    prevRoll = frame.attitude.roll;
    prevPitch = frame.attitude.pitch;
  }

  const hoverAccuracy = Math.round((withinThreshold / frames.length) * 100);
  const altitudeStability = Math.round(Math.max(0, 100 - maxAltDeviation * 10));

  // Battery efficiency: compare actual drain vs theoretical
  const startBattery = frames[0].battery.remaining;
  const endBattery = frames[frames.length - 1].battery.remaining;
  const actualDrain = startBattery - endBattery;
  const theoreticalDrain = (frames.length / 50) * 0.1; // Theoretical 0.1% per second
  const batteryEfficiency = Math.round(Math.min(100, (theoreticalDrain / Math.max(actualDrain, 0.1)) * 100));

  return {
    hover_accuracy: hoverAccuracy,
    altitude_stability: altitudeStability,
    battery_efficiency: batteryEfficiency,
    wind_compensation_events: Math.min(windEvents, 10),
    max_altitude_deviation: Number(maxAltDeviation.toFixed(2)),
    avg_rotor_rpm: Math.round(totalRPM / frames.length),
    gps_quality_avg: Math.round(totalGPSQuality / frames.length)
  };
}

/**
 * Analyze flight path from drone telemetry
 */
export function analyzeDroneFlightPath(frames: DroneTelemetryFrame[]): DroneFlightPath {
  if (frames.length < 2) {
    return {
      waypoints_completed: 0,
      total_distance: 0,
      max_speed: 0,
      avg_speed: 0
    };
  }

  let totalDistance = 0;
  let maxSpeed = 0;
  let totalSpeed = 0;

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const curr = frames[i];

    // Calculate distance (simplified, using lat/lon as meters for small distances)
    const dx = (curr.position.lat - prev.position.lat) * 111000; // ~111km per degree
    const dy = (curr.position.lon - prev.position.lon) * 111000 * Math.cos(curr.position.lat * Math.PI / 180);
    const dz = curr.position.alt - prev.position.alt;

    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    totalDistance += dist;

    // Calculate speed
    const speed = Math.sqrt(curr.velocity.vx * curr.velocity.vx + curr.velocity.vy * curr.velocity.vy + curr.velocity.vz * curr.velocity.vz);
    maxSpeed = Math.max(maxSpeed, speed);
    totalSpeed += speed;
  }

  // Count waypoints completed based on position changes
  let waypointsCompleted = 0;
  const startPos = frames[0].position;
  const endPos = frames[frames.length - 1].position;

  // Approximate waypoints based on total distance traveled
  if (totalDistance > 10) waypointsCompleted++;
  if (totalDistance > 30) waypointsCompleted++;
  if (totalDistance > 60) waypointsCompleted++;
  if (totalDistance > 100) waypointsCompleted++;

  return {
    waypoints_completed: waypointsCompleted,
    total_distance: Number(totalDistance.toFixed(1)),
    max_speed: Number(maxSpeed.toFixed(1)),
    avg_speed: Number((totalSpeed / (frames.length - 1)).toFixed(1))
  };
}

/**
 * Generate drone telemetry summary
 */
export function generateDroneTelemetrySummary(
  frames: DroneTelemetryFrame[],
  metrics: DroneSimulationMetrics,
  flightPath: DroneFlightPath
): string {
  const parts: string[] = [];

  // Overall assessment
  if (metrics.hover_accuracy >= 90 && metrics.altitude_stability >= 90) {
    parts.push('Flight completed.');
  } else if (metrics.hover_accuracy >= 70) {
    parts.push('Flight completed with minor deviations.');
  } else {
    parts.push('Flight completed with significant position errors.');
  }

  // Hover stability
  parts.push(`Hover stability maintained within ${metrics.max_altitude_deviation.toFixed(1)}m.`);

  // Wind compensation
  if (metrics.wind_compensation_events > 0) {
    const firstWindFrame = frames.find((f, i) => {
      if (i === 0) return false;
      return Math.abs(f.attitude.roll - frames[i-1].attitude.roll) > 3;
    });
    if (firstWindFrame) {
      parts.push(`Wind compensation active at t=${(firstWindFrame.timestamp / 1000).toFixed(1)}s.`);
    }
  }

  // Battery
  const finalBattery = frames[frames.length - 1].battery.remaining;
  if (finalBattery < 20) {
    parts.push(`Warning: Low battery (${finalBattery.toFixed(0)}%).`);
  } else {
    parts.push('Battery consumption nominal.');
  }

  return parts.join(' ');
}
