import React, { useState } from 'react'

import { Card, CardHeader, CardTitle, CardContent, CardFooter, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import {
    Table,
    TableHeader,
    TableBody,
    TableRow,
    TableHead,
    TableCell,
} from '@/components/ui/table'

export interface ComponentDict {
    type: string
    [key: string]: unknown
}

export interface ComponentRendererProps {
    components: ComponentDict[]
}

function renderComponent(component: ComponentDict, index: number): React.ReactNode {
    const key = (component.key as string) ?? index

    switch (component.type) {
        // ── Existing types ──────────────────────────────────────────

        case 'card': {
            const { title, description, value, footer, children } = component as ComponentDict & {
                title?: string
                description?: string
                value?: string | number
                footer?: string
                children?: ComponentDict[]
            }
            return (
                <Card key={key}>
                    {(title || description) && (
                        <CardHeader>
                            {title && <CardTitle>{title}</CardTitle>}
                            {description && <CardDescription>{description}</CardDescription>}
                        </CardHeader>
                    )}
                    <CardContent>
                        {value !== undefined && <div>{String(value)}</div>}
                        {children && children.map((c, i) => renderComponent(c, i))}
                    </CardContent>
                    {footer && <CardFooter><span className="text-sm text-muted-foreground">{footer}</span></CardFooter>}
                </Card>
            )
        }

        case 'columns': {
            const { children } = component as ComponentDict & { children?: ComponentDict[] }
            const cols = children ?? []
            return (
                <div
                    key={key}
                    className="grid gap-4"
                    style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}
                >
                    {cols.map((c, i) => renderComponent(c, i))}
                </div>
            )
        }

        case 'chart': {
            const { title, data } = component as ComponentDict & { title?: string; data?: unknown[] }
            const count = Array.isArray(data) ? data.length : 0
            return (
                <Card key={key}>
                    <CardHeader>
                        <CardTitle>{title ?? 'Chart'}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">Chart placeholder ({count} data points)</p>
                    </CardContent>
                </Card>
            )
        }

        case 'table': {
            const { headers, rows, title } = component as ComponentDict & {
                headers?: string[]
                rows?: (string | number)[][]
                title?: string
            }
            const headerList = headers ?? []
            const rowList = rows ?? []
            return (
                <div key={key} className="rounded-lg border">
                    {title && <div className="px-4 py-3 border-b font-semibold">{title}</div>}
                    <Table>
                        <TableHeader>
                            <TableRow>
                                {headerList.map((h, i) => (
                                    <TableHead key={i}>{h}</TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rowList.map((row, ri) => (
                                <TableRow key={ri}>
                                    {(Array.isArray(row) ? row : []).map((cell, ci) => (
                                        <TableCell key={ci}>
                                            {typeof cell === 'object' ? JSON.stringify(cell) : String(cell ?? '')}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )
        }

        case 'text': {
            const { content, className } = component as ComponentDict & { content?: string; className?: string }
            return <p key={key} className={className}>{content ?? ''}</p>
        }

        // ── Tier 1 ──────────────────────────────────────────────────

        case 'metric': {
            const { label, value, delta, delta_color } = component as ComponentDict & {
                label?: string
                value?: string | number
                delta?: string | number
                delta_color?: 'green' | 'red' | 'off' | string
            }
            const colorMap: Record<string, string> = {
                green: 'text-green-500',
                red: 'text-red-500',
                off: 'text-gray-400',
            }
            const deltaClass = colorMap[delta_color ?? ''] ?? 'text-gray-400'
            return (
                <Card key={key}>
                    <CardHeader>
                        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{String(value ?? '')}</div>
                        {delta !== undefined && (
                            <span className={`text-sm ${deltaClass}`}>{String(delta)}</span>
                        )}
                    </CardContent>
                </Card>
            )
        }

        case 'progress_bar': {
            const { label, value, max_value } = component as ComponentDict & {
                label?: string
                value?: number
                max_value?: number
            }
            const max = max_value ?? 100
            const pct = max > 0 ? ((value ?? 0) / max) * 100 : 0
            return (
                <div key={key} className="space-y-2">
                    {label && <Label>{label}</Label>}
                    <Progress value={pct} />
                </div>
            )
        }

        case 'alert': {
            const { variant, title, content } = component as ComponentDict & {
                variant?: 'info' | 'success' | 'warning' | 'error'
                title?: string
                content?: string
            }
            const bgMap: Record<string, string> = {
                info: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
                success: 'bg-green-500/10 border-green-500/30 text-green-400',
                warning: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
                error: 'bg-red-500/10 border-red-500/30 text-red-400',
            }
            const classes = bgMap[variant ?? 'info'] ?? bgMap.info
            return (
                <div key={key} className={`rounded-lg border p-4 ${classes}`}>
                    {title && <div className="font-bold mb-1">{title}</div>}
                    {content && <div>{content}</div>}
                </div>
            )
        }

        case 'badge': {
            const { label, variant } = component as ComponentDict & {
                label?: string
                variant?: 'default' | 'secondary' | 'destructive' | 'outline'
            }
            return <Badge key={key} variant={variant}>{label ?? ''}</Badge>
        }

        case 'separator': {
            return <Separator key={key} />
        }

        case 'tabs': {
            const { items } = component as ComponentDict & {
                items?: { label: string; children?: ComponentDict[] }[]
            }
            const tabItems = items ?? []
            const defaultVal = tabItems.length > 0 ? tabItems[0].label : undefined
            return (
                <Tabs key={key} defaultValue={defaultVal}>
                    <TabsList>
                        {tabItems.map((item) => (
                            <TabsTrigger key={item.label} value={item.label}>{item.label}</TabsTrigger>
                        ))}
                    </TabsList>
                    {tabItems.map((item) => (
                        <TabsContent key={item.label} value={item.label}>
                            {item.children && item.children.map((c, i) => renderComponent(c, i))}
                        </TabsContent>
                    ))}
                </Tabs>
            )
        }

        case 'accordion': {
            const { items } = component as ComponentDict & {
                items?: { label: string; content?: string; children?: ComponentDict[] }[]
            }
            const accItems = items ?? []
            return (
                <Accordion key={key} type="multiple">
                    {accItems.map((item, i) => (
                        <AccordionItem key={i} value={`item-${i}`}>
                            <AccordionTrigger>{item.label}</AccordionTrigger>
                            <AccordionContent>
                                {item.content && <p>{item.content}</p>}
                                {item.children && item.children.map((c, ci) => renderComponent(c, ci))}
                            </AccordionContent>
                        </AccordionItem>
                    ))}
                </Accordion>
            )
        }

        case 'image_display': {
            const { src, alt, caption, className } = component as ComponentDict & {
                src?: string
                alt?: string
                caption?: string
                className?: string
            }
            return (
                <figure key={key} className={className}>
                    <img src={src} alt={alt ?? ''} className="rounded-lg max-w-full" />
                    {caption && <figcaption className="text-sm text-muted-foreground mt-2">{caption}</figcaption>}
                </figure>
            )
        }

        case 'code_block': {
            const { code, language } = component as ComponentDict & {
                code?: string
                language?: string
            }
            return (
                <pre key={key} className="rounded-lg bg-muted p-4 overflow-auto">
                    <code className={language ? `language-${language}` : undefined}>
                        {code ?? ''}
                    </code>
                </pre>
            )
        }

        case 'json_view': {
            const { data } = component as ComponentDict & { data?: unknown }
            return (
                <pre key={key} className="rounded-lg bg-muted p-4 overflow-auto text-sm">
                    {JSON.stringify(data, null, 2)}
                </pre>
            )
        }

        // ── Tier 2: Form Inputs (display-only) ─────────────────────

        case 'text_input': {
            const { label, placeholder, value, disabled } = component as ComponentDict & {
                label?: string
                placeholder?: string
                value?: string
                disabled?: boolean
            }
            return (
                <div key={key} className="space-y-2">
                    {label && <Label>{label}</Label>}
                    <Input placeholder={placeholder} defaultValue={value} disabled={disabled} />
                </div>
            )
        }

        case 'number_input': {
            const { label, value, min, max, step, disabled } = component as ComponentDict & {
                label?: string
                value?: number
                min?: number
                max?: number
                step?: number
                disabled?: boolean
            }
            return (
                <div key={key} className="space-y-2">
                    {label && <Label>{label}</Label>}
                    <Input
                        type="number"
                        defaultValue={value}
                        min={min}
                        max={max}
                        step={step}
                        disabled={disabled}
                    />
                </div>
            )
        }

        case 'select_input': {
            const { label, options, value, placeholder, disabled } = component as ComponentDict & {
                label?: string
                options?: { label: string; value: string }[]
                value?: string
                placeholder?: string
                disabled?: boolean
            }
            const opts = options ?? []
            return (
                <div key={key} className="space-y-2">
                    {label && <Label>{label}</Label>}
                    <Select defaultValue={value} disabled={disabled}>
                        <SelectTrigger>
                            <SelectValue placeholder={placeholder ?? 'Select...'} />
                        </SelectTrigger>
                        <SelectContent>
                            {opts.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )
        }

        case 'slider_input': {
            const { label, value, min, max, step, disabled } = component as ComponentDict & {
                label?: string
                value?: number
                min?: number
                max?: number
                step?: number
                disabled?: boolean
            }
            const [sliderVal, setSliderVal] = useState(value ?? 0)
            return (
                <div key={key} className="space-y-2">
                    {label && <Label>{label} <span className="text-muted-foreground">({sliderVal})</span></Label>}
                    <Slider
                        defaultValue={[value ?? 0]}
                        min={min}
                        max={max}
                        step={step}
                        disabled={disabled}
                        onValueChange={(v) => setSliderVal(v[0])}
                    />
                </div>
            )
        }

        case 'checkbox_input': {
            const { label, checked, disabled } = component as ComponentDict & {
                label?: string
                checked?: boolean
                disabled?: boolean
            }
            return (
                <div key={key} className="flex items-center space-x-2">
                    <Checkbox defaultChecked={checked} disabled={disabled} />
                    {label && <Label>{label}</Label>}
                </div>
            )
        }

        case 'switch_input': {
            const { label, checked, disabled } = component as ComponentDict & {
                label?: string
                checked?: boolean
                disabled?: boolean
            }
            return (
                <div key={key} className="flex items-center space-x-2">
                    <Switch defaultChecked={checked} disabled={disabled} />
                    {label && <Label>{label}</Label>}
                </div>
            )
        }

        case 'radio_input': {
            const { label, options, value, disabled } = component as ComponentDict & {
                label?: string
                options?: { label: string; value: string }[]
                value?: string
                disabled?: boolean
            }
            const opts = options ?? []
            return (
                <div key={key} className="space-y-2">
                    {label && <Label>{label}</Label>}
                    <RadioGroup defaultValue={value} disabled={disabled}>
                        {opts.map((opt) => (
                            <div key={opt.value} className="flex items-center space-x-2">
                                <RadioGroupItem value={opt.value} />
                                <Label>{opt.label}</Label>
                            </div>
                        ))}
                    </RadioGroup>
                </div>
            )
        }

        case 'textarea_input': {
            const { label, value, placeholder, rows, disabled } = component as ComponentDict & {
                label?: string
                value?: string
                placeholder?: string
                rows?: number
                disabled?: boolean
            }
            return (
                <div key={key} className="space-y-2">
                    {label && <Label>{label}</Label>}
                    <textarea
                        className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        defaultValue={value}
                        placeholder={placeholder}
                        rows={rows ?? 3}
                        disabled={disabled}
                    />
                </div>
            )
        }

        // ── Tier 3 ──────────────────────────────────────────────────

        case 'container': {
            const { title, children } = component as ComponentDict & {
                title?: string
                children?: ComponentDict[]
            }
            return (
                <div key={key} className="space-y-4">
                    {title && <h3 className="text-lg font-semibold">{title}</h3>}
                    {children && children.map((c, i) => renderComponent(c, i))}
                </div>
            )
        }

        case 'expander': {
            const { title, expanded, children } = component as ComponentDict & {
                title?: string
                expanded?: boolean
                children?: ComponentDict[]
            }
            return (
                <Accordion key={key} type="single" collapsible defaultValue={expanded ? 'expander' : undefined}>
                    <AccordionItem value="expander">
                        <AccordionTrigger>{title ?? 'Details'}</AccordionTrigger>
                        <AccordionContent>
                            {children && children.map((c, i) => renderComponent(c, i))}
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            )
        }

        case 'divider': {
            const { text } = component as ComponentDict & { text?: string }
            if (text) {
                return (
                    <div key={key} className="flex items-center gap-3">
                        <Separator className="flex-1" />
                        <span className="text-sm text-muted-foreground">{text}</span>
                        <Separator className="flex-1" />
                    </div>
                )
            }
            return <Separator key={key} />
        }

        case 'link': {
            const { href, label, external } = component as ComponentDict & {
                href?: string
                label?: string
                external?: boolean
            }
            return (
                <a
                    key={key}
                    href={href}
                    target={external ? '_blank' : undefined}
                    rel={external ? 'noopener noreferrer' : undefined}
                    className="text-primary underline underline-offset-4 hover:text-primary/80"
                >
                    {label ?? href}
                </a>
            )
        }

        case 'button_group': {
            const { buttons } = component as ComponentDict & {
                buttons?: { label: string; variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' }[]
            }
            const btns = buttons ?? []
            return (
                <div key={key} className="flex gap-2">
                    {btns.map((btn, i) => (
                        <Button key={i} variant={btn.variant}>{btn.label}</Button>
                    ))}
                </div>
            )
        }

        case 'stat_group': {
            const { items } = component as ComponentDict & {
                items?: { label?: string; value?: string | number; delta?: string | number; delta_color?: string }[]
            }
            const stats = items ?? []
            return (
                <div key={key} className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, 1fr)` }}>
                    {stats.map((stat, i) => {
                        const colorMap: Record<string, string> = {
                            green: 'text-green-500',
                            red: 'text-red-500',
                            off: 'text-gray-400',
                        }
                        const deltaClass = colorMap[stat.delta_color ?? ''] ?? 'text-gray-400'
                        return (
                            <Card key={i}>
                                <CardHeader>
                                    <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold">{String(stat.value ?? '')}</div>
                                    {stat.delta !== undefined && (
                                        <span className={`text-sm ${deltaClass}`}>{String(stat.delta)}</span>
                                    )}
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            )
        }

        case 'header': {
            const { content, level } = component as ComponentDict & {
                content?: string
                level?: 1 | 2 | 3 | 4 | 5 | 6
            }
            const Tag = (`h${level ?? 2}`) as keyof React.JSX.IntrinsicElements
            const sizeMap: Record<number, string> = {
                1: 'text-3xl font-bold',
                2: 'text-2xl font-bold',
                3: 'text-xl font-semibold',
                4: 'text-lg font-semibold',
                5: 'text-base font-medium',
                6: 'text-sm font-medium',
            }
            return <Tag key={key} className={sizeMap[level ?? 2]}>{content ?? ''}</Tag>
        }

        case 'markdown_text': {
            const { content } = component as ComponentDict & { content?: string }
            return (
                <div
                    key={key}
                    dangerouslySetInnerHTML={{ __html: content ?? '' }}
                    className="prose dark:prose-invert"
                />
            )
        }

        case 'empty': {
            const { content } = component as ComponentDict & { content?: string }
            return (
                <div key={key} className="flex items-center justify-center py-8 text-muted-foreground">
                    {content ?? 'No data'}
                </div>
            )
        }

        case 'spinner': {
            const { text } = component as ComponentDict & { text?: string }
            return (
                <div key={key} className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    {text && <span className="text-sm text-muted-foreground">{text}</span>}
                </div>
            )
        }

        case 'avatar': {
            const { src, alt, fallback } = component as ComponentDict & {
                src?: string
                alt?: string
                fallback?: string
            }
            return (
                <Avatar key={key}>
                    {src && <AvatarImage src={src} alt={alt} />}
                    <AvatarFallback>{fallback ?? (alt ? alt.charAt(0).toUpperCase() : '?')}</AvatarFallback>
                </Avatar>
            )
        }

        case 'callout': {
            const { variant, title, content } = component as ComponentDict & {
                variant?: 'info' | 'success' | 'warning' | 'error'
                title?: string
                content?: string
            }
            const borderMap: Record<string, string> = {
                info: 'border-blue-500/50 bg-blue-500/5',
                success: 'border-green-500/50 bg-green-500/5',
                warning: 'border-amber-500/50 bg-amber-500/5',
                error: 'border-red-500/50 bg-red-500/5',
            }
            const classes = borderMap[variant ?? 'info'] ?? borderMap.info
            return (
                <div key={key} className={`rounded-lg border-l-4 p-4 ${classes}`}>
                    {title && <div className="font-semibold mb-1">{title}</div>}
                    {content && <div className="text-sm">{content}</div>}
                </div>
            )
        }

        // ── Default fallback ────────────────────────────────────────

        default: {
            return (
                <pre key={key} className="rounded-lg bg-muted p-4 overflow-auto text-sm">
                    {JSON.stringify(component, null, 2)}
                </pre>
            )
        }
    }
}

export function ComponentRenderer({ components }: ComponentRendererProps) {
    return (
        <div className="space-y-4">
            {components.map((component, index) => renderComponent(component, index))}
        </div>
    )
}
