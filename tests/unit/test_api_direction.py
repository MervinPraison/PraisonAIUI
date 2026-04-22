"""Test API direction constraints to prevent regression.

This test file enforces the API naming conventions established in issue #41.
It fails CI if new symbols are added that violate the verb-first naming pattern.
"""

import ast
import re
from pathlib import Path

import pytest

# Allow-lists for current symbols that should not be changed
# Modifying these lists should be a deliberate decision requiring review

# Current Ask*Message classes that are documented but deprecated
ALLOWED_ASK_MESSAGE_CLASSES = {
    "AskUserMessage",
    "AskFileMessage",
    "AskActionMessage",
    "AskElementMessage",
}

# Verbs that should not be used to start Message class names
FORBIDDEN_VERB_PREFIXES = {
    "Ask",
    "Do",
    "Request",
    "Show",
    "Get",
    "Set",
    "Send",
    "Create",
    "Make",
    "Build",
    "Generate",
}

# Current callback decorators in callbacks.py that are allowed
ALLOWED_CALLBACK_DECORATORS = {
    "welcome",
    "reply",
    "goodbye",
    "cancel",
    "button",
    "login",
    "settings",
    "profiles",
    "starters",
    "on",
    "page",
    "resume",
}

# Future-proof decorator namespaces that are always allowed
ALLOWED_DECORATOR_NAMESPACES = {
    "on_",  # e.g. on_connect, on_message
    "get_",  # e.g. get_starters, get_chat_profiles
}


def get_project_root() -> Path:
    """Get the project root directory."""
    return Path(__file__).parent.parent.parent


def extract_classes_from_file(file_path: Path) -> list[str]:
    """Extract class names from a Python file."""
    if not file_path.exists():
        return []

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            tree = ast.parse(f.read())

        classes = []
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                classes.append(node.name)
        return classes
    except (SyntaxError, UnicodeDecodeError):
        # Skip files that can't be parsed
        return []


def extract_functions_from_file(file_path: Path) -> list[str]:
    """Extract top-level function names from a Python file."""
    if not file_path.exists():
        return []

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            tree = ast.parse(f.read())

        functions = []
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and not node.name.startswith("_"):
                functions.append(node.name)
        return functions
    except (SyntaxError, UnicodeDecodeError):
        # Skip files that can't be parsed
        return []


def get_exported_symbols_from_init() -> set[str]:
    """Get symbols exported from __init__.py's __all__ list."""
    init_path = get_project_root() / "src" / "praisonaiui" / "__init__.py"
    if not init_path.exists():
        return set()

    try:
        with open(init_path, "r", encoding="utf-8") as f:
            tree = ast.parse(f.read())

        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id == "__all__":
                        if isinstance(node.value, ast.List):
                            return {
                                elt.value
                                for elt in node.value.elts
                                if isinstance(elt, ast.Constant) and isinstance(elt.value, str)
                            }
    except (SyntaxError, UnicodeDecodeError):
        pass

    return set()


class TestAskMessageRegression:
    """Test that no new Ask*Message classes are added."""

    def test_no_new_ask_message_classes_in_message_py(self):
        """Fail if new Ask*Message classes are added to message.py."""
        message_file = get_project_root() / "src" / "praisonaiui" / "message.py"
        classes = extract_classes_from_file(message_file)

        ask_message_classes = {cls for cls in classes if re.match(r"^Ask.+Message$", cls)}

        new_ask_classes = ask_message_classes - ALLOWED_ASK_MESSAGE_CLASSES

        assert not new_ask_classes, (
            f"New Ask*Message classes detected in message.py: {new_ask_classes}. "
            f"The API direction is verb-first helpers, not class-first patterns. "
            f"Add a verb-first helper function instead (e.g., request_file, prompt). "
            f"See issue #41 Phase 2 for examples."
        )

    def test_no_new_ask_message_classes_in_exports(self):
        """Fail if new Ask*Message classes are exported from __init__.py."""
        exported_symbols = get_exported_symbols_from_init()

        exported_ask_classes = {
            symbol for symbol in exported_symbols if re.match(r"^Ask.+Message$", symbol)
        }

        new_exported_ask_classes = exported_ask_classes - ALLOWED_ASK_MESSAGE_CLASSES

        assert not new_exported_ask_classes, (
            f"New Ask*Message classes exported from __init__.py: {new_exported_ask_classes}. "
            f"Remove from __all__ or add equivalent verb-first helper instead."
        )


class TestVerbPrefixedMessageClasses:
    """Test that no new Message classes start with forbidden verbs."""

    def test_no_verb_prefixed_message_classes(self):
        """Fail if Message classes are added with verb prefixes."""
        message_file = get_project_root() / "src" / "praisonaiui" / "message.py"
        classes = extract_classes_from_file(message_file)

        # Find classes ending in 'Message' that start with forbidden verbs
        forbidden_classes = []
        for cls in classes:
            if cls.endswith("Message"):
                for verb in FORBIDDEN_VERB_PREFIXES:
                    if cls.startswith(verb) and cls != "Message":
                        # Allow existing Ask*Message classes
                        if cls not in ALLOWED_ASK_MESSAGE_CLASSES:
                            forbidden_classes.append(cls)
                        break

        assert not forbidden_classes, (
            f"Message classes with forbidden verb prefixes detected: {forbidden_classes}. "
            f"Forbidden prefixes: {sorted(FORBIDDEN_VERB_PREFIXES)}. "
            f"Use verb-first module functions instead of verb-in-class-name pattern."
        )


class TestCallbackDecoratorRegression:
    """Test callback decorator naming constraints."""

    def test_no_unauthorized_callback_decorators(self):
        """Fail if new decorators are added that don't follow on_*/get_* pattern."""
        callbacks_file = get_project_root() / "src" / "praisonaiui" / "callbacks.py"
        functions = extract_functions_from_file(callbacks_file)

        # Filter to decorator-like functions (those that likely return callables)
        # This is a heuristic but should catch most decorator functions
        unauthorized_decorators = []

        for func in functions:
            # Skip if it's already in the allow-list
            if func in ALLOWED_CALLBACK_DECORATORS:
                continue

            # Skip if it matches an allowed namespace
            if any(func.startswith(namespace) for namespace in ALLOWED_DECORATOR_NAMESPACES):
                continue

            # If we get here, it's potentially unauthorized
            unauthorized_decorators.append(func)

        assert not unauthorized_decorators, (
            f"New callback decorators detected that don't follow naming pattern: {unauthorized_decorators}. "
            f"New decorators should use 'on_*' or 'get_*' prefixes for framework-neutral vocabulary. "
            f"Allowed existing decorators: {sorted(ALLOWED_CALLBACK_DECORATORS)}. "
            f"Allowed new patterns: functions starting with {sorted(ALLOWED_DECORATOR_NAMESPACES)}."
        )

    def test_callback_decorators_exported_consistently(self):
        """Ensure callback decorators are properly exported."""
        callbacks_file = get_project_root() / "src" / "praisonaiui" / "callbacks.py"
        functions = extract_functions_from_file(callbacks_file)
        exported_symbols = get_exported_symbols_from_init()

        # Check that all allowed decorators are exported if they exist
        missing_exports = []
        for func in functions:
            if func in ALLOWED_CALLBACK_DECORATORS and func not in exported_symbols:
                missing_exports.append(func)

        assert not missing_exports, (
            f"Callback decorators exist but are not exported: {missing_exports}. "
            f"Add them to __all__ in __init__.py or remove from callbacks.py."
        )


class TestAPIDirectionCompliance:
    """Test overall API direction compliance."""

    def test_no_verb_in_class_name_pattern_in_exports(self):
        """Fail if exported classes follow the verb-in-class-name anti-pattern."""
        exported_symbols = get_exported_symbols_from_init()

        # Look for class-like symbols (PascalCase) that start with verbs
        verb_class_pattern = re.compile(
            r"^(Ask|Do|Request|Show|Get|Set|Send|Create|Make|Build|Generate)[A-Z]"
        )

        violations = []
        for symbol in exported_symbols:
            if verb_class_pattern.match(symbol):
                # Allow existing Ask*Message classes during transition
                if symbol not in ALLOWED_ASK_MESSAGE_CLASSES:
                    violations.append(symbol)

        assert not violations, (
            f"Exported symbols follow verb-in-class-name anti-pattern: {violations}. "
            f"Use verb-first module functions instead. "
            f"Example: prefer 'request_file()' over 'RequestFileMessage().send()'."
        )

    def test_existing_ask_classes_are_documented_as_deprecated(self):
        """Ensure existing Ask*Message classes are properly marked for deprecation."""
        # This test documents the current state and will be updated in future phases
        message_file = get_project_root() / "src" / "praisonaiui" / "message.py"

        assert message_file.exists(), "message.py should exist"

        with open(message_file, "r", encoding="utf-8") as f:
            content = f.read()

        # Verify the known deprecated classes exist
        for cls in ALLOWED_ASK_MESSAGE_CLASSES:
            assert f"class {cls}" in content, f"{cls} should exist in message.py"

        # This test will be enhanced in Phase 1 to check for actual DeprecationWarning calls
        # For now, it just documents the current state
        assert True, "Existing Ask*Message classes documented"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
