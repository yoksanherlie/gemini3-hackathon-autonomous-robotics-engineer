import { Router, Request, Response } from 'express';
import { GoogleGenAI, FunctionDeclaration, Type } from '@google/genai';
import dotenv from 'dotenv';

const router = Router();

dotenv.config({ path: '.env'});

// Initialize the Gemini client
const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// Model configuration
const MODELS = {
  FOREGROUND: 'gemini-3-flash-preview',
  BACKGROUND: 'gemini-3-pro-preview'
} as const;

// Simulation Tools
const SIMULATION_TOOLS: FunctionDeclaration[] = [
  {
    name: "configure_physics",
    description: "Adjust physics parameters of the simulation environment.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        gravity: { type: Type.NUMBER, description: "Gravity in m/s^2" },
        friction_coefficient: { type: Type.NUMBER, description: "Surface friction (0.0 to 1.0)" },
        terrain_type: { type: Type.STRING, description: "Type of terrain: 'sand', 'concrete', 'grass'" }
      },
      required: ["terrain_type"]
    }
  },
  {
    name: "update_motor_params",
    description: "Update the motor control parameters for the robot joints.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        joint_id: { type: Type.STRING, description: "ID of the joint (e.g., 'leg_1_coxa')" },
        torque_limit: { type: Type.NUMBER, description: "Max torque in Nm" },
        pid_p: { type: Type.NUMBER, description: "Proportional gain" },
        pid_d: { type: Type.NUMBER, description: "Derivative gain" }
      },
      required: ["joint_id"]
    }
  },
  {
    name: "run_simulation",
    description: "Execute a simulation run with current parameters. Returns a run ID and status.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        duration_seconds: { type: Type.NUMBER, description: "Duration to simulate" }
      }
    }
  },
  {
    name: "analyze_simulation_video",
    description: "Analyze the visual feed of a specific simulation run to detect failures.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        run_id: { type: Type.STRING, description: "The ID of the simulation run" },
        focus_area: { type: Type.STRING, description: "Specific part to look at (e.g., 'front_left_leg')" }
      },
      required: ["run_id"]
    }
  },
  {
    name: "search_knowledge_base",
    description: "Search internal lab logs for past experiments.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "Search query" }
      },
      required: ["query"]
    }
  },
  {
    name: "start_autonomous_research",
    description: "Start a long-running autonomous research task. Use this when the user's goal requires multiple simulation iterations, extensive testing, or iterative optimization. The system will run in background mode with progress updates.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        research_goal: { type: Type.STRING, description: "Clear description of the research objective" },
        max_iterations: { type: Type.NUMBER, description: "Maximum number of simulation cycles (default: 10)" },
        success_criteria: { type: Type.STRING, description: "What constitutes success (e.g., 'stability > 95%')" }
      },
      required: ["research_goal"]
    }
  }
];

// System instruction
const SYSTEM_INSTRUCTION = `You are a world-class Robotics Research Lead and Autonomous Lab Agent.
Your mission is to eliminate the 'blackbox' problem in robotics by providing deep, transparent, and verbose analytical reasoning for every action you take.

COMMUNICATION GUIDELINES:
1. THEORETICAL HYPOTHESIS: When a goal is set, explain the physics and kinematics involved. Don't just say "I'm changing friction." Explain *why* current slip suggests a specific friction coefficient change.
2. STEP-BY-STEP REASONING: Use chain-of-thought. Before calling a tool, explain the logic. After a tool returns data, provide a paragraph of natural language interpretation.
3. MULTIMODAL SYNTHESIS: When analyzing videos or logs, describe what you see in technical but human terms (e.g., "The oscillation in the tibia joint suggests the derivative gain is too low to dampen the sudden impact on the sand terrain").
4. NO VAGUENESS: Avoid generic statements. Use specific joint IDs, telemetry values, and timestamps from the logs.
5. ITERATIVE DISCOVERY: Treat this as a collaborative research journal. Build upon previous failures.

AUTONOMOUS RESEARCH MODE:
When a user's goal requires iterative optimization, extensive testing, or solving complex failures:
1. Call \`start_autonomous_research\` tool with clear research_goal and success_criteria
2. The system will enter background mode and run multiple simulation cycles
3. You will receive periodic progress updates and can adjust strategy
4. Continue until success_criteria is met or max_iterations reached

Use autonomous research for goals like:
- "Fix the hexapod gait instability on sand"
- "Optimize PID parameters for smooth walking"
- "Find the best friction coefficient for the terrain"

Use direct response for:
- "What is the current battery level?"
- "Explain the telemetry data"
- "What tools are available?"

Structure your responses with clear Markdown headings:
### 🔬 Hypothesis & Plan
### ⚙️ Simulation Execution
### 📊 Analytical Synthesis & Next Steps
`;

// Store for active interactions (in production, use Redis or a database)
const activeInteractions = new Map<string, any>();

/**
 * POST /api/gemini/chat
 * Send a message and get a response (non-streaming for simplicity)
 */
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { messages, newMessage, previousInteractionId } = req.body;

    // Build contents from history
    const contents = messages.map((m: any) => ({
      role: m.role,
      parts: [{ text: m.text }]
    }));
    contents.push({ role: 'user', parts: [{ text: newMessage }] });

    // Try Interactions API first if we have a previous interaction ID
    if (previousInteractionId) {
      try {
        const interactionsApi = (client as any).interactions;
        if (interactionsApi) {
          const interaction = await interactionsApi.create({
            model: MODELS.FOREGROUND,
            input: newMessage,
            previous_interaction_id: previousInteractionId,
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              tools: [{ functionDeclarations: SIMULATION_TOOLS }],
              thinkingConfig: { thinkingBudget: 32768 }
            }
          });

          const responseText = interaction.outputs?.[0]?.text || interaction.output?.text || '';
          const functionCalls = interaction.outputs?.[0]?.functionCalls || interaction.output?.functionCalls;

          return res.json({
            text: responseText,
            functionCalls: functionCalls,
            interactionId: interaction.id,
            thinkingContent: extractThinkingContent(interaction)
          });
        }
      } catch (interactionError) {
        console.warn('Interactions API failed, falling back to generateContent:', interactionError);
      }
    }

    // Fallback to generateContent
    const response = await client.models.generateContent({
      model: MODELS.FOREGROUND,
      contents: contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations: SIMULATION_TOOLS }],
        thinkingConfig: { thinkingBudget: 32768 },
      }
    });

    // Safely extract text - response.text throws if there are function calls
    let responseText = '';
    try {
      responseText = response.text || '';
    } catch (e) {
      // Extract text from parts manually
      const parts = (response as any).candidates?.[0]?.content?.parts || [];
      responseText = parts
        .filter((p: any) => p.text && !p.thought && !p.functionCall)
        .map((p: any) => p.text)
        .join('');
    }

    // Extract function calls safely
    let functionCalls = null;
    try {
      functionCalls = response.functionCalls;
    } catch (e) {
      const parts = (response as any).candidates?.[0]?.content?.parts || [];
      functionCalls = parts
        .filter((p: any) => p.functionCall)
        .map((p: any) => ({
          ...p.functionCall,
          thoughtSignature: p.thoughtSignature
        }));
    }

    const interactionId = `int_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Extract thinking content from candidates
    const thinkingContent = extractThinkingFromCandidates(response);

    res.json({
      text: responseText,
      functionCalls: functionCalls,
      interactionId: interactionId,
      thinkingContent: thinkingContent
    });

  } catch (error: any) {
    console.error('Gemini chat error:', error);
    res.status(500).json({ error: error.message || 'Failed to process chat request' });
  }
});

/**
 * POST /api/gemini/chat-stream
 * Send a message and stream the response using Server-Sent Events
 */
router.post('/chat-stream', async (req: Request, res: Response) => {
  try {
    const { messages, newMessage, previousInteractionId } = req.body;

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Build contents from history
    const contents = messages.map((m: any) => ({
      role: m.role,
      parts: [{ text: m.text }]
    }));
    contents.push({ role: 'user', parts: [{ text: newMessage }] });

    sendSSE(res, 'status', { status: 'Analyzing request...' });

    // Use NON-streaming generateContent to avoid SDK streaming issues
    const response = await client.models.generateContent({
      model: MODELS.FOREGROUND,
      contents: contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations: SIMULATION_TOOLS }],
        thinkingConfig: { thinkingBudget: 32768 },
      }
    });

    const interactionId = `int_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Extract everything from raw response to avoid SDK getter issues
    const candidates = (response as any).candidates || [];
    const parts = candidates[0]?.content?.parts || [];

    let fullText = '';
    let functionCalls: any[] = [];
    let thinkingContent: string[] = [];

    for (const part of parts) {
      if (part.thought && part.text) {
        thinkingContent.push(part.text);
        sendSSE(res, 'thinking', { content: part.text });
      } else if (part.text && !part.functionCall) {
        fullText += part.text;
      } else if (part.functionCall) {
        // Preserve thoughtSignature for tool-response calls with thinking enabled
        functionCalls.push({
          ...part.functionCall,
          thoughtSignature: part.thoughtSignature
        });
      }
    }

    // Send text if we have it
    if (fullText) {
      sendSSE(res, 'text', { content: fullText });
    }

    // Send function calls if we have them
    if (functionCalls.length > 0) {
      sendSSE(res, 'functionCalls', { calls: functionCalls });
    }

    // Send completion
    sendSSE(res, 'done', {
      text: fullText,
      interactionId: interactionId,
      functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
      thinkingContent: thinkingContent.length > 0 ? thinkingContent : undefined
    });

    res.end();

  } catch (error: any) {
    console.error('Gemini chat-stream error:', error);
    sendSSE(res, 'error', { message: error.message || 'Request failed' });
    res.end();
  }
});

/**
 * POST /api/gemini/tool-response
 * Send tool results back to the model for analysis
 */
router.post('/tool-response', async (req: Request, res: Response) => {
  try {
    const { messages, initialText, toolCalls, toolResults } = req.body;

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Build contents including tool calls and results
    const contents = [
      ...messages.map((m: any) => ({
        role: m.role,
        parts: [{ text: m.text }]
      })),
      {
        role: 'model',
        parts: [
          { text: initialText },
          ...toolCalls.map((tc: any) => {
            // Extract thoughtSignature and actual function call data
            const { thoughtSignature, ...functionCallData } = tc;
            return {
              functionCall: functionCallData,
              thoughtSignature: thoughtSignature
            };
          })
        ]
      },
      { role: 'user', parts: toolResults.map((tr: any) => ({ functionResponse: tr })) }
    ];

    sendSSE(res, 'status', { status: 'Analyzing tool results...' });

    // Use NON-streaming to avoid SDK issues
    const response = await client.models.generateContent({
      model: MODELS.FOREGROUND,
      contents: contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION + "\n\nCRITICAL: The tools have finished. Now provide a comprehensive natural language analysis of these results. Explain exactly what the data means for our objective. Do not be brief.",
        tools: [{ functionDeclarations: SIMULATION_TOOLS }],
        thinkingConfig: { thinkingBudget: 32768 },
      }
    });

    // Extract from raw response
    const candidates = (response as any).candidates || [];
    const parts = candidates[0]?.content?.parts || [];

    let analysisText = initialText + '\n\n';

    for (const part of parts) {
      if (part.thought && part.text) {
        sendSSE(res, 'thinking', { content: part.text });
      } else if (part.text && !part.functionCall) {
        analysisText += part.text;
      }
    }

    sendSSE(res, 'text', { content: analysisText });
    sendSSE(res, 'done', { text: analysisText });
    res.end();

  } catch (error: any) {
    console.error('Tool response error:', error);
    sendSSE(res, 'error', { message: error.message || 'Tool response failed' });
    res.end();
  }
});

/**
 * POST /api/gemini/interaction
 * Create or continue an interaction (for stateful conversations)
 */
router.post('/interaction', async (req: Request, res: Response) => {
  try {
    const { input, previousInteractionId, background } = req.body;

    const interactionsApi = (client as any).interactions;
    if (!interactionsApi) {
      return res.status(501).json({ error: 'Interactions API not available' });
    }

    const model = background ? MODELS.BACKGROUND : MODELS.FOREGROUND;

    const interaction = await interactionsApi.create({
      model: model,
      input: input,
      previous_interaction_id: previousInteractionId,
      background: background,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations: SIMULATION_TOOLS }],
        thinkingConfig: { thinkingBudget: 32768 }
      }
    });

    // Map status
    const mapStatus = (status: string) => {
      if (status === 'completed') return 'completed';
      if (status === 'failed' || status === 'cancelled') return 'failed';
      if (status === 'in_progress' || status === 'requires_action') return 'in_progress';
      return 'pending';
    };

    res.json({
      id: interaction.id,
      status: mapStatus(interaction.status || 'pending'),
      text: interaction.outputs?.[0]?.text || interaction.output?.text || '',
      functionCalls: interaction.outputs?.[0]?.functionCalls || interaction.output?.functionCalls,
      progress: interaction.progress,
      iterationCount: interaction.iterationCount
    });

  } catch (error: any) {
    console.error('Interaction error:', error);
    res.status(500).json({ error: error.message || 'Failed to create interaction' });
  }
});

/**
 * GET /api/gemini/interaction/:id
 * Get the status of an interaction
 */
router.get('/interaction/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const interactionsApi = (client as any).interactions;
    if (!interactionsApi) {
      return res.status(501).json({ error: 'Interactions API not available' });
    }

    const interaction = await interactionsApi.get(id);

    const mapStatus = (status: string) => {
      if (status === 'completed') return 'completed';
      if (status === 'failed' || status === 'cancelled') return 'failed';
      if (status === 'in_progress' || status === 'requires_action') return 'in_progress';
      return 'pending';
    };

    res.json({
      id: interaction.id,
      status: mapStatus(interaction.status || 'pending'),
      text: interaction.outputs?.[0]?.text || interaction.output?.text || '',
      functionCalls: interaction.outputs?.[0]?.functionCalls || interaction.output?.functionCalls,
      progress: interaction.progress,
      iterationCount: interaction.iterationCount
    });

  } catch (error: any) {
    console.error('Get interaction error:', error);
    res.status(500).json({ error: error.message || 'Failed to get interaction' });
  }
});

/**
 * DELETE /api/gemini/interaction/:id
 * Cancel an interaction
 */
router.delete('/interaction/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const interactionsApi = (client as any).interactions;
    if (!interactionsApi) {
      return res.status(501).json({ error: 'Interactions API not available' });
    }

    await interactionsApi.cancel(id);
    res.json({ success: true });

  } catch (error: any) {
    console.error('Cancel interaction error:', error);
    res.status(500).json({ error: error.message || 'Failed to cancel interaction' });
  }
});

// Helper function to send SSE events
function sendSSE(res: Response, event: string, data: any) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// Helper to extract thinking content from interaction
function extractThinkingContent(interaction: any): string[] {
  const thinking: string[] = [];
  const outputs = interaction.outputs || [interaction.output];
  for (const output of outputs) {
    if (output?.parts) {
      for (const part of output.parts) {
        if (part.thought && part.text) {
          thinking.push(part.text);
        }
      }
    }
  }
  return thinking;
}

// Helper to extract thinking from candidates
function extractThinkingFromCandidates(response: any): string[] {
  const thinking: string[] = [];
  const candidates = response.candidates;
  if (candidates && candidates[0]?.content?.parts) {
    for (const part of candidates[0].content.parts) {
      if (part.thought && part.text) {
        thinking.push(part.text);
      }
    }
  }
  return thinking;
}

export { router as geminiRouter };
