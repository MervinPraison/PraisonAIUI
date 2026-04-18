/**
 * tasks.ts — Task list state management for progress sidebar.
 *
 * Manages task lists per session and provides subscription API for React components.
 * Task events come via SSE and update the task states in real time.
 */

import { useEffect, useState } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = 'READY' | 'RUNNING' | 'DONE' | 'FAILED'

export interface Task {
  id: string
  title: string
  status: TaskStatus
  icon?: string
  forId?: string
  created_at: number
  updated_at: number
}

export interface TaskList {
  id: string
  name: string
  tasks: Task[]
  stats: {
    total: number
    ready: number
    running: number
    done: number
    failed: number
  }
  sequence: number
  created_at: number
  updated_at: number
}

export interface TaskState {
  taskLists: TaskList[]
  collapsed: boolean
}

// ---------------------------------------------------------------------------
// Internal store: Map<sessionId, state + listeners>
// ---------------------------------------------------------------------------

interface TaskStoreEntry {
  state: TaskState
  listeners: Set<() => void>
}

const defaultState = (): TaskState => ({
  taskLists: [],
  collapsed: false,
})

const store = new Map<string, TaskStoreEntry>()

function getEntry(sessionId: string): TaskStoreEntry {
  if (!store.has(sessionId)) {
    store.set(sessionId, {
      state: defaultState(),
      listeners: new Set(),
    })
  }
  return store.get(sessionId)!
}

// ---------------------------------------------------------------------------
// Store mutations
// ---------------------------------------------------------------------------

function setState(sessionId: string, updater: (state: TaskState) => TaskState): void {
  const entry = getEntry(sessionId)
  const newState = updater(entry.state)
  entry.state = newState
  
  // Notify all listeners for this session
  entry.listeners.forEach(listener => listener())
}

// ---------------------------------------------------------------------------
// Task list event handlers
// ---------------------------------------------------------------------------

export function initTaskList(sessionId: string, data: {
  task_list_id: string
  name: string
  tasks: Task[]
  sequence: number
  timestamp: number
}): void {
  setState(sessionId, state => {
    // Remove existing task list with same ID if it exists
    const filteredTaskLists = state.taskLists.filter(tl => tl.id !== data.task_list_id)
    
    const taskList: TaskList = {
      id: data.task_list_id,
      name: data.name,
      tasks: data.tasks,
      stats: calculateStats(data.tasks),
      sequence: data.sequence,
      created_at: data.timestamp,
      updated_at: data.timestamp,
    }
    
    return {
      ...state,
      taskLists: [...filteredTaskLists, taskList],
      // Auto-expand if we have tasks
      collapsed: state.taskLists.length === 0 && data.tasks.length <= 1,
    }
  })
}

export function updateTaskList(sessionId: string, data: {
  task_list_id: string
  tasks: Task[]
  sequence: number
  timestamp: number
}): void {
  setState(sessionId, state => {
    const taskLists = state.taskLists.map(taskList => {
      if (taskList.id === data.task_list_id) {
        return {
          ...taskList,
          tasks: data.tasks,
          stats: calculateStats(data.tasks),
          sequence: data.sequence,
          updated_at: data.timestamp,
        }
      }
      return taskList
    })
    
    return {
      ...state,
      taskLists,
    }
  })
}

function calculateStats(tasks: Task[]): TaskList['stats'] {
  return tasks.reduce(
    (stats, task) => {
      stats.total += 1
      stats[task.status.toLowerCase() as keyof Omit<TaskList['stats'], 'total'>] += 1
      return stats
    },
    { total: 0, ready: 0, running: 0, done: 0, failed: 0 }
  )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getTaskState(sessionId: string): TaskState {
  return getEntry(sessionId).state
}

export function setTasksCollapsed(sessionId: string, collapsed: boolean): void {
  setState(sessionId, state => ({
    ...state,
    collapsed,
  }))
}

export function clearTaskLists(sessionId: string): void {
  setState(sessionId, () => defaultState())
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export function useTaskState(sessionId: string): TaskState {
  const [, forceUpdate] = useState({})
  
  useEffect(() => {
    const entry = getEntry(sessionId)
    const listener = () => forceUpdate({})
    
    entry.listeners.add(listener)
    
    return () => {
      entry.listeners.delete(listener)
    }
  }, [sessionId])
  
  return getEntry(sessionId).state
}

// ---------------------------------------------------------------------------
// SSE event integration (to be called from ChatArea or similar)
// ---------------------------------------------------------------------------

export function handleTaskSSEEvent(sessionId: string, event: any): boolean {
  if (event.type === 'task_list.init') {
    initTaskList(sessionId, event)
    return true
  }
  
  if (event.type === 'task_list.update') {
    updateTaskList(sessionId, event)
    return true
  }
  
  return false  // Not a task event
}