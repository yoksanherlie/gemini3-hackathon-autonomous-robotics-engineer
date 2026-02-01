import React from 'react';
import { Session } from '../types';
import { Bot, Plus, Terminal, Activity, Clock } from 'lucide-react';

interface SessionListProps {
  sessions: Session[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
}

export const SessionList: React.FC<SessionListProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession
}) => {
  return (
    <div className="w-64 bg-background border-r border-border flex flex-col h-full">
      <div className="p-4 border-b border-border flex items-center gap-2">
        <div className="bg-primary/20 p-2 rounded-lg">
           <Bot className="w-5 h-5 text-primary" />
        </div>
        <span className="font-semibold text-text tracking-tight">RoboLab OS</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted uppercase tracking-wider">
          Active Experiments
        </div>
        {sessions.map((session) => (
          <button
            key={session.id}
            onClick={() => onSelectSession(session.id)}
            className={`w-full text-left p-3 rounded-lg text-sm transition-colors group relative ${
              activeSessionId === session.id
                ? 'bg-surface text-white shadow-sm ring-1 ring-border'
                : 'text-muted hover:bg-surface/50 hover:text-text'
            }`}
          >
            <div className="font-medium truncate mb-1 pr-4">{session.title}</div>
            <div className="text-xs text-muted/80 truncate font-mono">
              {session.previewText}
            </div>
            {session.status === 'running' && (
              <Activity className="w-3 h-3 text-accent absolute top-3 right-3 animate-pulse" />
            )}
          </button>
        ))}
      </div>

      <div className="p-4 border-t border-border">
        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-2 bg-text text-background font-medium py-2 px-4 rounded-md hover:bg-white transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Experiment
        </button>
      </div>
    </div>
  );
};
