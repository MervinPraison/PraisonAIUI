"""Tests for docs scanner."""

from pathlib import Path

import pytest

from praisonaiui.compiler.docs_scanner import DocPage, DocsScanner


class TestDocsScanner:
    """Tests for DocsScanner."""

    def test_scan_empty_dir(self, tmp_path):
        """Test scanning an empty directory."""
        docs_dir = tmp_path / "docs"
        docs_dir.mkdir()

        scanner = DocsScanner(docs_dir)
        pages = scanner.scan()
        assert pages == []

    def test_scan_single_file(self, tmp_path):
        """Test scanning a single markdown file."""
        docs_dir = tmp_path / "docs"
        docs_dir.mkdir()
        (docs_dir / "intro.md").write_text("# Introduction\n\nWelcome!")

        scanner = DocsScanner(docs_dir)
        pages = scanner.scan()

        assert len(pages) == 1
        assert pages[0].slug == "intro"
        assert pages[0].title == "Introduction"

    def test_scan_with_frontmatter(self, tmp_path):
        """Test extracting frontmatter from markdown."""
        docs_dir = tmp_path / "docs"
        docs_dir.mkdir()
        (docs_dir / "guide.md").write_text(
            """---
title: User Guide
order: 1
---

# Guide

Content here.
"""
        )

        scanner = DocsScanner(docs_dir)
        pages = scanner.scan()

        assert len(pages) == 1
        assert pages[0].title == "User Guide"
        assert pages[0].order == 1
        assert pages[0].frontmatter["order"] == 1

    def test_scan_index_file(self, tmp_path):
        """Test index file gets root slug."""
        docs_dir = tmp_path / "docs"
        docs_dir.mkdir()
        (docs_dir / "index.md").write_text("# Welcome")

        scanner = DocsScanner(docs_dir)
        pages = scanner.scan()

        assert len(pages) == 1
        assert pages[0].slug == "index"

    def test_scan_nested_structure(self, tmp_path):
        """Test scanning nested directory structure."""
        docs_dir = tmp_path / "docs"
        (docs_dir / "getting-started").mkdir(parents=True)
        (docs_dir / "getting-started" / "installation.md").write_text("# Installation")
        (docs_dir / "getting-started" / "quick-start.md").write_text("# Quick Start")

        scanner = DocsScanner(docs_dir)
        pages = scanner.scan()

        assert len(pages) == 2
        slugs = {p.slug for p in pages}
        assert "getting-started/installation" in slugs
        assert "getting-started/quick-start" in slugs

    def test_exclude_patterns(self, tmp_path):
        """Test excluding files by pattern."""
        docs_dir = tmp_path / "docs"
        docs_dir.mkdir()
        (docs_dir / "public.md").write_text("# Public")
        (docs_dir / "draft-secret.md").write_text("# Draft")

        scanner = DocsScanner(docs_dir, exclude=["draft-*"])
        pages = scanner.scan()

        assert len(pages) == 1
        assert pages[0].slug == "public"

    def test_number_prefix_ordering(self, tmp_path):
        """Test that number prefixes are stripped and used for ordering."""
        docs_dir = tmp_path / "docs"
        docs_dir.mkdir()
        (docs_dir / "01-first.md").write_text("# First")
        (docs_dir / "02-second.md").write_text("# Second")

        scanner = DocsScanner(docs_dir)
        pages = scanner.scan()

        assert len(pages) == 2
        assert pages[0].order == 1
        assert pages[1].order == 2
