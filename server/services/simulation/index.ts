// Simulation Service - Main orchestrator and tool dispatcher

import { stateStore, DEFAULT_DRONE_PHYSICS } from './state';
import {
  generateTelemetryStream,
  analyzeTelemetry,
  generateTelemetrySummary,
  generateDroneTelemetryStream,
  analyzeDroneTelemetry,
  analyzeDroneFlightPath,
  generateDroneTelemetrySummary
} from './telemetry';
import {
  generateSimulationEvents,
  shouldSimulationFail,
  generateRecommendations,
  generateDroneSimulationEvents,
  shouldDroneSimulationFail,
  generateDroneRecommendations
} from './failures';
import {
  ToolExecutionResult,
  ToolError,
  ConfigurePhysicsResult,
  UpdateMotorResult,
  RunSimulationResult,
  AnalyzeVideoResult,
  SearchKnowledgeBaseResult,
  StartAutonomousResearchResult,
  SimulationRun,
  PhysicsConfig,
  EnhancedAutonomousResearchResult,
  DroneRunSimulationResult,
  DronePhysicsConfig,
  DroneSimulationEvent
} from './types';

// R2 Video URL mapping per robot type
const R2_VIDEO_BASE = 'https://pub-d81bd376745a4ee1b9073461f2c2651d.r2.dev';
const R2_VIDEO_MAP: Record<string, string> = {
  drone: `${R2_VIDEO_BASE}/uav_scenes.mp4`,
  uav: `${R2_VIDEO_BASE}/uav_scenes.mp4`,
  quadcopter: `${R2_VIDEO_BASE}/uav_scenes.mp4`,
  aerial: `${R2_VIDEO_BASE}/uav_scenes.mp4`,
  // Add more robot types as videos become available:
  // hexapod: `${R2_VIDEO_BASE}/hexapod_scenes.mp4`,
  // quadruped: `${R2_VIDEO_BASE}/quadruped_scenes.mp4`,
};

/**
 * Look up R2 video URL for a robot type, returns undefined if none available
 */
function getR2VideoUrl(robotType: string): string | undefined {
  const key = robotType.toLowerCase();
  // Check for exact match first
  if (R2_VIDEO_MAP[key]) return R2_VIDEO_MAP[key];
  // Check for partial matches (e.g., "quadcopter_v2" matches "quadcopter")
  for (const [mapKey, url] of Object.entries(R2_VIDEO_MAP)) {
    if (key.includes(mapKey)) return url;
  }
  return undefined;
}

/**
 * Generate random delay within a range
 */
function randomDelay(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate a unique run ID
 */
function generateRunId(): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const random = Math.random().toString(36).substring(2, 6);
  return `sim_${timestamp}_${random}`;
}

/**
 * Knowledge base mock data
 */
const KNOWLEDGE_BASE = [
  {
    date: '2023-10-01',
    experiment: 'Sand Gait V1',
    outcome: 'Failed - motor overheating after 45s',
    key_findings: ['friction_coefficient too low (0.3)', 'pid_p too aggressive']
  },
  {
    date: '2023-10-15',
    experiment: 'Sand Gait V2',
    outcome: 'Partial success - stability issues',
    key_findings: ['Increased friction to 0.5', 'Slip events at high speed']
  },
  {
    date: '2023-11-01',
    experiment: 'Sand Gait V3',
    outcome: 'Success - low speed operation',
    key_findings: ['friction_coefficient 0.6 optimal', 'Reduced gait frequency']
  },
  {
    date: '2023-11-15',
    experiment: 'Concrete Walking',
    outcome: 'Success - stable at all speeds',
    key_findings: ['Default parameters work well', 'Sharp impacts on joints']
  },
  {
    date: '2023-12-01',
    experiment: 'Grass Terrain Test',
    outcome: 'Success with minor slip',
    key_findings: ['Moderate friction required (0.5)', 'Dew conditions increase slip']
  },
  {
    date: '2024-01-10',
    experiment: 'PID Optimization Study',
    outcome: 'Completed',
    key_findings: ['pid_p=0.8 reduces oscillation', 'pid_d critical for sand']
  },
  {
    date: '2024-02-01',
    experiment: 'Thermal Management Test',
    outcome: 'Success',
    key_findings: ['Max safe temp 55°C', 'Throttling at 50°C recommended']
  },
  // Drone-specific experiments
  {
    date: '2024-03-01',
    experiment: 'Quad Hover Stability',
    outcome: 'Success',
    key_findings: [
      'Altitude PID gains: P=0.8, I=0.1, D=0.3 optimal',
      'Position hold accuracy within 0.3m',
      'Battery consumption 12% per 5min hover'
    ]
  },
  {
    date: '2024-03-15',
    experiment: 'Wind Resistance Test - Gusty Conditions',
    outcome: 'Partial success - stable up to 8m/s gusts',
    key_findings: [
      'Roll PID gains critical for gust rejection',
      'Altitude hold degraded above 6m/s sustained wind',
      'Battery drain increased 23% in windy conditions'
    ]
  },
  {
    date: '2024-04-01',
    experiment: 'Autonomous Waypoint Navigation',
    outcome: 'Success',
    key_findings: [
      'Path following accuracy within 0.5m',
      'Smooth transitions between waypoints',
      'Optimal cruise speed 4-6m/s for efficiency'
    ]
  },
  {
    date: '2024-04-10',
    experiment: 'Urban Canyon Navigation',
    outcome: 'Success with GPS backup',
    key_findings: [
      'Visual odometry essential in GPS-denied areas',
      'Wind tunneling effect between buildings',
      'Signal reflection caused control latency'
    ]
  },
  {
    date: '2024-05-01',
    experiment: 'Low Battery RTH Test',
    outcome: 'Success',
    key_findings: [
      'RTH triggered reliably at 15% battery',
      'Safe landing with 8% remaining',
      'Altitude reduction improves range by 15%'
    ]
  }
];

export class SimulationService {

  /**
   * Execute a tool by name
   */
  async execute(
    sessionId: string,
    toolName: string,
    args: Record<string, any>
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();

    console.log(`[SimulationService] Executing ${toolName} for session ${sessionId}`, args);

    try {
      let result: any;

      switch (toolName) {
        case 'configure_physics':
          result = await this.configurePhysics(sessionId, args as { gravity?: number; friction_coefficient?: number; terrain_type?: string });
          break;

        case 'update_motor_params':
          result = await this.updateMotorParams(sessionId, args as { joint_id: string; torque_limit?: number; pid_p?: number; pid_i?: number; pid_d?: number });
          break;

        case 'run_simulation':
          result = await this.runSimulation(sessionId, args as { duration_seconds?: number; robot_type?: string; wind_speed?: number; airspace_condition?: string });
          break;

        case 'analyze_simulation_video':
          result = await this.analyzeSimulationVideo(sessionId, args as { run_id: string; focus_area?: string; robot_type?: string });
          break;

        case 'search_knowledge_base':
          result = await this.searchKnowledgeBase(sessionId, args as { query: string });
          break;

        case 'start_autonomous_research':
          result = await this.startAutonomousResearch(sessionId, args as { research_goal: string; max_iterations?: number; success_criteria?: string });
          break;

        default:
          throw this.createError('UNKNOWN_TOOL', `Unknown tool: ${toolName}`, true);
      }

      return {
        success: true,
        result,
        executionTimeMs: Date.now() - startTime
      };

    } catch (error: any) {
      console.error(`[SimulationService] Error executing ${toolName}:`, error);

      return {
        success: false,
        error: error.code ? error : this.createError('EXECUTION_ERROR', error.message, true),
        executionTimeMs: Date.now() - startTime
      };
    }
  }

  /**
   * Configure physics parameters
   */
  private async configurePhysics(
    sessionId: string,
    args: { gravity?: number; friction_coefficient?: number; terrain_type?: string }
  ): Promise<ConfigurePhysicsResult> {
    // Variable delay: 300-700ms
    await sleep(randomDelay(300, 700));

    const warnings: string[] = [];

    // Validate inputs
    if (args.friction_coefficient !== undefined) {
      if (args.friction_coefficient < 0 || args.friction_coefficient > 1) {
        args.friction_coefficient = Math.max(0, Math.min(1, args.friction_coefficient));
        warnings.push(`friction_coefficient clamped to valid range [0, 1]`);
      }
    }

    if (args.terrain_type && !['sand', 'concrete', 'grass', 'gravel'].includes(args.terrain_type)) {
      args.terrain_type = 'concrete';
      warnings.push(`Unknown terrain type, defaulting to concrete`);
    }

    const physics = stateStore.updatePhysics(sessionId, args as Partial<PhysicsConfig>);

    return {
      status: warnings.length > 0 ? 'partial' : 'success',
      message: `Physics configuration updated. Terrain=${physics.terrain_type}, Friction=${physics.friction_coefficient}, Gravity=${physics.gravity}m/s²`,
      applied_config: physics,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  /**
   * Update motor parameters
   */
  private async updateMotorParams(
    sessionId: string,
    args: { joint_id: string; torque_limit?: number; pid_p?: number; pid_i?: number; pid_d?: number }
  ): Promise<UpdateMotorResult> {
    // Variable delay: 200-400ms
    await sleep(randomDelay(200, 400));

    if (!args.joint_id) {
      throw this.createError('MISSING_PARAM', 'joint_id is required', true);
    }

    const motor = stateStore.updateMotor(sessionId, args.joint_id, {
      torque_limit: args.torque_limit,
      pid_p: args.pid_p,
      pid_i: args.pid_i,
      pid_d: args.pid_d
    });

    return {
      status: 'success',
      message: `Motor ${args.joint_id} parameters updated. P=${motor.pid_p}, I=${motor.pid_i}, D=${motor.pid_d}, Torque=${motor.torque_limit}Nm`,
      joint_id: args.joint_id,
      applied_params: motor
    };
  }

  /**
   * Run a simulation (supports both ground robots and drones)
   */
  private async runSimulation(
    sessionId: string,
    args: { duration_seconds?: number; robot_type?: string; wind_speed?: number; airspace_condition?: string }
  ): Promise<RunSimulationResult | DroneRunSimulationResult> {
    // Check if this is a drone simulation
    const robotType = (args.robot_type || '').toLowerCase();
    const isDrone = robotType.includes('drone') || robotType.includes('uav') ||
                    robotType.includes('quadcopter') || robotType.includes('aerial');

    if (isDrone) {
      return this.runDroneSimulation(sessionId, args);
    }

    // Ground robot simulation (original logic)
    // Variable delay: 2000-4500ms (simulates actual computation)
    const delay = randomDelay(2000, 4500);
    await sleep(delay);

    const session = stateStore.getOrCreate(sessionId);
    const duration = args.duration_seconds || 5;
    const runId = generateRunId();

    // Generate telemetry
    const telemetry = generateTelemetryStream(
      duration,
      session.physics,
      session.motors,
      50 // 50Hz sample rate for reasonable data size
    );

    // Analyze telemetry
    const metrics = analyzeTelemetry(telemetry);

    // Generate events (including potential failures)
    const events = generateSimulationEvents(telemetry, session.physics);

    // Determine if simulation failed
    const failed = shouldSimulationFail(events);

    // Resolve R2 video URL (falls back to placeholder if no R2 video for this robot type)
    const robotTypeForVideo = (args.robot_type || 'hexapod').toLowerCase();
    const r2VideoUrl = getR2VideoUrl(robotTypeForVideo);
    const videoUrl = r2VideoUrl || `https://picsum.photos/800/450?grayscale&random=${runId}`;

    // Create run record
    const run: SimulationRun = {
      run_id: runId,
      status: failed ? 'failed' : 'completed',
      started_at: Date.now() - delay,
      completed_at: Date.now(),
      duration_requested: duration,
      duration_actual: duration + Math.random() * 0.5,
      physics_config: session.physics,
      motor_configs: session.motors,
      telemetry,
      events,
      metrics,
      video_url: r2VideoUrl
    };

    // Store run
    stateStore.addRun(sessionId, run);

    // Generate summary
    const telemetrySummary = generateTelemetrySummary(telemetry, metrics);

    // Event summaries
    const eventsSummary = events.length > 0
      ? events.slice(0, 3).map(e => `[${e.severity.toUpperCase()}] ${e.message} at t=${(e.timestamp / 1000).toFixed(1)}s`)
      : undefined;

    return {
      run_id: runId,
      status: failed ? 'failed' : 'completed',
      telemetry_summary: telemetrySummary,
      video_url: videoUrl,
      duration_actual: run.duration_actual!,
      metrics,
      events_summary: eventsSummary
    };
  }

  /**
   * Analyze simulation video (supports both ground robots and drones)
   */
  private async analyzeSimulationVideo(
    sessionId: string,
    args: { run_id: string; focus_area?: string; robot_type?: string }
  ): Promise<AnalyzeVideoResult> {
    // Detect if this is a drone analysis
    const runId = args.run_id || '';
    const robotType = (args.robot_type || '').toLowerCase();
    const isDrone = runId.startsWith('flight_') ||
                    robotType.includes('drone') || robotType.includes('uav') ||
                    robotType.includes('quadcopter') || robotType.includes('aerial');

    if (isDrone) {
      // Generate mock drone events for analysis
      const mockEvents: DroneSimulationEvent[] = [
        { timestamp: 12400, type: 'wind_warning', severity: 'warning', message: 'Wind compensation active', data: { roll: 15 } },
        { timestamp: 17840, type: 'motor_failure', severity: 'warning', message: 'Rotor variance detected', data: { variance: 3, rotor: 1 } },
        { timestamp: 29000, type: 'gps_loss', severity: 'warning', message: 'GPS quality degraded', data: { gps_quality: 65 } }
      ];
      return this.analyzeDroneSimulationVideo(sessionId, args, mockEvents, DEFAULT_DRONE_PHYSICS);
    }

    // Ground robot video analysis (original logic)
    // Variable delay: 1500-2800ms
    await sleep(randomDelay(1500, 2800));

    // Try to find the referenced run
    let run = stateStore.getRun(sessionId, args.run_id);

    // If not found, get the latest run
    if (!run) {
      run = stateStore.getLatestRun(sessionId);
    }

    const session = stateStore.getOrCreate(sessionId);

    if (!run) {
      // No runs yet - generate generic analysis
      return {
        analysis: `Visual analysis requested for run ${args.run_id}, but no simulation data found.`,
        findings: ['No telemetry data available for analysis'],
        recommendations: ['Run a simulation first using run_simulation tool'],
        confidence: 0.5
      };
    }

    // Generate findings based on actual telemetry
    const findings: string[] = [];
    const frameAnnotations: { frame: number; annotation: string; confidence: number }[] = [];

    // Find significant events in telemetry
    for (const event of run.events) {
      const frameNum = Math.floor(event.timestamp / 20); // Assuming 50fps
      let annotation = '';

      switch (event.type) {
        case 'slip':
          annotation = `Slippage detected on ${event.data?.leg || 'front-left'} tarsus`;
          findings.push(`Frame ${frameNum}: ${annotation} (confidence: 0.94)`);
          break;

        case 'stability_warning':
        case 'rollover':
          annotation = `Body pitch exceeded ${Math.abs(event.data?.pitch || 15).toFixed(0)}°`;
          findings.push(`Frame ${frameNum}-${frameNum + 20}: ${annotation} during recovery`);
          break;

        case 'gait_mismatch':
          annotation = `Gait phase lag detected`;
          findings.push(`Frame ${frameNum}: ${annotation} between leg_2 and leg_5 (Δ=45ms)`);
          break;

        case 'overheat':
          findings.push(`Frame ${frameNum}: Thermal signature indicates motor stress`);
          break;
      }

      if (annotation) {
        frameAnnotations.push({
          frame: frameNum,
          annotation,
          confidence: 0.85 + Math.random() * 0.1
        });
      }
    }

    // Add generic findings if none from events
    if (findings.length === 0) {
      findings.push('Gait cycle appears nominal');
      findings.push(`Average stability maintained at ${run.metrics?.stability_score || 85}%`);
    }

    // Focus area specific analysis
    if (args.focus_area) {
      findings.push(`Detailed analysis of ${args.focus_area}: No anomalies detected in specified region`);
    }

    // Generate recommendations based on events and physics
    const recommendations = generateRecommendations(run.events, session.physics);

    // Add generic recommendations if none
    if (recommendations.length === 0) {
      recommendations.push('Current parameters appear optimal for this terrain');
      recommendations.push('Consider testing at higher speeds to verify stability margins');
    }

    return {
      analysis: `Visual analysis of run ${args.run_id} complete. Analyzed ${run.telemetry.length} frames over ${run.duration_actual?.toFixed(2)}s.`,
      findings: findings.slice(0, 5),
      recommendations: recommendations.slice(0, 3),
      confidence: 0.88 + Math.random() * 0.1,
      video_url: run.video_url,
      frame_annotations: frameAnnotations.length > 0 ? frameAnnotations.slice(0, 5) : undefined
    };
  }

  /**
   * Search knowledge base
   */
  private async searchKnowledgeBase(
    sessionId: string,
    args: { query: string }
  ): Promise<SearchKnowledgeBaseResult> {
    // Variable delay: 500-1200ms
    await sleep(randomDelay(500, 1200));

    const query = (args.query || '').toLowerCase();
    const queryWords = query.split(/\s+/);

    // Simple keyword matching
    const results = KNOWLEDGE_BASE
      .map(entry => {
        let score = 0;
        const experimentLower = entry.experiment.toLowerCase();
        const outcomeLower = entry.outcome.toLowerCase();

        // Check experiment name
        if (experimentLower.includes(query)) score += 0.5;

        // Check outcome
        if (outcomeLower.includes(query)) score += 0.3;

        // Check key findings
        for (const finding of entry.key_findings) {
          if (finding.toLowerCase().includes(query)) score += 0.2;
        }

        // Word-level matching for multi-word queries
        for (const word of queryWords) {
          if (word.length < 3) continue;
          if (experimentLower.includes(word)) score += 0.15;
          if (outcomeLower.includes(word)) score += 0.1;
          for (const finding of entry.key_findings) {
            if (finding.toLowerCase().includes(word)) score += 0.1;
          }
        }

        // Terrain keywords
        if (query.includes('sand') && experimentLower.includes('sand')) score += 0.4;
        if (query.includes('concrete') && experimentLower.includes('concrete')) score += 0.4;
        if (query.includes('grass') && experimentLower.includes('grass')) score += 0.4;
        if (query.includes('pid') && experimentLower.includes('pid')) score += 0.4;
        if (query.includes('thermal') && experimentLower.includes('thermal')) score += 0.4;

        // Drone-specific keywords
        if (query.includes('wind') && (experimentLower.includes('wind') || entry.key_findings.some(f => f.toLowerCase().includes('wind')))) score += 0.5;
        if (query.includes('hover') && experimentLower.includes('hover')) score += 0.5;
        if (query.includes('quadcopter') || query.includes('quad')) {
          if (experimentLower.includes('quad')) score += 0.5;
        }
        if (query.includes('drone') || query.includes('flight') || query.includes('uav')) {
          if (experimentLower.includes('hover') || experimentLower.includes('waypoint') || experimentLower.includes('wind') || experimentLower.includes('urban') || experimentLower.includes('rth') || experimentLower.includes('battery')) {
            score += 0.4;
          }
        }
        if (query.includes('stability') && (experimentLower.includes('stability') || experimentLower.includes('hover'))) score += 0.4;
        if (query.includes('gps') && (experimentLower.includes('urban') || experimentLower.includes('waypoint'))) score += 0.4;
        if (query.includes('battery') && (experimentLower.includes('battery') || experimentLower.includes('rth'))) score += 0.5;
        if (query.includes('navigation') && (experimentLower.includes('waypoint') || experimentLower.includes('navigation') || experimentLower.includes('urban'))) score += 0.5;

        return {
          ...entry,
          relevance_score: Number(Math.min(1, score).toFixed(2))
        };
      })
      .filter(entry => entry.relevance_score > 0)
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, 5);

    return {
      query: args.query,
      results,
      total_matches: results.length
    };
  }

  /**
   * Start autonomous research (enhanced with rich multi-iteration data)
   */
  private async startAutonomousResearch(
    sessionId: string,
    args: { research_goal: string; max_iterations?: number; success_criteria?: string }
  ): Promise<EnhancedAutonomousResearchResult> {
    // Variable delay: 300-600ms
    await sleep(randomDelay(300, 600));

    const maxIterations = args.max_iterations || 10;
    const successCriteria = args.success_criteria || 'stability > 95%';
    const researchId = `research_${Math.floor(Date.now() / 1000)}_${Math.random().toString(36).substring(2, 6)}`;

    // Parse research goal to generate appropriate hypothesis and parameters
    const goalLower = args.research_goal.toLowerCase();
    const isSandTerrain = goalLower.includes('sand');
    const isGaitOptimization = goalLower.includes('gait') || goalLower.includes('stability');
    const isDroneRelated = goalLower.includes('drone') || goalLower.includes('flight') || goalLower.includes('hover') || goalLower.includes('quadcopter');

    // Generate context-aware research plan
    let initialHypothesis: string;
    let parameterRanges: EnhancedAutonomousResearchResult['research_plan']['parameter_ranges'];
    let phases: EnhancedAutonomousResearchResult['research_plan']['phases'];

    if (isDroneRelated) {
      initialHypothesis = 'Hover instability may be caused by suboptimal altitude PID gains combined with delayed wind compensation. Hypothesis: Increasing D-gain while reducing I-gain should improve transient response without introducing oscillation.';
      parameterRanges = {
        pid_p: { min: 0.6, max: 1.2, step: 0.1 },
        pid_d: { min: 0.2, max: 0.5, step: 0.05 }
      };
      phases = [
        { id: 1, name: 'Baseline Assessment', iterations: 2, focus: 'Establish current hover metrics and identify primary instability modes' },
        { id: 2, name: 'PID Exploration', iterations: 4, focus: 'Systematic sweep of altitude and attitude PID gains' },
        { id: 3, name: 'Wind Response Tuning', iterations: 3, focus: 'Optimize gust rejection with varying wind profiles' },
        { id: 4, name: 'Validation', iterations: 1, focus: 'Confirm stability under combined perturbations' }
      ];
    } else if (isSandTerrain && isGaitOptimization) {
      initialHypothesis = 'Sand terrain instability is caused by low friction coefficient (0.3) combined with aggressive pid_p (1.2). Hypothesis: Increasing friction to 0.5-0.7 while reducing pid_p to 0.8-1.0 should improve traction and reduce oscillation.';
      parameterRanges = {
        friction_coefficient: { min: 0.4, max: 0.8, step: 0.1 },
        pid_p: { min: 0.6, max: 1.2, step: 0.1 },
        pid_d: { min: 0.03, max: 0.08, step: 0.01 }
      };
      phases = [
        { id: 1, name: 'Baseline Assessment', iterations: 2, focus: 'Establish current performance metrics on sand' },
        { id: 2, name: 'Parameter Exploration', iterations: 4, focus: 'Systematic friction/PID sweep' },
        { id: 3, name: 'Fine Tuning', iterations: 3, focus: 'Gradient descent on best candidates' },
        { id: 4, name: 'Validation', iterations: 1, focus: 'Confirm stability under perturbation' }
      ];
    } else {
      initialHypothesis = 'Current configuration may have suboptimal parameter combinations. Hypothesis: Systematic exploration of PID gains and physics parameters will identify more stable operating points.';
      parameterRanges = {
        pid_p: { min: 0.5, max: 1.5, step: 0.1 },
        pid_d: { min: 0.02, max: 0.1, step: 0.01 }
      };
      phases = [
        { id: 1, name: 'Baseline Assessment', iterations: 2, focus: 'Establish current performance metrics' },
        { id: 2, name: 'Parameter Exploration', iterations: 5, focus: 'Systematic parameter sweep' },
        { id: 3, name: 'Optimization', iterations: 2, focus: 'Fine-tune best configuration' },
        { id: 4, name: 'Validation', iterations: 1, focus: 'Verify stability margins' }
      ];
    }

    // Calculate estimated duration based on iterations
    const estimatedDurationMinutes = Math.ceil(maxIterations * 0.8);

    return {
      status: 'initiated',
      research_id: researchId,
      message: `Autonomous research initiated: ${args.research_goal}. System will execute up to ${maxIterations} simulation cycles with adaptive parameter tuning.`,
      max_iterations: maxIterations,
      success_criteria: successCriteria,
      estimated_duration_minutes: estimatedDurationMinutes,
      research_plan: {
        phases,
        initial_hypothesis: initialHypothesis,
        parameter_ranges: parameterRanges
      },
      checkpoints: [
        { after_iteration: 2, expected_metric: 'stability_score >= 70', action_if_failed: 'Widen parameter search' },
        { after_iteration: Math.floor(maxIterations * 0.6), expected_metric: 'stability_score >= 85', action_if_failed: 'Switch to alternative approach' },
        { after_iteration: maxIterations, expected_metric: `${successCriteria}`, action_if_failed: 'Report best achieved with recommendations' }
      ],
      early_termination: {
        success_threshold: 97,
        failure_conditions: ['3 consecutive critical failures', 'motor_overheat detected', 'system_error']
      }
    };
  }

  /**
   * Run drone simulation
   */
  async runDroneSimulation(
    sessionId: string,
    args: { duration_seconds?: number; wind_speed?: number; airspace_condition?: string }
  ): Promise<DroneRunSimulationResult> {
    // Variable delay: 2000-4000ms
    const delay = randomDelay(2000, 4000);
    await sleep(delay);

    const duration = args.duration_seconds || 30;
    const runId = `flight_${Math.floor(Date.now() / 1000)}_${Math.random().toString(36).substring(2, 6)}`;

    // Build drone physics config
    const dronePhysics: DronePhysicsConfig = {
      ...DEFAULT_DRONE_PHYSICS,
      wind_speed: args.wind_speed ?? DEFAULT_DRONE_PHYSICS.wind_speed,
      airspace_condition: (args.airspace_condition as DronePhysicsConfig['airspace_condition']) || DEFAULT_DRONE_PHYSICS.airspace_condition
    };

    // Generate drone telemetry
    const telemetry = generateDroneTelemetryStream(duration, dronePhysics, 50);

    // Analyze telemetry
    const metrics = analyzeDroneTelemetry(telemetry);
    const flightPath = analyzeDroneFlightPath(telemetry);

    // Generate events (including potential failures)
    const events = generateDroneSimulationEvents(telemetry, dronePhysics);

    // Determine if simulation failed
    const failed = shouldDroneSimulationFail(events);

    // Generate summary
    const telemetrySummary = generateDroneTelemetrySummary(telemetry, metrics, flightPath);

    // Resolve R2 video URL for drone
    const r2VideoUrl = R2_VIDEO_MAP.drone;
    const videoUrl = r2VideoUrl || `https://picsum.photos/800/450?grayscale&random=${runId}`;

    // Event summaries
    const eventsSummary = events.length > 0
      ? events.slice(0, 3).map(e => `[${e.severity.toUpperCase()}] ${e.message} at t=${(e.timestamp / 1000).toFixed(1)}s`)
      : undefined;

    return {
      run_id: runId,
      status: failed ? 'failed' : 'completed',
      telemetry_summary: telemetrySummary,
      video_url: videoUrl,
      duration_actual: duration + Math.random() * 0.5,
      metrics,
      flight_path: flightPath,
      events_summary: eventsSummary
    };
  }

  /**
   * Analyze drone simulation video
   */
  async analyzeDroneSimulationVideo(
    sessionId: string,
    args: { run_id: string; focus_area?: string },
    events: DroneSimulationEvent[],
    dronePhysics: DronePhysicsConfig
  ): Promise<AnalyzeVideoResult> {
    // Variable delay: 1500-2800ms
    await sleep(randomDelay(1500, 2800));

    const findings: string[] = [];
    const frameAnnotations: { frame: number; annotation: string; confidence: number }[] = [];

    // Generate findings based on events
    for (const event of events) {
      const frameNum = Math.floor(event.timestamp / 20); // Assuming 50fps
      let annotation = '';

      switch (event.type) {
        case 'wind_warning':
          annotation = `Wind gust detected - ${Math.abs(event.data?.roll || 15).toFixed(0)}° roll compensation initiated`;
          findings.push(`Frame ${frameNum}: ${annotation}`);
          break;

        case 'motor_failure':
          annotation = `Rotor showing ${event.data?.variance?.toFixed(0) || '3'}% RPM variance`;
          findings.push(`Frame ${frameNum}-${frameNum + 18}: ${annotation} (within tolerance)`);
          break;

        case 'gps_loss':
          annotation = 'GPS multipath interference detected';
          findings.push(`Frame ${frameNum}: ${annotation} caused position jump`);
          break;

        case 'low_battery':
          findings.push(`Frame ${frameNum}: Battery warning - ${event.data?.battery_remaining?.toFixed(0) || '15'}% remaining`);
          break;

        case 'signal_lost':
          findings.push(`Frame ${frameNum}: RC signal degradation to ${event.data?.signal_strength || '-70'}dBm`);
          break;
      }

      if (annotation) {
        frameAnnotations.push({
          frame: frameNum,
          annotation,
          confidence: 0.85 + Math.random() * 0.12
        });
      }
    }

    // Add landing analysis if no other major findings
    if (findings.length < 3) {
      findings.push('Frame 2100: Descent rate exceeded 2m/s during landing approach');
      frameAnnotations.push({
        frame: 2100,
        annotation: 'Fast descent warning',
        confidence: 0.92
      });
    }

    // Generate recommendations
    const recommendations = generateDroneRecommendations(events, dronePhysics);

    // Add generic recommendations if none
    if (recommendations.length === 0) {
      recommendations.push('Current flight parameters appear nominal');
      recommendations.push('Consider testing in higher wind conditions to verify stability margins');
    }

    // Add landing-specific recommendation
    if (!recommendations.some(r => r.includes('landing'))) {
      recommendations.push('Reduce landing descent rate to < 1.5m/s for smoother touchdown');
    }

    return {
      analysis: `Visual analysis of flight ${args.run_id} complete. Analyzed ${Math.floor((args.focus_area ? 30 : 45) * 50)} frames over ${args.focus_area ? '30.0' : '45.2'}s.`,
      findings: findings.slice(0, 5),
      recommendations: recommendations.slice(0, 4),
      confidence: 0.88 + Math.random() * 0.08,
      video_url: R2_VIDEO_MAP.drone,
      frame_annotations: frameAnnotations.length > 0 ? frameAnnotations.slice(0, 5) : undefined
    };
  }

  /**
   * Create a standardized error
   */
  private createError(code: string, message: string, recoverable: boolean): ToolError {
    return { code, message, recoverable };
  }
}

// Singleton instance
export const simulationService = new SimulationService();
