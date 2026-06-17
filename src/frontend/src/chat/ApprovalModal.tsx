import React, { useEffect, useState } from 'react'
import { Button } from '../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Badge } from '../components/ui/badge'
import { Checkbox } from '../components/ui/checkbox'
import { Textarea } from '../components/ui/textarea'

interface ApprovalRequest {
  id: string
  tool_name: string
  arguments: Record<string, any>
  risk_level: string
  agent_name?: string
  description?: string
  session_id?: string
}

const riskColors: Record<string, string> = {
  low: 'bg-green-500',
  medium: 'bg-yellow-500',
  high: 'bg-orange-500',
  critical: 'bg-red-500',
}

const riskIcons: Record<string, string> = {
  low: '✅',
  medium: '⚠️',
  high: '🟠',
  critical: '🔴',
}

export function ApprovalModal() {
  const [approval, setApproval] = useState<ApprovalRequest | null>(null)
  const [reason, setReason] = useState('')
  const [alwaysAllow, setAlwaysAllow] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const handleApprovalRequired = (event: CustomEvent<ApprovalRequest>) => {
      setApproval(event.detail)
      setReason('')
      setAlwaysAllow(false)
    }

    window.addEventListener('approval-required', handleApprovalRequired as EventListener)
    return () => {
      window.removeEventListener('approval-required', handleApprovalRequired as EventListener)
    }
  }, [])

  const handleApprove = async () => {
    if (!approval) return
    setLoading(true)

    try {
      const res = await fetch(`/api/approvals/${approval.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          approver: 'user',
          always: alwaysAllow,
        }),
      })

      if (res.ok) {
        setApproval(null)
        setReason('')
        setAlwaysAllow(false)
      }
    } catch (err) {
      console.error('Failed to approve:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDeny = async () => {
    if (!approval) return
    setLoading(true)

    try {
      const res = await fetch(`/api/approvals/${approval.id}/deny`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          approver: 'user',
          always: alwaysAllow,
        }),
      })

      if (res.ok) {
        setApproval(null)
        setReason('')
        setAlwaysAllow(false)
      }
    } catch (err) {
      console.error('Failed to deny:', err)
    } finally {
      setLoading(false)
    }
  }

  if (!approval) return null

  return (
    <Dialog open={!!approval} onOpenChange={(open) => !open && !loading && setApproval(null)}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {riskIcons[approval.risk_level] || '⚠️'} Tool Execution Approval Required
          </DialogTitle>
          <DialogDescription>
            {approval.agent_name || 'Agent'} wants to execute: {approval.tool_name}
          </DialogDescription>
        </DialogHeader>

        <div className="my-4 space-y-4">
          <div className="flex items-center gap-2">
            <Badge className={riskColors[approval.risk_level] || 'bg-yellow-500'}>
              Risk Level: {approval.risk_level}
            </Badge>
          </div>

          {approval.description && (
            <p className="text-sm">{approval.description}</p>
          )}

          {Object.keys(approval.arguments).length > 0 && (
            <div className="bg-gray-100 dark:bg-gray-800 p-3 rounded">
              <p className="text-sm font-semibold mb-2">Tool Arguments:</p>
              <pre className="text-xs overflow-auto max-h-40">
                {JSON.stringify(approval.arguments, null, 2)}
              </pre>
            </div>
          )}

          <Textarea
            placeholder="Optional: Provide a reason for your decision..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="min-h-[60px]"
          />

          <div className="flex items-center space-x-2">
            <Checkbox
              id="always"
              checked={alwaysAllow}
              onCheckedChange={(checked) => setAlwaysAllow(checked as boolean)}
            />
            <label htmlFor="always" className="text-sm cursor-pointer">
              Always allow this tool for this session
            </label>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button 
            variant="outline" 
            onClick={() => setApproval(null)} 
            disabled={loading}
          >
            Cancel
          </Button>
          <Button 
            variant="destructive" 
            onClick={handleDeny} 
            disabled={loading}
          >
            Deny
          </Button>
          <Button 
            onClick={handleApprove} 
            disabled={loading}
          >
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}