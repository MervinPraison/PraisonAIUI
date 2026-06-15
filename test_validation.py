#!/usr/bin/env python3
"""Test script to demonstrate the new validation functionality."""

import yaml
from pathlib import Path
from praisonaiui.schema.models import Config
from praisonaiui.schema.validators import validate_config

# Test with the 11-full-featured example
config_path = Path("examples/yaml/11-full-featured/aiui.template.yaml")

if config_path.exists():
    with open(config_path) as f:
        data = yaml.safe_load(f)
    
    cfg = Config.model_validate(data)
    
    # Test regular validation
    result = validate_config(cfg, config_path.parent)
    print(f"Regular validation: {'✓ PASS' if result.valid else '✗ FAIL'}")
    
    # Test strict validation
    result_strict = validate_config(cfg, config_path.parent, strict=True)
    print(f"Strict validation: {'✓ PASS' if result_strict.valid else '✗ FAIL'}")
    
    if not result_strict.valid:
        print("\nStrict validation errors:")
        for error in result_strict.errors:
            print(f"  [{error.category}] {error.message}")
            if error.suggestion:
                print(f"    💡 {error.suggestion}")
else:
    print(f"Config file not found: {config_path}")