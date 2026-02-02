import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, BrainCircuit, CheckCircle2, Loader2, Wrench, MessageSquare, Zap, Sparkles } from 'lucide-react';
import { ToolCall, ToolResult, ThinkingStep } from '../types';

interface ThinkingBlockProps {
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  thinkingSteps?: ThinkingStep[];
  currentStatus?: string;
  isComplete: boolean;
}

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
  toolCalls,
  toolResults,
  thinkingSteps,
  currentStatus,
  isComplete
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const stepsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest step
  useEffect(() => {
    if (isExpanded && stepsEndRef.current) {
      stepsEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [thinkingSteps, isExpanded]);

  const hasContent = (thinkingSteps && thinkingSteps.length > 0) || (toolCalls && toolCalls.length > 0);

  if (!hasContent && !currentStatus) return null;

  const getStepIcon = (step: ThinkingStep) => {
    switch (step.type) {
      case 'thinking':
        return <Sparkles className="w-3.5 h-3.5 text-purple-400" />;
      case 'tool_call':
        return <Wrench className="w-3 h-3 text-accent" />;
      case 'tool_result':
        return <CheckCircle2 className="w-3 h-3 text-green-500" />;
      case 'status':
        return <Zap className="w-3 h-3 text-yellow-400" />;
      default:
        return <MessageSquare className="w-3 h-3 text-muted" />;
    }
  };

  const getStepColor = (step: ThinkingStep) => {
    switch (step.type) {
      case 'thinking':
        return 'border-l-purple-500 border-l-[3px]';
      case 'tool_call':
        return 'border-l-accent/50';
      case 'tool_result':
        return 'border-l-green-500/50';
      case 'status':
        return 'border-l-yellow-500/50';
      default:
        return 'border-l-muted/50';
    }
  };

  const hasThinkingContent = thinkingSteps && thinkingSteps.some(s => s.type === 'thinking');

  return (
    <div className={`mt-2 mb-4 rounded-lg border ${hasThinkingContent ? 'border-purple-500/30' : 'border-border'} bg-surface/30 overflow-hidden`}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 p-2.5 px-3 bg-gradient-to-r from-purple-500/10 to-surface/50 hover:from-purple-500/20 hover:to-surface text-xs font-medium text-muted transition-colors"
      >
        {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Sparkles className="w-3.5 h-3.5 text-purple-400" />
        <span className="text-purple-300">Inner Thoughts & Actions</span>
        {thinkingSteps && thinkingSteps.filter(s => s.type === 'thinking').length > 0 && (
          <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded">
            {thinkingSteps.filter(s => s.type === 'thinking').length} thoughts
          </span>
        )}
        <span className="text-[10px] text-muted/60 ml-1">
          ({thinkingSteps?.length || 0} total steps)
        </span>
        {!isComplete && <Loader2 className="w-3 h-3 animate-spin ml-auto text-purple-400" />}
        {isComplete && <CheckCircle2 className="w-3 h-3 text-green-500 ml-auto" />}
      </button>

      {/* Current Status Banner */}
      {!isComplete && currentStatus && (
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/20 flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin text-primary" />
          <span className="text-xs text-primary font-medium">{currentStatus}</span>
        </div>
      )}

      {/* Steps Timeline */}
      {isExpanded && (
        <div className="p-3 space-y-2 max-h-[500px] overflow-y-auto custom-scrollbar">
          {/* Render thinking steps if available */}
          {thinkingSteps && thinkingSteps.length > 0 ? (
            thinkingSteps.map((step, index) => (
              <div
                key={step.id}
                className={`pl-3 border-l-2 ${getStepColor(step)} animate-in fade-in slide-in-from-left-2 duration-300 ${step.type === 'thinking' ? 'my-3' : ''}`}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="flex items-start gap-2">
                  <div className="mt-0.5">{getStepIcon(step)}</div>
                  <div className="flex-1 min-w-0">
                    {step.type === 'thinking' && (
                      <div className="rounded-lg bg-purple-500/10 border border-purple-500/20 p-3">
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-purple-400">Model Reasoning</span>
                        </div>
                        <div className="text-xs text-text/90 leading-relaxed whitespace-pre-wrap">
                          {step.content}
                        </div>
                      </div>
                    )}

                    {step.type === 'tool_call' && step.toolCall && (
                      <div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono font-bold text-accent">{step.toolCall.name}</span>
                          <span className="text-muted truncate">
                            {Object.entries(step.toolCall.args).slice(0, 2).map(([k, v]) =>
                              `${k}: ${typeof v === 'string' ? v.slice(0, 20) : v}`
                            ).join(', ')}
                            {Object.keys(step.toolCall.args).length > 2 && '...'}
                          </span>
                        </div>
                      </div>
                    )}

                    {step.type === 'tool_result' && step.toolResult && (
                      <div>
                        <div className="text-xs text-green-400 font-medium mb-1">
                          {step.toolResult.name} completed
                        </div>
                        <div className="p-2 bg-black/20 rounded border border-border/50 font-mono text-[10px] text-muted overflow-x-auto max-h-[100px] overflow-y-auto">
                          <pre>{JSON.stringify(step.toolResult.result, null, 2)}</pre>
                        </div>
                      </div>
                    )}

                    {step.type === 'status' && (
                      <div className="text-xs text-yellow-400 font-medium">
                        {step.content}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          ) : (
            // Fallback to legacy tool calls display
            toolCalls && toolCalls.map((call) => {
              const result = toolResults?.find(r => r.toolId === call.id);
              const isDone = !!result;

              return (
                <div key={call.id} className="pl-3 border-l-2 border-l-accent/50">
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5">
                      {isDone ? (
                        <CheckCircle2 className="w-3 h-3 text-green-500" />
                      ) : (
                        <Loader2 className="w-3 h-3 text-accent animate-spin" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs mb-1">
                        <span className="font-mono font-bold text-accent">{call.name}</span>
                        <span className="text-muted truncate max-w-[200px]">
                          ({Object.entries(call.args).map(([k,v]) => `${k}:${v}`).join(', ')})
                        </span>
                      </div>
                      {result && (
                        <div className="p-2 bg-black/20 rounded border border-border/50 font-mono text-[10px] text-muted overflow-x-auto max-h-[100px] overflow-y-auto">
                          <pre>{JSON.stringify(result.result, null, 2)}</pre>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={stepsEndRef} />
        </div>
      )}
    </div>
  );
};
