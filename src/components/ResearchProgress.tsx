import React from 'react';
import { InteractionState } from '../types';
import { Loader2, CheckCircle2, XCircle, FlaskConical, Pause } from 'lucide-react';

interface ResearchProgressProps {
  interaction: InteractionState;
  onCancel: () => void;
}

export const ResearchProgress: React.FC<ResearchProgressProps> = ({ interaction, onCancel }) => {
  const { status, progress = 0, iterationCount = 0, maxIterations = 10, researchGoal } = interaction;

  const getStatusIcon = () => {
    switch (status) {
      case 'pending':
        return <Loader2 className="w-4 h-4 animate-spin text-muted" />;
      case 'in_progress':
        return <FlaskConical className="w-4 h-4 text-primary animate-pulse" />;
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-green-400" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-400" />;
      default:
        return <Loader2 className="w-4 h-4 animate-spin text-muted" />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'pending':
        return 'Initializing research...';
      case 'in_progress':
        return `Running simulation ${iterationCount} of ${maxIterations}`;
      case 'completed':
        return 'Research complete';
      case 'failed':
        return 'Research failed';
      default:
        return 'Unknown status';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'pending':
        return 'border-muted';
      case 'in_progress':
        return 'border-primary';
      case 'completed':
        return 'border-green-500';
      case 'failed':
        return 'border-red-500';
      default:
        return 'border-muted';
    }
  };

  const isActive = status === 'pending' || status === 'in_progress';

  return (
    <div className={`bg-surface rounded-lg p-4 border ${getStatusColor()} transition-colors`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <span className="text-xs font-medium text-text uppercase tracking-wider">
            Autonomous Research
          </span>
        </div>
        {isActive && (
          <button
            onClick={onCancel}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-muted hover:text-red-400 border border-border hover:border-red-400 rounded transition-colors"
          >
            <Pause className="w-3 h-3" />
            Cancel
          </button>
        )}
      </div>

      {/* Research Goal */}
      {researchGoal && (
        <div className="mb-3">
          <div className="text-[10px] text-muted uppercase tracking-wider mb-1">Goal</div>
          <div className="text-xs text-text/80 line-clamp-2">{researchGoal}</div>
        </div>
      )}

      {/* Progress Bar */}
      <div className="mb-2">
        <div className="flex justify-between items-center mb-1">
          <span className="text-[10px] text-muted">{getStatusText()}</span>
          <span className="text-[10px] font-mono text-primary">{Math.round(progress)}%</span>
        </div>
        <div className="h-1.5 bg-black/30 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ease-out ${
              status === 'completed'
                ? 'bg-green-500'
                : status === 'failed'
                ? 'bg-red-500'
                : 'bg-primary'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Iteration Counter */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-[10px] text-muted">Iterations</div>
            <div className="text-sm font-mono text-text">
              {iterationCount} / {maxIterations}
            </div>
          </div>
          {isActive && (
            <div className="flex gap-1">
              {Array.from({ length: maxIterations }).map((_, i) => (
                <div
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i < iterationCount
                      ? 'bg-primary'
                      : i === iterationCount && status === 'in_progress'
                      ? 'bg-primary animate-pulse'
                      : 'bg-black/30'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
        {status === 'completed' && (
          <span className="text-[10px] text-green-400 font-medium">SUCCESS</span>
        )}
        {status === 'failed' && (
          <span className="text-[10px] text-red-400 font-medium">STOPPED</span>
        )}
      </div>
    </div>
  );
};
