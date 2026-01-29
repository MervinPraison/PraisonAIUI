// Official shadcn/ui theme presets from themes.shadcn.com
// Users can specify these in YAML: site.theme.preset: "zinc"
export const SHADCN_THEMES: Record<string, { light: Record<string, string>; dark: Record<string, string> }> = {
    zinc: {
        light: {
            '--background': '0 0% 100%',
            '--foreground': '240 10% 3.9%',
            '--card': '0 0% 100%',
            '--card-foreground': '240 10% 3.9%',
            '--primary': '240 5.9% 10%',
            '--primary-foreground': '0 0% 98%',
            '--secondary': '240 4.8% 95.9%',
            '--muted': '240 4.8% 95.9%',
            '--muted-foreground': '240 3.8% 46.1%',
            '--accent': '240 4.8% 95.9%',
            '--border': '240 5.9% 90%',
        },
        dark: {
            '--background': '240 10% 3.9%',
            '--foreground': '0 0% 98%',
            '--card': '240 10% 3.9%',
            '--card-foreground': '0 0% 98%',
            '--primary': '0 0% 98%',
            '--primary-foreground': '240 5.9% 10%',
            '--secondary': '240 3.7% 15.9%',
            '--muted': '240 3.7% 15.9%',
            '--muted-foreground': '240 5% 64.9%',
            '--accent': '240 3.7% 15.9%',
            '--border': '240 3.7% 15.9%',
        },
    },
    slate: {
        light: {
            '--background': '0 0% 100%',
            '--foreground': '222.2 84% 4.9%',
            '--primary': '222.2 47.4% 11.2%',
            '--primary-foreground': '210 40% 98%',
            '--secondary': '210 40% 96.1%',
            '--muted': '210 40% 96.1%',
            '--muted-foreground': '215.4 16.3% 46.9%',
            '--accent': '210 40% 96.1%',
            '--border': '214.3 31.8% 91.4%',
        },
        dark: {
            '--background': '222.2 84% 4.9%',
            '--foreground': '210 40% 98%',
            '--primary': '210 40% 98%',
            '--primary-foreground': '222.2 47.4% 11.2%',
            '--secondary': '217.2 32.6% 17.5%',
            '--muted': '217.2 32.6% 17.5%',
            '--muted-foreground': '215 20.2% 65.1%',
            '--accent': '217.2 32.6% 17.5%',
            '--border': '217.2 32.6% 17.5%',
        },
    },
    green: {
        light: {
            '--background': '0 0% 100%',
            '--foreground': '240 10% 3.9%',
            '--primary': '142.1 76.2% 36.3%',
            '--primary-foreground': '355.7 100% 97.3%',
            '--secondary': '240 4.8% 95.9%',
            '--muted': '240 4.8% 95.9%',
            '--muted-foreground': '240 3.8% 46.1%',
            '--accent': '240 4.8% 95.9%',
            '--border': '240 5.9% 90%',
        },
        dark: {
            '--background': '20 14.3% 4.1%',
            '--foreground': '0 0% 95%',
            '--primary': '142.1 70.6% 45.3%',
            '--primary-foreground': '144.9 80.4% 10%',
            '--secondary': '240 3.7% 15.9%',
            '--muted': '0 0% 15%',
            '--muted-foreground': '240 5% 64.9%',
            '--accent': '12 6.5% 15.1%',
            '--border': '240 3.7% 15.9%',
        },
    },
    blue: {
        light: {
            '--background': '0 0% 100%',
            '--foreground': '222.2 84% 4.9%',
            '--primary': '221.2 83.2% 53.3%',
            '--primary-foreground': '210 40% 98%',
            '--secondary': '210 40% 96.1%',
            '--muted': '210 40% 96.1%',
            '--muted-foreground': '215.4 16.3% 46.9%',
            '--accent': '210 40% 96.1%',
            '--border': '214.3 31.8% 91.4%',
        },
        dark: {
            '--background': '222.2 84% 4.9%',
            '--foreground': '210 40% 98%',
            '--primary': '217.2 91.2% 59.8%',
            '--primary-foreground': '222.2 47.4% 11.2%',
            '--secondary': '217.2 32.6% 17.5%',
            '--muted': '217.2 32.6% 17.5%',
            '--muted-foreground': '215 20.2% 65.1%',
            '--accent': '217.2 32.6% 17.5%',
            '--border': '217.2 32.6% 17.5%',
        },
    },
    violet: {
        light: {
            '--background': '0 0% 100%',
            '--foreground': '224 71.4% 4.1%',
            '--primary': '262.1 83.3% 57.8%',
            '--primary-foreground': '210 20% 98%',
            '--secondary': '220 14.3% 95.9%',
            '--muted': '220 14.3% 95.9%',
            '--muted-foreground': '220 8.9% 46.1%',
            '--accent': '220 14.3% 95.9%',
            '--border': '220 13% 91%',
        },
        dark: {
            '--background': '224 71.4% 4.1%',
            '--foreground': '210 20% 98%',
            '--primary': '263.4 70% 50.4%',
            '--primary-foreground': '210 20% 98%',
            '--secondary': '215 27.9% 16.9%',
            '--muted': '215 27.9% 16.9%',
            '--muted-foreground': '217.9 10.6% 64.9%',
            '--accent': '215 27.9% 16.9%',
            '--border': '215 27.9% 16.9%',
        },
    },
    orange: {
        light: {
            '--background': '0 0% 100%',
            '--foreground': '20 14.3% 4.1%',
            '--primary': '24.6 95% 53.1%',
            '--primary-foreground': '60 9.1% 97.8%',
            '--secondary': '60 4.8% 95.9%',
            '--muted': '60 4.8% 95.9%',
            '--muted-foreground': '25 5.3% 44.7%',
            '--accent': '60 4.8% 95.9%',
            '--border': '20 5.9% 90%',
        },
        dark: {
            '--background': '20 14.3% 4.1%',
            '--foreground': '60 9.1% 97.8%',
            '--primary': '20.5 90.2% 48.2%',
            '--primary-foreground': '60 9.1% 97.8%',
            '--secondary': '12 6.5% 15.1%',
            '--muted': '12 6.5% 15.1%',
            '--muted-foreground': '24 5.4% 63.9%',
            '--accent': '12 6.5% 15.1%',
            '--border': '12 6.5% 15.1%',
        },
    },
    rose: {
        light: {
            '--background': '0 0% 100%',
            '--foreground': '240 10% 3.9%',
            '--primary': '346.8 77.2% 49.8%',
            '--primary-foreground': '355.7 100% 97.3%',
            '--secondary': '240 4.8% 95.9%',
            '--muted': '240 4.8% 95.9%',
            '--muted-foreground': '240 3.8% 46.1%',
            '--accent': '240 4.8% 95.9%',
            '--border': '240 5.9% 90%',
        },
        dark: {
            '--background': '20 14.3% 4.1%',
            '--foreground': '0 0% 95%',
            '--primary': '346.8 77.2% 49.8%',
            '--primary-foreground': '355.7 100% 97.3%',
            '--secondary': '240 3.7% 15.9%',
            '--muted': '0 0% 15%',
            '--muted-foreground': '240 5% 64.9%',
            '--accent': '12 6.5% 15.1%',
            '--border': '240 3.7% 15.9%',
        },
    },
    yellow: {
        light: {
            '--background': '0 0% 100%',
            '--foreground': '20 14.3% 4.1%',
            '--primary': '47.9 95.8% 53.1%',
            '--primary-foreground': '26 83.3% 14.1%',
            '--secondary': '60 4.8% 95.9%',
            '--muted': '60 4.8% 95.9%',
            '--muted-foreground': '25 5.3% 44.7%',
            '--accent': '60 4.8% 95.9%',
            '--border': '20 5.9% 90%',
        },
        dark: {
            '--background': '20 14.3% 4.1%',
            '--foreground': '60 9.1% 97.8%',
            '--primary': '47.9 95.8% 53.1%',
            '--primary-foreground': '26 83.3% 14.1%',
            '--secondary': '12 6.5% 15.1%',
            '--muted': '12 6.5% 15.1%',
            '--muted-foreground': '24 5.4% 63.9%',
            '--accent': '12 6.5% 15.1%',
            '--border': '12 6.5% 15.1%',
        },
    },
}

export const RADIUS_PRESETS: Record<string, string> = {
    none: '0',
    sm: '0.3rem',
    md: '0.5rem',
    lg: '0.75rem',
    xl: '1rem',
}

export function applyTheme(preset: string = 'zinc', darkMode: boolean = true, radius: string = 'md') {
    const root = document.documentElement
    const theme = SHADCN_THEMES[preset] || SHADCN_THEMES.zinc
    const colors = darkMode ? theme.dark : theme.light

    // Apply colors (HSL format for shadcn compatibility)
    Object.entries(colors).forEach(([key, value]) => {
        root.style.setProperty(key, value)
    })

    // Apply radius
    root.style.setProperty('--radius', RADIUS_PRESETS[radius] || RADIUS_PRESETS.md)

    // Toggle dark class
    if (darkMode) {
        document.documentElement.classList.add('dark')
    } else {
        document.documentElement.classList.remove('dark')
    }
}
