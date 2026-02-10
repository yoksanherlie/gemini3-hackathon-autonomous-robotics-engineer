import React, { useState, useRef, useCallback } from 'react';
import { SessionList } from './components/SessionList';
import { ChatInterface } from './components/ChatInterface';
import { ContextPanel } from './components/ContextPanel';
import { Session, Message, ToolCall, ToolResult, InteractionState, ThinkingStep } from './types';
import { geminiService } from './services/geminiService';

const INITIAL_SESSION: Session = {
  id: 'sess_001',
  title: 'Gusty Wind Optimization',
  previewText: 'Analyzing air friction...',
  lastActive: Date.now(),
  status: 'idle',
  activeRobotId: 'robot_3',
  robots: [
    {
      id: 'robot_1',
      name: 'HX-9000 Hexapod',
      type: 'Multi-legged Walker',
      status: 'Standby',
      currentVideoUrl: 'https://picsum.photos/id/237/800/450?grayscale',
      telemetry: {
         last_run_status: 'stable',
         battery: '98%'
      },
      jointAngles: {
        'coxa_L1': 0.05,
        'femur_L1': 0.45,
        'tibia_L1': -0.82,
        'coxa_R1': -0.02,
        'femur_R1': 0.48,
        'tibia_R1': -0.80,
      },
      sensorReadings: {
        'IMU_Pitch': '1.2°',
        'IMU_Roll': '0.3°',
        'Lidar_Front': '4.2m',
        'Torque_Avg': '2.1Nm'
      }
    },
    {
      id: 'robot_2',
      name: 'QS-V4 Quadruped',
      type: 'Spot-Style Walker',
      status: 'Charging',
      currentVideoUrl: 'https://picsum.photos/id/1025/800/450?grayscale',
      telemetry: {
         last_run_status: 'idle',
         battery: '100%'
      },
      jointAngles: {
        'fl_hip': 0.0,
        'fl_knee': 0.0,
        'fr_hip': 0.0,
        'fr_knee': 0.0,
      },
      sensorReadings: {
        'IMU_Pitch': '0.0°',
        'Lidar_Front': 'Offline'
      }
    },
    {
      id: 'robot_3',
      name: 'SkyWatch-X4 Quadcopter',
      type: 'Aerial UAV',
      status: 'Grounded',
      currentVideoUrl: 'https://pub-d81bd376745a4ee1b9073461f2c2651d.r2.dev/frame_1671607621205360381.jpg',
      videoUrl: 'https://pub-d81bd376745a4ee1b9073461f2c2651d.r2.dev/uav_scenes.mp4',
      telemetry: {
        last_run_status: 'idle',
        battery: '95%',
        gps_fix: '3D',
        altitude: '0m'
      },
      jointAngles: {
        'rotor_fl': 0,
        'rotor_fr': 0,
        'rotor_bl': 0,
        'rotor_br': 0,
      },
      sensorReadings: {
        'Altitude': '0m',
        'GPS_Quality': '98%',
        'Wind_Speed': '2.1m/s',
        'Battery_V': '16.2V'
      }
    }
  ],
  messages: [{
    id: 'msg_0',
    role: 'model',
    text: "Welcome to the Autonomous Research Lab. I'm connected to the fleet management system. I have access to the HX-9000 Hexapod, QS-V4 Quadruped and SkyWatch-X4 Quadcopter. What is our objective today?",
    timestamp: Date.now()
  }]
};

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([INITIAL_SESSION]);
  const [activeSessionId, setActiveSessionId] = useState<string>(INITIAL_SESSION.id);
  const [isProcessing, setIsProcessing] = useState(false);

  // AbortController for cancelling background research
  const abortControllerRef = useRef<AbortController | null>(null);

  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];

  const updateSessionMessage = useCallback((sessionId: string, messageId: string, updates: Partial<Message>) => {
    setSessions(prev => prev.map(s => {
      if (s.id === sessionId) {
        return {
          ...s,
          messages: s.messages.map(m => m.id === messageId ? { ...m, ...updates } : m)
        };
      }
      return s;
    }));
  }, []);

  const updateActiveRobotContext = useCallback((sessionId: string, contextUpdates: any) => {
    setSessions(prev => prev.map(s => {
      if (s.id === sessionId) {
        const updatedRobots = s.robots.map(robot =>
          robot.id === s.activeRobotId ? { ...robot, ...contextUpdates } : robot
        );
        return {
          ...s,
          robots: updatedRobots
        };
      }
      return s;
    }));
  }, []);

  const updateSessionInteraction = useCallback((sessionId: string, updates: Partial<Session>) => {
    setSessions(prev => prev.map(s => {
      if (s.id === sessionId) {
        return { ...s, ...updates };
      }
      return s;
    }));
  }, []);

  /**
   * Handle autonomous research when the AI decides to use start_autonomous_research tool
   */
  const handleAutonomousResearch = useCallback(async (
    args: { research_goal: string; max_iterations?: number; success_criteria?: string },
    responseId: string
  ) => {
    const sessionId = activeSessionId;
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;

    // Create abort controller for cancellation
    abortControllerRef.current = new AbortController();

    const maxIterations = args.max_iterations || 10;
    const successCriteria = args.success_criteria || 'task completion';

    // Initialize interaction state
    const initialState: InteractionState = {
      id: '',
      status: 'pending',
      progress: 0,
      iterationCount: 0,
      maxIterations,
      researchGoal: args.research_goal
    };

    updateSessionInteraction(sessionId, { currentInteraction: initialState });

    let currentToolCalls: ToolCall[] = [];
    let currentToolResults: ToolResult[] = [];

    try {
      const result = await geminiService.runAutonomousResearch(
        sessionId,
        args.research_goal,
        maxIterations,
        successCriteria,
        session.lastInteractionId,
        // onProgress
        (state) => {
          updateSessionInteraction(sessionId, { currentInteraction: state });
        },
        // onToolStart
        (toolCall) => {
          currentToolCalls.push(toolCall);
          updateSessionMessage(sessionId, responseId, { toolCalls: [...currentToolCalls] });
        },
        // onToolEnd
        (toolResult) => {
          currentToolResults.push(toolResult);
          updateSessionMessage(sessionId, responseId, { toolResults: [...currentToolResults] });

          if (toolResult.name === 'run_simulation') {
            updateActiveRobotContext(sessionId, {
              currentVideoUrl: toolResult.result.video_url,
              telemetry: {
                last_run_id: toolResult.result.run_id,
                status: toolResult.result.status
              },
              lastVisualAnalysis: undefined
            });
          }

          if (toolResult.name === 'analyze_simulation_video') {
            updateActiveRobotContext(sessionId, {
              lastVisualAnalysis: {
                ...toolResult.result,
                timestamp: Date.now()
              }
            });
          }
        },
        // onTextChunk
        (textChunk) => {
          updateSessionMessage(sessionId, responseId, { text: textChunk });
        },
        abortControllerRef.current.signal
      );

      // Update session with new interaction ID
      updateSessionInteraction(sessionId, {
        lastInteractionId: result.interactionId,
        currentInteraction: result.finalState
      });

    } catch (error) {
      console.error("Autonomous research error:", error);
      updateSessionInteraction(sessionId, {
        currentInteraction: {
          ...initialState,
          status: 'failed'
        }
      });
    }
  }, [activeSessionId, sessions, updateSessionMessage, updateActiveRobotContext, updateSessionInteraction]);

  /**
   * Cancel ongoing background research
   */
  const handleCancelResearch = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const handleSendMessage = async (text: string) => {
    // 1. Add User Message
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      text,
      timestamp: Date.now()
    };

    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        return {
          ...s,
          messages: [...s.messages, userMsg],
          status: 'running',
          previewText: text
        };
      }
      return s;
    }));

    setIsProcessing(true);

    try {
        const responseId = (Date.now() + 1).toString();

        let currentToolCalls: ToolCall[] = [];
        let currentToolResults: ToolResult[] = [];
        let currentThinkingSteps: ThinkingStep[] = [];

        // Add initial model message for streaming
        setSessions(prev => prev.map(s => {
            if (s.id === activeSessionId) {
              return {
                ...s,
                messages: [...s.messages, {
                   id: responseId,
                   role: 'model',
                   text: '',
                   timestamp: Date.now(),
                   isThinking: true,
                   thinkingSteps: [],
                   currentStatus: 'Initializing...'
                }]
              };
            }
            return s;
        }));

        // Call Gemini Service with Interactions API
        const result = await geminiService.sendMessage(
            activeSessionId,
            activeSession.messages,
            text,
            activeSession.lastInteractionId,
            // onToolStart
            (toolCall) => {
                currentToolCalls.push(toolCall);
                updateSessionMessage(activeSessionId, responseId, { toolCalls: [...currentToolCalls] });
            },
            // onToolEnd
            (toolResult) => {
                currentToolResults.push(toolResult);
                updateSessionMessage(activeSessionId, responseId, { toolResults: [...currentToolResults] });

                if (toolResult.name === 'run_simulation') {
                   updateActiveRobotContext(activeSessionId, {
                      currentVideoUrl: toolResult.result.video_url,
                      telemetry: {
                         last_run_id: toolResult.result.run_id,
                         status: toolResult.result.status
                      },
                      lastVisualAnalysis: undefined
                   });
                }

                if (toolResult.name === 'analyze_simulation_video') {
                   updateActiveRobotContext(activeSessionId, {
                      lastVisualAnalysis: {
                          ...toolResult.result,
                          timestamp: Date.now()
                      }
                   });
                }
            },
            // onTextChunk
            (textChunk) => {
                updateSessionMessage(activeSessionId, responseId, { text: textChunk });
            },
            // onThinkingStep - captures chain of thought reasoning
            (step) => {
                currentThinkingSteps.push(step);
                updateSessionMessage(activeSessionId, responseId, { thinkingSteps: [...currentThinkingSteps] });
            },
            // onStatusUpdate - shows what the agent is currently doing
            (status) => {
                updateSessionMessage(activeSessionId, responseId, { currentStatus: status });
            },
            // onAutonomousResearchStart - called when AI decides to start background research
            (args) => {
                // Don't await here - let it run in background
                handleAutonomousResearch(args, responseId);
            }
        );

        // Update session with new interaction ID for stateful conversations
        updateSessionInteraction(activeSessionId, {
          lastInteractionId: result.interactionId
        });

        // Finalize state
        updateSessionMessage(activeSessionId, responseId, {
            isThinking: false,
            currentStatus: undefined
        });

    } catch (error) {
        console.error("Error in chat loop", error);
    } finally {
        setIsProcessing(false);
        setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, status: 'idle' } : s));
    }
  };

  const handleRobotSelect = (robotId: string) => {
    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        return { ...s, activeRobotId: robotId };
      }
      return s;
    }));
  };

  const createNewSession = () => {
    const newId = `sess_${Date.now()}`;
    const newSession: Session = {
        ...INITIAL_SESSION,
        id: newId,
        title: 'New Experiment',
        lastInteractionId: undefined,  // New session starts fresh
        currentInteraction: undefined,
        messages: [{
            id: 'init',
            role: 'model',
            text: 'New session initialized. Ready for instructions.',
            timestamp: Date.now()
        }]
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newId);
  };

  return (
    <div className="flex h-screen w-screen bg-background text-text overflow-hidden font-sans">
      <SessionList
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={setActiveSessionId}
        onNewSession={createNewSession}
      />
      <ChatInterface
        messages={activeSession.messages}
        onSendMessage={handleSendMessage}
        isProcessing={isProcessing}
      />
      <ContextPanel
        session={activeSession}
        onSelectRobot={handleRobotSelect}
        onCancelResearch={handleCancelResearch}
      />
    </div>
  );
}
