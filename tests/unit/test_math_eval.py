"""Tests for safe math expression evaluation."""

import pytest

from praisonaiui.math_eval import eval_math_expression


def test_basic_arithmetic():
    assert eval_math_expression("2 + 3") == 5
    assert eval_math_expression("10 - 4") == 6
    assert eval_math_expression("3 * 7") == 21
    assert eval_math_expression("8 / 2") == 4.0


def test_parentheses_and_unary():
    assert eval_math_expression("(2 + 3) * 4") == 20
    assert eval_math_expression("-5 + 10") == 5


def test_rejects_unsafe_input():
    with pytest.raises(ValueError):
        eval_math_expression("__import__('os').system('id')")
    with pytest.raises(ValueError):
        eval_math_expression("2 + x")
