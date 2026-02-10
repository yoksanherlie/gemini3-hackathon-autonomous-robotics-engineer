import { Message, ToolCall, ToolResult, InteractionState, ThinkingStep } from "../types";
import dotenv from 'dotenv';

dotenv.config({ path: '.env'});

// API base URL - proxied through Vite in development
const API_BASE = `${process.env.API_BASE_URL || '/api/gemini'}`;

// Tool Execution Result from backend
interface ToolExecutionResponse {
  success: boolean;
  result?: any;
  error?: { code: string; message: string; recoverable: boolean };
  executionTimeMs: number;
}

/**
 * Execute a tool via the backend simulation service
 */
const executeToolRemote = async (sessionId: string, name: string, args: any): Promise<any> => {
  console.log(`[executeToolRemote] Session: ${sessionId}, Tool: ${name}`, args);

  try {
    const response = await fetch(`${API_BASE}/execute-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId,
        toolName: name,
        args
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result: ToolExecutionResponse = await response.json();

    console.log(`[executeToolRemote] ${name} completed in ${result.executionTimeMs}ms`, result);

    if (!result.success && result.error) {
      return {
        error: result.error.message,
        code: result.error.code,
        recoverable: result.error.recoverable
      };
    }

    return result.result;

  } catch (error: any) {
    console.error(`[executeToolRemote] Error executing ${name}:`, error);
    return {
      error: error.message || 'Failed to execute tool',
      code: 'NETWORK_ERROR',
      recoverable: true
    };
  }
};

export class GeminiService {

  /**
   * Send a message using the backend API with Server-Sent Events for streaming
   */
  async sendMessage(
    sessionId: string,
    history: Message[],
    newMessage: string,
    previousInteractionId: string | undefined,
    onToolStart: (tool: ToolCall) => void,
    onToolEnd: (result: ToolResult) => void,
    onTextChunk: (chunk: string) => void,
    onThinkingStep: (step: ThinkingStep) => void,
    onStatusUpdate: (status: string) => void,
    onAutonomousResearchStart?: (args: { research_goal: string; max_iterations?: number; success_criteria?: string }) => void
  ): Promise<{ text: string; interactionId: string; autonomousResearchRequested?: boolean }> {

    const genStepId = () => `step_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    try {
      onStatusUpdate("Connecting to server...");

      // Use fetch with EventSource-like handling for SSE
      const response = await fetch(`${API_BASE}/chat-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: history.map(m => ({ role: m.role, text: m.text })),
          newMessage,
          previousInteractionId
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let fullText = '';
      let interactionId = previousInteractionId || '';
      let functionCalls: any[] = [];
      let autonomousResearchRequested = false;

      // Read the SSE stream
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        let currentEvent = '';
        let currentData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7);
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6);

            try {
              const data = JSON.parse(currentData);

              switch (currentEvent) {
                case 'status':
                  onStatusUpdate(data.status);
                  break;

                case 'thinking':
                  onThinkingStep({
                    id: genStepId(),
                    type: 'thinking',
                    content: data.content,
                    timestamp: Date.now()
                  });
                  break;

                case 'text':
                  fullText = data.content;
                  onTextChunk(fullText);
                  break;

                case 'functionCalls':
                  functionCalls = data.calls;
                  break;

                case 'done':
                  fullText = data.text;
                  interactionId = data.interactionId;
                  if (data.functionCalls) {
                    functionCalls = data.functionCalls;
                  }
                  break;

                case 'error':
                  throw new Error(data.message);
              }
            } catch (parseError) {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }

      // Process function calls if any
      if (functionCalls && functionCalls.length > 0) {
        onStatusUpdate("Executing tools...");

        const processResult = await this.processToolCalls(
          sessionId,
          functionCalls,
          history,
          fullText,
          onToolStart,
          onToolEnd,
          onTextChunk,
          onThinkingStep,
          onStatusUpdate,
          onAutonomousResearchStart
        );

        fullText = processResult.text;
        autonomousResearchRequested = processResult.autonomousResearchRequested || false;
      }

      return { text: fullText, interactionId, autonomousResearchRequested };

    } catch (error) {
      console.error("Gemini Error:", error);
      onStatusUpdate("Error occurred");
      return {
        text: "I encountered a protocol error while communicating with the lab subsystems. Ensure the API configuration is valid.",
        interactionId: previousInteractionId || ""
      };
    }
  }

  /**
   * Process tool calls and get analysis from the backend
   */
  private async processToolCalls(
    sessionId: string,
    toolCalls: Array<{ id?: string; name: string; args: Record<string, any> }>,
    history: Message[],
    initialText: string,
    onToolStart: (tool: ToolCall) => void,
    onToolEnd: (result: ToolResult) => void,
    onTextChunk: (chunk: string) => void,
    onThinkingStep: (step: ThinkingStep) => void,
    onStatusUpdate: (status: string) => void,
    onAutonomousResearchStart?: (args: { research_goal: string; max_iterations?: number; success_criteria?: string }) => void
  ): Promise<{ text: string; autonomousResearchRequested?: boolean }> {

    const toolResults = [];
    let autonomousResearchRequested = false;
    const genStepId = () => `step_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    // Execute each tool
    for (const call of toolCalls) {
      const callId = call.id || Math.random().toString(36).substr(2, 9);
      const toolCall: ToolCall = { id: callId, name: call.name, args: call.args };

      // Check if this is the autonomous research tool
      if (call.name === 'start_autonomous_research') {
        autonomousResearchRequested = true;
        if (onAutonomousResearchStart) {
          onAutonomousResearchStart(call.args as any);
        }
      }

      onStatusUpdate(`Executing ${call.name}...`);
      onThinkingStep({
        id: genStepId(),
        type: 'tool_call',
        content: `Calling ${call.name}`,
        toolCall,
        timestamp: Date.now()
      });
      onToolStart(toolCall);

      const output = await executeToolRemote(sessionId, call.name, call.args);

      const toolResult: ToolResult = { toolId: callId, name: call.name, result: output };
      onThinkingStep({
        id: genStepId(),
        type: 'tool_result',
        content: `${call.name} completed`,
        toolResult,
        timestamp: Date.now()
      });
      onToolEnd(toolResult);

      toolResults.push({
        id: call.id,
        name: call.name,
        response: { result: output }
      });
    }

    // Check if any tool result contains a video_url from analyze_simulation_video
    let videoUrl: string | undefined;
    for (const tr of toolResults) {
      if (tr.name === 'analyze_simulation_video' && tr.response?.result?.video_url) {
        videoUrl = tr.response.result.video_url;
        break;
      }
    }

    // Send tool results to backend for analysis
    onStatusUpdate("Analyzing tool results...");
    onThinkingStep({
      id: genStepId(),
      type: 'status',
      content: 'Generating analysis of results...',
      timestamp: Date.now()
    });

    try {
      const response = await fetch(`${API_BASE}/tool-response`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: history.map(m => ({ role: m.role, text: m.text })),
          initialText,
          toolCalls,
          toolResults,
          videoUrl
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let analysisText = initialText;

      // Read the SSE stream for analysis
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        let currentEvent = '';
        let currentData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7);
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6);

            try {
              const data = JSON.parse(currentData);

              switch (currentEvent) {
                case 'status':
                  onStatusUpdate(data.status);
                  break;

                case 'thinking':
                  onThinkingStep({
                    id: genStepId(),
                    type: 'thinking',
                    content: data.content,
                    timestamp: Date.now()
                  });
                  break;

                case 'text':
                  analysisText = data.content;
                  onTextChunk(analysisText);
                  break;

                case 'done':
                  analysisText = data.text;
                  break;

                case 'error':
                  throw new Error(data.message);
              }
            } catch (parseError) {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }

      return { text: analysisText, autonomousResearchRequested };

    } catch (error) {
      console.error("Tool response error:", error);
      return { text: initialText + "\n\n[Error analyzing tool results]", autonomousResearchRequested };
    }
  }

  /**
   * Create an interaction (for stateful conversations)
   */
  async createInteraction(
    input: string,
    previousInteractionId?: string,
    background: boolean = false
  ): Promise<{
    id: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    text: string;
    functionCalls?: any[];
  }> {
    const response = await fetch(`${API_BASE}/interaction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input,
        previousInteractionId,
        background
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Get interaction status (for polling background tasks)
   */
  async getInteraction(interactionId: string): Promise<{
    id: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    text: string;
    functionCalls?: any[];
    progress?: number;
    iterationCount?: number;
  }> {
    const response = await fetch(`${API_BASE}/interaction/${interactionId}`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Cancel an interaction
   */
  async cancelInteraction(interactionId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/interaction/${interactionId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  }

  /**
   * Run autonomous research via server-side Interactions API with tool call loop.
   * The server handles the full tool execution cycle and streams progress via SSE.
   */
  async runAutonomousResearch(
    sessionId: string,
    researchGoal: string,
    maxIterations: number = 10,
    successCriteria: string,
    previousInteractionId: string | undefined,
    onProgress: (state: InteractionState) => void,
    onToolStart: (tool: ToolCall) => void,
    onToolEnd: (result: ToolResult) => void,
    onTextChunk: (chunk: string) => void,
    abortSignal?: AbortSignal
  ): Promise<{ text: string; interactionId: string; finalState: InteractionState }> {

    const researchPrompt = `
AUTONOMOUS RESEARCH TASK:
Goal: ${researchGoal}
Success Criteria: ${successCriteria}
Maximum Iterations: ${maxIterations}

Execute this research autonomously. Run multiple simulation cycles, analyze results, adjust parameters, and iterate until success criteria is met or maximum iterations reached.

For each iteration:
1. Formulate a hypothesis based on previous results
2. Configure simulation parameters
3. Run the simulation
4. Analyze results
5. Determine next steps

Begin the research now.
`;

    let currentInteractionId = "";
    let fullText = "";
    let iterationCount = 0;
    let currentState: InteractionState = {
      id: "",
      status: 'in_progress',
      progress: 0,
      iterationCount: 0,
      maxIterations,
      researchGoal
    };

    try {
      onProgress(currentState);

      // POST to /interaction — server handles the tool call loop via SSE
      const response = await fetch(`${API_BASE}/interaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: researchPrompt,
          previousInteractionId,
          sessionId,
          maxIterations
        }),
        signal: abortSignal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();

      // Consume the SSE stream
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        let currentEvent = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7);
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              switch (currentEvent) {
                case 'status':
                  // Status updates from the server
                  break;

                case 'text':
                  fullText = data.content;
                  onTextChunk(fullText);
                  break;

                case 'tool_start':
                  onToolStart({ id: data.id, name: data.name, args: data.args });
                  break;

                case 'tool_end':
                  onToolEnd({ toolId: data.id, name: data.name, result: data.result });
                  break;

                case 'progress':
                  iterationCount = data.iterationCount;
                  currentState = {
                    ...currentState,
                    iterationCount,
                    progress: Math.min((iterationCount / maxIterations) * 100, 99)
                  };
                  onProgress(currentState);
                  break;

                case 'done':
                  fullText = data.text || fullText;
                  currentInteractionId = data.interactionId || currentInteractionId;
                  iterationCount = data.iterationCount || iterationCount;
                  break;

                case 'error':
                  throw new Error(data.message);
              }
            } catch (parseError) {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }

      // Final state
      currentState = {
        id: currentInteractionId,
        status: 'completed',
        progress: 100,
        iterationCount,
        maxIterations,
        researchGoal
      };
      onProgress(currentState);

      return {
        text: fullText,
        interactionId: currentInteractionId,
        finalState: currentState
      };

    } catch (error) {
      console.error("Autonomous research error:", error);
      currentState.status = 'failed';
      onProgress(currentState);

      return {
        text: "Autonomous research encountered an error. Please check the console for details.",
        interactionId: currentInteractionId,
        finalState: currentState
      };
    }
  }
}

export const geminiService = new GeminiService();
