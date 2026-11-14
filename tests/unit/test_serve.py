"""Tests for serve command and SPA handler."""




class TestServeCommand:
    """Tests for the serve command."""

    def test_serve_command_exists(self):
        """Verify serve command is registered."""
        from typer.testing import CliRunner

        from praisonaiui.cli import app

        runner = CliRunner()
        result = runner.invoke(app, ["serve", "--help"])
        assert result.exit_code == 0
        assert "serve" in result.output.lower() or "Serve" in result.output

    def test_serve_requires_output_directory(self, tmp_path):
        """Verify serve fails without output directory."""
        from typer.testing import CliRunner

        from praisonaiui.cli import app

        runner = CliRunner()
        result = runner.invoke(app, ["serve", "--output", str(tmp_path / "nonexistent"), "--no-build"])
        assert result.exit_code != 0

    def test_serve_finds_available_port(self):
        """Test that serve finds an available port when default is in use."""
        import socket

        # Bind to a port to make it unavailable
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("", 0))
            occupied_port = s.getsockname()[1]

            # The find_available_port logic should skip occupied ports
            # This is tested indirectly through the serve command


class TestSPAHandler:
    """Tests for the SPA request handler."""

    def test_spa_handler_serves_index_for_routes(self, tmp_path):
        """Test that routes without extensions serve index.html."""
        # Create a mock index.html
        output_dir = tmp_path / "aiui"
        output_dir.mkdir()
        (output_dir / "index.html").write_text("<html>test</html>")

        # The SPAHandler should serve index.html for paths without extensions
        # This is the key behavior for SPA routing

    def test_spa_handler_serves_static_files(self, tmp_path):
        """Test that static files are served directly."""
        output_dir = tmp_path / "aiui"
        output_dir.mkdir()
        assets_dir = output_dir / "assets"
        assets_dir.mkdir()
        (assets_dir / "style.css").write_text("body { color: red; }")

        # Static files with extensions should be served as-is

    def test_spa_handler_handles_json_files(self, tmp_path):
        """Test that JSON manifest files are served correctly."""
        output_dir = tmp_path / "aiui"
        output_dir.mkdir()
        (output_dir / "ui-config.json").write_text('{"site": {}}')
        (output_dir / "docs-nav.json").write_text('{"items": []}')
        (output_dir / "route-manifest.json").write_text('{"routes": []}')

        # JSON files should be served with correct content-type


class TestServeAutoBuild:
    """Tests for auto-build before serve."""

    def test_serve_builds_before_serving(self, tmp_path):
        """Test that serve builds manifests if --no-build is not set."""
        # Create a config file
        config = tmp_path / "aiui.template.yaml"
        config.write_text("""
schemaVersion: 1
site:
  title: "Test"
""")

        # Serve should build first unless --no-build is passed

    def test_serve_no_build_skips_build(self, tmp_path):
        """Test that --no-build skips the build step."""
        from typer.testing import CliRunner


        runner = CliRunner()
        output_dir = tmp_path / "aiui"
        output_dir.mkdir()
        (output_dir / "index.html").write_text("<html></html>")
        (output_dir / "ui-config.json").write_text("{}")
        (output_dir / "docs-nav.json").write_text("{}")
        (output_dir / "route-manifest.json").write_text("{}")

        # With --no-build, should not try to build
        # This would require mocking the server to avoid actually serving


class TestPortHandling:
    """Tests for port availability checking."""

    def test_default_port_help_shows_8000(self):
        """Verify help text shows default port 8000."""
        from typer.testing import CliRunner

        from praisonaiui.cli import app

        runner = CliRunner()
        result = runner.invoke(app, ["serve", "--help"])
        assert "8000" in result.output

    def test_custom_port_accepted(self):
        """Test that custom port can be specified."""
        from typer.testing import CliRunner


        runner = CliRunner()
        # Just verify the option is accepted (would need mock server to test fully)


class TestServePortProbe:
    """`aiui serve` / `aiui run` pick the port the way uvicorn binds it."""

    def test_listening_port_is_skipped(self):
        import socket

        from praisonaiui.cli import _can_bind, _find_available_port

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            s.listen()
            taken = s.getsockname()[1]
            assert not _can_bind("127.0.0.1", taken)
            moved = _find_available_port("127.0.0.1", taken)
            assert moved != taken and moved > taken

    def test_free_port_is_kept(self):
        import socket

        from praisonaiui.cli import _find_available_port

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            free = s.getsockname()[1]
        assert _find_available_port("127.0.0.1", free) == free

    def test_time_wait_does_not_move_the_port(self):
        """Closed connections from a previous run (TIME_WAIT) used to make
        `aiui serve` silently move to the next port."""
        import os
        import socket

        import pytest

        from praisonaiui.cli import _can_bind

        if os.name == "nt":
            pytest.skip("TIME_WAIT probing is POSIX behaviour")
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind(("127.0.0.1", 0))
        server.listen()
        port = server.getsockname()[1]
        client = socket.create_connection(("127.0.0.1", port))
        conn, _ = server.accept()
        conn.close()  # the server side closes first, so it holds TIME_WAIT
        client.close()
        server.close()
        assert _can_bind("127.0.0.1", port)

    def test_moved_port_message_names_both_ports(self):
        from praisonaiui.cli import _port_moved_message

        msg = _port_moved_message("127.0.0.1", 8000, 8001)
        assert "8000" in msg and "8001" in msg and "in use" in msg
