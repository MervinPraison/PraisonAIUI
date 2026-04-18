/**
 * useWindowMessage hook - Window.postMessage bridge for iframe/embed contexts
 * 
 * Dispatches SSE `window.message` events to parent frame and listens for
 * incoming messages from parent.
 */

import { useEffect, useCallback, useRef } from 'react';
import { useSSE } from './useSSE';

export interface WindowMessageData {
  type: string;
  [key: string]: any;
}

export interface UseWindowMessageOptions {
  /**
   * Target origin for postMessage security
   * Set to '*' to allow any origin (not recommended for production)
   */
  targetOrigin?: string;
  
  /**
   * Whether to enable the hook (useful for iframe detection)
   */
  enabled?: boolean;
  
  /**
   * Callback for incoming messages from parent
   */
  onMessage?: (data: WindowMessageData, origin: string) => void;
  
  /**
   * Callback for SSE connection status changes
   */
  onConnectionChange?: (connected: boolean) => void;
}

export interface UseWindowMessageReturn {
  /**
   * Send message to parent window
   */
  sendToParent: (data: WindowMessageData) => void;
  
  /**
   * Whether SSE connection is active
   */
  connected: boolean;
  
  /**
   * Whether we're running in an iframe
   */
  isIframe: boolean;
  
  /**
   * Send message via API (alternative to postMessage)
   */
  sendViaAPI: (data: WindowMessageData, target?: string) => Promise<void>;
}

/**
 * Hook for window.postMessage communication in iframe contexts
 */
export function useWindowMessage(options: UseWindowMessageOptions = {}): UseWindowMessageReturn {
  const {
    targetOrigin = "parent",
    enabled = true,
    onMessage,
    onConnectionChange,
  } = options;
  
  const onMessageRef = useRef(onMessage);
  const onConnectionChangeRef = useRef(onConnectionChange);
  
  // Update refs when callbacks change
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);
  
  useEffect(() => {
    onConnectionChangeRef.current = onConnectionChange;
  }, [onConnectionChange]);
  
  // Detect if we're in an iframe
  const isIframe = window !== window.parent;
  
  // SSE connection for outbound messages
  const { connected } = useSSE('/sse/window-message', {
    enabled: enabled && isIframe,
    onMessage: (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'window.message') {
          // Send message to parent via postMessage
          const messageData = data.data;
          const target = data.target || targetOrigin;
          
          if (window.parent && target) {
            if (target === "parent") {
              // Use specific origin when possible, avoid wildcard
              const origin = targetOrigin !== "*" && targetOrigin !== "parent" 
                ? targetOrigin 
                : window.location.origin;
              window.parent.postMessage(messageData, origin);
            } else {
              window.parent.postMessage(messageData, target);
            }
          }
        }
      } catch (error) {
        console.warn('Failed to parse window message SSE event:', error);
      }
    },
    onOpen: () => {
      onConnectionChangeRef.current?.(true);
    },
    onError: () => {
      onConnectionChangeRef.current?.(false);
    },
  });
  
  // Listen for incoming messages from parent
  useEffect(() => {
    if (!enabled || !isIframe) return;
    
    const handleMessage = (event: MessageEvent) => {
      // Basic origin validation
      if (targetOrigin !== "*" && targetOrigin !== "parent" && 
          event.origin !== targetOrigin) {
        console.warn('Rejected message from untrusted origin:', event.origin);
        return;
      }
      
      try {
        const data = event.data;
        
        // Forward to callback if provided
        if (onMessageRef.current) {
          onMessageRef.current(data, event.origin);
        }
        
        // Also forward to server via API
        fetch('/api/window-message/receive', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            data,
            source: event.origin,
          }),
        }).catch(error => {
          console.warn('Failed to forward message to server:', error);
        });
      } catch (error) {
        console.warn('Failed to handle incoming window message:', error);
      }
    };
    
    window.addEventListener('message', handleMessage);
    
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [enabled, isIframe, targetOrigin]);
  
  // Send message to parent window directly
  const sendToParent = useCallback((data: WindowMessageData) => {
    if (!isIframe || !window.parent) {
      console.warn('Cannot send to parent: not in iframe context');
      return;
    }
    
    try {
      // Use specific origin when possible, avoid wildcard
      const origin = targetOrigin !== "*" && targetOrigin !== "parent" 
        ? targetOrigin 
        : window.location.origin;
      window.parent.postMessage(data, origin);
    } catch (error) {
      console.error('Failed to send message to parent:', error);
    }
  }, [isIframe, targetOrigin]);
  
  // Send message via server API
  const sendViaAPI = useCallback(async (data: WindowMessageData, target: string = "parent") => {
    try {
      const response = await fetch('/api/window-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data,
          target,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to send message via API:', error);
      throw error;
    }
  }, []);
  
  return {
    sendToParent,
    connected,
    isIframe,
    sendViaAPI,
  };
}

/**
 * Simple hook for iframe detection
 */
export function useIsIframe(): boolean {
  return window !== window.parent;
}

/**
 * Hook for listening to parent messages only
 */
export function useParentMessages(
  onMessage: (data: WindowMessageData, origin: string) => void,
  targetOrigin: string = "*"
) {
  const onMessageRef = useRef(onMessage);
  
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);
  
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (targetOrigin !== "*" && event.origin !== targetOrigin) {
        return;
      }
      
      onMessageRef.current(event.data, event.origin);
    };
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [targetOrigin]);
}