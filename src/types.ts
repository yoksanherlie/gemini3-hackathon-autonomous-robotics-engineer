export interface ThinkingStep {
  id: string;
  type: 'thinking' | 'tool_call' | 'tool_result' | 'status';
  content: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  timestamp: number;
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  isThinking?: boolean;
  thinkingSteps?: ThinkingStep[];  // Chain of thought steps
  currentStatus?: string;  // What the agent is currently doing
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface ToolResult {
  toolId: string;
  name: string;
  result: any;
}

export interface VisualAnalysisResult {
  analysis: string;
  findings: string[];
  confidence: number;
  timestamp: number;
}

export interface RobotContext {
  id: string;
  name: string;
  type: string;
  status: string;
  currentVideoUrl?: string;
  videoUrl?: string;
  telemetry?: Record<string, any>;
  jointAngles?: Record<string, number>;
  sensorReadings?: Record<string, any>;
  lastVisualAnalysis?: VisualAnalysisResult;
}

export interface InteractionState {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  progress?: number;  // 0-100 for long-running tasks
  iterationCount?: number;  // Number of simulation iterations run
  maxIterations?: number;  // Maximum iterations for the task
  researchGoal?: string;  // Description of what the research is trying to achieve
}

export interface Session {
  id: string;
  title: string;
  previewText: string;
  lastActive: number;
  messages: Message[];
  status: 'idle' | 'running' | 'waiting';
  robots: RobotContext[];
  activeRobotId: string;
  lastInteractionId?: string;  // For stateful conversations
  currentInteraction?: InteractionState;  // Track background task
}

export enum SimulationStatus {
  IDLE = 'IDLE',
  CONFIGURING = 'CONFIGURING',
  RUNNING = 'RUNNING',
  ANALYZING = 'ANALYZING',
  FAILED = 'FAILED',
  SUCCESS = 'SUCCESS'
}

export interface AnalysisState {
  currentFrame?: string; // Image URL
  logs?: string[];
  activeParameter?: string;
}
