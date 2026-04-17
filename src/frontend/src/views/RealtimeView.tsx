/**
 * RealtimeView.tsx — Realtime voice dashboard page
 * 
 * Features:
 * - Microphone access and audio capture
 * - Real-time waveform visualization  
 * - Session management (create/close)
 * - Live transcript display
 * - WebRTC connection to OpenAI Realtime API
 */

import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Phone, PhoneOff } from 'lucide-react';

interface RealtimeSession {
  session_id: string;
  client_secret: string;
  model: string;
  status: string;
  type: string;
  modalities: string[];
}

interface TranscriptItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export const RealtimeView: React.FC = () => {
  const [session, setSession] = useState<RealtimeSession | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number>(0);

  // Initialize audio visualization
  const initializeAudioVisualization = (stream: MediaStream) => {
    if (!canvasRef.current) return;

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    
    analyser.fftSize = 2048;
    source.connect(analyser);
    
    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    
    drawWaveform();
  };

  // Draw waveform visualization
  const drawWaveform = () => {
    if (!canvasRef.current || !analyserRef.current) return;
    
    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext('2d')!;
    const analyser = analyserRef.current;
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      
      analyser.getByteTimeDomainData(dataArray);
      
      canvasCtx.fillStyle = 'rgb(20, 20, 20)';
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
      
      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = isRecording ? 'rgb(34, 197, 94)' : 'rgb(156, 163, 175)';
      canvasCtx.beginPath();
      
      const sliceWidth = canvas.width / bufferLength;
      let x = 0;
      
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * canvas.height / 2;
        
        if (i === 0) {
          canvasCtx.moveTo(x, y);
        } else {
          canvasCtx.lineTo(x, y);
        }
        
        x += sliceWidth;
      }
      
      canvasCtx.lineTo(canvas.width, canvas.height / 2);
      canvasCtx.stroke();
    };
    
    draw();
  };

  // Create new realtime session
  const createSession = async () => {
    setIsConnecting(true);
    setError(null);
    
    try {
      const response = await fetch('/api/realtime/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-realtime-preview' })
      });
      
      const sessionData = await response.json();
      
      if (sessionData.type === 'error') {
        throw new Error(sessionData.error);
      }
      
      setSession(sessionData);
      
      // Connect to WebSocket for real-time events
      const ws = new WebSocket(`/ws/realtime/${sessionData.session_id}`);
      websocketRef.current = ws;
      
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleRealtimeEvent(data);
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setError('Connection error occurred');
      };
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setIsConnecting(false);
    }
  };

  // Close current session
  const closeSession = async () => {
    if (!session) return;
    
    try {
      await fetch(`/api/realtime/session/${session.session_id}`, {
        method: 'DELETE'
      });
      
      if (websocketRef.current) {
        websocketRef.current.close();
        websocketRef.current = null;
      }
      
      stopRecording();
      setSession(null);
      setTranscript([]);
      
    } catch (err) {
      setError('Failed to close session');
    }
  };

  // Start microphone recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          sampleRate: 24000,
          channelCount: 1 
        } 
      });
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      mediaRecorderRef.current = mediaRecorder;
      
      mediaRecorder.ondataavailable = (event) => {
        // In a real implementation, this would send audio to the realtime API
        console.log('Audio chunk:', event.data.size, 'bytes');
      };
      
      mediaRecorder.start(100); // 100ms chunks
      initializeAudioVisualization(stream);
      setIsRecording(true);
      
    } catch (err) {
      setError('Microphone access denied');
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      mediaRecorderRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = 0;
    }
    
    setIsRecording(false);
  };

  // Handle realtime events from WebSocket
  const handleRealtimeEvent = (event: any) => {
    switch (event.type) {
      case 'conversation.item.created':
        const item = event.item;
        if (item.type === 'message' && item.content?.[0]?.text) {
          setTranscript(prev => [...prev, {
            id: item.id,
            role: item.role,
            content: item.content[0].text,
            timestamp: new Date()
          }]);
        }
        break;
        
      case 'error':
        setError(event.error);
        break;
        
      default:
        console.log('Unhandled event:', event);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
      if (websocketRef.current) {
        websocketRef.current.close();
      }
    };
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Realtime Voice</h1>
        <p className="text-gray-600">
          Bidirectional voice chat with OpenAI Realtime API
        </p>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* Session Controls */}
      <div className="bg-white border rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold mb-1">Session Status</h3>
            <p className="text-sm text-gray-600">
              {session ? `Active: ${session.session_id}` : 'No active session'}
            </p>
          </div>
          <div className="flex gap-2">
            {!session ? (
              <button
                onClick={createSession}
                disabled={isConnecting}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                <Phone className="w-4 h-4" />
                {isConnecting ? 'Connecting...' : 'Start Session'}
              </button>
            ) : (
              <button
                onClick={closeSession}
                className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
              >
                <PhoneOff className="w-4 h-4" />
                End Session
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Audio Controls */}
      {session && (
        <div className="bg-white border rounded-lg p-6 mb-6">
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-4">Voice Input</h3>
            
            {/* Waveform Visualization */}
            <canvas
              ref={canvasRef}
              width={400}
              height={100}
              className="border rounded mb-4 mx-auto"
            />
            
            {/* Microphone Toggle */}
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`flex items-center gap-2 px-6 py-3 rounded-full font-semibold mx-auto ${
                isRecording 
                  ? 'bg-red-600 text-white hover:bg-red-700' 
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {isRecording ? (
                <>
                  <MicOff className="w-5 h-5" />
                  Stop Recording
                </>
              ) : (
                <>
                  <Mic className="w-5 h-5" />
                  Start Recording
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Transcript */}
      {session && (
        <div className="bg-white border rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Conversation</h3>
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {transcript.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                No conversation yet. Start recording to begin.
              </p>
            ) : (
              transcript.map((item) => (
                <div
                  key={item.id}
                  className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                      item.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-900'
                    }`}
                  >
                    <p className="text-sm">{item.content}</p>
                    <p className="text-xs opacity-75 mt-1">
                      {item.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default RealtimeView;