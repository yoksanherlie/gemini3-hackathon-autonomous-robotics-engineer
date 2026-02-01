import { Message, ToolCall, ToolResult, InteractionState, ThinkingStep } from "../types";

// API base URL - proxied through Vite in development
const API_BASE = '/api/gemini';

// Mock Execution Logic (runs on frontend for now)
const executeTool = async (name: string, args: any): Promise<any> => {
  console.log(`Executing tool: ${name}`, args);
  await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate latency

  switch (name) {
    case "configure_physics":
      return { status: "success", message: `Physics updated: Terrain=${args.terrain_type}, Friction=${args.friction_coefficient || 'default'}` };
    case "update_motor_params":
      return { status: "success", message: `Motor ${args.joint_id} updated. P=${args.pid_p || 1.0}` };
    case "run_simulation":
      return {
        run_id: `sim_${Math.floor(Math.random() * 10000)}`,
        status: "completed",
        telemetry_summary: "Instability detected at t=4.2s",
        video_url: "https://picsum.photos/800/450?grayscale"
      };
    case "analyze_simulation_video":
      return {
        analysis: `Visual analysis of run ${args.run_id} complete.`,
        findings: [
          "Slippage detected on front-left tarsus.",
          "Body pitch exceeded 45 degrees causing rollover.",
          "Gait phase mismatch between leg 2 and 4."
        ],
        confidence: 0.98
      };
    case "search_knowledge_base":
      return {
        results: [
          { date: "2023-10-01", experiment: "Sand Gait V1", outcome: "Failed - overheating" },
          { date: "2023-11-15", experiment: "Sand Gait V2", outcome: "Success - low speed" }
        ]
      };
    case "start_autonomous_research":
      return {
        status: "initiated",
        message: `Autonomous research started: ${args.research_goal}`,
        max_iterations: args.max_iterations || 10,
        success_criteria: args.success_criteria || "task completion"
      };
    default:
      return { error: "Unknown tool" };
  }
};

// Sleep utility
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class GeminiService {

  /**
   * Send a message using the backend API with Server-Sent Events for streaming
   */
  async sendMessage(
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

      const output = await executeTool(call.name, call.args);

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
          toolResults
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
   * Run autonomous research in background mode
   */
  async runAutonomousResearch(
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
      // Create background interaction
      const interaction = await this.createInteraction(
        researchPrompt,
        previousInteractionId,
        true // background mode
      );

      currentInteractionId = interaction.id;
      currentState.id = currentInteractionId;
      onProgress(currentState);

      // Polling loop for background task
      while (currentState.status !== 'completed' && currentState.status !== 'failed') {
        // Check for cancellation
        if (abortSignal?.aborted) {
          await this.cancelInteraction(currentInteractionId);
          currentState.status = 'failed';
          onProgress(currentState);
          break;
        }

        await sleep(5000); // Poll every 5 seconds

        const updatedInteraction = await this.getInteraction(currentInteractionId);

        // Update state
        currentState = {
          id: currentInteractionId,
          status: updatedInteraction.status,
          progress: updatedInteraction.progress || Math.min((iterationCount / maxIterations) * 100, 99),
          iterationCount: updatedInteraction.iterationCount || iterationCount,
          maxIterations,
          researchGoal
        };

        // Stream text updates
        if (updatedInteraction.text && updatedInteraction.text !== fullText) {
          fullText = updatedInteraction.text;
          onTextChunk(fullText);
        }

        // Process any tool calls
        if (updatedInteraction.functionCalls && updatedInteraction.functionCalls.length > 0) {
          for (const call of updatedInteraction.functionCalls) {
            const callId = call.id || Math.random().toString(36).substr(2, 9);
            onToolStart({ id: callId, name: call.name, args: call.args });
            const output = await executeTool(call.name, call.args);
            onToolEnd({ toolId: callId, name: call.name, result: output });

            // Track simulation runs as iterations
            if (call.name === 'run_simulation') {
              iterationCount++;
              currentState.iterationCount = iterationCount;
              currentState.progress = Math.min((iterationCount / maxIterations) * 100, 99);
            }
          }
        }

        onProgress(currentState);

        // Safety: stop after max iterations
        if (iterationCount >= maxIterations) {
          currentState.status = 'completed';
          currentState.progress = 100;
          onProgress(currentState);
          break;
        }
      }

      // Final state
      currentState.status = 'completed';
      currentState.progress = 100;
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
