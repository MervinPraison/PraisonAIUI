/**
 * TaskSidebar.tsx — Right-side collapsible panel for task progress display.
 *
 * Shows live-updating task lists with states, progress bars, and click-to-jump functionality.
 */

import React from 'react'
import { ChevronRight, ChevronDown, CheckCircle, Clock, XCircle, Circle, ExternalLink } from 'lucide-react'
import { useTaskState, setTasksCollapsed, type Task, type TaskList, type TaskStatus } from '../state/tasks'
import { cn } from '../lib/utils'

interface TaskSidebarProps {
  sessionId: string
  onTaskClick?: (taskForId: string) => void
}

export function TaskSidebar({ sessionId, onTaskClick }: TaskSidebarProps) {
  const taskState = useTaskState(sessionId)
  
  // Hide sidebar when no task lists
  if (taskState.taskLists.length === 0) {
    return null
  }
  
  const toggleCollapsed = () => {
    setTasksCollapsed(sessionId, !taskState.collapsed)
  }
  
  return (
    <div className="w-80 border-l bg-background flex flex-col">
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-center justify-between">
        <button
          onClick={toggleCollapsed}
          className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
        >
          {taskState.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          Task Progress
        </button>
        {!taskState.collapsed && (
          <div className="text-xs text-muted-foreground">
            {taskState.taskLists.length} pipeline{taskState.taskLists.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
      
      {/* Content */}
      {!taskState.collapsed && (
        <div className="flex-1 overflow-auto">
          <div className="p-4 space-y-6">
            {taskState.taskLists.map((taskList, index) => (
              <TaskListDisplay
                key={taskList.id}
                taskList={taskList}
                onTaskClick={onTaskClick}
                isLast={index === taskState.taskLists.length - 1}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface TaskListDisplayProps {
  taskList: TaskList
  onTaskClick?: (taskForId: string) => void
  isLast: boolean
}

function TaskListDisplay({ taskList, onTaskClick, isLast }: TaskListDisplayProps) {
  const { stats } = taskList
  const progressPercent = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0
  
  return (
    <div className={cn("space-y-3", !isLast && "pb-6 border-b")}>
      {/* Task List Header */}
      <div className="space-y-2">
        <h3 className="font-medium text-sm">{taskList.name}</h3>
        
        {/* Progress Bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{stats.done}/{stats.total} completed</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className="bg-primary rounded-full h-2 transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
        
        {/* Status Summary */}
        {(stats.running > 0 || stats.failed > 0) && (
          <div className="flex gap-4 text-xs text-muted-foreground">
            {stats.running > 0 && (
              <span className="flex items-center gap-1">
                <Clock size={12} className="text-blue-500" />
                {stats.running} running
              </span>
            )}
            {stats.failed > 0 && (
              <span className="flex items-center gap-1">
                <XCircle size={12} className="text-red-500" />
                {stats.failed} failed
              </span>
            )}
          </div>
        )}
      </div>
      
      {/* Task List */}
      <div className="space-y-2">
        {taskList.tasks.map((task, index) => (
          <TaskDisplay
            key={task.id}
            task={task}
            index={index}
            onTaskClick={onTaskClick}
          />
        ))}
      </div>
    </div>
  )
}

interface TaskDisplayProps {
  task: Task
  index: number
  onTaskClick?: (taskForId: string) => void
}

function TaskDisplay({ task, index, onTaskClick }: TaskDisplayProps) {
  const handleClick = () => {
    if (task.forId && onTaskClick) {
      onTaskClick(task.forId)
    }
  }
  
  const isClickable = task.forId && onTaskClick
  
  return (
    <div
      className={cn(
        "flex items-center gap-3 p-2 rounded border text-sm",
        isClickable && "cursor-pointer hover:bg-accent/50 transition-colors",
        !isClickable && "bg-muted/30"
      )}
      onClick={isClickable ? handleClick : undefined}
    >
      {/* Task Number */}
      <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-xs font-mono text-muted-foreground shrink-0">
        {index + 1}
      </div>
      
      {/* Status Icon */}
      <TaskStatusIcon status={task.status} />
      
      {/* Task Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {task.icon && <span className="text-xs">{task.icon}</span>}
          <span className="truncate">{task.title}</span>
          {isClickable && <ExternalLink size={12} className="text-muted-foreground shrink-0" />}
        </div>
      </div>
    </div>
  )
}

interface TaskStatusIconProps {
  status: TaskStatus
}

function TaskStatusIcon({ status }: TaskStatusIconProps) {
  switch (status) {
    case 'READY':
      return <Circle size={14} className="text-muted-foreground shrink-0" />
    case 'RUNNING':
      return <Clock size={14} className="text-blue-500 animate-pulse shrink-0" />
    case 'DONE':
      return <CheckCircle size={14} className="text-green-500 shrink-0" />
    case 'FAILED':
      return <XCircle size={14} className="text-red-500 shrink-0" />
    default:
      return <Circle size={14} className="text-muted-foreground shrink-0" />
  }
}