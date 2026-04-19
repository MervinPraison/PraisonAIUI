/**
 * MCPStatusChip component - shows MCP server connection status in the UI
 * Displays a chip with server count and popover with detailed server info
 */

import React, { useState, useEffect } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Separator } from '../components/ui/separator';

interface MCPTool {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

interface MCPServer {
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  status: 'connecting' | 'connected' | 'error' | 'disconnected';
  tools: MCPTool[];
  last_error?: string;
  connection_data?: Record<string, any>;
}

interface MCPStatusChipProps {
  className?: string;
}

const MCPStatusChip: React.FC<MCPStatusChipProps> = ({ className }) => {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  // Fetch MCP servers from the API
  const fetchServers = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/mcp/servers');
      const data = await response.json();
      
      if (data.error) {
        setError(data.error);
        setServers([]);
      } else {
        setServers(data.servers || []);
        setError(null);
      }
    } catch (err) {
      setError('Failed to fetch MCP servers');
      setServers([]);
    } finally {
      setLoading(false);
    }
  };

  // Disconnect a server
  const disconnectServer = async (serverName: string) => {
    try {
      const response = await fetch(`/api/mcp/disconnect/${serverName}`, {
        method: 'POST'
      });
      const result = await response.json();
      
      if (result.success) {
        // Refresh the server list
        await fetchServers();
      } else {
        console.error('Failed to disconnect server:', result.error);
      }
    } catch (err) {
      console.error('Error disconnecting server:', err);
    }
  };

  // Get status color for a server
  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'connected':
        return 'text-green-600';
      case 'connecting':
        return 'text-yellow-600';
      case 'error':
        return 'text-red-600';
      case 'disconnected':
        return 'text-gray-600';
      default:
        return 'text-gray-600';
    }
  };

  // Get status icon
  const getStatusIcon = (status: string): string => {
    switch (status) {
      case 'connected':
        return '●';
      case 'connecting':
        return '●';
      case 'error':
        return '●';
      case 'disconnected':
        return '○';
      default:
        return '○';
    }
  };

  // Fetch servers on mount
  useEffect(() => {
    fetchServers();
  }, []);

  // If no servers configured, don't show the chip (zero overhead)
  if (!loading && servers.length === 0 && !error) {
    return null;
  }

  const connectedCount = servers.filter(s => s.status === 'connected').length;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-8 px-2 py-1 text-sm font-medium hover:bg-accent ${className}`}
        >
          <Badge variant="secondary" className="mr-1">
            MCP: {loading ? '...' : connectedCount}
          </Badge>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-96 p-4" align="end">
        <div className="space-y-3">
          <h3 className="text-lg font-semibold">MCP Servers</h3>
          
          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-center py-4 text-sm text-gray-500">
              Loading servers...
            </div>
          ) : servers.length === 0 ? (
            <div className="text-center py-4 text-sm text-gray-500">
              No MCP servers configured
            </div>
          ) : (
            <div className="space-y-3">
              {servers.map((server, index) => (
                <div key={server.name} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className={`text-lg ${getStatusColor(server.status)}`}>
                        {getStatusIcon(server.status)}
                      </span>
                      <span className="font-medium">{server.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {server.transport}
                      </Badge>
                    </div>
                    
                    {server.status === 'connected' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => disconnectServer(server.name)}
                        className="h-6 px-2 text-xs text-red-600 hover:text-red-800"
                      >
                        Disconnect
                      </Button>
                    )}
                  </div>

                  <div className="text-xs text-gray-600 space-y-1">
                    <div>Status: {server.status}</div>
                    {server.tools.length > 0 && (
                      <div>Tools: {server.tools.length}</div>
                    )}
                    {server.last_error && (
                      <div className="text-red-600">Error: {server.last_error}</div>
                    )}
                  </div>

                  {server.tools.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-gray-600 hover:text-gray-800">
                        Show tools ({server.tools.length})
                      </summary>
                      <ul className="mt-1 space-y-1 pl-4">
                        {server.tools.map((tool) => (
                          <li key={tool.name} className="text-gray-700">
                            <code className="text-blue-600">{tool.name}</code>
                            {tool.description && (
                              <span className="ml-2 text-gray-600">{tool.description}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {index < servers.length - 1 && <Separator />}
                </div>
              ))}
            </div>
          )}
          
          <Separator />
          
          <div className="flex justify-between items-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchServers}
              disabled={loading}
              className="text-xs"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => {
                // TODO: Open AddMCPServerModal
                console.log('Add MCP Server clicked');
              }}
            >
              + Add Server
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default MCPStatusChip;