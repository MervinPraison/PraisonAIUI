/**
 * useMicStream hook - Microphone audio streaming to server
 * 
 * Captures microphone audio, converts to PCM16, and streams via WebSocket
 * to server-side audio hooks for STT processing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface AudioConfig {
  /** Sample rate in Hz */
  sampleRate?: number;
  
  /** Audio channels (1 for mono, 2 for stereo) */
  channels?: number;
  
  /** Audio constraints for getUserMedia */
  constraints?: MediaTrackConstraints;
  
  /** Chunk size in samples */
  chunkSize?: number;
  
  /** Enable automatic gain control */
  autoGainControl?: boolean;
  
  /** Enable noise suppression */
  noiseSuppression?: boolean;
  
  /** Enable echo cancellation */
  echoCancellation?: boolean;
}

export interface UseMicStreamOptions extends AudioConfig {
  /** Session ID for the audio stream */
  sessionId?: string;
  
  /** Whether to auto-connect on mount */
  autoConnect?: boolean;
  
  /** WebSocket endpoint path */
  endpoint?: string;
  
  /** Called when connection state changes */
  onConnectionChange?: (connected: boolean) => void;
  
  /** Called when recording state changes */
  onRecordingChange?: (recording: boolean) => void;
  
  /** Called when audio chunks are sent */
  onChunkSent?: (chunkSize: number) => void;
  
  /** Called when errors occur */
  onError?: (error: Error) => void;
}

export interface UseMicStreamReturn {
  /** Whether WebSocket is connected */
  connected: boolean;
  
  /** Whether currently recording audio */
  recording: boolean;
  
  /** Whether microphone permission is granted */
  permitted: boolean;
  
  /** Start recording and streaming */
  startRecording: () => Promise<void>;
  
  /** Stop recording and streaming */
  stopRecording: () => void;
  
  /** Connect to WebSocket */
  connect: () => void;
  
  /** Disconnect from WebSocket */
  disconnect: () => void;
  
  /** Current audio level (0-100) */
  audioLevel: number;
  
  /** Total bytes sent */
  bytesSent: number;
  
  /** Total chunks sent */
  chunksSent: number;
}

/**
 * Hook for streaming microphone audio to server
 */
export function useMicStream(options: UseMicStreamOptions = {}): UseMicStreamReturn {
  const {
    sessionId = 'default',
    sampleRate = 16000,
    channels = 1,
    chunkSize = 1024,
    autoConnect = false,
    endpoint = '/ws/audio',
    autoGainControl = true,
    noiseSuppression = true,
    echoCancellation = true,
    constraints = {},
    onConnectionChange,
    onRecordingChange,
    onChunkSent,
    onError,
  } = options;
  
  // State
  const [connected, setConnected] = useState(false);
  const [recording, setRecording] = useState(false);
  const [permitted, setPermitted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [bytesSent, setBytesSent] = useState(0);
  const [chunksSent, setChunksSent] = useState(0);
  
  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioDataRef = useRef<Float32Array[]>([]);
  const animationFrameRef = useRef<number>(0);
  
  // Callback refs to avoid stale closures
  const onConnectionChangeRef = useRef(onConnectionChange);
  const onRecordingChangeRef = useRef(onRecordingChange);
  const onChunkSentRef = useRef(onChunkSent);
  const onErrorRef = useRef(onError);
  
  useEffect(() => {
    onConnectionChangeRef.current = onConnectionChange;
  }, [onConnectionChange]);
  
  useEffect(() => {
    onRecordingChangeRef.current = onRecordingChange;
  }, [onRecordingChange]);
  
  useEffect(() => {
    onChunkSentRef.current = onChunkSent;
  }, [onChunkSent]);
  
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  
  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}${endpoint}`;
    
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      setConnected(true);
      onConnectionChangeRef.current?.(true);
      
      // Send initial session info
      ws.send(JSON.stringify({
        session_id: sessionId,
        sample_rate: sampleRate,
      }));
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.error) {
          onErrorRef.current?.(new Error(data.error));
        }
      } catch (error) {
        console.warn('Failed to parse WebSocket message:', error);
      }
    };
    
    ws.onclose = () => {
      setConnected(false);
      onConnectionChangeRef.current?.(false);
    };
    
    ws.onerror = (error) => {
      onErrorRef.current?.(new Error('WebSocket error'));
      setConnected(false);
      onConnectionChangeRef.current?.(false);
    };
    
    wsRef.current = ws;
  }, [sessionId, sampleRate, endpoint]);
  
  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);
  
  // Convert Float32Array to 16-bit PCM
  const convertToPCM16 = useCallback((float32Array: Float32Array): ArrayBuffer => {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    
    for (let i = 0; i < float32Array.length; i++) {
      // Clamp and convert to 16-bit signed integer
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(i * 2, int16, true); // little-endian
    }
    
    return buffer;
  }, []);
  
  // Send audio chunk via WebSocket
  const sendAudioChunk = useCallback((pcmData: ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(pcmData);
      setBytesSent(prev => prev + pcmData.byteLength);
      setChunksSent(prev => prev + 1);
      onChunkSentRef.current?.(pcmData.byteLength);
    }
  }, []);
  
  // Process audio data and send chunks
  const processAudioData = useCallback(() => {
    if (audioDataRef.current.length === 0) return;
    
    // Concatenate all buffered audio data
    const totalLength = audioDataRef.current.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Float32Array(totalLength);
    let offset = 0;
    
    for (const chunk of audioDataRef.current) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    
    // Clear buffer
    audioDataRef.current = [];
    
    // Send in chunks
    for (let i = 0; i < combined.length; i += chunkSize) {
      const chunk = combined.slice(i, i + chunkSize);
      if (chunk.length > 0) {
        const pcmData = convertToPCM16(chunk);
        sendAudioChunk(pcmData);
      }
    }
  }, [chunkSize, convertToPCM16, sendAudioChunk]);
  
  // Calculate audio level for visualization
  const updateAudioLevel = useCallback(() => {
    if (!analyserRef.current) return;
    
    const analyser = analyserRef.current;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    
    // Calculate RMS level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);
    const level = (rms / 255) * 100;
    
    setAudioLevel(level);
    
    if (recording) {
      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
    }
  }, [recording]);
  
  // Start recording
  const startRecording = useCallback(async () => {
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate,
          channelCount: channels,
          autoGainControl,
          noiseSuppression,
          echoCancellation,
          ...constraints,
        },
      });
      
      setPermitted(true);
      streamRef.current = stream;
      
      // Create audio context
      const audioContext = new AudioContext({ sampleRate });
      audioContextRef.current = audioContext;
      
      // Create analyser for level visualization
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      
      // Create processor for audio data
      const processor = audioContext.createScriptProcessor(4096, channels, channels);
      processorRef.current = processor;
      
      processor.onaudioprocess = (event) => {
        if (!recording) return;
        
        const inputBuffer = event.inputBuffer;
        const channelData = inputBuffer.getChannelData(0); // Use first channel
        
        // Resample if needed
        let resampledData = channelData;
        if (inputBuffer.sampleRate !== sampleRate) {
          // Simple linear interpolation resampling
          const ratio = inputBuffer.sampleRate / sampleRate;
          const newLength = Math.floor(channelData.length / ratio);
          const resampled = new Float32Array(newLength);
          
          for (let i = 0; i < newLength; i++) {
            const srcIndex = i * ratio;
            const index = Math.floor(srcIndex);
            const fraction = srcIndex - index;
            
            if (index + 1 < channelData.length) {
              resampled[i] = channelData[index] * (1 - fraction) + 
                           channelData[index + 1] * fraction;
            } else {
              resampled[i] = channelData[index];
            }
          }
          
          resampledData = resampled;
        }
        
        // Buffer audio data
        audioDataRef.current.push(new Float32Array(resampledData));
        
        // Process and send periodically
        if (audioDataRef.current.length >= 10) { // Send every ~100ms at 4096 samples
          processAudioData();
        }
      };
      
      // Connect audio nodes
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      source.connect(processor);
      processor.connect(audioContext.destination);
      
      setRecording(true);
      onRecordingChangeRef.current?.(true);
      
      // Start audio level visualization
      updateAudioLevel();
      
    } catch (error) {
      const err = error as Error;
      onErrorRef.current?.(err);
      setPermitted(false);
      throw err;
    }
  }, [
    sampleRate,
    channels,
    autoGainControl,
    noiseSuppression,
    echoCancellation,
    constraints,
    recording,
    processAudioData,
    updateAudioLevel,
  ]);
  
  // Stop recording
  const stopRecording = useCallback(() => {
    // Send final chunks
    processAudioData();
    
    // Send end signal
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'end' }));
    }
    
    // Stop audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    // Stop media stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // Cancel animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = 0;
    }
    
    setRecording(false);
    setAudioLevel(0);
    onRecordingChangeRef.current?.(false);
    
    // Clear refs
    analyserRef.current = null;
    processorRef.current = null;
    audioDataRef.current = [];
  }, [processAudioData]);
  
  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    
    return () => {
      stopRecording();
      disconnect();
    };
  }, [autoConnect, connect, stopRecording, disconnect]);
  
  return {
    connected,
    recording,
    permitted,
    startRecording,
    stopRecording,
    connect,
    disconnect,
    audioLevel,
    bytesSent,
    chunksSent,
  };
}