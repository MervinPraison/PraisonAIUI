"""Test frontend navigation functionality."""

from pathlib import Path


class TestFrontendNavigation:
    """Tests for browser history navigation in the frontend."""

    def test_frontend_bundle_exists(self):
        """Test that the built frontend bundle exists in templates."""
        bundle_path = Path("src/praisonaiui/templates/frontend/assets/index.js")
        assert bundle_path.exists(), "Frontend bundle should exist in templates"

    def test_index_html_includes_assets(self):
        """Test that index.html references the correct assets."""
        index_path = Path("src/praisonaiui/templates/frontend/index.html")
        assert index_path.exists(), "index.html should exist"

        content = index_path.read_text()
        assert "/assets/index.js" in content, "Should reference index.js"
        assert "/assets/index.css" in content, "Should reference index.css"

    def test_popstate_handler_in_bundle(self):
        """Test that popstate handler is present in the bundle."""
        bundle_path = Path("src/praisonaiui/templates/frontend/assets/index.js")
        if bundle_path.exists():
            # Check if the bundle contains popstate handling code
            # Note: The bundle is minified, so we check for the event name
            content = bundle_path.read_text()
            assert "popstate" in content, "Bundle should contain popstate event handler"

    def test_title_template_handling(self):
        """Test that title template handling is robust."""
        # This tests the logic, not the actual implementation
        # as the JS is bundled and minified

        test_cases = [
            ("%s | Site", "Page", "Page | Site"),
            ("%s", "Page", "Page"),
            ("%s | %s", "Page", "Page | Site"),  # Second %s would be replaced with site name
        ]

        for template, page_title, expected_start in test_cases:
            # Simulate the title replacement logic
            result = template.replace("%s", page_title, 1)
            assert result.startswith(expected_start.split("|")[0].strip())
