/**
 * ErrorMessage component for displaying error messages with red banner styling.
 * 
 * This component renders error messages with a distinct red banner style,
 * copy-to-clipboard functionality, and proper error state indication.
 */

import React, { useState } from 'react';
import { AlertCircle, Copy, Check } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';

interface ErrorMessageProps {
  /** The error message content */
  content: string;
  /** Additional metadata from the message */
  metadata?: {
    type?: string;
    copyable?: boolean;
    [key: string]: any;
  };
  /** Optional timestamp */
  timestamp?: string;
  /** Whether to show the copy button */
  showCopyButton?: boolean;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({
  content,
  metadata = {},
  timestamp,
  showCopyButton = true
}) => {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      
      // Reset copied state after 2 seconds
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      
      // Fallback: select text
      const textArea = document.createElement('textarea');
      textArea.value = content;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (fallbackErr) {
        console.error('Fallback copy failed:', fallbackErr);
      }
      document.body.removeChild(textArea);
    }
  };

  const isCopyable = metadata.copyable !== false && showCopyButton;

  return (
    <div className="error-message-container mb-4">
      <Alert variant="destructive" className="border-red-500 bg-red-50 dark:bg-red-950/20">
        <AlertCircle className="h-4 w-4 text-red-600" />
        <AlertDescription className="text-red-800 dark:text-red-200">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <div className="whitespace-pre-wrap break-words font-mono text-sm">
                {content}
              </div>
              {timestamp && (
                <div className="text-xs text-red-600/70 dark:text-red-400/70 mt-1">
                  {new Date(timestamp).toLocaleString()}
                </div>
              )}
            </div>
            
            {isCopyable && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                className="shrink-0 h-8 w-8 p-0 hover:bg-red-100 dark:hover:bg-red-900/40"
                title={copied ? "Copied!" : "Copy error message"}
                disabled={copied}
              >
                {copied ? (
                  <Check className="h-3 w-3 text-green-600" />
                ) : (
                  <Copy className="h-3 w-3 text-red-600" />
                )}
              </Button>
            )}
          </div>
        </AlertDescription>
      </Alert>
      
      {/* Success feedback for copy action */}
      {copied && (
        <div className="text-xs text-green-600 mt-1 animate-fade-in">
          Error message copied to clipboard
        </div>
      )}
    </div>
  );
};

export default ErrorMessage;