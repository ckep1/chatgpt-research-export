## ChatGPT Research Export
A Tampermonkey userscript that exports ChatGPT conversations and deep research results to clean markdown with configurable citation styles.

### Features
- Export both regular conversations and deep research results as markdown
- 6 citation styles: endnotes, footnotes, inline, parenthesized, named (domain-based), or none
- Download as file or copy to clipboard
- Optional YAML frontmatter (title, date, source URL)
- Optional title as H1 heading
- Standard or extra-newline spacing
- Full HTML-to-markdown conversion including tables, code blocks, blockquotes, and nested lists
- Deduplicates citations from the same source URL
- Buttons and options panel positioned above the ChatGPT composer
- Handles SPA navigation between chats

### Installation
1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Install the script from [Greasy Fork](https://greasyfork.org/en/scripts/528076-chatgpt-deep-research-markdown-exporter), or open `chatgpt-research-export.user.js` directly in your browser
3. Visit ChatGPT and open any conversation or deep research result

### Usage
Export buttons appear above the ChatGPT composer when content is detected:
- **Save/Copy Conversation as Markdown** -- shown when conversation turns exist
- **Save/Copy Research as Markdown** -- shown when deep research content exists
- **Options** -- opens a panel to configure citation style, spacing, frontmatter, title heading, and export method

All preferences persist across sessions via Tampermonkey storage.

### Requirements
- Tampermonkey or compatible userscript manager
- Works on chatgpt.com and chat.openai.com

### License
MIT
