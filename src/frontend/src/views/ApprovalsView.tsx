import React, { useEffect, useState } from 'react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Badge } from '../components/ui/badge'
import { Checkbox } from '../components/ui/checkbox'
import { Textarea } from '../components/ui/textarea'

interface Approval {
  id: string
  tool_name: string
  arguments: Record<string, any>
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  agent_name?: string
  description?: string
  status: 'pending' | 'approved' | 'denied'
  created_at: number
  risk_icon?: string
}

const riskColors = {
  low: 'bg-green-500',
  medium: 'bg-yellow-500',
  high: 'bg-orange-500',
  critical: 'bg-red-500',
}

export function ApprovalsView() {
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [activeApproval, setActiveApproval] = useState<Approval | null>(null)
  const [reason, setReason] = useState('')
  const [alwaysAllow, setAlwaysAllow] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchApprovals()
    const eventSource = setupSSE()
    return () => eventSource?.close()
  }, [])

  const fetchApprovals = async () => {
    try {
      const res = await fetch('/api/approvals?status=pending')
      const data = await res.json()
      setApprovals(data.approvals || [])
    } catch (err) {
      console.error('Failed to fetch approvals:', err)
    }
  }

  const setupSSE = () => {
    try {
      const eventSource = new EventSource('/api/approvals/stream')
      
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.event === 'new' || data.event === 'resolved') {
            fetchApprovals()
          }
        } catch (err) {
          console.error('SSE parse error:', err)
        }
      }

      eventSource.onerror = () => {
        console.error('SSE connection error')
      }

      return eventSource
    } catch {
      return null
    }
  }

  const handleApprove = async () => {
    if (!activeApproval) return
    setLoading(true)

    try {
      const res = await fetch(`/api/approvals/${activeApproval.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          approver: 'user',
          always: alwaysAllow,
        }),
      })

      if (res.ok) {
        setActiveApproval(null)
        setReason('')
        setAlwaysAllow(false)
        fetchApprovals()
      }
    } catch (err) {
      console.error('Failed to approve:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDeny = async () => {
    if (!activeApproval) return
    setLoading(true)

    try {
      const res = await fetch(`/api/approvals/${activeApproval.id}/deny`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          approver: 'user',
          always: alwaysAllow,
        }),
      })

      if (res.ok) {
        setActiveApproval(null)
        setReason('')
        setAlwaysAllow(false)
        fetchApprovals()
      }
    } catch (err) {
      console.error('Failed to deny:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container mx-auto p-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Tool Execution Approvals</h1>
        <p className="text-gray-600">Review and approve tool execution requests</p>
      </div>

      <div className="grid gap-4">
        {approvals.length === 0 ? (
          <Card>
            <CardContent className="text-center py-8">
              <p className="text-gray-500">No pending approvals</p>
            </CardContent>
          </Card>
        ) : (
          approvals.map((approval) => (
            <Card key={approval.id} className="cursor-pointer hover:shadow-lg transition-shadow"
                  onClick={() => setActiveApproval(approval)}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <span>{approval.risk_icon || '⚠️'}</span>
                    {approval.tool_name}
                  </CardTitle>
                  <Badge className={riskColors[approval.risk_level]}>
                    {approval.risk_level}
                  </Badge>
                </div>
                {approval.agent_name && (
                  <CardDescription>Agent: {approval.agent_name}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600 mb-2">
                  {approval.description || 'Tool execution request'}
                </p>
                {Object.keys(approval.arguments).length > 0 && (
                  <div className="text-xs bg-gray-100 p-2 rounded">
                    <pre>{JSON.stringify(approval.arguments, null, 2)}</pre>
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={!!activeApproval} onOpenChange={(open) => !open && setActiveApproval(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {activeApproval?.risk_icon || '⚠️'} Approve Tool Execution?
            </DialogTitle>
            <DialogDescription>
              {activeApproval?.tool_name} requested by {activeApproval?.agent_name || 'unknown agent'}
            </DialogDescription>
          </DialogHeader>

          <div className="my-4">
            <div className="mb-3">
              <Badge className={activeApproval ? riskColors[activeApproval.risk_level] : ''}>
                Risk Level: {activeApproval?.risk_level}
              </Badge>
            </div>

            {activeApproval?.description && (
              <p className="text-sm mb-3">{activeApproval.description}</p>
            )}

            {activeApproval && Object.keys(activeApproval.arguments).length > 0 && (
              <div className="bg-gray-100 p-3 rounded mb-3">
                <p className="text-sm font-semibold mb-1">Arguments:</p>
                <pre className="text-xs">{JSON.stringify(activeApproval.arguments, null, 2)}</pre>
              </div>
            )}

            <Textarea
              placeholder="Optional: Provide a reason for your decision..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mb-3"
            />

            <div className="flex items-center space-x-2">
              <Checkbox
                id="always"
                checked={alwaysAllow}
                onCheckedChange={(checked) => setAlwaysAllow(checked as boolean)}
              />
              <label htmlFor="always" className="text-sm">
                Always {activeApproval?.status === 'pending' ? 'allow' : 'deny'} this tool
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setActiveApproval(null)} disabled={loading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeny} disabled={loading}>
              Deny
            </Button>
            <Button onClick={handleApprove} disabled={loading}>
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}