"""The utility classes a docs page may use (``className`` / ``class``), for ``aiui validate`` 7022.

``CLASS_PATTERNS`` mirrors ``CLASS_PATTERNS`` in ``src/frontend/src/docs/docsClasses.ts``
word for word (``tests/unit/test_docs_classes.py`` checks); the browser drops any other class.
"""

from __future__ import annotations

import re

#: Mirrors ``CLASS_PATTERNS`` in ``src/frontend/src/docs/docsClasses.ts``.
CLASS_PATTERNS: tuple[str, ...] = (
    "{,sm:,md:,lg:}{block,inline-block,inline,flex,inline-flex,grid,hidden}",
    "dark:{block,inline-block,inline,flex,grid,hidden}",
    "{,sm:,md:,lg:}{flex-row,flex-col,grid-cols-1,grid-cols-2,grid-cols-3,grid-cols-4,text-left,text-center,text-right,w-full,w-1/2,w-1/3,w-2/3}",
    "{flex-wrap,flex-1,flex-none,shrink-0,items-start,items-center,items-end,items-baseline,justify-start,justify-center,justify-end,justify-between,self-start,self-center,self-end,col-span-2,col-span-3,col-span-full}",
    "{gap,gap-x,gap-y}-{0,1,2,3,4,6,8}",
    "{m,mx,my,mt,mb,p,px,py,pt,pb}-{0,1,2,3,4,6,8,12}",
    "mx-auto",
    "text-{xs,sm,base,lg,xl,2xl,3xl}",
    "font-{normal,medium,semibold,bold,mono}",
    "{italic,underline,no-underline,uppercase,truncate,whitespace-nowrap,break-words,leading-tight,leading-normal,leading-relaxed,tracking-tight,tracking-wide}",
    "text-{foreground,muted-foreground,primary,primary-foreground,destructive,success,warning,info}",
    "bg-{background,card,muted,accent,primary,secondary}",
    "{border,border-0,border-2,border-t,border-b,border-dashed,border-border,border-primary}",
    "rounded{,-none,-sm,-md,-lg,-xl,-full}",
    "{w-auto,w-fit,w-1/4,w-3/4,h-auto,min-w-0,aspect-video,aspect-square,object-cover,object-contain,overflow-hidden,overflow-x-auto,opacity-50,opacity-75}",
    "max-w-{xs,sm,md,lg,xl,2xl,full,prose}",
)

_BRACE = re.compile(r"\{([^{}]*)\}")


def expand(pattern: str) -> list[str]:
    """``a{b,c}d{e,f}`` -> abde, abdf, acde, acdf (no nesting)."""
    m = _BRACE.search(pattern)
    if not m:
        return [pattern]
    head, tail = pattern[: m.start()], pattern[m.end():]
    return [name for alt in m.group(1).split(",") for name in expand(head + alt + tail)]


#: Every class a docs page may use.
DOCS_CLASSES: frozenset[str] = frozenset(name for p in CLASS_PATTERNS for name in expand(p))
