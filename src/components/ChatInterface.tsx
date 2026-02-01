import React, { useEffect, useRef, useState } from 'react';
import { Message, ToolCall, ToolResult } from '../types';
import { Send, UploadCloud, Cpu } from 'lucide-react';
import { ThinkingBlock } from './ThinkingBlock';

interface ChatInterfaceProps {
  messages: Message[];
  onSendMessage: (text: string) => void;
  isProcessing: boolean;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages, onSendMessage, isProcessing }) => {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;
    onSendMessage(input);
    setInput('');
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-background relative">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none">
        <div className="flex items-center gap-2 text-muted text-sm opacity-50">
          <Cpu className="w-4 h-4" />
          <span>Gemini 3 Pro // Interactions API // Active</span>
        </div>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-6 pt-16 space-y-8">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-muted opacity-50 gap-4">
            <Cpu className="w-16 h-16 stroke-1" />
            <p className="text-lg">Initialize Research Protocol...</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col max-w-3xl mx-auto ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>

            {/* Thinking / Tools Block (Only for model) */}
            {msg.role === 'model' && (msg.toolCalls || msg.thinkingSteps || msg.currentStatus) && (
               <div className="w-full">
                 <ThinkingBlock
                    toolCalls={msg.toolCalls}
                    toolResults={msg.toolResults}
                    thinkingSteps={msg.thinkingSteps}
                    currentStatus={msg.currentStatus}
                    isComplete={!msg.isThinking}
                 />
               </div>
            )}

            {/* Message Bubble */}
            <div className={`
              px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap
              ${msg.role === 'user'
                ? 'bg-primary text-white rounded-br-none'
                : 'text-text w-full pl-0 pt-0'}
            `}>
              {msg.text && (
                 <div className={msg.role === 'model' ? "prose prose-invert prose-sm max-w-none font-sans" : ""}>
                    {msg.text}
                 </div>
              )}
            </div>

          </div>
        ))}

        {isProcessing && !messages[messages.length-1]?.toolCalls && (
            <div className="max-w-3xl mx-auto w-full">
                 <div className="flex items-center gap-2 text-muted text-xs animate-pulse">
                    <Cpu className="w-3 h-3" />
                    <span>Thinking...</span>
                 </div>
            </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input Area */}
      <div className="p-6 border-t border-border bg-background">
        <div className="max-w-3xl mx-auto">
          <form onSubmit={handleSubmit} className="relative">
            <div className="absolute left-3 top-3 text-muted hover:text-text cursor-pointer transition-colors">
               <UploadCloud className="w-5 h-5" />
            </div>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if(e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                }
              }}
              placeholder="Give instructions to the research agent..."
              className="w-full bg-surface border border-border rounded-xl pl-10 pr-12 py-3 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary resize-none h-[52px] min-h-[52px] max-h-[200px]"
            />
            <button
              type="submit"
              disabled={!input.trim() || isProcessing}
              className="absolute right-2 top-2 p-1.5 bg-primary text-white rounded-lg hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
          <div className="text-center mt-2">
             <span className="text-[10px] text-muted uppercase tracking-widest opacity-60">Action Mode Enabled • Max Thinking Budget 32k</span>
          </div>
        </div>
      </div>
    </div>
  );
};
