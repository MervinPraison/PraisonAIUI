"""Element constructors for common data visualization libraries.

This module provides constructors for Plotly, Pyplot, and Dataframe elements
that serialize matplotlib/plotly/pandas objects to JSON deterministically.
Lazy imports ensure these heavy dependencies are only loaded on first use.
"""

from __future__ import annotations

import base64
import json
from io import BytesIO
from typing import Any, Dict, Optional

from praisonaiui.schema.models import MessageElement


class PlotlyElement(MessageElement):
    """Plotly figure element for messages.

    Accepts a plotly figure object and serializes it to JSON for display.

    Example:
        import plotly.graph_objects as go

        fig = go.Figure(data=go.Bar(x=['A', 'B', 'C'], y=[1, 2, 3]))
        plotly_elem = PlotlyElement.from_fig(fig)
        await plotly_elem.send()
    """

    type: str = "plotly"
    fig_data: Optional[Dict[str, Any]] = None

    @classmethod
    def from_fig(cls, fig: Any, name: Optional[str] = None, display: str = "inline", **kwargs) -> "PlotlyElement":
        """Create PlotlyElement from a plotly figure.

        Args:
            fig: Plotly figure object
            name: Optional name for the element
            display: Display mode (inline, side, page)
            **kwargs: Additional element properties

        Returns:
            PlotlyElement instance
        """
        # Lazy import plotly
        try:
            import plotly  # noqa: F401
            import plotly.graph_objects as go  # noqa: F401
        except ImportError:
            raise ImportError(
                "plotly is required for PlotlyElement. Install with: pip install plotly"
            )

        fig_data = None
        if fig is not None:
            # Serialize plotly figure deterministically
            if hasattr(fig, 'to_dict'):
                fig_data = fig.to_dict()
            elif hasattr(fig, 'to_json'):
                # Some plotly objects have to_json
                fig_json = fig.to_json()
                fig_data = json.loads(fig_json)
            else:
                raise ValueError(f"Unsupported plotly object type: {type(fig)}")

        return cls(
            type="plotly",
            name=name or "Plotly Figure",
            display=display,
            fig_data=fig_data,
            **kwargs
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        result = super().model_dump()
        result.update({
            "type": "plotly",
            "data": self.fig_data
        })
        return result


class PyplotElement(MessageElement):
    """Matplotlib pyplot figure element for messages.

    Accepts a matplotlib figure and converts it to a base64 PNG image.

    Example:
        import matplotlib.pyplot as plt

        plt.figure()
        plt.plot([1, 2, 3], [4, 5, 6])

        pyplot_elem = PyplotElement.from_fig(plt.gcf())
        await pyplot_elem.send()
    """

    type: str = "image"
    url: Optional[str] = None

    @classmethod
    def from_fig(cls, fig: Any = None, name: Optional[str] = None,
                 display: str = "inline", dpi: int = 100, **kwargs) -> "PyplotElement":
        """Create PyplotElement from a matplotlib figure.

        Args:
            fig: Matplotlib figure object
            name: Optional name for the element
            display: Display mode (inline, side, page)
            dpi: Resolution for PNG export
            **kwargs: Additional element properties

        Returns:
            PyplotElement instance
        """
        # Lazy import matplotlib
        try:
            import matplotlib.figure
            import matplotlib.pyplot as plt  # noqa: F401
        except ImportError:
            raise ImportError(
                "matplotlib is required for PyplotElement. Install with: pip install matplotlib"
            )

        url = None
        if fig is not None:
            # Convert matplotlib figure to base64 PNG
            if not isinstance(fig, matplotlib.figure.Figure):
                raise ValueError(f"Expected matplotlib Figure, got {type(fig)}")

            # Save figure to bytes buffer
            buffer = BytesIO()
            fig.savefig(buffer, format='png', dpi=dpi, bbox_inches='tight')
            buffer.seek(0)

            # Encode as base64 data URL
            img_data = buffer.getvalue()
            img_base64 = base64.b64encode(img_data).decode('utf-8')
            url = f"data:image/png;base64,{img_base64}"

            buffer.close()

        return cls(
            type="image",
            name=name or "Matplotlib Figure",
            display=display,
            url=url,
            **kwargs
        )


class DataframeElement(MessageElement):
    """Pandas DataFrame element for messages.

    Accepts a pandas DataFrame and serializes it to JSON with optional styling.

    Example:
        import pandas as pd

        df = pd.DataFrame({
            'A': [1, 2, 3],
            'B': [4, 5, 6]
        })

        df_elem = DataframeElement.from_df(df)
        await df_elem.send()
    """

    type: str = "dataframe"
    data: Optional[Dict[str, Any]] = None

    @classmethod
    def from_df(cls, df: Any = None, name: Optional[str] = None,
                display: str = "inline", max_rows: int = 1000,
                max_cols: int = 100, **kwargs) -> "DataframeElement":
        """Create DataframeElement from a pandas DataFrame.

        Args:
            df: Pandas DataFrame object
            name: Optional name for the element
            display: Display mode (inline, side, page)
            max_rows: Maximum number of rows to serialize
            max_cols: Maximum number of columns to serialize
            **kwargs: Additional element properties

        Returns:
            DataframeElement instance
        """
        # Lazy import pandas
        try:
            import pandas as pd
        except ImportError:
            raise ImportError(
                "pandas is required for DataframeElement. Install with: pip install pandas"
            )

        data = None
        if df is not None:
            if not isinstance(df, pd.DataFrame):
                raise ValueError(f"Expected pandas DataFrame, got {type(df)}")

            # Truncate if too large
            if len(df) > max_rows:
                df = df.head(max_rows)
            if len(df.columns) > max_cols:
                df = df.iloc[:, :max_cols]

            # Convert to JSON with proper handling of different data types
            data = {
                "columns": df.columns.tolist(),
                "index": df.index.tolist(),
                "data": df.to_dict('records'),
                "shape": df.shape,
                "dtypes": df.dtypes.astype(str).to_dict()
            }

        return cls(
            type="dataframe",
            name=name or "DataFrame",
            display=display,
            data=data,
            **kwargs
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        result = super().model_dump()
        result.update({
            "type": "dataframe",
            "data": self.data
        })
        return result


# Convenience constructors (matching the issue spec)
def Plotly(fig: Any, name: Optional[str] = None, display: str = "inline") -> PlotlyElement:
    """Create a Plotly element from a plotly figure.

    Args:
        fig: Plotly figure object
        name: Optional name for the element
        display: Display mode (inline, side, page)

    Returns:
        PlotlyElement instance
    """
    return PlotlyElement.from_fig(fig=fig, name=name, display=display)


def Pyplot(fig: Any = None, name: Optional[str] = None, display: str = "inline",
           dpi: int = 100) -> PyplotElement:
    """Create a Pyplot element from a matplotlib figure.

    Args:
        fig: Matplotlib figure object (if None, uses plt.gcf())
        name: Optional name for the element
        display: Display mode (inline, side, page)
        dpi: Resolution for PNG export

    Returns:
        PyplotElement instance
    """
    if fig is None:
        # Lazy import matplotlib
        try:
            import matplotlib.pyplot as plt  # noqa: F401
            fig = plt.gcf()
        except ImportError:
            raise ImportError(
                "matplotlib is required for Pyplot. Install with: pip install matplotlib"
            )

    return PyplotElement.from_fig(fig=fig, name=name, display=display, dpi=dpi)


def Dataframe(df: Any, name: Optional[str] = None, display: str = "inline",
              max_rows: int = 1000, max_cols: int = 100) -> DataframeElement:
    """Create a Dataframe element from a pandas DataFrame.

    Args:
        df: Pandas DataFrame object
        name: Optional name for the element
        display: Display mode (inline, side, page)
        max_rows: Maximum number of rows to serialize
        max_cols: Maximum number of columns to serialize

    Returns:
        DataframeElement instance
    """
    return DataframeElement.from_df(df=df, name=name, display=display,
                                   max_rows=max_rows, max_cols=max_cols)
