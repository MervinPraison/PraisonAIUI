# Layout components

Columns, card, step, accordion, tab and code group options (specs/docs-layout.spec.ts).

## Columns

<Columns cols={2}>
<Column>
Left column text.
</Column>
<Column>
Right column text.
</Column>
</Columns>

## Card options

<CardGroup cols={2}>
<Card title="Horizontal card" icon="rocket" horizontal href="guide/first.md" color="#0f766e" />
<Card title="Image card" img="images/sample.png" cta="Open the guide" href="guide/second.md">
A card with a header image.
</Card>
</CardGroup>

## Step options

<Steps titleSize="h3">
<Step title="Install the package" stepNumber={3} icon="terminal">
Run the installer.
</Step>
<Step title="Start the server">
Then start it.
</Step>
</Steps>

## Accordion options

<Accordion title="Deep-linked answer" description="Opens from the address bar" icon="code" id="deep-answer">
The answer inside the accordion.
</Accordion>

## Tab options

<Tabs>
<Tab title="macOS">
### Mac setup

Mac text in the first set.
</Tab>
<Tab title="Windows" icon="terminal" id="windows-tab">
### Windows setup

Windows text in the first set.
</Tab>
</Tabs>

<Tabs defaultTabIndex={1} borderBottom>
<Tab title="Linux">
Linux text in the second set.
</Tab>
<Tab title="macOS">
Mac text in the second set.
</Tab>
<Tab title="Windows">
Windows text in the second set.
</Tab>
</Tabs>

<Tabs sync={false}>
<Tab title="macOS">
Mac text in the unsynced set.
</Tab>
<Tab title="Windows">
Windows text in the unsynced set.
</Tab>
</Tabs>

## Dropdown code group

<CodeGroup dropdown>

```bash pip
pip install aiui
```

```bash uv
uv pip install aiui
```

</CodeGroup>
