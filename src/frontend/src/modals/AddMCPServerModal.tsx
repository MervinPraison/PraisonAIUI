/**
 * AddMCPServerModal component - modal for adding new MCP server connections
 * Supports stdio (command), SSE, and HTTP transport types
 */

import React, { useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { Separator } from '../components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';

interface AddMCPServerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onServerAdded?: () => void;
}

interface MCPServerConfig {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
}

const AddMCPServerModal: React.FC<AddMCPServerModalProps> = ({
  open,
  onOpenChange,
  onServerAdded
}) => {
  const [transportType, setTransportType] = useState<'stdio' | 'sse' | 'http'>('stdio');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [url, setUrl] = useState('');
  const [headersText, setHeadersText] = useState('');

  // Reset form when modal opens/closes
  React.useEffect(() => {
    if (!open) {
      setName('');
      setCommand('');
      setArgsText('');
      setUrl('');
      setHeadersText('');
      setError(null);
    }
  }, [open]);

  // Parse headers from text
  const parseHeaders = (text: string): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (!text.trim()) return headers;
    
    try {
      // Try to parse as JSON first
      const parsed = JSON.parse(text);
      return parsed;
    } catch {
      // Fall back to key:value format
      const lines = text.split('\n');
      for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.slice(0, colonIndex).trim();
          const value = line.slice(colonIndex + 1).trim();
          if (key && value) {
            headers[key] = value;
          }
        }
      }
    }
    return headers;
  };

  // Parse args from text with better handling of quoted arguments
  const parseArgs = (text: string): string[] => {
    if (!text.trim()) return [];
    
    try {
      // Try to parse as JSON array first
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall back to shell-like parsing that handles quoted strings
      const args: string[] = [];
      const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
      let match;
      
      while ((match = regex.exec(text)) !== null) {
        // match[1] is content of double quotes, match[2] is content of single quotes
        args.push(match[1] || match[2] || match[0]);
      }
      
      return args;
    }
    
    return [];
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Build server config based on transport type
      const config: MCPServerConfig = { name };
      
      if (transportType === 'stdio') {
        if (!command.trim()) {
          throw new Error('Command is required for stdio transport');
        }
        config.command = command.trim();
        const args = parseArgs(argsText);
        if (args.length > 0) {
          config.args = args;
        }
      } else {
        if (!url.trim()) {
          throw new Error('URL is required for SSE/HTTP transport');
        }
        config.url = url.trim();
        const headers = parseHeaders(headersText);
        if (Object.keys(headers).length > 0) {
          config.headers = headers;
        }
      }

      // Submit to API
      const response = await fetch('/api/mcp/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to connect to MCP server');
      }

      // Success - notify parent and close modal
      if (onServerAdded) {
        onServerAdded();
      }
      onOpenChange(false);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add MCP Server</DialogTitle>
          <DialogDescription>
            Connect to a Model Context Protocol (MCP) server to expand available tools and capabilities.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Server Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Server Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., filesystem, github, memory"
              required
            />
          </div>

          {/* Transport Type Selection */}
          <Tabs value={transportType} onValueChange={(value) => setTransportType(value as any)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="stdio">Stdio</TabsTrigger>
              <TabsTrigger value="sse">SSE</TabsTrigger>
              <TabsTrigger value="http">HTTP</TabsTrigger>
            </TabsList>

            {/* Stdio Configuration */}
            <TabsContent value="stdio" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="command">Command *</Label>
                <Input
                  id="command"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="e.g., npx, node, python"
                  required={transportType === 'stdio'}
                />
                <p className="text-sm text-gray-600">
                  The command to execute (e.g., <code>npx</code>, <code>node</code>, <code>python</code>)
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="args">Arguments</Label>
                <Input
                  id="args"
                  value={argsText}
                  onChange={(e) => setArgsText(e.target.value)}
                  placeholder='e.g., @modelcontextprotocol/server-filesystem /tmp'
                />
                <p className="text-sm text-gray-600">
                  Space-separated arguments or JSON array: <code>["arg1", "arg2"]</code>
                </p>
              </div>

              <div className="p-4 bg-blue-50 rounded-md">
                <h4 className="font-medium text-blue-900">Example: Filesystem Server</h4>
                <div className="mt-2 text-sm text-blue-800">
                  <div><strong>Command:</strong> npx</div>
                  <div><strong>Arguments:</strong> @modelcontextprotocol/server-filesystem /tmp</div>
                </div>
              </div>
            </TabsContent>

            {/* SSE/HTTP Configuration */}
            <TabsContent value="sse" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="url">Server URL *</Label>
                <Input
                  id="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="e.g., https://api.mcp.example.com/sse"
                  required={transportType === 'sse'}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="headers">Headers</Label>
                <textarea
                  id="headers"
                  value={headersText}
                  onChange={(e) => setHeadersText(e.target.value)}
                  placeholder={`Authorization: Bearer token\nContent-Type: application/json\n\nOR JSON format:\n{"Authorization": "Bearer token"}`}
                  className="w-full h-24 px-3 py-2 text-sm border rounded-md resize-none"
                />
              </div>
            </TabsContent>

            <TabsContent value="http" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="url-http">Server URL *</Label>
                <Input
                  id="url-http"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="e.g., https://api.mcp.example.com"
                  required={transportType === 'http'}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="headers-http">Headers</Label>
                <textarea
                  id="headers-http"
                  value={headersText}
                  onChange={(e) => setHeadersText(e.target.value)}
                  placeholder={`Authorization: Bearer token\nContent-Type: application/json\n\nOR JSON format:\n{"Authorization": "Bearer token"}`}
                  className="w-full h-24 px-3 py-2 text-sm border rounded-md resize-none"
                />
              </div>
            </TabsContent>
          </Tabs>

          {/* Error Display */}
          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            onClick={handleSubmit}
            disabled={loading || !name.trim()}
          >
            {loading ? 'Connecting...' : 'Connect Server'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AddMCPServerModal;