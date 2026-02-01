import React from 'react';
import { Session, RobotContext } from '../types';
import { PlayCircle, FileText, Activity, Video, Settings2, Gauge, ChevronDown, Bot, ScanEye, X } from 'lucide-react';
import { ResearchProgress } from './ResearchProgress';

interface ContextPanelProps {
  session: Session;
  onSelectRobot: (robotId: string) => void;
  onCancelResearch?: () => void;
}

export const ContextPanel: React.FC<ContextPanelProps> = ({ session, onSelectRobot, onCancelResearch }) => {
  const activeRobot = session.robots.find(r => r.id === session.activeRobotId);
  const hasActiveResearch = session.currentInteraction &&
    (session.currentInteraction.status === 'pending' || session.currentInteraction.status === 'in_progress');

  return (
    <div className="w-80 bg-background border-l border-border flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <h3 className="font-medium text-text text-sm flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-accent" />
          Fleet Status
        </h3>

        {/* Robot Selector */}
        <div className="relative">
          <select
            value={session.activeRobotId}
            onChange={(e) => onSelectRobot(e.target.value)}
            className="w-full appearance-none bg-surface border border-border rounded-lg py-2 pl-9 pr-8 text-sm text-text focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer hover:bg-surface/80 transition-colors"
          >
            {session.robots.map(robot => (
              <option key={robot.id} value={robot.id}>{robot.name}</option>
            ))}
          </select>
          <Bot className="w-4 h-4 text-muted absolute left-3 top-2.5 pointer-events-none" />
          <ChevronDown className="w-4 h-4 text-muted absolute right-3 top-2.5 pointer-events-none" />
        </div>
      </div>

      {!activeRobot ? (
         <div className="flex-1 flex flex-col items-center justify-center text-muted text-sm p-6 text-center opacity-50">
            <Bot className="w-12 h-12 mb-2 stroke-1" />
            <p>No active robot selected.</p>
         </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-6">

          {/* Research Progress - Show when autonomous research is active */}
          {session.currentInteraction && (
            <ResearchProgress
              interaction={session.currentInteraction}
              onCancel={onCancelResearch || (() => {})}
            />
          )}

          {/* Active Robot Card */}
          <div className="bg-surface rounded-lg p-3 border border-border">
            <div className="flex justify-between items-start mb-2">
              <div>
                 <div className="text-xs text-muted uppercase tracking-wider">Type</div>
                 <div className="text-sm font-semibold text-text">{activeRobot.type}</div>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] border ${
                  activeRobot.status === 'Standby' || activeRobot.status === 'Charging'
                  ? 'bg-yellow-900/30 text-yellow-400 border-yellow-900'
                  : 'bg-green-900/30 text-green-400 border-green-900'
              }`}>
                 {activeRobot.status.toUpperCase()}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
               <div className="bg-black/20 p-2 rounded">
                  <div className="text-[10px] text-muted">Battery</div>
                  <div className="text-xs font-mono">
                    {activeRobot.telemetry?.battery || 'N/A'}
                  </div>
               </div>
               <div className="bg-black/20 p-2 rounded">
                  <div className="text-[10px] text-muted">Run Status</div>
                  <div className="text-xs font-mono truncate">
                    {activeRobot.telemetry?.last_run_status || 'Idle'}
                  </div>
               </div>
            </div>
          </div>

          {/* Live/Sim Video Feed with Analysis Overlay */}
          <div className="space-y-2">
             <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted flex items-center gap-1">
                   <Video className="w-3 h-3" /> Visual Feed
                </span>
                <span className={`text-[10px] ${hasActiveResearch ? 'text-primary' : 'text-red-400'} animate-pulse`}>
                  {hasActiveResearch ? '● RESEARCH' : '● LIVE'}
                </span>
             </div>
             <div className="aspect-video bg-black rounded-lg border border-border overflow-hidden relative group">
                {activeRobot.currentVideoUrl ? (
                   <img src={activeRobot.currentVideoUrl} alt="Sim feed" className="w-full h-full object-cover opacity-80" />
                ) : (
                   <div className="w-full h-full flex items-center justify-center bg-zinc-900">
                      <PlayCircle className="w-8 h-8 text-muted opacity-50" />
                   </div>
                )}

                {/* ID Overlay */}
                <div className="absolute top-2 left-2 pointer-events-none">
                   <div className="text-[10px] font-mono text-green-400 bg-black/50 px-1 rounded">
                      {activeRobot.id.toUpperCase()}_CAM
                   </div>
                </div>

                {/* Analysis Overlay */}
                {activeRobot.lastVisualAnalysis && (
                  <div className="absolute inset-x-2 bottom-2 bg-black/70 backdrop-blur-md border border-red-500/30 p-2 rounded text-xs text-white/90 transition-all animate-in fade-in slide-in-from-bottom-2">
                      <div className="flex items-center gap-2 mb-1 text-red-400 font-bold uppercase tracking-wider text-[10px]">
                          <ScanEye className="w-3 h-3" />
                          Analysis Overlay
                          <span className="ml-auto text-muted font-normal normal-case">
                              {(activeRobot.lastVisualAnalysis.confidence * 100).toFixed(0)}% conf
                          </span>
                      </div>
                      <ul className="list-disc list-inside space-y-0.5 text-[10px] opacity-90">
                          {activeRobot.lastVisualAnalysis.findings.map((f, i) => (
                              <li key={i} className="truncate">{f}</li>
                          ))}
                      </ul>
                  </div>
                )}
             </div>
          </div>

          {/* Joint Telemetry */}
          {activeRobot.jointAngles && (
            <div className="space-y-2">
               <span className="text-xs font-medium text-muted flex items-center gap-1">
                   <Settings2 className="w-3 h-3" /> Joint Telemetry
               </span>
               <div className="grid grid-cols-2 gap-2">
                   {Object.entries(activeRobot.jointAngles).map(([joint, angle]) => (
                       <div key={joint} className="bg-surface border border-border rounded p-2 flex justify-between items-center group hover:border-primary/50 transition-colors">
                           <span className="text-[10px] text-muted font-mono truncate" title={joint}>{joint}</span>
                           <span className="text-xs font-mono text-primary group-hover:text-white">{(angle as number).toFixed(2)}</span>
                       </div>
                   ))}
               </div>
            </div>
          )}

          {/* Sensor Array */}
          {activeRobot.sensorReadings && (
            <div className="space-y-2">
               <span className="text-xs font-medium text-muted flex items-center gap-1">
                   <Gauge className="w-3 h-3" /> Sensor Array
               </span>
               <div className="grid grid-cols-2 gap-2">
                   {Object.entries(activeRobot.sensorReadings).map(([sensor, value]) => (
                       <div key={sensor} className="bg-surface border border-border rounded p-2">
                           <div className="text-[10px] text-muted font-mono uppercase truncate" title={sensor}>{sensor}</div>
                           <div className="text-sm font-mono text-text truncate" title={String(value)}>{value}</div>
                       </div>
                   ))}
               </div>
            </div>
          )}

          {/* Telemetry Logs */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted flex items-center gap-1">
               <FileText className="w-3 h-3" /> System Logs
            </span>
            <div className="bg-zinc-950 rounded-lg p-3 border border-border font-mono text-[10px] text-muted h-48 overflow-y-auto custom-scrollbar">
               <div className="text-green-500/50">[{activeRobot.id}] Connected...</div>
               <div className="text-muted opacity-50">...</div>
               {activeRobot.telemetry && Object.entries(activeRobot.telemetry).map(([k,v], i) => (
                  <div key={i} className="border-l-2 border-accent pl-2 my-1">
                     <span className="text-accent">{k}:</span> {JSON.stringify(v)}
                  </div>
               ))}
               {session.currentInteraction && (
                  <div className="border-l-2 border-primary pl-2 my-1">
                     <span className="text-primary">research_status:</span> {session.currentInteraction.status}
                  </div>
               )}
               <div className="text-accent mt-2 animate-pulse">_</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
