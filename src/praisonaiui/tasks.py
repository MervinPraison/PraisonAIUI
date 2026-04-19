"""Task management for progress sidebar - live-updating task lists with states."""

from __future__ import annotations

import asyncio
import time
from enum import Enum
from typing import Any, Optional
from uuid import uuid4


class TaskStatus(Enum):
    """Task status enumeration."""
    READY = "READY"
    RUNNING = "RUNNING"
    DONE = "DONE"
    FAILED = "FAILED"


class Task:
    """Individual task with title, status, and optional metadata."""

    def __init__(
        self,
        title: str,
        status: TaskStatus = TaskStatus.READY,
        icon: Optional[str] = None,
        forId: Optional[str] = None,
        parent: Optional[TaskList] = None,
    ):
        """Initialize a task.

        Args:
            title: Display name for the task
            status: Current task status (default: READY)
            icon: Optional Lucide icon name for the task
            forId: Optional message ID to link to when clicked
            parent: Reference to parent TaskList (set automatically)
        """
        self.id = str(uuid4())
        self.title = title
        self._status = status
        self.icon = icon
        self.forId = forId
        self.parent = parent
        self.created_at = time.time()
        self.updated_at = time.time()

    @property
    def status(self) -> TaskStatus:
        """Get task status."""
        return self._status

    @status.setter
    def status(self, value: TaskStatus) -> None:
        """Set task status and trigger parent update if needed."""
        if self._status != value:
            self._status = value
            self.updated_at = time.time()
            # Trigger parent TaskList update if available
            if self.parent:
                self._schedule_update()

    def _schedule_update(self) -> None:
        """Safely schedule parent update from any thread."""
        if not self.parent:
            return

        try:
            # Try to get current event loop
            loop = asyncio.get_running_loop()
            # Schedule update on the event loop thread
            loop.call_soon_threadsafe(self._create_update_task, loop)
        except RuntimeError:
            # No event loop running, attempt direct task creation
            # This may fail if called from wrong thread, but we catch it gracefully
            try:
                asyncio.create_task(self.parent._trigger_update())
            except RuntimeError:
                # Silently ignore - update will be missed but app won't crash
                pass

    def _create_update_task(self, loop: asyncio.AbstractEventLoop) -> None:
        """Create update task on the given event loop."""
        if self.parent:
            loop.create_task(self.parent._trigger_update())

    def to_dict(self) -> dict[str, Any]:
        """Serialize task to dictionary for SSE events."""
        return {
            "id": self.id,
            "title": self.title,
            "status": self.status.value,
            "icon": self.icon,
            "forId": self.forId,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class TaskList:
    """Manages a collection of tasks with live SSE updates."""

    def __init__(self, name: str):
        """Initialize a TaskList.

        Args:
            name: Display name for the task list
        """
        self.id = str(uuid4())
        self.name = name
        self.tasks: list[Task] = []
        self.created_at = time.time()
        self.updated_at = time.time()
        self._sequence_number = 0
        self._sent = False

    async def send(self) -> None:
        """Send initial TaskList to frontend via SSE."""
        from praisonaiui.callbacks import _get_context

        ctx = _get_context()
        if not ctx or not hasattr(ctx, '_stream_queue'):
            raise RuntimeError("TaskList.send() must be called within an active callback context")

        self._sent = True
        self._sequence_number += 1
        self.updated_at = time.time()

        event_data = {
            "type": "task_list.init",
            "task_list_id": self.id,
            "name": self.name,
            "tasks": [task.to_dict() for task in self.tasks],
            "sequence": self._sequence_number,
            "timestamp": self.updated_at,
        }

        await ctx._stream_queue.put(event_data)

    async def add_task(self, task: Task) -> None:
        """Add a task to the list and update frontend."""
        task.parent = self
        self.tasks.append(task)
        self.updated_at = time.time()

        if self._sent:
            await self._trigger_update()

    async def remove_task(self, task_id: str) -> bool:
        """Remove a task by ID and update frontend.

        Returns:
            True if task was found and removed, False otherwise
        """
        original_length = len(self.tasks)
        self.tasks = [t for t in self.tasks if t.id != task_id]

        if len(self.tasks) < original_length:
            self.updated_at = time.time()
            if self._sent:
                await self._trigger_update()
            return True
        return False

    async def update(self) -> None:
        """Manually trigger update to frontend (for batch operations)."""
        if self._sent:
            await self._trigger_update()

    async def _trigger_update(self) -> None:
        """Internal method to send update event via SSE."""
        from praisonaiui.callbacks import _get_context

        ctx = _get_context()
        if not ctx or not hasattr(ctx, '_stream_queue'):
            return  # Silently ignore if no context (task updates after callback ends)

        self._sequence_number += 1
        self.updated_at = time.time()

        event_data = {
            "type": "task_list.update",
            "task_list_id": self.id,
            "tasks": [task.to_dict() for task in self.tasks],
            "sequence": self._sequence_number,
            "timestamp": self.updated_at,
        }

        await ctx._stream_queue.put(event_data)

    def get_stats(self) -> dict[str, int]:
        """Get progress statistics for the task list."""
        stats = {
            "total": len(self.tasks),
            "ready": 0,
            "running": 0,
            "done": 0,
            "failed": 0,
        }

        for task in self.tasks:
            if task.status == TaskStatus.READY:
                stats["ready"] += 1
            elif task.status == TaskStatus.RUNNING:
                stats["running"] += 1
            elif task.status == TaskStatus.DONE:
                stats["done"] += 1
            elif task.status == TaskStatus.FAILED:
                stats["failed"] += 1

        return stats

    def to_dict(self) -> dict[str, Any]:
        """Serialize TaskList to dictionary for SSE events."""
        return {
            "id": self.id,
            "name": self.name,
            "tasks": [task.to_dict() for task in self.tasks],
            "stats": self.get_stats(),
            "sequence": self._sequence_number,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
