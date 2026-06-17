import React, { useEffect, useState } from 'react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Badge } from '../components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'

interface MCPServer {
  name: string
  transport: 'stdio' | 'sse' | 'http'
  status: 'connecting' | 'connected' | 'error' | 'disconnected'
  tools: Array<{
    name: string
    description: string
    input_schema: Record<string, any>
  }>
  last_error?: string
  connection_data?: Record<string, any>
}

interface NewServerForm {
  name: string
  transport: 'stdio' | 'sse' | 'http'
  command?: string
  args?: string
  url?: string
  headers?: string
}

const statusColors = {
  connected: 'bg-green-500',
  connecting: 'bg-yellow-500',
  error: 'bg-red-500',
  disconnected: 'bg-gray-500',
}

export function McpView() {
  const [servers, setServers] = useState<MCPServer[]>([])
  const [loading, setLoading] = useState(false)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [selectedServer, setSelectedServer] = useState<MCPServer | null>(null)
  const [form, setForm] = useState<NewServerForm>({
    name: '',
    transport: 'stdio',
    command: '',
    args: '',
    url: '',
    headers: '',
  })

  useEffect(() => {
    fetchServers()
    const interval = setInterval(fetchServers, 5000) // Poll every 5s
    return () => clearInterval(interval)
  }, [])

  const fetchServers = async () => {
    try {
      const res = await fetch('/api/mcp/servers')
      if (res.ok) {
        const data = await res.json()
        setServers(data.servers || [])
      }
    } catch (err) {
      console.error('Failed to fetch MCP servers:', err)
    }
  }

  const handleConnect = async () => {
    setLoading(true)
    
    const config: any = {
      name: form.name,
    }

    if (form.transport === 'stdio') {
      config.command = form.command
      if (form.args) {
        config.args = form.args.split(' ').filter(Boolean)
      }
    } else if (form.transport === 'sse' || form.transport === 'http') {
      config.url = form.url
      if (form.headers) {
        try {
          config.headers = JSON.parse(form.headers)
        } catch {
          alert('Invalid JSON for headers')
          setLoading(false)
          return
        }
      }
    }

    try {
      const res = await fetch('/api/mcp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })

      if (res.ok) {
        setShowAddDialog(false)
        setForm({
          name: '',
          transport: 'stdio',
          command: '',
          args: '',
          url: '',
          headers: '',
        })
        fetchServers()
      } else {
        const error = await res.text()
        alert(`Failed to connect: ${error}`)
      }
    } catch (err) {
      alert(`Connection error: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnect = async (serverName: string) => {
    if (!confirm(`Disconnect from ${serverName}?`)) return

    try {
      const res = await fetch('/api/mcp/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: serverName }),
      })

      if (res.ok) {
        fetchServers()
      }
    } catch (err) {
      console.error('Failed to disconnect:', err)
    }
  }

  const handleTestTool = async (serverName: string, toolName: string) => {
    try {
      const res = await fetch('/api/mcp/test-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server: serverName, tool: toolName }),
      })

      const result = await res.json()
      alert(`Tool test result:\n${JSON.stringify(result, null, 2)}`)
    } catch (err) {
      alert(`Failed to test tool: ${err}`)
    }
  }

  return (
    <div className="container mx-auto p-4">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold mb-2">MCP Manager</h1>
          <p className="text-gray-600">Manage Model Context Protocol server connections</p>
        </div>
        <Button onClick={() => setShowAddDialog(true)}>
          + Connect Server
        </Button>
      </div>

      <div className="grid gap-4">
        {servers.length === 0 ? (
          <Card>
            <CardContent className="text-center py-8">
              <p className="text-gray-500">No MCP servers configured</p>
              <Button className="mt-4" onClick={() => setShowAddDialog(true)}>
                Connect Your First Server
              </Button>
            </CardContent>
          </Card>
        ) : (
          servers.map((server) => (
            <Card key={server.name}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle>{server.name}</CardTitle>
                    <Badge className={statusColors[server.status]}>
                      {server.status}
                    </Badge>
                    <Badge variant="outline">{server.transport}</Badge>
                  </div>
                  <Button
                    size="sm"
                    variant={server.status === 'connected' ? 'destructive' : 'default'}
                    onClick={() => 
                      server.status === 'connected' 
                        ? handleDisconnect(server.name)
                        : handleConnect()
                    }
                  >
                    {server.status === 'connected' ? 'Disconnect' : 'Reconnect'}
                  </Button>
                </div>
                {server.last_error && (
                  <CardDescription className="text-red-500 mt-2">
                    Error: {server.last_error}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="tools">
                  <TabsList>
                    <TabsTrigger value="tools">Tools ({server.tools.length})</TabsTrigger>
                    <TabsTrigger value="config">Configuration</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="tools" className="mt-4">
                    {server.tools.length === 0 ? (
                      <p className="text-gray-500">No tools available</p>
                    ) : (
                      <div className="grid gap-2">
                        {server.tools.map((tool) => (
                          <div key={tool.name} className="border rounded p-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-semibold">{tool.name}</p>
                                <p className="text-sm text-gray-600">{tool.description}</p>
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleTestTool(server.name, tool.name)}
                              >
                                Test
                              </Button>
                            </div>
                            {Object.keys(tool.input_schema).length > 0 && (
                              <details className="mt-2">
                                <summary className="text-sm text-gray-500 cursor-pointer">
                                  Schema
                                </summary>
                                <pre className="text-xs mt-1 bg-gray-100 p-2 rounded overflow-auto">
                                  {JSON.stringify(tool.input_schema, null, 2)}
                                </pre>
                              </details>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                  
                  <TabsContent value="config" className="mt-4">
                    <div className="bg-gray-100 p-3 rounded">
                      <pre className="text-sm">
                        {JSON.stringify(server.connection_data || {}, null, 2)}
                      </pre>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Connect MCP Server</DialogTitle>
            <DialogDescription>
              Configure a new Model Context Protocol server connection
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Server Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="my-mcp-server"
              />
            </div>

            <div>
              <Label htmlFor="transport">Transport Type</Label>
              <Select
                value={form.transport}
                onValueChange={(value) => setForm({ ...form, transport: value as any })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">STDIO (Subprocess)</SelectItem>
                  <SelectItem value="sse">SSE (Server-Sent Events)</SelectItem>
                  <SelectItem value="http">HTTP (REST API)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.transport === 'stdio' && (
              <>
                <div>
                  <Label htmlFor="command">Command</Label>
                  <Input
                    id="command"
                    value={form.command}
                    onChange={(e) => setForm({ ...form, command: e.target.value })}
                    placeholder="npx"
                  />
                </div>
                <div>
                  <Label htmlFor="args">Arguments (space-separated)</Label>
                  <Input
                    id="args"
                    value={form.args}
                    onChange={(e) => setForm({ ...form, args: e.target.value })}
                    placeholder="-y @modelcontextprotocol/server-filesystem"
                  />
                </div>
              </>
            )}

            {(form.transport === 'sse' || form.transport === 'http') && (
              <>
                <div>
                  <Label htmlFor="url">Server URL</Label>
                  <Input
                    id="url"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    placeholder="http://localhost:3000/sse"
                  />
                </div>
                <div>
                  <Label htmlFor="headers">Headers (JSON)</Label>
                  <Input
                    id="headers"
                    value={form.headers}
                    onChange={(e) => setForm({ ...form, headers: e.target.value })}
                    placeholder='{"Authorization": "Bearer token"}'
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleConnect} disabled={loading || !form.name}>
              {loading ? 'Connecting...' : 'Connect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}