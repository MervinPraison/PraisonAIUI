"""Safe arithmetic expression evaluation without eval/exec."""

from __future__ import annotations

import ast
import operator

_BINOPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARYOPS = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}
_ALLOWED_NODES = (
    ast.Expression,
    ast.BinOp,
    ast.UnaryOp,
    ast.Constant,
    *tuple(_BINOPS),
    *tuple(_UNARYOPS),
)


def eval_math_expression(expression: str) -> float | int:
    """Evaluate a basic math expression via AST walking (no eval/exec)."""
    allowed_chars = set("0123456789+-*/.() ")
    if not expression or not all(c in allowed_chars for c in expression):
        raise ValueError("Only basic math operations allowed")

    tree = ast.parse(expression.strip(), mode="eval")

    def _walk(node: ast.AST) -> float | int:
        if isinstance(node, ast.Expression):
            return _walk(node.body)
        if isinstance(node, ast.Constant):
            if isinstance(node.value, (int, float)):
                return node.value
            raise ValueError("Only numeric literals allowed")
        if isinstance(node, ast.BinOp):
            op = _BINOPS.get(type(node.op))
            if op is None:
                raise ValueError("Unsupported operator")
            left = _walk(node.left)
            right = _walk(node.right)
            if isinstance(node.op, ast.Pow):
                if abs(right) > 100:
                    raise ValueError("Exponent too large")
            return op(left, right)
        if isinstance(node, ast.UnaryOp):
            op = _UNARYOPS.get(type(node.op))
            if op is None:
                raise ValueError("Unsupported unary operator")
            return op(_walk(node.operand))
        raise ValueError("Unsupported expression")

    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODES):
            raise ValueError("Only basic math operations allowed")

    return _walk(tree)
