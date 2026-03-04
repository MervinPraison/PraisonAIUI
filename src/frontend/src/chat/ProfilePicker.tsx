import { useState, useEffect, useRef, useCallback } from 'react'

interface Profile {
    id: string
    name: string
    description?: string
    icon?: string
    active?: boolean
}

interface ProfilePickerProps {
    className?: string
}

export function ProfilePicker({ className = '' }: ProfilePickerProps) {
    const [profiles, setProfiles] = useState<Profile[]>([])
    const [open, setOpen] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)

    // Fetch profiles from the backend
    useEffect(() => {
        fetch('/profiles')
            .then((res) => res.json())
            .then((data) => {
                if (data.profiles && data.profiles.length > 0) {
                    setProfiles(data.profiles)
                }
            })
            .catch(() => {
                // No profiles endpoint or error — that's fine
            })
    }, [])

    // Close dropdown on outside click
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        if (open) {
            document.addEventListener('mousedown', handleClickOutside)
            return () => document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [open])

    const handleSelect = useCallback((profile: Profile) => {
        // POST to backend to switch agent (uses the profile id)
        fetch('/profiles/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile_id: profile.id }),
        }).catch(() => { })

        // Optimistically update active state
        setProfiles((prev) =>
            prev.map((p) => ({ ...p, active: p.id === profile.id }))
        )
        setOpen(false)
    }, [])

    // Don't render anything if no profiles available
    if (profiles.length === 0) return null

    const active = profiles.find((p) => p.active) || profiles[0]

    return (
        <div className={`relative ${className}`} ref={dropdownRef}>
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-background hover:bg-accent transition-colors text-sm"
            >
                {active.icon && <span>{active.icon}</span>}
                <span className="font-medium">{active.name}</span>
                <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`transition-transform ${open ? 'rotate-180' : ''}`}
                >
                    <path d="m6 9 6 6 6-6" />
                </svg>
            </button>

            {open && (
                <div className="absolute top-full left-0 mt-1 w-56 rounded-lg border bg-popover shadow-lg z-50 py-1 animate-in fade-in slide-in-from-top-1">
                    {profiles.map((profile) => (
                        <button
                            key={profile.id}
                            onClick={() => handleSelect(profile)}
                            className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${profile.active
                                    ? 'bg-accent/50 text-accent-foreground'
                                    : 'text-foreground'
                                }`}
                        >
                            {profile.icon && (
                                <span className="text-base">{profile.icon}</span>
                            )}
                            <div className="flex-1 min-w-0">
                                <div className="font-medium truncate">{profile.name}</div>
                                {profile.description && (
                                    <div className="text-xs text-muted-foreground truncate">
                                        {profile.description}
                                    </div>
                                )}
                            </div>
                            {profile.active && (
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="text-primary shrink-0"
                                >
                                    <path d="M20 6 9 17l-5-5" />
                                </svg>
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
