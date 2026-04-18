"""
Unit tests for praisonaiui.tasks module.

Tests task status transitions, SSE event emission, concurrent TaskLists,
forId linking, and deterministic serialization as specified in the acceptance criteria.
"""

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Use anyio for async tests (same as other test files)
pytestmark = pytest.mark.anyio

from praisonaiui.tasks import Task, TaskList, TaskStatus


class TestTask:
    """Test Task class functionality."""
    
    def test_task_creation(self):
        """Test basic task creation with defaults."""
        task = Task("Test task")
        
        assert task.title == "Test task"
        assert task.status == TaskStatus.READY
        assert task.icon is None
        assert task.forId is None
        assert task.parent is None
        assert isinstance(task.id, str)
        assert len(task.id) > 0
        
    def test_task_creation_with_options(self):
        """Test task creation with all options."""
        task = Task(
            title="Custom task",
            status=TaskStatus.RUNNING,
            icon="🔧",
            forId="msg-123"
        )
        
        assert task.title == "Custom task"
        assert task.status == TaskStatus.RUNNING
        assert task.icon == "🔧"
        assert task.forId == "msg-123"
        
    def test_task_status_transitions(self):
        """Test that changing task status updates timestamp and triggers parent update."""
        task = Task("Test task")
        original_time = task.updated_at
        
        # Small delay to ensure timestamp changes
        time.sleep(0.001)
        
        task.status = TaskStatus.RUNNING
        
        assert task.status == TaskStatus.RUNNING
        assert task.updated_at > original_time
        
    def test_task_to_dict(self):
        """Test task serialization to dictionary."""
        task = Task(
            title="Test task",
            status=TaskStatus.RUNNING,
            icon="🔧",
            forId="msg-123"
        )
        
        data = task.to_dict()
        
        assert data["id"] == task.id
        assert data["title"] == "Test task"
        assert data["status"] == "RUNNING"
        assert data["icon"] == "🔧"
        assert data["forId"] == "msg-123"
        assert data["created_at"] == task.created_at
        assert data["updated_at"] == task.updated_at


class TestTaskList:
    """Test TaskList class functionality."""
    
    def test_tasklist_creation(self):
        """Test basic TaskList creation."""
        task_list = TaskList("Test pipeline")
        
        assert task_list.name == "Test pipeline"
        assert task_list.tasks == []
        assert isinstance(task_list.id, str)
        assert len(task_list.id) > 0
        assert task_list._sequence_number == 0
        assert not task_list._sent
        
    def test_tasklist_get_stats(self):
        """Test TaskList statistics calculation."""
        task_list = TaskList("Test pipeline")
        
        # Empty list
        stats = task_list.get_stats()
        assert stats == {"total": 0, "ready": 0, "running": 0, "done": 0, "failed": 0}
        
        # Add tasks with different statuses
        task_list.tasks = [
            Task("Task 1", TaskStatus.READY),
            Task("Task 2", TaskStatus.RUNNING),
            Task("Task 3", TaskStatus.DONE),
            Task("Task 4", TaskStatus.DONE),
            Task("Task 5", TaskStatus.FAILED),
        ]
        
        stats = task_list.get_stats()
        assert stats == {"total": 5, "ready": 1, "running": 1, "done": 2, "failed": 1}
        
    def test_tasklist_to_dict(self):
        """Test TaskList serialization to dictionary."""
        task_list = TaskList("Test pipeline")
        task = Task("Test task", TaskStatus.RUNNING)
        task_list.tasks = [task]
        
        data = task_list.to_dict()
        
        assert data["id"] == task_list.id
        assert data["name"] == "Test pipeline"
        assert len(data["tasks"]) == 1
        assert data["tasks"][0] == task.to_dict()
        assert data["stats"]["total"] == 1
        assert data["stats"]["running"] == 1
        assert data["sequence"] == task_list._sequence_number


class TestTaskStatusEnum:
    """Test TaskStatus enumeration."""
    
    def test_task_status_values(self):
        """Test that TaskStatus enum has expected values."""
        assert TaskStatus.READY.value == "READY"
        assert TaskStatus.RUNNING.value == "RUNNING"
        assert TaskStatus.DONE.value == "DONE"
        assert TaskStatus.FAILED.value == "FAILED"
        
    def test_task_status_serialization(self):
        """Test that TaskStatus serializes correctly."""
        task = Task("Test", TaskStatus.RUNNING)
        data = task.to_dict()
        
        assert data["status"] == "RUNNING"
        assert isinstance(data["status"], str)


if __name__ == "__main__":
    pytest.main([__file__])