"""Unit tests for message elements with Chainlit parity."""

import pytest
from pydantic import ValidationError

from praisonaiui.schema.models import (
    MessageElement,
    ImageElement,
    PdfElement,
    VideoElement,
    AudioElement,
    FileElement,
    CodeElement,
    MessageElementUnion,
)
from praisonaiui.message import Message, MAX_FILE_SIZE, MAX_CODE_SIZE


class TestMessageElementBase:
    """Tests for MessageElement base class functionality."""

    def test_image_element_dict_access(self):
        """Test backward compatibility with dict-style access."""
        element = ImageElement(url="https://example.com/img.png", alt="Test image")
        
        # Dict-style access should work
        assert element["type"] == "image"
        assert element["url"] == "https://example.com/img.png"
        assert element["alt"] == "Test image"
        assert element["display"] == "inline"  # default
        
        # Attribute access should still work
        assert element.type == "image"
        assert element.url == "https://example.com/img.png"
        assert element.alt == "Test image"

    def test_element_get_method(self):
        """Test dict-style get method with defaults."""
        element = ImageElement(url="https://example.com/img.png")
        
        assert element.get("type") == "image"
        assert element.get("url") == "https://example.com/img.png"
        assert element.get("alt") is None
        assert element.get("alt", "default") == "default"
        assert element.get("nonexistent", "fallback") == "fallback"

    def test_missing_attribute_access(self):
        """Test that missing attributes raise appropriate errors."""
        element = ImageElement(url="https://example.com/img.png")
        
        # Dict access should raise AttributeError for missing attrs
        with pytest.raises(AttributeError):
            _ = element["nonexistent"]


class TestImageElement:
    """Tests for ImageElement."""

    def test_image_element_creation(self):
        """Test creating a valid image element."""
        element = ImageElement(
            url="https://example.com/image.png",
            alt="Test image",
            width=800,
            height=600,
            name="test.png",
            display="inline"
        )
        
        assert element.type == "image"
        assert element.url == "https://example.com/image.png"
        assert element.alt == "Test image"
        assert element.width == 800
        assert element.height == 600
        assert element.name == "test.png"
        assert element.display == "inline"

    def test_image_element_required_url(self):
        """Test that url is required for image elements."""
        with pytest.raises(ValidationError):
            ImageElement()

    def test_image_element_dict_serialization(self):
        """Test converting image element to dict."""
        element = ImageElement(url="https://example.com/img.png", alt="Test")
        element_dict = element.model_dump()
        
        assert element_dict["type"] == "image"
        assert element_dict["url"] == "https://example.com/img.png"
        assert element_dict["alt"] == "Test"


class TestPdfElement:
    """Tests for PdfElement."""

    def test_pdf_element_creation(self):
        """Test creating a valid PDF element."""
        element = PdfElement(
            url="https://example.com/document.pdf",
            name="report.pdf",
            display="page"
        )
        
        assert element.type == "pdf"
        assert element.url == "https://example.com/document.pdf"
        assert element.name == "report.pdf"
        assert element.display == "page"

    def test_pdf_element_dict_access(self):
        """Test PDF element dict-style access."""
        element = PdfElement(url="https://example.com/doc.pdf")
        
        assert element["type"] == "pdf"
        assert element["url"] == "https://example.com/doc.pdf"


class TestVideoElement:
    """Tests for VideoElement."""

    def test_video_element_creation(self):
        """Test creating a valid video element."""
        element = VideoElement(
            url="https://example.com/video.mp4",
            name="demo.mp4",
            autoplay=True,
            controls=False,
            loop=True
        )
        
        assert element.type == "video"
        assert element.url == "https://example.com/video.mp4"
        assert element.name == "demo.mp4"
        assert element.autoplay is True
        assert element.controls is False
        assert element.loop is True

    def test_video_element_defaults(self):
        """Test video element default values."""
        element = VideoElement(url="https://example.com/video.mp4")
        
        assert element.autoplay is False
        assert element.controls is True
        assert element.loop is False


class TestAudioElement:
    """Tests for AudioElement."""

    def test_audio_element_creation(self):
        """Test creating a valid audio element."""
        element = AudioElement(
            url="https://example.com/audio.mp3",
            name="clip.mp3",
            autoplay=False,
            controls=True,
            loop=False
        )
        
        assert element.type == "audio"
        assert element.url == "https://example.com/audio.mp3"
        assert element.name == "clip.mp3"
        assert element.autoplay is False
        assert element.controls is True
        assert element.loop is False


class TestFileElement:
    """Tests for FileElement."""

    def test_file_element_creation(self):
        """Test creating a valid file element."""
        element = FileElement(
            url="https://example.com/data.csv",
            name="data.csv",
            size=1024,
            mime_type="text/csv"
        )
        
        assert element.type == "file"
        assert element.url == "https://example.com/data.csv"
        assert element.name == "data.csv"
        assert element.size == 1024
        assert element.mime_type == "text/csv"

    def test_file_element_alias_support(self):
        """Test that mimeType alias works."""
        element = FileElement(url="https://example.com/file.txt", mimeType="text/plain")
        assert element.mime_type == "text/plain"


class TestCodeElement:
    """Tests for CodeElement."""

    def test_code_element_creation(self):
        """Test creating a valid code element."""
        element = CodeElement(
            content="print('Hello, world!')",
            language="python",
            name="example.py"
        )
        
        assert element.type == "code"
        assert element.content == "print('Hello, world!')"
        assert element.language == "python"
        assert element.name == "example.py"

    def test_code_element_required_content(self):
        """Test that content is required for code elements."""
        with pytest.raises(ValidationError):
            CodeElement()


class TestMessageIntegration:
    """Tests for Message class integration with elements."""

    def test_message_add_element_backward_compatibility(self):
        """Test that add_element maintains backward compatibility."""
        from praisonaiui.message import Message
        
        msg = Message(content="Here's an image:")
        msg.add_element("image", url="https://example.com/img.png", alt="Example")
        
        # Both dict and attribute access should work
        element = msg.elements[0]
        assert element["type"] == "image"  # Dict-style (backward compatible)
        assert element.type == "image"     # Attribute-style (new)
        assert element["url"] == "https://example.com/img.png"
        assert element.url == "https://example.com/img.png"

    def test_message_add_all_element_types(self):
        """Test adding all supported element types."""
        from praisonaiui.message import Message
        
        msg = Message(content="Multiple elements:")
        msg.add_element("image", url="https://example.com/img.png", alt="Image")
        msg.add_element("pdf", url="https://example.com/doc.pdf", name="doc.pdf")
        msg.add_element("video", url="https://example.com/vid.mp4", name="vid.mp4")
        msg.add_element("audio", url="https://example.com/audio.mp3", name="audio.mp3")
        msg.add_element("file", url="https://example.com/data.csv", name="data.csv")
        msg.add_element("code", content="print('hi')", language="python")
        
        assert len(msg.elements) == 6
        
        # Check each element type
        assert msg.elements[0]["type"] == "image"
        assert msg.elements[1]["type"] == "pdf"
        assert msg.elements[2]["type"] == "video"
        assert msg.elements[3]["type"] == "audio"
        assert msg.elements[4]["type"] == "file"
        assert msg.elements[5]["type"] == "code"

    def test_convenience_methods_backward_compatibility(self):
        """Test convenience methods maintain backward compatibility."""
        from praisonaiui.message import Message
        
        msg = Message()
        msg.add_image("https://example.com/img.png", alt="Image")
        msg.add_pdf("https://example.com/doc.pdf", name="Document")
        msg.add_code("print('hello')", language="python")
        
        assert len(msg.elements) == 3
        assert msg.elements[0]["type"] == "image"
        assert msg.elements[1]["type"] == "pdf"
        assert msg.elements[2]["type"] == "code"

    def test_size_limit_validation(self):
        """Test that size limits are enforced."""
        from praisonaiui.message import Message
        
        msg = Message()
        
        # Test file size limit
        with pytest.raises(ValueError, match="File size .* exceeds maximum"):
            msg.add_element("file", url="https://example.com/huge.zip", size=MAX_FILE_SIZE + 1)
        
        # Test code size limit
        huge_code = "x" * (MAX_CODE_SIZE + 1)
        with pytest.raises(ValueError, match="Code content size exceeds maximum"):
            msg.add_element("code", content=huge_code)

    def test_missing_required_fields(self):
        """Test validation when required fields are missing."""
        from praisonaiui.message import Message
        
        msg = Message()
        
        # Missing URL for image
        with pytest.raises(ValueError, match="url is required for image elements"):
            msg.add_element("image")
        
        # Missing content for code
        with pytest.raises(ValueError, match="content is required for code elements"):
            msg.add_element("code")

    def test_fallback_to_dict_format(self):
        """Test fallback to legacy dict format on validation errors."""
        from praisonaiui.message import Message
        
        msg = Message()
        
        # Should fallback gracefully for unknown element types
        msg.add_element("unknown", custom_field="value")
        
        assert len(msg.elements) == 1
        element = msg.elements[0]
        assert isinstance(element, dict)  # Should be dict, not dataclass
        assert element["type"] == "unknown"
        assert element["custom_field"] == "value"

    def test_legacy_elements_list_compatibility(self):
        """Test that legacy dict elements still work alongside new ones."""
        from praisonaiui.message import Message
        
        msg = Message()
        
        # Mix of new typed elements and legacy dict elements
        msg.add_element("image", url="https://example.com/img.png")  # New typed
        msg.elements.append({"type": "legacy", "custom": "value"})    # Legacy dict
        
        assert len(msg.elements) == 2
        
        # First element should be typed with dict access
        assert msg.elements[0]["type"] == "image"
        assert msg.elements[0].type == "image"  # Also supports attribute access
        
        # Second element should be plain dict
        assert msg.elements[1]["type"] == "legacy"
        assert msg.elements[1]["custom"] == "value"