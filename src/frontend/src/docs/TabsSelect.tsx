// The menu of a dropdown code group (<CodeGroup dropdown>, DocsTabs.tsx): a
// lazy chunk, so pages without one never load the select primitive.
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Props = { titles: readonly string[]; value: number; onChange: (index: number) => void }

export default function TabsSelect({ titles, value, onChange }: Props) {
    return (
        <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
            <SelectTrigger size="sm" aria-label="Choose a code sample" className="aiui-tabs-select border-0 bg-transparent font-medium text-foreground shadow-none">
                <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
                {titles.map((t, i) => (
                    <SelectItem key={i} value={String(i)}>{t}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
