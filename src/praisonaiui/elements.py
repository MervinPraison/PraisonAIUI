"""Element constructors for common data visualization libraries.

This module provides constructors for Plotly, Pyplot, and Dataframe elements
that serialize matplotlib/plotly/pandas objects to JSON deterministically.
Lazy imports ensure these heavy dependencies are only loaded on first use.
"""

from __future__ import annotations

import json
import base64
from io import BytesIO
from typing import Any, Optional, Dict, Union
from dataclasses import dataclass

from praisonaiui.schema.models import MessageElement


@dataclass
class PlotlyElement(MessageElement):
    """Plotly figure element for messages.
    
    Accepts a plotly figure object and serializes it to JSON for display.
    
    Example:
        import plotly.graph_objects as go
        
        fig = go.Figure(data=go.Bar(x=['A', 'B', 'C'], y=[1, 2, 3]))
        plotly_elem = PlotlyElement(fig)
        await plotly_elem.send()
    """
    
    type: str = "plotly"
    fig_data: Optional[Dict[str, Any]] = None
    
    def __init__(self, fig: Any = None, name: Optional[str] = None, 
                 display: str = "inline", **kwargs):
        """Initialize with a plotly figure.
        
        Args:
            fig: Plotly figure object
            name: Optional name for the element
            display: Display mode (inline, side, page)
            **kwargs: Additional element properties
        """
        # Lazy import plotly
        try:
            import plotly.graph_objects as go
            import plotly
        except ImportError:
            raise ImportError(
                "plotly is required for PlotlyElement. Install with: pip install plotly"
            )
        
        if fig is not None:
            # Serialize plotly figure deterministically
            if hasattr(fig, 'to_dict'):
                self.fig_data = fig.to_dict()
            elif hasattr(fig, 'to_json'):
                # Some plotly objects have to_json
                fig_json = fig.to_json()
                self.fig_data = json.loads(fig_json)
            else:
                raise ValueError(f"Unsupported plotly object type: {type(fig)}")
        
        super().__init__(
            type=self.type,
            name=name or "Plotly Figure", 
            display=display,
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


@dataclass  
class PyplotElement(MessageElement):
    """Matplotlib pyplot figure element for messages.
    
    Accepts a matplotlib figure and converts it to a base64 PNG image.
    
    Example:
        import matplotlib.pyplot as plt
        
        plt.figure()
        plt.plot([1, 2, 3], [4, 5, 6])
        
        pyplot_elem = PyplotElement(plt.gcf())
        await pyplot_elem.send()
    """
    
    type: str = "image"
    url: Optional[str] = None
    
    def __init__(self, fig: Any = None, name: Optional[str] = None,
                 display: str = "inline", dpi: int = 100, **kwargs):
        """Initialize with a matplotlib figure.
        
        Args:
            fig: Matplotlib figure object
            name: Optional name for the element
            display: Display mode (inline, side, page)
            dpi: Resolution for PNG export
            **kwargs: Additional element properties
        """
        # Lazy import matplotlib
        try:
            import matplotlib.pyplot as plt
            import matplotlib.figure
        except ImportError:
            raise ImportError(
                "matplotlib is required for PyplotElement. Install with: pip install matplotlib"
            )
        
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
            self.url = f"data:image/png;base64,{img_base64}"
            
            buffer.close()
        
        super().__init__(
            type=self.type,
            name=name or "Matplotlib Figure",
            display=display,
            url=self.url,
            **kwargs
        )


@dataclass
class DataframeElement(MessageElement):
    """Pandas DataFrame element for messages.
    
    Accepts a pandas DataFrame and serializes it to JSON with optional styling.
    
    Example:
        import pandas as pd
        
        df = pd.DataFrame({
            'A': [1, 2, 3],
            'B': [4, 5, 6]
        })
        
        df_elem = DataframeElement(df)
        await df_elem.send()
    """
    
    type: str = "dataframe"
    data: Optional[Dict[str, Any]] = None
    
    def __init__(self, df: Any = None, name: Optional[str] = None,
                 display: str = "inline", max_rows: int = 1000, 
                 max_cols: int = 100, **kwargs):
        """Initialize with a pandas DataFrame.
        
        Args:
            df: Pandas DataFrame object
            name: Optional name for the element
            display: Display mode (inline, side, page)
            max_rows: Maximum number of rows to serialize
            max_cols: Maximum number of columns to serialize
            **kwargs: Additional element properties
        """
        # Lazy import pandas
        try:
            import pandas as pd
        except ImportError:
            raise ImportError(
                "pandas is required for DataframeElement. Install with: pip install pandas"
            )
        
        if df is not None:
            if not isinstance(df, pd.DataFrame):
                raise ValueError(f"Expected pandas DataFrame, got {type(df)}")
            
            # Truncate if too large
            if len(df) > max_rows:
                df = df.head(max_rows)
            if len(df.columns) > max_cols:
                df = df.iloc[:, :max_cols]
            
            # Convert to JSON with proper handling of different data types
            self.data = {
                "columns": df.columns.tolist(),
                "index": df.index.tolist(),
                "data": df.to_dict('records'),
                "shape": df.shape,
                "dtypes": df.dtypes.astype(str).to_dict()
            }
        
        super().__init__(
            type=self.type,
            name=name or "DataFrame",
            display=display,
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
    return PlotlyElement(fig=fig, name=name, display=display)


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
            import matplotlib.pyplot as plt
            fig = plt.gcf()
        except ImportError:
            raise ImportError(
                "matplotlib is required for Pyplot. Install with: pip install matplotlib"
            )
    
    return PyplotElement(fig=fig, name=name, display=display, dpi=dpi)


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
    return DataframeElement(df=df, name=name, display=display, 
                           max_rows=max_rows, max_cols=max_cols)