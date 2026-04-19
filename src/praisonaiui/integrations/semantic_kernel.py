"""Semantic Kernel integration for PraisonAIUI.

Provides function invocation filter that maps SK function calls to aiui.Step events.
"""

from typing import Any, Dict

from praisonaiui.message import Step


class AiuiSemanticKernelFilter:
    """Semantic Kernel function invocation filter that creates aiui.Step events.

    Maps SK function invocations to Step visualization with proper nesting.

    Example:
        from praisonaiui.integrations.semantic_kernel import AiuiSemanticKernelFilter

        kernel.add_filter("function_invocation", AiuiSemanticKernelFilter())

        # All function calls now appear as Steps
        result = await kernel.invoke(function, arguments)
    """

    def __init__(self):
        """Initialize the Semantic Kernel filter."""
        self._context_to_step: Dict[str, Step] = {}

    async def on_function_invocation(self, context: Any, next_filter: Any) -> Any:
        """Handle function invocation with Step wrapping.

        Args:
            context: SK function context containing function info and arguments
            next_filter: Next filter in the chain

        Returns:
            The result of the function invocation
        """
        # Extract function information
        function_name = getattr(context.function, "name", "unknown_function")
        plugin_name = getattr(context.function, "plugin_name", None)

        # Create step name
        if plugin_name:
            step_name = f"🔧 SK Function: {plugin_name}.{function_name}"
        else:
            step_name = f"🔧 SK Function: {function_name}"

        # Get arguments
        args = getattr(context, "arguments", {})

        # SK doesn't provide explicit parent-child relationships in filters
        # Functions will appear as top-level steps unless nested SK calls occur
        parent_step = None
        step = Step(
            name=step_name,
            type="tool_call",
            parent=parent_step,
            metadata={
                "function_name": function_name,
                "plugin_name": plugin_name,
                "arguments": dict(args) if args else {},
            },
        )

        context_id = id(context)
        self._context_to_step[str(context_id)] = step

        try:
            # Start the step
            await step.__aenter__()

            # Stream function call details
            await step.stream_token(f"Calling {function_name}")
            if args:
                # Stream a summary of arguments (truncated for readability)
                args_str = str(dict(args))[:200]
                await step.stream_token(f"Arguments: {args_str}")

            # Execute the actual function
            result = await next_filter(context)

            # Stream the result
            if result is not None:
                result_str = str(result)[:300]
                await step.stream_token(f"Result: {result_str}")

            # Complete the step successfully
            await step.__aexit__(None, None, None)

            return result

        except Exception as error:
            # Complete the step with error
            await step.__aexit__(type(error), error, None)
            raise

        finally:
            # Clean up
            if str(context_id) in self._context_to_step:
                del self._context_to_step[str(context_id)]

    async def on_auto_function_invocation(self, context: Any, next_filter: Any) -> Any:
        """Handle auto function invocation (for AI-initiated calls).

        Similar to on_function_invocation but with different step naming
        to distinguish auto vs manual invocations.
        """
        # Extract function information
        function_name = getattr(context.function, "name", "unknown_function")
        plugin_name = getattr(context.function, "plugin_name", None)

        # Create step name for auto invocation
        if plugin_name:
            step_name = f"🤖 Auto SK Function: {plugin_name}.{function_name}"
        else:
            step_name = f"🤖 Auto SK Function: {function_name}"

        # Get arguments
        args = getattr(context, "arguments", {})

        # SK doesn't provide explicit parent-child relationships in filters
        # Functions will appear as top-level steps unless nested SK calls occur
        parent_step = None
        step = Step(
            name=step_name,
            type="sub_agent",  # Auto calls are more like sub-agent behavior
            parent=parent_step,
            metadata={
                "function_name": function_name,
                "plugin_name": plugin_name,
                "arguments": dict(args) if args else {},
                "auto_invocation": True,
            },
        )

        context_id = id(context)
        self._context_to_step[str(context_id)] = step

        try:
            # Start the step
            await step.__aenter__()

            # Stream function call details
            await step.stream_token(f"Auto-calling {function_name}")
            if args:
                # Stream a summary of arguments (truncated for readability)
                args_str = str(dict(args))[:200]
                await step.stream_token(f"Arguments: {args_str}")

            # Execute the actual function
            result = await next_filter(context)

            # Stream the result
            if result is not None:
                result_str = str(result)[:300]
                await step.stream_token(f"Result: {result_str}")

            # Complete the step successfully
            await step.__aexit__(None, None, None)

            return result

        except Exception as error:
            # Complete the step with error
            await step.__aexit__(type(error), error, None)
            raise

        finally:
            # Clean up
            if str(context_id) in self._context_to_step:
                del self._context_to_step[str(context_id)]

    # Alternative method names for different SK versions/interfaces
    async def on_function_invoking(self, context: Any, next_filter: Any) -> Any:
        """Alias for on_function_invocation for compatibility."""
        return await self.on_function_invocation(context, next_filter)

    async def on_function_invoked(self, context: Any, next_filter: Any) -> Any:
        """Handle post-invocation if needed by SK filter interface."""
        return await next_filter(context)
