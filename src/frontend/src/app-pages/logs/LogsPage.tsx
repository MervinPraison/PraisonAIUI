/**
 * Logs (ProLogs.dc.html), the app shell's page for `logs` inside a layout:
 * the log viewer template (level toggles with counts, search with match
 * navigation, only-matching lines, a monospaced time · level · source ·
 * message list that follows the tail) over the server's log buffer, with
 * Pause, Download and Clear. Clear asks first.
 *
 * Data: GET /api/logs?limit=500 every 3 s while the tab is visible and the
 * view is not paused; POST /api/logs/clear.
 */
import { useMemo, useState } from 'react'
import { Download, Pause, Play, Trash } from 'lucide-react'
import { LogViewer } from '@/components/page/LogViewer'
import { Button } from '@/components/ui/button'
import { fetchJson } from '@/sdk/services'
import { inLayoutOnly, useJson } from '../shared'
import { StatusDot } from '../ui'
import { logEntries, logsAsText } from './model'
import { Modal, ModalActions } from '../Modal'

function LogsPage() {
  const [paused, setPaused] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const logs = useJson<unknown>(paused ? null : '/api/logs?limit=500', 3000)
  const entries = useMemo(() => logEntries(logs.data), [logs.data])

  const download = () => {
    const url = URL.createObjectURL(new Blob([logsAsText(entries)], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'aiui-logs.txt'
    a.click()
    URL.revokeObjectURL(url)
  }
  const clear = async () => {
    setError(null)
    try {
      await fetchJson('/api/logs/clear', { method: 'POST' })
      logs.reload()
    } catch (e) {
      setError(`Clear failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const actions = (
    <>
      <StatusDot tone={paused ? 'idle' : logs.error ? 'bad' : 'ok'} className="mr-1">
        {paused ? 'Paused' : logs.error ? 'Not reachable' : 'Live'}
      </StatusDot>
      <Button variant="outline" size="sm" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
        {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
        {paused ? 'Resume' : 'Pause'}
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Download these lines" title="Download these lines" disabled={!entries.length} onClick={download}>
        <Download aria-hidden />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Clear the log" title="Clear the log" disabled={!entries.length} onClick={() => setConfirm(true)}>
        <Trash aria-hidden />
      </Button>
    </>
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-aiui-app-page="logs">
      {error && (
        <p role="alert" className="mx-4 mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-destructive sm:mx-6">
          {error}
        </p>
      )}
      <LogViewer
        label="Log lines"
        entries={entries}
        actions={actions}
        follow={!paused}
        emptyText={logs.loading ? 'Loading the log…' : 'Nothing logged yet. Lines appear here as the server writes them.'}
      />
      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        title="Clear the log?"
        description={`The server forgets the ${entries.length} lines it holds. Download them first to keep a copy.`}
      >
        <ModalActions>
          <Button variant="outline" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setConfirm(false)
              void clear()
            }}
          >
            Clear
          </Button>
        </ModalActions>
      </Modal>
    </div>
  )
}

export default inLayoutOnly(LogsPage)
