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
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Skeleton as ShadcnSkeleton } from '@/components/ui/skeleton'
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator, BreadcrumbPage } from '@/components/ui/breadcrumb'
import { Pagination as ShadcnPagination, PaginationContent, PaginationItem, PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis } from '@/components/ui/pagination'
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

/** Helper: normalize option that may be a plain string or {label, value} object */
function normalizeOption(opt: unknown): { label: string; value: string } {
    if (typeof opt === 'string') return { label: opt, value: opt }
    if (typeof opt === 'object' && opt !== null) {
        const o = opt as Record<string, unknown>
        return { label: String(o.label ?? o.value ?? ''), value: String(o.value ?? o.label ?? '') }
    }
    return { label: String(opt), value: String(opt) }
}

/** Slider extracted as a proper React component to avoid hooks-in-switch violation */
function SliderInputComponent({ component, keyProp }: { component: ComponentDict; keyProp: string | number }) {
    const label = component.label as string | undefined
    const value = (component.value as number) ?? 0
    const min = (component.min_val as number) ?? 0
    const max = (component.max_val as number) ?? 100
    const step = (component.step as number) ?? 1
    const [sliderVal, setSliderVal] = useState(value)
    return (
        <div key={keyProp} className="space-y-2">
            {label && <Label>{label} <span className="text-muted-foreground">({sliderVal})</span></Label>}
            <Slider
                defaultValue={[value]}
                min={min}
                max={max}
                step={step}
                onValueChange={(v) => setSliderVal(v[0])}
            />
        </div>
    )
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
            const label = component.label as string | undefined
            const value = component.value
            const delta = component.delta as string | number | undefined
            const deltaColor = component.delta_color as string | undefined
            // Auto-detect delta direction from value
            let deltaClass = 'text-muted-foreground'
            if (deltaColor === 'inverse') {
                // inverse: positive = red, negative = green
                const str = String(delta ?? '')
                if (str.startsWith('+') || str.startsWith('↑')) deltaClass = 'text-red-500'
                else if (str.startsWith('-') || str.startsWith('↓')) deltaClass = 'text-green-500'
            } else if (deltaColor === 'off') {
                deltaClass = 'text-muted-foreground'
            } else {
                // "normal" (default): auto-detect from delta string
                const str = String(delta ?? '')
                if (str.startsWith('+') || str.startsWith('↑')) deltaClass = 'text-green-500'
                else if (str.startsWith('-') || str.startsWith('↓')) deltaClass = 'text-red-500'
            }
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
            const variant = component.variant as string | undefined
            const title = component.title as string | undefined
            const message = (component.message ?? component.content) as string | undefined
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
                    {message && <div>{message}</div>}
                </div>
            )
        }

        case 'badge': {
            const badgeText = (component.text ?? component.label) as string | undefined
            const variant = component.variant as 'default' | 'secondary' | 'destructive' | 'outline' | undefined
            return <Badge key={key} variant={variant}>{badgeText ?? ''}</Badge>
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
                items?: { title?: string; label?: string; content?: string; children?: ComponentDict[] }[]
            }
            const accItems = items ?? []
            return (
                <Accordion key={key} type="multiple">
                    {accItems.map((item, i) => (
                        <AccordionItem key={i} value={`item-${i}`}>
                            <AccordionTrigger>{item.title ?? item.label ?? ''}</AccordionTrigger>
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
            const src = component.src as string | undefined
            const alt = component.alt as string | undefined
            const caption = component.caption as string | undefined
            const width = component.width as string | undefined
            return (
                <figure key={key}>
                    <img
                        src={src}
                        alt={alt ?? ''}
                        className="rounded-lg max-w-full"
                        style={width ? { width } : undefined}
                    />
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
            const { label, placeholder, value } = component as ComponentDict & {
                label?: string
                placeholder?: string
                value?: string
            }
            return (
                <div key={key} className="space-y-2">
                    {label && <Label>{label}</Label>}
                    <Input placeholder={placeholder} defaultValue={value} />
                </div>
            )
        }

        case 'number_input': {
            const label = component.label as string | undefined
            const value = component.value as number | undefined
            const min = (component.min_val ?? component.min) as number | undefined
            const max = (component.max_val ?? component.max) as number | undefined
            const step = component.step as number | undefined
            return (
                <div key={key} className="space-y-2">
                    {label && <Label>{label}</Label>}
                    <Input
                        type="number"
                        defaultValue={value}
                        min={min}
                        max={max}
                        step={step}
                    />
                </div>
            )
        }

        case 'select_input': {
            const label = component.label as string | undefined
            const rawOptions = (component.options ?? []) as unknown[]
            const value = component.value as string | undefined
            const opts = rawOptions.map(normalizeOption)
            return (
                <div key={key} className="space-y-2">
                    {label && <Label>{label}</Label>}
                    <Select defaultValue={value || undefined}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select..." />
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
            return <SliderInputComponent key={key} component={component} keyProp={key} />
        }

        case 'checkbox_input': {
            const { label, checked } = component as ComponentDict & {
                label?: string
                checked?: boolean
            }
            return (
                <div key={key} className="flex items-center space-x-2">
                    <Checkbox defaultChecked={checked} />
                    {label && <Label>{label}</Label>}
                </div>
            )
        }

        case 'switch_input': {
            const { label, checked } = component as ComponentDict & {
                label?: string
                checked?: boolean
            }
            return (
                <div key={key} className="flex items-center space-x-2">
                    <Switch defaultChecked={checked} />
                    {label && <Label>{label}</Label>}
                </div>
            )
        }

        case 'radio_input': {
            const label = component.label as string | undefined
            const rawOptions = (component.options ?? []) as unknown[]
            const value = component.value as string | undefined
            const opts = rawOptions.map(normalizeOption)
            return (
                <div key={key} className="space-y-2">
                    {label && <Label>{label}</Label>}
                    <RadioGroup defaultValue={value || undefined}>
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
            const { label, value, placeholder, rows } = component as ComponentDict & {
                label?: string
                value?: string
                placeholder?: string
                rows?: number
            }
            return (
                <div key={key} className="space-y-2">
                    {label && <Label>{label}</Label>}
                    <textarea
                        className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        defaultValue={value}
                        placeholder={placeholder}
                        rows={rows ?? 4}
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
            const href = component.href as string | undefined
            const linkText = (component.text ?? component.label) as string | undefined
            const external = component.external as boolean | undefined
            return (
                <a
                    key={key}
                    href={href}
                    target={external ? '_blank' : undefined}
                    rel={external ? 'noopener noreferrer' : undefined}
                    className="text-primary underline underline-offset-4 hover:text-primary/80"
                >
                    {linkText ?? href}
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
            const rawStats = (component.stats ?? component.items) as
                { label?: string; value?: string | number; delta?: string | number; delta_color?: string }[] | undefined
            const stats = rawStats ?? []
            return (
                <div key={key} className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, 1fr)` }}>
                    {stats.map((stat, i) => {
                        const str = String(stat.delta ?? '')
                        let deltaClass = 'text-muted-foreground'
                        if (str.startsWith('+') || str.startsWith('↑')) deltaClass = 'text-green-500'
                        else if (str.startsWith('-') || str.startsWith('↓')) deltaClass = 'text-red-500'
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
            const headerText = (component.text ?? component.content) as string | undefined
            const level = (component.level as number) ?? 1
            const Tag = (`h${Math.min(6, Math.max(1, level))}`) as keyof React.JSX.IntrinsicElements
            const sizeMap: Record<number, string> = {
                1: 'text-3xl font-bold',
                2: 'text-2xl font-bold',
                3: 'text-xl font-semibold',
                4: 'text-lg font-semibold',
                5: 'text-base font-medium',
                6: 'text-sm font-medium',
            }
            return <Tag key={key} className={sizeMap[level] ?? sizeMap[2]}>{headerText ?? ''}</Tag>
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
            const emptyText = (component.text ?? component.content) as string | undefined
            return (
                <div key={key} className="flex items-center justify-center py-8 text-muted-foreground">
                    {emptyText ?? 'No data'}
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
            const src = component.src as string | undefined
            const name = component.name as string | undefined
            const fallback = component.fallback as string | undefined
            const altText = name ?? ''
            const fallbackText = fallback ?? (name ? name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?')
            return (
                <Avatar key={key}>
                    {src && <AvatarImage src={src} alt={altText} />}
                    <AvatarFallback>{fallbackText}</AvatarFallback>
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

        // ── Tier A ──────────────────────────────────────────────────

        case 'multiselect_input': {
            const label = component.label as string | undefined
            const rawOptions = (component.options ?? []) as unknown[]
            const value = (component.value ?? []) as string[]
            const opts = rawOptions.map(normalizeOption)
            return (
                <div key={key} className="space-y-2">
                    {label && <Label>{label}</Label>}
                    <div className="space-y-2">
                        {opts.map((opt) => (
                            <div key={opt.value} className="flex items-center space-x-2">
                                <Checkbox defaultChecked={value.includes(opt.value)} />
                                <Label>{opt.label}</Label>
                            </div>
                        ))}
                    </div>
                </div>
            )
        }

        case 'date_input': {
            const label = component.label as string | undefined
            const value = component.value as string | undefined
            return (
                <div key={key} className="space-y-2">
                    {label && <Label>{label}</Label>}
                    <Input type="date" defaultValue={value} />
                </div>
            )
        }

        case 'color_picker_input': {
            const label = component.label as string | undefined
            const value = (component.value as string) ?? '#000000'
            return (
                <div key={key} className="space-y-2">
                    {label && <Label>{label}</Label>}
                    <div className="flex items-center gap-3">
                        <input type="color" defaultValue={value} className="h-10 w-10 rounded border cursor-pointer" />
                        <span className="text-sm text-muted-foreground font-mono">{value}</span>
                    </div>
                </div>
            )
        }

        case 'audio_player': {
            const src = component.src as string | undefined
            const autoplay = component.autoplay as boolean | undefined
            return (
                <audio key={key} controls autoPlay={autoplay} src={src} className="w-full" />
            )
        }

        case 'video_player': {
            const src = component.src as string | undefined
            const autoplay = component.autoplay as boolean | undefined
            const poster = component.poster as string | undefined
            return (
                <video key={key} controls autoPlay={autoplay} src={src} poster={poster} className="w-full rounded-lg" />
            )
        }

        case 'file_download': {
            const label = (component.label ?? 'Download') as string
            const href = component.href as string | undefined
            const filename = component.filename as string | undefined
            return (
                <Button key={key} asChild>
                    <a href={href} download={filename ?? true}>{label}</a>
                </Button>
            )
        }

        // ── Tier B ──────────────────────────────────────────────────

        case 'toast': {
            const message = (component.message ?? component.content) as string | undefined
            const variant = component.variant as string | undefined
            const bgMap: Record<string, string> = {
                info: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
                success: 'bg-green-500/10 border-green-500/30 text-green-400',
                warning: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
                error: 'bg-red-500/10 border-red-500/30 text-red-400',
            }
            const classes = bgMap[variant ?? 'info'] ?? bgMap.info
            return (
                <div key={key} className={`rounded-lg border p-3 text-sm ${classes}`}>
                    {message ?? ''}
                </div>
            )
        }

        case 'dialog': {
            const title = component.title as string | undefined
            const description = component.description as string | undefined
            const children = component.children as ComponentDict[] | undefined
            return (
                <Dialog key={key}>
                    <DialogTrigger asChild>
                        <Button variant="outline">Open {title ?? 'Dialog'}</Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            {title && <DialogTitle>{title}</DialogTitle>}
                            {description && <DialogDescription>{description}</DialogDescription>}
                        </DialogHeader>
                        <div className="space-y-4">
                            {children && children.map((c, i) => renderComponent(c, i))}
                        </div>
                    </DialogContent>
                </Dialog>
            )
        }

        case 'caption': {
            const text = (component.text ?? component.content) as string | undefined
            return (
                <p key={key} className="text-xs text-muted-foreground">{text ?? ''}</p>
            )
        }

        case 'html_embed': {
            const content = (component.content ?? component.html) as string | undefined
            return (
                <div key={key} dangerouslySetInnerHTML={{ __html: content ?? '' }} />
            )
        }

        case 'skeleton': {
            const variant = (component.variant as string) ?? 'text'
            const width = component.width as string | undefined
            const height = component.height as string | undefined
            const variantMap: Record<string, string> = {
                text: 'h-4 w-full',
                card: 'h-32 w-full rounded-lg',
                avatar: 'h-10 w-10 rounded-full',
            }
            const baseClass = variantMap[variant] ?? variantMap.text
            return (
                <ShadcnSkeleton
                    key={key}
                    className={baseClass}
                    style={{
                        ...(width ? { width } : {}),
                        ...(height ? { height } : {}),
                    }}
                />
            )
        }

        case 'tooltip_wrap': {
            const child = component.child as ComponentDict | undefined
            const content = component.content as string | undefined
            return (
                <TooltipProvider key={key}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span>{child ? renderComponent(child, 0) : null}</span>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>{content ?? ''}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )
        }

        // ── Tier C ──────────────────────────────────────────────────

        case 'time_input': {
            const label = component.label as string | undefined
            const value = component.value as string | undefined
            return (
                <div key={key} className="space-y-2">
                    {label && <Label>{label}</Label>}
                    <Input type="time" defaultValue={value} />
                </div>
            )
        }

        case 'gallery': {
            const items = (component.items ?? []) as { src?: string; alt?: string; caption?: string }[]
            return (
                <div key={key} className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                    {items.map((item, i) => (
                        <figure key={i} className="space-y-1">
                            <img src={item.src} alt={item.alt ?? ''} className="rounded-lg w-full h-auto object-cover" />
                            {item.caption && <figcaption className="text-xs text-muted-foreground">{item.caption}</figcaption>}
                        </figure>
                    ))}
                </div>
            )
        }

        case 'breadcrumb': {
            const items = (component.items ?? []) as { label: string; href?: string }[]
            return (
                <Breadcrumb key={key}>
                    <BreadcrumbList>
                        {items.map((item, i) => {
                            const isLast = i === items.length - 1
                            return (
                                <React.Fragment key={i}>
                                    <BreadcrumbItem>
                                        {isLast || !item.href ? (
                                            <BreadcrumbPage>{item.label}</BreadcrumbPage>
                                        ) : (
                                            <BreadcrumbLink href={item.href}>{item.label}</BreadcrumbLink>
                                        )}
                                    </BreadcrumbItem>
                                    {!isLast && <BreadcrumbSeparator />}
                                </React.Fragment>
                            )
                        })}
                    </BreadcrumbList>
                </Breadcrumb>
            )
        }

        case 'pagination': {
            const total = (component.total as number) ?? 0
            const page = (component.page as number) ?? 1
            const perPage = (component.per_page as number) ?? 10
            const totalPages = Math.max(1, Math.ceil(total / perPage))

            // Calculate visible page numbers (up to 5)
            let startPage = Math.max(1, page - 2)
            const endPage = Math.min(totalPages, startPage + 4)
            startPage = Math.max(1, endPage - 4)
            const pages: number[] = []
            for (let p = startPage; p <= endPage; p++) pages.push(p)

            return (
                <ShadcnPagination key={key}>
                    <PaginationContent>
                        <PaginationItem>
                            <PaginationPrevious href="#" />
                        </PaginationItem>
                        {startPage > 1 && (
                            <PaginationItem>
                                <PaginationEllipsis />
                            </PaginationItem>
                        )}
                        {pages.map((p) => (
                            <PaginationItem key={p}>
                                <PaginationLink href="#" isActive={p === page}>{p}</PaginationLink>
                            </PaginationItem>
                        ))}
                        {endPage < totalPages && (
                            <PaginationItem>
                                <PaginationEllipsis />
                            </PaginationItem>
                        )}
                        <PaginationItem>
                            <PaginationNext href="#" />
                        </PaginationItem>
                    </PaginationContent>
                </ShadcnPagination>
            )
        }

        case 'key_value_list': {
            const items = (component.items ?? []) as { label: string; value: string | number }[]
            const title = component.title as string | undefined
            return (
                <Card key={key}>
                    {title && (
                        <CardHeader>
                            <CardTitle>{title}</CardTitle>
                        </CardHeader>
                    )}
                    <CardContent>
                        <div className="space-y-2">
                            {items.map((item, i) => (
                                <div key={i} className="flex justify-between items-center py-1">
                                    <span className="text-sm text-muted-foreground">{item.label}</span>
                                    <span className="text-sm font-medium">{String(item.value ?? '')}</span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )
        }

        case 'popover': {
            const trigger = component.trigger as ComponentDict | undefined
            const children = component.children as ComponentDict[] | undefined
            return (
                <Popover key={key}>
                    <PopoverTrigger asChild>
                        <span>{trigger ? renderComponent(trigger, 0) : <Button variant="outline">Open</Button>}</span>
                    </PopoverTrigger>
                    <PopoverContent>
                        <div className="space-y-4">
                            {children && children.map((c, i) => renderComponent(c, i))}
                        </div>
                    </PopoverContent>
                </Popover>
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
