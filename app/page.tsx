"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Play, Square, Settings, AlertCircle } from "lucide-react";
import { SHADER_EXAMPLES, type ShaderExample } from "./shader-examples";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-black">
      <div className="text-[#4a4a4e]">Loading editor...</div>
    </div>
  ),
});

interface Stats {
  fps: number;
  frameTime: number;
  frameCount: number;
  bytesReceived: number;
}

export default function MetalPlayground() {
  const [shaderCode, setShaderCode] = useState(SHADER_EXAMPLES[0].code);
  const [selectedExample, setSelectedExample] = useState<ShaderExample>(SHADER_EXAMPLES[0]);
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState<Stats>({ fps: 0, frameTime: 0, frameCount: 0, bytesReceived: 0 });
  const [targetFps, setTargetFps] = useState(60);
  const [showSettings, setShowSettings] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const frameTimesRef = useRef<number[]>([]);
  const runningRef = useRef(false);
  const statsRef = useRef({ frameCount: 0, bytesReceived: 0 });
  const wsRef = useRef<WebSocket | null>(null);

  const handleWebSocketMessage = useCallback(async (event: MessageEvent) => {
    if (typeof event.data === "string") {
      try {
        const json = JSON.parse(event.data);
        if (json.error) {
          setCompileError(json.error);
        } else if (json.ok) {
          setCompileError(null);
        }
      } catch {
        // Ignore parse errors
      }
      return;
    }
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    try {
      const blob = event.data as Blob;
      const bitmap = await createImageBitmap(blob);
      
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      
      const now = performance.now();
      frameTimesRef.current.push(now);
      frameTimesRef.current = frameTimesRef.current.filter(t => now - t < 1000);
      
      statsRef.current.frameCount++;
      statsRef.current.bytesReceived += blob.size;
      
      const fps = frameTimesRef.current.length;
      const frameInterval = fps > 0 ? Math.round(1000 / fps * 10) / 10 : 0;
      
      if (now - (statsRef.current as { lastUpdate?: number }).lastUpdate! > 100 || !(statsRef.current as { lastUpdate?: number }).lastUpdate) {
        (statsRef.current as { lastUpdate?: number }).lastUpdate = now;
        setStats({
          fps,
          frameTime: frameInterval,
          frameCount: statsRef.current.frameCount,
          bytesReceived: statsRef.current.bytesReceived,
        });
      }
    } catch (error) {
      console.error("Frame decode error:", error);
    }
  }, []);

  const run = useCallback(async () => {
    setCompileError(null);

    const container = canvasContainerRef.current;
    let width = 800;
    let height = 600;
    
    if (container) {
      width = container.clientWidth;
      height = container.clientHeight;
    }

    const ws = new WebSocket(`ws://localhost:9000/ws`);
    wsRef.current = ws;
    
    ws.onopen = () => {
      runningRef.current = true;
      statsRef.current = { frameCount: 0, bytesReceived: 0 };
      frameTimesRef.current = [];
      
      ws.send(JSON.stringify({ type: "config", targetFps, width, height }));
      ws.send(JSON.stringify({ type: "shader", code: shaderCode }));
      
      setIsRunning(true);
    };
    
    ws.onmessage = handleWebSocketMessage;
    
    ws.onerror = () => {
      setIsRunning(false);
      runningRef.current = false;
    };
    
    ws.onclose = () => {
      if (runningRef.current) {
        runningRef.current = false;
      }
      setIsRunning(false);
    };
  }, [shaderCode, targetFps, handleWebSocketMessage]);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsRunning(false);
    setStats({ fps: 0, frameTime: 0, frameCount: 0, bytesReceived: 0 });
    frameTimesRef.current = [];
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ws = wsRef.current;
    if (!canvas || !ws || ws.readyState !== WebSocket.OPEN) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    
    ws.send(JSON.stringify({ type: "mousemove", x, y }));
  }, []);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ws = wsRef.current;
    if (!canvas || !ws || ws.readyState !== WebSocket.OPEN) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    
    ws.send(JSON.stringify({ type: "click", x, y }));
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    const timer = setTimeout(() => {
      ws.send(JSON.stringify({ type: "shader", code: shaderCode }));
    }, 500);
    
    return () => clearTimeout(timer);
  }, [shaderCode, isRunning]);

  useEffect(() => {
    if (!isRunning) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    ws.send(JSON.stringify({ type: "config", targetFps }));
  }, [targetFps, isRunning]);

  const handleExampleChange = (example: ShaderExample) => {
    setSelectedExample(example);
    setShaderCode(example.code);
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-black overflow-hidden">
      {/* Top bar */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-[#1f1f23]">
        <div className="flex items-center gap-4">
          <select
            value={selectedExample.name}
            onChange={(e) => {
              const example = SHADER_EXAMPLES.find(ex => ex.name === e.target.value);
              if (example) handleExampleChange(example);
            }}
            className="bg-black text-[#a0a0a0] text-sm px-3 py-1.5 rounded border border-[#2a2a2e] focus:outline-none focus:border-[#3a3a4e]"
          >
            {SHADER_EXAMPLES.map(example => (
              <option key={example.name} value={example.name}>
                {example.name}
              </option>
            ))}
          </select>
          
          {isRunning && (
            <button
              onClick={stop}
              className="flex items-center gap-2 bg-[#3a1a1a] hover:bg-[#4a1f1f] text-[#f87171] text-sm px-3 py-1.5 rounded transition-colors"
            >
              <Square size={14} />
              Stop
            </button>
          )}
        </div>

        <div className="flex items-center gap-4">
          {compileError && (
            <div className="flex items-center gap-2 text-[#f87171] text-sm">
              <AlertCircle size={14} />
              Shader error
            </div>
          )}
          
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 rounded transition-colors ${showSettings ? "bg-[#2a2a3e] text-[#8a8aff]" : "text-[#5a5a5e] hover:text-[#8a8a8e]"}`}
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="h-10 flex items-center gap-6 px-4 border-b border-[#1f1f23] bg-black">
          <label className="flex items-center gap-2 text-sm text-[#5a5a5e]">
            Target FPS
            <input
              type="range"
              min="1"
              max="120"
              value={targetFps}
              onChange={(e) => setTargetFps(Number(e.target.value))}
              className="w-24"
            />
            <span className="text-[#8a8a8e] w-8">{targetFps}</span>
          </label>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Editor panel */}
        <div className="w-1/2 flex flex-col border-r border-[#1f1f23]">
          {compileError && (
            <div className="px-4 py-2 bg-[#1f1515] border-b border-[#2f2020] text-[#f87171] text-sm font-mono whitespace-pre-wrap max-h-32 overflow-auto">
              {compileError}
            </div>
          )}
          <div className="flex-1 min-h-0">
            <MonacoEditor
              height="100%"
              language="cpp"
              theme="vs-dark"
              value={shaderCode}
              onChange={(value) => setShaderCode(value || "")}
              options={{
                fontSize: 13,
                fontFamily: "var(--font-geist-mono), monospace",
                minimap: { enabled: false },
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                padding: { top: 16 },
                renderLineHighlight: "none",
                overviewRulerBorder: false,
                hideCursorInOverviewRuler: true,
                scrollbar: {
                  vertical: "auto",
                  horizontal: "auto",
                  verticalScrollbarSize: 8,
                  horizontalScrollbarSize: 8,
                },
              }}
            />
          </div>
        </div>

        {/* Canvas panel */}
        <div className="w-1/2 flex flex-col">
          <div ref={canvasContainerRef} className="flex-1 flex items-center justify-center bg-black min-h-0 overflow-hidden relative">
            {isRunning ? (
              <canvas
                ref={canvasRef}
                width={800}
                height={600}
                onMouseMove={handleMouseMove}
                onClick={handleClick}
                className="w-full h-full cursor-crosshair"
                style={{ imageRendering: "auto" }}
              />
            ) : (
              <button
                onClick={run}
                className="flex items-center gap-3 bg-[#1a3a1a] hover:bg-[#1f4a1f] text-[#4ade80] text-lg px-6 py-3 rounded-lg transition-colors"
              >
                <Play size={20} />
                Run
              </button>
            )}
          </div>
          
          {/* Stats bar - only show when running */}
          {isRunning && (
            <div className="h-8 flex items-center justify-end px-4 border-t border-[#1f1f23] text-xs text-[#5a5a5e] font-mono">
              <div className="flex items-center gap-4">
                <span>{stats.fps} fps</span>
                <span>{stats.frameTime} ms</span>
                <span>{formatBytes(stats.bytesReceived)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
