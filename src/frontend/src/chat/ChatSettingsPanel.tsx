/**
 * ChatSettingsPanel component for runtime configuration editing.
 * 
 * This component renders a side form with various input widgets that allows
 * users to edit model/temperature/system prompt and other settings at runtime.
 * Changes fire onSettingsUpdate callbacks.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Settings, Save, RotateCcw, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Slider } from '../components/ui/slider';
import { Switch } from '../components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../components/ui/sheet';

interface SettingsWidget {
  type: 'text' | 'number' | 'select' | 'slider' | 'switch' | 'color';
  name: string;
  label: string;
  default?: any;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<string | { value: string; label: string }>;
  multiple?: boolean;
}

interface ChatSettingsData {
  type: 'chat_settings';
  id: string;
  title: string;
  description?: string;
  widgets: SettingsWidget[];
}

interface ChatSettingsPanelProps {
  /** Settings configuration */
  settings: ChatSettingsData;
  /** Whether the panel is open */
  isOpen: boolean;
  /** Callback when panel is closed */
  onClose: () => void;
  /** Callback when settings are updated */
  onSettingsUpdate: (settings: Record<string, any>) => void;
  /** Initial values */
  initialValues?: Record<string, any>;
}

/**
 * Individual widget renderer
 */
const WidgetRenderer: React.FC<{
  widget: SettingsWidget;
  value: any;
  onChange: (value: any) => void;
}> = ({ widget, value, onChange }) => {
  const { type, name, label, placeholder, options } = widget;

  switch (type) {
    case 'text':
      if (widget.multiline) {
        return (
          <div className="space-y-2">
            <Label htmlFor={name}>{label}</Label>
            <Textarea
              id={name}
              placeholder={placeholder}
              value={value || ''}
              onChange={(e) => onChange(e.target.value)}
              maxLength={widget.maxLength}
              rows={4}
            />
          </div>
        );
      }
      return (
        <div className="space-y-2">
          <Label htmlFor={name}>{label}</Label>
          <Input
            id={name}
            type="text"
            placeholder={placeholder}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            maxLength={widget.maxLength}
          />
        </div>
      );

    case 'number':
      return (
        <div className="space-y-2">
          <Label htmlFor={name}>{label}</Label>
          <Input
            id={name}
            type="number"
            placeholder={placeholder}
            value={value || ''}
            onChange={(e) => onChange(Number(e.target.value))}
            min={widget.min}
            max={widget.max}
            step={widget.step}
          />
        </div>
      );

    case 'select':
      return (
        <div className="space-y-2">
          <Label>{label}</Label>
          <Select value={value || ''} onValueChange={onChange}>
            <SelectTrigger>
              <SelectValue placeholder={`Select ${label.toLowerCase()}...`} />
            </SelectTrigger>
            <SelectContent>
              {options?.map((option, index) => {
                const optionValue = typeof option === 'string' ? option : option.value;
                const optionLabel = typeof option === 'string' ? option : option.label;
                return (
                  <SelectItem key={index} value={optionValue}>
                    {optionLabel}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      );

    case 'slider':
      const sliderValue = value !== undefined ? [value] : [widget.default || 0];
      return (
        <div className="space-y-2">
          <div className="flex justify-between">
            <Label>{label}</Label>
            <span className="text-sm text-muted-foreground">{sliderValue[0]}</span>
          </div>
          <Slider
            value={sliderValue}
            onValueChange={(values) => onChange(values[0])}
            min={widget.min || 0}
            max={widget.max || 1}
            step={widget.step || 0.1}
            className="w-full"
          />
        </div>
      );

    case 'switch':
      return (
        <div className="flex items-center space-x-2">
          <Switch
            id={name}
            checked={value || false}
            onCheckedChange={onChange}
          />
          <Label htmlFor={name}>{label}</Label>
        </div>
      );

    case 'color':
      return (
        <div className="space-y-2">
          <Label htmlFor={name}>{label}</Label>
          <Input
            id={name}
            type="color"
            value={value || '#000000'}
            onChange={(e) => onChange(e.target.value)}
            className="w-full h-10"
          />
        </div>
      );

    default:
      return (
        <div className="text-sm text-muted-foreground">
          Unsupported widget type: {type}
        </div>
      );
  }
};

/**
 * Main ChatSettingsPanel component
 */
export const ChatSettingsPanel: React.FC<ChatSettingsPanelProps> = ({
  settings,
  isOpen,
  onClose,
  onSettingsUpdate,
  initialValues = {}
}) => {
  const [values, setValues] = useState<Record<string, any>>({});
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize values from widgets' defaults and initial values
  useEffect(() => {
    const defaultValues: Record<string, any> = {};
    
    settings.widgets.forEach(widget => {
      const key = widget.name;
      defaultValues[key] = initialValues[key] ?? widget.default;
    });
    
    setValues(defaultValues);
  }, [settings.widgets, initialValues]);

  // Track changes
  useEffect(() => {
    const hasAnyChanges = Object.keys(values).some(key => {
      return values[key] !== (initialValues[key] ?? settings.widgets.find(w => w.name === key)?.default);
    });
    setHasChanges(hasAnyChanges);
  }, [values, initialValues, settings.widgets]);

  const handleValueChange = useCallback((name: string, value: any) => {
    setValues(prev => ({
      ...prev,
      [name]: value
    }));
  }, []);

  const handleSave = useCallback(() => {
    // Only send changed values
    const changedValues: Record<string, any> = {};
    Object.keys(values).forEach(key => {
      const defaultValue = initialValues[key] ?? settings.widgets.find(w => w.name === key)?.default;
      if (values[key] !== defaultValue) {
        changedValues[key] = values[key];
      }
    });

    onSettingsUpdate(changedValues);
    setHasChanges(false);
  }, [values, initialValues, settings.widgets, onSettingsUpdate]);

  const handleReset = useCallback(() => {
    const defaultValues: Record<string, any> = {};
    settings.widgets.forEach(widget => {
      defaultValues[widget.name] = initialValues[widget.name] ?? widget.default;
    });
    setValues(defaultValues);
  }, [settings.widgets, initialValues]);

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="right" className="w-[400px] sm:w-[540px]">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            <SheetTitle>{settings.title}</SheetTitle>
          </div>
          {settings.description && (
            <SheetDescription>{settings.description}</SheetDescription>
          )}
        </SheetHeader>

        <div className="flex flex-col h-full">
          <div className="flex-1 overflow-auto pr-2">
            <div className="space-y-6">
              {settings.widgets.map((widget, index) => (
                <Card key={`${widget.name}-${index}`}>
                  <CardContent className="pt-4">
                    <WidgetRenderer
                      widget={widget}
                      value={values[widget.name]}
                      onChange={(value) => handleValueChange(widget.name, value)}
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="border-t pt-4 mt-4">
            <div className="flex justify-between gap-2">
              <Button
                variant="outline"
                onClick={handleReset}
                disabled={!hasChanges}
                className="flex items-center gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </Button>
              
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={onClose}
                  className="flex items-center gap-2"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
                
                <Button
                  onClick={handleSave}
                  disabled={!hasChanges}
                  className="flex items-center gap-2"
                >
                  <Save className="h-4 w-4" />
                  Save Changes
                </Button>
              </div>
            </div>
            
            {hasChanges && (
              <p className="text-sm text-muted-foreground mt-2">
                You have unsaved changes
              </p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

/**
 * Hook for managing settings panel state
 */
export const useSettingsPanel = (
  onSettingsUpdate: (settings: Record<string, any>) => void
) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentSettings, setCurrentSettings] = useState<ChatSettingsData | null>(null);
  const [settingsValues, setSettingsValues] = useState<Record<string, any>>({});

  const openSettings = useCallback((settings: ChatSettingsData, initialValues?: Record<string, any>) => {
    setCurrentSettings(settings);
    setSettingsValues(initialValues || {});
    setIsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setIsOpen(false);
    setCurrentSettings(null);
    setSettingsValues({});
  }, []);

  const handleSettingsUpdate = useCallback((newSettings: Record<string, any>) => {
    setSettingsValues(prev => ({ ...prev, ...newSettings }));
    onSettingsUpdate(newSettings);
    // Don't auto-close, let user decide
  }, [onSettingsUpdate]);

  return {
    isOpen,
    currentSettings,
    settingsValues,
    openSettings,
    closeSettings,
    handleSettingsUpdate
  };
};

export default ChatSettingsPanel;