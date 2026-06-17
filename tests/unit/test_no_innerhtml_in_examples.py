"""Test to ensure no innerHTML XSS patterns in examples."""

import os
from pathlib import Path


def test_no_innerhtml_in_examples():
    """Ensure no innerHTML with interpolated API data in example files."""
    examples_dir = Path(__file__).parent.parent.parent / "examples"
    
    # Patterns that indicate potential XSS via innerHTML
    dangerous_patterns = [
        ".innerHTML =",
        ".innerHTML=",
        ".innerHTML +=",
        ".innerHTML+=",
    ]
    
    violations = []
    
    # Check all Python and HTML files in examples
    for file_path in examples_dir.rglob("*.py"):
        content = file_path.read_text()
        for line_num, line in enumerate(content.split("\n"), 1):
            for pattern in dangerous_patterns:
                if pattern in line:
                    # Check if it's in a string (potential HTML/JS)
                    if ('"""' in line or "'''" in line or 
                        "HTML" in line or "html" in line or
                        "<script>" in content[max(0, content.find(line) - 100):content.find(line) + 100]):
                        violations.append({
                            "file": str(file_path.relative_to(examples_dir.parent)),
                            "line": line_num,
                            "content": line.strip()
                        })
    
    # Also check actual .html files
    for file_path in examples_dir.rglob("*.html"):
        content = file_path.read_text()
        for line_num, line in enumerate(content.split("\n"), 1):
            for pattern in dangerous_patterns:
                if pattern in line:
                    violations.append({
                        "file": str(file_path.relative_to(examples_dir.parent)),
                        "line": line_num,
                        "content": line.strip()
                    })
    
    if violations:
        msg = "Found innerHTML XSS patterns in examples:\n"
        for v in violations:
            msg += f"  {v['file']}:{v['line']} - {v['content'][:80]}\n"
        raise AssertionError(msg)


def test_no_deprecated_example_12():
    """Ensure deprecated example 12-agent-dashboard is removed."""
    examples_dir = Path(__file__).parent.parent.parent / "examples"
    deprecated_path = examples_dir / "python" / "12-agent-dashboard"
    
    assert not deprecated_path.exists(), (
        f"Deprecated insecure example {deprecated_path} should be removed. "
        "It contains innerHTML XSS vulnerabilities. "
        "Use examples/python/15-dashboard-test/ or examples/python/13-real-dashboard/ instead."
    )


if __name__ == "__main__":
    # Allow running without pytest
    try:
        test_no_innerhtml_in_examples()
        print("✓ No innerHTML XSS patterns found in examples")
    except AssertionError as e:
        print(f"✗ {e}")
        exit(1)
    
    try:
        test_no_deprecated_example_12()
        print("✓ Deprecated example 12-agent-dashboard is removed")
    except AssertionError as e:
        print(f"✗ {e}")
        exit(1)
    
    print("\nAll security tests passed!")